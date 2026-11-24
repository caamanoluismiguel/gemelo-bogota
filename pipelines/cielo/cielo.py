#!/usr/bin/env python3
"""Tarjeta «el cielo de Bogotá ahora»: arma data/cielo/ahora.json.

Solo usa la biblioteca estándar de Python (3.10 o más nueva) y ninguna clave.

Uso:
    python3 pipelines/cielo/cielo.py --salida data/cielo \
        [--anterior data/cielo/ahora.json | --anterior https://.../cielo/ahora.json]

Reglas que cumple el archivo (panel/respuestas-gemelo.md, sección 12.1):
  * Cada bloque lleva fuente, URL, hora del dato, hora de consulta, licencia y
    etiqueta (medido o estimado, de la lista común del sitio).
  * Si una fuente falla, el bloque dice «falla», guarda el último valor bueno
    que había en el JSON anterior y su edad. Nunca se inventa un valor.
  * El gemelo no emite alertas propias. Ningún campo dice «alerta», «riesgo»
    ni «evacúe»; las alertas oficiales son del IDIGER y del IDEAM.
  * Nada de RMCAB.
  * Licencias: cada bloque conserva la suya. Ningún cálculo mezcla fuentes NC
    (SAB del IDIGER) con fuentes SA (IDEAM). El único cálculo propio sobre
    datos NC es el resumen por localidad del SAB, que solo usa datos del SAB.

Etiquetas (la misma lista del sitio: medido, de fuente, inferido, estimado,
supuesto; esta tarjeta usa solo las dos primeras de aquí abajo):
  medido    lo registró un instrumento (pluviómetro, estación de aeropuerto,
            sismógrafo, detección de calor por satélite, imagen de satélite).
  estimado  sale de un modelo o de una relación teórica a partir de medidas
            (UV de CAMS, lluvia del radar por Marshall‑Palmer). Los
            pronósticos también son estimado.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

UA = "gemelo-bogota-cielo/0.1 (datos abiertos; sitio estatico)"
BOGOTA = (4.65, -74.10)  # centro aproximado de referencia para distancias
TZ_BOGOTA = timezone(timedelta(hours=-5))  # Colombia no usa horario de verano

# Caja de la Sabana de Bogotá para focos de calor: 4,30 a 5,20 N y 74,50 a 73,70 O.
SABANA = {"lat_min": 4.30, "lat_max": 5.20, "lon_min": -74.50, "lon_max": -73.70}
# Caja que se pide a GIBS para la imagen de GOES (Bogotá y bordes).
CAJA_GOES = {"lat_min": 4.25, "lat_max": 5.05, "lon_min": -74.50, "lon_max": -73.70}
# Relleno Doña Juana, aproximado [inferido]: un foco aquí puede ser calor del relleno.
DONA_JUANA = (4.505, -74.137)

VIGENCIA_MIN = {  # más allá de esto la tarjeta no lo muestra como «ahora»
    "metar": 90,
    "sab": 30,
    "radar": 60,
    "goes": 60,
}

LIC = {
    "noaa_nws": {
        "nombre": "Dominio público (NOAA/NWS)",
        "url": "https://www.weather.gov/disclaimer",
        "familia": "dominio_publico",
    },
    "usgs": {
        "nombre": "Dominio público de EE. UU. (USGS)",
        "url": "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
        "familia": "dominio_publico",
    },
    "nasa_firms": {
        "nombre": "Datos abiertos de la NASA; citar «NASA FIRMS»",
        "url": "https://www.earthdata.nasa.gov/data/tools/firms/faq",
        "familia": "dominio_publico",
    },
    "goes_gibs": {
        "nombre": "Dominio público (NOAA GOES‑19), servido por NASA GIBS; se pide reconocimiento",
        "url": "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance",
        "familia": "dominio_publico",
    },
    "cams_openmeteo": {
        "nombre": "Datos CC BY 4.0 (CAMS de Copernicus vía Open‑Meteo); la API gratis de Open‑Meteo es solo para uso no comercial",
        "url": "https://open-meteo.com/en/terms",
        "familia": "cc_by_servicio_nc",
    },
    "ideam_sa": {
        "nombre": "CC BY‑SA 4.0 (IDEAM)",
        "url": "https://www.datos.gov.co/d/9ii9-i4ym",
        "familia": "cc_by_sa",
    },
    "idiger_nc": {
        "nombre": "CC BY‑NC 4.0 (IDIGER)",
        "url": "https://datosabiertos.bogota.gov.co/dataset/sab-sistema-de-alerta-de-bogota-lluvia-minutal-idiger-bogota-d-c",
        "familia": "cc_by_nc",
    },
}


# ---------------------------------------------------------------- utilidades

def ahora_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def de_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def edad_min(dt: datetime | None, ref: datetime) -> int | None:
    if dt is None:
        return None
    return int((ref - dt).total_seconds() // 60)


def bajar(url: str, intentos: int = 3, timeout: int = 40, cabeceras: dict | None = None) -> tuple[bytes, dict]:
    """GET con reintentos. Devuelve el cuerpo y las cabeceras."""
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(cabeceras or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(), dict(r.headers)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            ultimo = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"no respondió tras {intentos} intentos: {ultimo}")


def bajar_json(url: str):
    cuerpo, _ = bajar(url)
    return json.loads(cuerpo.decode("utf-8"))


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return round(6371.0 * 2 * math.asin(math.sqrt(h)), 1)


def en_caja(lat: float, lon: float, c: dict) -> bool:
    return c["lat_min"] <= lat <= c["lat_max"] and c["lon_min"] <= lon <= c["lon_max"]


def bloque(fuente: str, url: str, licencia: str, etiqueta: str, consulta: datetime) -> dict:
    return {
        "estado": "ok",
        "fuente": fuente,
        "url": url,
        "licencia": LIC[licencia],
        "etiqueta": etiqueta,
        "hora_consulta": iso(consulta),
        "hora_dato": None,
    }


# ---------------------------------------------------------------- fuentes

def metar(consulta: datetime) -> dict:
    url = "https://aviationweather.gov/api/data/metar?ids=SKBO,SKGY&format=json&hours=2"
    b = bloque("Aviation Weather Center (NOAA/NWS), METAR", url, "noaa_nws", "medido", consulta)
    b["rotulo"] = "Aeropuerto, no tu calle"
    datos = bajar_json(url)
    ultimos: dict[str, dict] = {}
    for m in datos:
        icao = m.get("icaoId")
        if icao and (icao not in ultimos or m["obsTime"] > ultimos[icao]["obsTime"]):
            ultimos[icao] = m
    nombres = {"SKBO": "El Dorado", "SKGY": "Guaymaral"}
    estaciones = []
    for icao in ("SKBO", "SKGY"):
        m = ultimos.get(icao)
        if not m:
            estaciones.append({"icao": icao, "nombre": nombres[icao], "estado": "sin_reporte"})
            continue
        obs = datetime.fromtimestamp(m["obsTime"], timezone.utc)
        estaciones.append({
            "icao": icao,
            "nombre": nombres[icao],
            "lat": m.get("lat"), "lon": m.get("lon"), "elevacion_m": m.get("elev"),
            "hora_dato": iso(obs),
            "edad_min": edad_min(obs, consulta),
            "vigente": edad_min(obs, consulta) <= VIGENCIA_MIN["metar"],
            "temperatura_c": m.get("temp"),
            "punto_rocio_c": m.get("dewp"),
            "viento_dir_grados": m.get("wdir"),
            "viento_nudos": m.get("wspd"),
            "rafaga_nudos": m.get("wgst"),
            "visibilidad_millas": m.get("visib"),
            "fenomenos": m.get("wxString"),
            "nubes": m.get("clouds"),
            "qnh_hpa": m.get("altim"),
            "nota_qnh": "QNH es la presión reducida al nivel del mar; no es la presión en Bogotá (unos 752 hPa).",
            "texto": m.get("rawOb"),
        })
    b["estaciones"] = estaciones
    horas = [de_iso(e["hora_dato"]) for e in estaciones if e.get("hora_dato")]
    b["hora_dato"] = iso(max(horas)) if horas else None
    if not horas:
        raise RuntimeError("AWC respondió sin METAR de SKBO ni SKGY")
    return b


def sab_lluvia(consulta: datetime) -> dict:
    url = "https://app.sab.gov.co//sab/ServletTipoSensores?idtiposensor=5"
    b = bloque("IDIGER, Sistema de Alerta de Bogotá (SAB), pluviómetros", url, "idiger_nc", "medido", consulta)
    b["ficha"] = LIC["idiger_nc"]["url"]
    b["nota"] = ("Datos crudos sin validar en su totalidad, según el IDIGER. El acumulado del día se "
                 "reinicia a las 00:00 hora de Bogotá. Las alertas oficiales son del IDIGER.")
    b["enlace_alertas_oficiales"] = "https://www.idiger.gov.co"
    datos = bajar_json(url)["TipoSensores"]
    hoy_local = consulta.astimezone(TZ_BOGOTA).date()
    estaciones = []
    for s in datos:
        if s.get("VISIBLE") != 1:
            continue
        f = s.get("FECHALECTURA")
        dt = None
        if f:
            # FECHALECTURA viene en hora de Bogotá (comprobado: 16:35 cuando eran 21:37 UTC).
            dt = datetime.strptime(f.split(".")[0], "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ_BOGOTA)
        sin_hoy = dt is None or dt.date() != hoy_local
        estaciones.append({
            "id": s.get("IDESTACION"),
            "nombre": s.get("ESTACION"),
            "localidad": (s.get("LOCALIDAD") or "").title(),
            "lat": s.get("LATITUD"), "lon": s.get("LONGITUD"),
            "hora_dato": iso(dt),
            "edad_min": edad_min(dt, consulta),
            "sin_dato_hoy": sin_hoy,
            # Si no hay dato de hoy, el acumulado es de otro día: no se muestra como de hoy.
            "acumulado_hoy_mm": None if sin_hoy else s.get("ACUMULADODIA"),
            "ultimo_minuto_mm": None if sin_hoy else s.get("VALORLECTURA"),
        })
    b["estaciones"] = estaciones
    # Resumen por localidad: solo datos del SAB (familia NC), sin mezclar con nada más.
    por_loc: dict[str, list] = {}
    for e in estaciones:
        por_loc.setdefault(e["localidad"], []).append(e)
    resumen = []
    for loc, es in sorted(por_loc.items()):
        con = [e for e in es if not e["sin_dato_hoy"] and e["acumulado_hoy_mm"] is not None]
        mayor = max(con, key=lambda e: e["acumulado_hoy_mm"]) if con else None
        resumen.append({
            "localidad": loc,
            "estaciones": len(es),
            "con_dato_hoy": len(con),
            "acumulado_hoy_max_mm": mayor["acumulado_hoy_mm"] if mayor else None,
            "estacion_del_max": mayor["nombre"] if mayor else None,
            "lloviendo_ultimo_minuto": any((e["ultimo_minuto_mm"] or 0) > 0 for e in con),
        })
    b["por_localidad"] = resumen
    b["como_se_calcula"] = ("Máximo del acumulado de hoy entre las estaciones del SAB de cada localidad "
                            "con dato de hoy. Calculado por el gemelo solo con datos del SAB.")
    horas = [de_iso(e["hora_dato"]) for e in estaciones if e["hora_dato"]]
    b["hora_dato"] = iso(max(horas)) if horas else None
    b["vigente"] = bool(horas) and edad_min(max(horas), consulta) <= VIGENCIA_MIN["sab"]
    return b


def _listado(url: str) -> list[tuple[str, datetime]]:
    html, _ = bajar(url)
    pat = re.compile(r'href="(P_RAD_TAB_COL_(\d{12})_\w+?_Map\.png)"')
    out = []
    for nombre, sello in pat.findall(html.decode("latin-1")):
        out.append((nombre, datetime.strptime(sello, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)))
    return sorted(set(out), key=lambda x: x[1])


def radar_tablazo(consulta: datetime) -> dict:
    base = "https://bart.ideam.gov.co/ospa/DatosAbiertos/Acumulados_Precipitacion_Radar/Tablazo/"
    b = bloque("IDEAM, Oficina de Pronósticos y Alertas, radar de Tablazo (acumulados)", base, "ideam_sa", "estimado", consulta)
    b["aviso_de_la_fuente"] = "Producto en evaluación. No son valores oficiales de precipitación."
    b["metodo"] = "Lluvia estimada con la relación de Marshall‑Palmer sobre la reflectividad del radar [fuente: ficha 9ii9-i4ym]."
    b["decision_imagen"] = (
        "Enlazar a pedido, no copiar todavía. La imagen pesa unos 290 KB y cubre de 2,3 a 7,6 N; en teléfono "
        "no se carga sola. El navegador la abre solo si la persona toca el enlace, así el sitio no consulta al "
        "IDEAM en cada visita. Siguiente paso propuesto: recortarla a Bogotá en Actions (requiere Pillow) y "
        "publicar el recorte aparte como CC BY‑SA 4.0 con crédito al IDEAM y con su aviso.")
    imagenes = {}
    for ventana in ("01H", "24H"):
        encontrado = None
        for dias in (0, 1):  # carpeta de hoy y, si está vacía, la de ayer (fecha UTC)
            d = (consulta - timedelta(days=dias)).strftime("%Y/%m/%d")
            lista = _listado(f"{base}{d}/{ventana}/")
            if lista:
                nombre, sello = lista[-1]
                encontrado = (f"{base}{d}/{ventana}/{nombre}", sello)
                break
        if not encontrado:
            imagenes[ventana] = {"estado": "sin_imagen"}
            continue
        url, sello = encontrado
        _, cab = bajar(url, cabeceras={"Range": "bytes=0-7"})  # confirma que existe sin bajarla entera
        e = edad_min(sello, consulta)
        imagenes[ventana] = {
            "url": url,
            "hora_dato": iso(sello),
            "nota_hora": "Hora del nombre del archivo, en UTC; se toma como el fin de la ventana de acumulación [inferido].",
            "edad_min": e,
            "mostrar_como_actual": e <= VIGENCIA_MIN["radar"],
            "texto_si_vieja": None if e <= VIGENCIA_MIN["radar"] else "Radar sin imagen reciente",
            "tipo": cab.get("Content-Type"),
        }
    b["imagenes"] = imagenes
    horas = [de_iso(v["hora_dato"]) for v in imagenes.values() if v.get("hora_dato")]
    if not horas:
        raise RuntimeError("no hallé imágenes de Tablazo de hoy ni de ayer")
    b["hora_dato"] = iso(max(horas))
    return b


def goes19(consulta: datetime, salida: str) -> dict:
    capa = "GOES-East_ABI_GeoColor"
    dominios = (f"https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/{capa}/default/2km/all/"
                f"{iso(consulta - timedelta(hours=6))}--{iso(consulta)}.xml")
    b = bloque("NOAA GOES‑19 ABI GeoColor, servido por NASA GIBS", dominios, "goes_gibs", "medido", consulta)
    b["credito"] = "Imagen: NOAA GOES‑19, vía NASA Worldview/GIBS."
    b["decision_imagen"] = (
        "Copiar. Es dominio público, el recorte de Bogotá pesa unos 40 KB en JPEG y el WMS de GIBS falló "
        "en cerca de la mitad de las consultas de prueba del 23 nov 2026 (respuesta HTML en vez de imagen). "
        "Copiarla una vez por corrida evita que el teléfono vea una imagen rota.")
    xml, _ = bajar(dominios)
    m = re.search(r"<Domain>([^<]+)</Domain>", xml.decode("utf-8"))
    if not m:
        raise RuntimeError("GIBS no devolvió el dominio de tiempos")
    # Formato: inicio/fin/PT10M, separados por comas. Se arman los tiempos más recientes primero.
    tiempos = []
    for tramo in m.group(1).split(","):
        partes = tramo.split("/")
        if len(partes) == 3:
            ini, fin = de_iso(partes[0] if "T" in partes[0] else partes[0] + "T00:00:00Z"), de_iso(partes[1])
            paso = timedelta(minutes=int(re.sub(r"\D", "", partes[2])))
            t = fin
            while t >= ini and len(tiempos) < 200:
                tiempos.append(t)
                t -= paso
        else:
            tiempos.append(de_iso(partes[0]))
    tiempos = sorted(set(tiempos), reverse=True)[:12]
    c = CAJA_GOES
    for t in tiempos:
        url = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap"
               f"&VERSION=1.1.1&LAYERS={capa}&STYLES=&SRS=EPSG:4326"
               f"&BBOX={c['lon_min']},{c['lat_min']},{c['lon_max']},{c['lat_max']}"
               f"&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg&TIME={iso(t)}")
        try:
            cuerpo, cab = bajar(url, intentos=2)
        except RuntimeError:
            continue
        if not cuerpo.startswith(b"\xff\xd8"):  # GIBS a veces responde HTML con código 200
            continue
        if len(cuerpo) < 8000:
            # Un JPEG de 512 x 512 de menos de 8 KB es un cuadro negro: GIBS anuncia el tiempo antes de
            # tener la imagen (comprobado el 23 nov 2026: negro 1,8 KB, imagen real unos 38 KB).
            continue
        nombre = "goes19-bogota.jpg"
        with open(os.path.join(salida, nombre), "wb") as fh:
            fh.write(cuerpo)
        b.update({
            "url": url,
            "url_dominios": dominios,
            "hora_dato": iso(t),
            "edad_min": edad_min(t, consulta),
            "vigente": edad_min(t, consulta) <= VIGENCIA_MIN["goes"],
            "archivo_local": nombre,
            "bytes": len(cuerpo),
            "caja": c,
            "nota": "Imagen GeoColor: color real de día, nubes en infrarrojo de noche. No dice cuánto llueve.",
        })
        return b
    raise RuntimeError("GIBS no entregó imagen válida para ninguno de los 12 tiempos más recientes")


def uv_cams(consulta: datetime) -> dict:
    lat, lon = 4.65, -74.08
    url = ("https://air-quality-api.open-meteo.com/v1/air-quality"
           f"?latitude={lat}&longitude={lon}&hourly=uv_index,uv_index_clear_sky&timezone=GMT&forecast_days=2")
    b = bloque("CAMS global (Copernicus) vía Open‑Meteo, índice UV", url, "cams_openmeteo", "estimado", consulta)
    b["credito"] = ("Generated using Copernicus Atmosphere Monitoring Service information; "
                    "datos servidos por Open‑Meteo (open-meteo.com).")
    b["nota"] = ("Pronóstico de modelo para una celda de unos 45 km, no medido. No hay UV medido abierto en Bogotá. "
                 "El 23 nov 2026 CAMS daba 12,9 de cielo despejado y TEMIS 13,6 [panel/atmosfera-datos.md §3.3].")
    d = bajar_json(url)
    h = d["hourly"]
    horas = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in h["time"]]
    hoy = consulta.astimezone(TZ_BOGOTA).date()

    def maximo(serie, dia):
        pares = [(v, t) for v, t in zip(serie, horas) if v is not None and t.astimezone(TZ_BOGOTA).date() == dia]
        if not pares:
            return None, None
        v, t = max(pares, key=lambda p: p[0])
        return round(v, 1), iso(t)

    def de_hora(serie):
        previas = [(t, v) for t, v in zip(horas, serie) if t <= consulta and v is not None]
        return (round(previas[-1][1], 1), iso(previas[-1][0])) if previas else (None, None)

    uv_ahora, hora_ahora = de_hora(h["uv_index"])
    dias = {}
    for etiqueta, dia in (("hoy", hoy), ("manana", hoy + timedelta(days=1))):
        mx, tmx = maximo(h["uv_index"], dia)
        mxd, tmxd = maximo(h["uv_index_clear_sky"], dia)
        dias[etiqueta] = {
            "fecha_bogota": dia.isoformat(),
            "uv_max_con_nubes": mx, "hora_uv_max": tmx,
            "uv_max_cielo_despejado": mxd, "hora_uv_max_despejado": tmxd,
        }
    b.update({
        "punto": {"lat": d.get("latitude"), "lon": d.get("longitude"), "elevacion_modelo_m": d.get("elevation")},
        "uv_hora_actual": uv_ahora,
        "hora_dato": hora_ahora,
        "dias": dias,
        "escala_oms": "0 a 2 bajo, 3 a 5 moderado, 6 a 7 alto, 8 a 10 muy alto, 11 o más extremo",
    })
    return b


def firms(consulta: datetime) -> dict:
    fuentes = {
        "NOAA-21 VIIRS": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_24h.csv",
        "NOAA-20 VIIRS": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_24h.csv",
    }
    b = bloque("NASA FIRMS, focos de calor VIIRS (archivo público de 24 h, Suramérica)",
               list(fuentes.values())[0], "nasa_firms", "medido", consulta)
    b["urls"] = fuentes
    b["caja"] = SABANA
    b["nota"] = ("Un foco es un píxel de 375 m más caliente que su entorno, visto en el paso del satélite. "
                 "Puede ser incendio, quema o calor industrial. Ausencia de focos no significa ausencia de fuego "
                 "(nubes, horario de paso).")
    focos, horas_archivo, fallas = [], [], []
    for sat, url in fuentes.items():
        try:
            cuerpo, cab = bajar(url, timeout=60)
        except RuntimeError as e:
            fallas.append(f"{sat}: {e}")
            continue
        if cab.get("Last-Modified"):
            horas_archivo.append(datetime.strptime(cab["Last-Modified"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc))
        for f in csv.DictReader(io.StringIO(cuerpo.decode("utf-8"))):
            lat, lon = float(f["latitude"]), float(f["longitude"])
            if not en_caja(lat, lon, SABANA):
                continue
            t = datetime.strptime(f["acq_date"] + f["acq_time"].zfill(4), "%Y-%m-%d%H%M").replace(tzinfo=timezone.utc)
            foco = {
                "satelite": sat, "lat": lat, "lon": lon,
                "hora_dato": iso(t), "edad_min": edad_min(t, consulta),
                "confianza": f.get("confidence"), "frp_mw": float(f["frp"]) if f.get("frp") else None,
                "dia_noche": f.get("daynight"),
                "distancia_centro_km": km((lat, lon), BOGOTA),
            }
            if km((lat, lon), DONA_JUANA) <= 2.0:
                foco["nota"] = "A menos de 2 km del relleno Doña Juana: puede ser calor del relleno y no un incendio [inferido]."
            focos.append(foco)
    if len(fallas) == len(fuentes):
        raise RuntimeError("; ".join(fallas))
    if fallas:
        b["fallas_parciales"] = fallas
    focos.sort(key=lambda x: x["hora_dato"], reverse=True)
    b["focos"] = focos
    b["conteo"] = len(focos)
    b["texto"] = (f"{len(focos)} focos de calor detectados en la Sabana en las últimas 24 h" if focos
                  else "0 focos de calor detectados en la Sabana en las últimas 24 h")
    b["hora_archivo"] = iso(max(horas_archivo)) if horas_archivo else None
    b["hora_dato"] = focos[0]["hora_dato"] if focos else b["hora_archivo"]
    b["nota_hora_dato"] = ("Hora de la detección más reciente; si no hay focos, hora de actualización del archivo." )
    return b


def sismos(consulta: datetime) -> dict:
    desde = (consulta - timedelta(days=30)).strftime("%Y-%m-%d")
    url = ("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
           f"&latitude={BOGOTA[0]}&longitude={BOGOTA[1]}&maxradiuskm=300&minmagnitude=2.5"
           f"&starttime={desde}&orderby=time")
    b = bloque("USGS, catálogo ComCat de sismos", url, "usgs", "medido", consulta)
    b["criterio"] = "Magnitud 2,5 o más, a menos de 300 km del centro de Bogotá, últimos 30 días."
    b["nota"] = ("El catálogo oficial de Colombia es el del Servicio Geológico Colombiano, que no tiene hoy un "
                 "servicio abierto en vivo que respondiera a consultas automáticas. USGS ve menos sismos pequeños.")
    b["enlace_oficial"] = "https://www.sgc.gov.co/sismos"
    d = bajar_json(url)
    eventos = []
    for f in d["features"]:
        p, g = f["properties"], f["geometry"]["coordinates"]
        t = datetime.fromtimestamp(p["time"] / 1000, timezone.utc)
        eventos.append({
            "id": f["id"], "magnitud": p.get("mag"), "tipo_magnitud": p.get("magType"),
            "lugar_usgs": p.get("place"), "lat": g[1], "lon": g[0], "profundidad_km": g[2],
            "hora_dato": iso(t), "edad_min": edad_min(t, consulta),
            "distancia_centro_km": km((g[1], g[0]), BOGOTA),
            "revision": p.get("status"), "url": p.get("url"),
        })
    b["eventos"] = eventos
    b["conteo"] = len(eventos)
    gen = d.get("metadata", {}).get("generated")
    b["hora_dato"] = eventos[0]["hora_dato"] if eventos else (iso(datetime.fromtimestamp(gen / 1000, timezone.utc)) if gen else None)
    return b


# ---------------------------------------------------------------- armado

def leer_anterior(origen: str | None) -> dict:
    if not origen:
        return {}
    try:
        if origen.startswith("http"):
            return json.loads(bajar(origen, intentos=2)[0].decode("utf-8"))
        with open(origen, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:  # sin anterior no se rompe nada: solo no hay respaldo
        print(f"aviso: no pude leer el JSON anterior ({e})", file=sys.stderr)
        return {}


def con_respaldo(nombre: str, fn, consulta: datetime, anterior: dict) -> dict:
    try:
        return fn()
    except Exception as e:
        previo = (anterior.get("fuentes") or {}).get(nombre)
        res = {
            "estado": "falla",
            "error": str(e)[:300],
            "hora_consulta": iso(consulta),
        }
        if previo and previo.get("hora_dato"):
            ultimo = dict(previo)
            # Lo que se guarda es lo último bueno, con su edad recalculada ahora.
            ultimo.pop("ultimo_valor", None)
            ultimo["edad_min_al_generar"] = edad_min(de_iso(previo["hora_dato"]), consulta)
            res["ultimo_valor"] = ultimo if previo.get("estado") == "ok" else previo.get("ultimo_valor")
            res["texto"] = "Sin dato nuevo; se muestra el último con su edad."
        else:
            res["ultimo_valor"] = None
            res["texto"] = "Sin dato. No hay valor anterior que mostrar."
        print(f"falla en {nombre}: {e}", file=sys.stderr)
        return res


def edades(fuentes: dict, consulta: datetime) -> None:
    for b in fuentes.values():
        if b.get("estado") == "ok":
            b["edad_min_al_generar"] = edad_min(de_iso(b.get("hora_dato")), consulta)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--salida", default="data/cielo")
    ap.add_argument("--anterior", default=None, help="ruta o URL del ahora.json anterior, para el respaldo")
    a = ap.parse_args()
    os.makedirs(a.salida, exist_ok=True)
    anterior = leer_anterior(a.anterior or os.path.join(a.salida, "ahora.json"))
    t0 = ahora_utc()
    fuentes = {
        "metar": con_respaldo("metar", lambda: metar(ahora_utc()), t0, anterior),
        "lluvia_sab": con_respaldo("lluvia_sab", lambda: sab_lluvia(ahora_utc()), t0, anterior),
        "radar_tablazo": con_respaldo("radar_tablazo", lambda: radar_tablazo(ahora_utc()), t0, anterior),
        "goes19": con_respaldo("goes19", lambda: goes19(ahora_utc(), a.salida), t0, anterior),
        "uv": con_respaldo("uv", lambda: uv_cams(ahora_utc()), t0, anterior),
        "focos_calor": con_respaldo("focos_calor", lambda: firms(ahora_utc()), t0, anterior),
        "sismos": con_respaldo("sismos", lambda: sismos(ahora_utc()), t0, anterior),
    }
    generado = ahora_utc()
    edades(fuentes, generado)
    salida = {
        "esquema": "gemelo-bogota/cielo/1",
        "titulo": "El cielo de Bogotá ahora",
        "generado": iso(generado),
        "fecha_bogota": generado.astimezone(TZ_BOGOTA).date().isoformat(),
        "reglas": [
            "Cada valor muestra su edad. El navegador debe recalcularla con hora_dato.",
            "El gemelo no emite alertas propias. Para alertas oficiales: IDIGER (https://www.idiger.gov.co) e IDEAM (https://www.ideam.gov.co).",
            "Si una fuente falla, se muestra el último valor con su edad; nunca se inventa.",
            "Ningún cálculo mezcla datos CC BY‑NC (SAB del IDIGER) con datos CC BY‑SA (IDEAM). Este archivo los pone lado a lado; cada bloque conserva su licencia.",
        ],
        "etiquetas": {
            "medido": "Lo registró un instrumento.",
            "estimado": "Sale de un modelo o de una relación teórica a partir de medidas. Los pronósticos también son estimado.",
        },
        "licencia_del_archivo": "Recopilación sin fundir: cada bloque lleva la licencia de su fuente. El código que lo arma es AGPL‑3.0.",
        "resumen_estado": {k: v.get("estado") for k, v in fuentes.items()},
        "fuentes": fuentes,
    }
    ruta = os.path.join(a.salida, "ahora.json")
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, ruta)
    tam = os.path.getsize(ruta)
    print(f"escrito {ruta}: {tam} bytes; estado {salida['resumen_estado']}")
    # Falla la corrida solo si todas las fuentes fallaron (así Actions avisa).
    return 1 if all(v.get("estado") != "ok" for v in fuentes.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
