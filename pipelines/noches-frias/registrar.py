#!/usr/bin/env python3
"""Registro diario de noches frías de Bogotá.

Cada mañana guarda en data/noches-frias/AAAA-MM-DD.json:
  1. La mínima MEDIDA de anoche en El Dorado (SKBO) y Guaymaral (SKGY), sacada
     de los METAR que publica aviationweather.gov.
  2. La mínima PRONOSTICADA para las 3 noches siguientes en esos mismos dos
     puntos, como rango entre varios modelos que sirve Open-Meteo.

Así, cada pronóstico guardado hoy se puede comparar después con la mínima que
se midió esa noche. A las 4 semanas se publica la precisión.

Ventana de la noche (hora de Bogotá, UTC-5, sin horario de verano):
  desde las 18:00 del día anterior hasta las 06:00 del día del archivo, ambas
  incluidas. Son 13 horas en punto. La mínima en Bogotá suele llegar cerca del
  amanecer (5:45 a 6:15 a. m. a finales de noviembre), por eso la ventana
  cierra a las 06:00: la observación de esa hora ya está publicada cuando corre
  el registro a las 06:30. El pronóstico usa las mismas 13 horas, así medido y
  pronóstico se comparan con la misma regla.

Sin dependencias: solo la biblioteca estándar de Python 3.10 o más nuevo.
Sin claves: ninguna de las dos fuentes pide cuenta.

Uso:
  python3 pipelines/noches-frias/registrar.py
  python3 pipelines/noches-frias/registrar.py --fecha 2026-11-20   # solo medido
  python3 pipelines/noches-frias/registrar.py --sobrescribir
  python3 pipelines/noches-frias/registrar.py --rellenar 29  # hoy + días sin archivo, solo medido

Código de salida: 0 si todo salió; 1 si alguna fuente falló (el archivo se
escribe igual con lo que haya y el error queda anotado); 2 si no se pudo
escribir nada.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BOGOTA = timezone(timedelta(hours=-5), "America/Bogota")
RAIZ = Path(__file__).resolve().parents[2]
CARPETA_DATOS = RAIZ / "data" / "noches-frias"

ESQUEMA = "noches-frias/1"
HORA_INICIO = 18  # 18:00 del día anterior, hora de Bogotá
HORA_FIN = 6      # 06:00 del día del archivo, hora de Bogotá
NOCHES_PRONOSTICO = 3
UMBRAL_NOCHE_FRIA_C = 6.0  # el que usa el panel (atmosfera-datos.md §3.8)
UMBRAL_HELADA_C = 0.0

AGENTE = "gemelo-bogota-noches-frias/1 (+https://github.com/caamanoluismiguel/gemelo-bogota)"

# Coordenadas y altura de cada estación tal como las publica aviationweather.gov
# (consultado el 23 nov 2026). Se usan también para pedir el pronóstico en el
# mismo punto y a la misma altura.
ESTACIONES = {
    "SKBO": {"nombre": "Aeropuerto El Dorado", "lugar": "Fontibón, occidente de Bogotá",
             "lat": 4.706, "lon": -74.151, "altura_m": 2547},
    "SKGY": {"nombre": "Aeropuerto Guaymaral", "lugar": "Suba, norte de Bogotá",
             "lat": 4.812, "lon": -74.065, "altura_m": 2557},
}

FUENTE_METAR = {
    "nombre": "METAR de la Aerocivil, servidos por el Aviation Weather Center (NOAA/NWS)",
    "url": "https://aviationweather.gov/api/data/metar",
    "licencia": "Dominio público (NOAA/NWS): https://www.weather.gov/disclaimer",
    "atribucion": "Observaciones METAR vía aviationweather.gov (NOAA/NWS)",
    "notas": "El METAR da la temperatura en grados enteros y cada hora; la mínima "
             "real entre dos reportes puede ser más baja. Es el aire a 2 m en la "
             "pista del aeropuerto, no en cada calle.",
}

# Modelos que se piden a Open-Meteo. Se deja fuera el UK Met Office porque su
# licencia es CC BY-SA y este registro queda entero en CC BY 4.0.
MODELOS = {
    "ecmwf_ifs025": {"nombre": "ECMWF IFS 0,25°", "origen": "ECMWF",
                     "licencia_origen": "CC BY 4.0"},
    "ecmwf_aifs025_single": {"nombre": "ECMWF AIFS 0,25°", "origen": "ECMWF",
                             "licencia_origen": "CC BY 4.0"},
    "gfs_seamless": {"nombre": "GFS", "origen": "NOAA NCEP",
                     "licencia_origen": "Dominio público (NOAA)"},
    "icon_seamless": {"nombre": "ICON", "origen": "DWD",
                      "licencia_origen": "CC BY 4.0"},
    "gem_seamless": {"nombre": "GEM", "origen": "ECCC (Canadá)",
                     "licencia_origen": "Licencia de gobierno abierto de Canadá"},
    "meteofrance_seamless": {"nombre": "ARPEGE", "origen": "Météo-France",
                             "licencia_origen": "Licencia abierta Etalab 2.0"},
    "jma_seamless": {"nombre": "GSM", "origen": "JMA",
                     "licencia_origen": "Términos de uso de la JMA"},
}

FUENTE_OPEN_METEO = {
    "nombre": "Open-Meteo, API de pronóstico",
    "url": "https://api.open-meteo.com/v1/forecast",
    "licencia": "CC BY 4.0: https://open-meteo.com/en/licence (API gratis solo para uso no comercial)",
    "atribucion": "Weather data by Open-Meteo.com (https://open-meteo.com/)",
    "notas": "Temperatura a 2 m por hora de cada modelo, ajustada por Open-Meteo a la "
             "altura de la estación. El rango es entre modelos; que discrepen es "
             "lo esperado y es justo lo que el rango muestra.",
}


def ahora_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def pedir_json(url: str, intentos: int = 3) -> object:
    """GET con reintentos y espera creciente. Lanza la última excepción."""
    ultimo: Exception | None = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENTE, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            ultimo = exc
            if i < intentos - 1:
                time.sleep(5 * (i + 1))
    assert ultimo is not None
    raise ultimo


def ventana(fecha_fin: date) -> tuple[datetime, datetime]:
    """Inicio y fin de la noche que termina la mañana de fecha_fin, en hora de Bogotá."""
    fin = datetime(fecha_fin.year, fecha_fin.month, fecha_fin.day, HORA_FIN, tzinfo=BOGOTA)
    inicio = datetime(fecha_fin.year, fecha_fin.month, fecha_fin.day, HORA_INICIO, tzinfo=BOGOTA) - timedelta(days=1)
    return inicio, fin


def horas_ventana(fecha_fin: date) -> list[datetime]:
    inicio, fin = ventana(fecha_fin)
    horas = []
    h = inicio
    while h <= fin:
        horas.append(h)
        h += timedelta(hours=1)
    return horas


def leer_medido(fecha: date, consulta: datetime) -> list[dict]:
    inicio, fin = ventana(fecha)
    # aviationweather.gov guarda 30 días, pero «hours» solo devuelve las últimas 400
    # filas (medido el 24 nov 2026: con hours=720 llegaron 13 días de una sola
    # estación). Por eso se pide la ventana exacta con «date» (hora final) y 15 h hacia
    # atrás, y luego se filtra por la ventana.
    if (consulta - inicio).total_seconds() > 30 * 24 * 3600:
        raise ValueError("aviationweather.gov solo guarda 30 días de METAR")
    hasta = (fin + timedelta(hours=1)).astimezone(timezone.utc)
    params = urllib.parse.urlencode({"ids": ",".join(ESTACIONES), "format": "json",
                                     "hours": 15, "date": hasta.strftime("%Y-%m-%dT%H:%M:%SZ")})
    url = f"{FUENTE_METAR['url']}?{params}"
    datos = pedir_json(url)
    if not isinstance(datos, list):
        raise ValueError("respuesta inesperada de aviationweather.gov")

    esperadas = len(horas_ventana(fecha))
    resultado = []
    for icao, est in ESTACIONES.items():
        obs = []
        vistos = set()
        for m in datos:
            if m.get("icaoId") != icao or m.get("temp") is None or m.get("obsTime") is None:
                continue
            t = datetime.fromtimestamp(int(m["obsTime"]), timezone.utc)
            if not (inicio <= t <= fin):
                continue
            clave = (t, m.get("metarType"))
            if clave in vistos:
                continue
            vistos.add(clave)
            obs.append({
                "hora_local": iso(t.astimezone(BOGOTA)),
                "temperatura_c": float(m["temp"]),
                "tipo": m.get("metarType"),
                "texto": m.get("rawOb"),
            })
        obs.sort(key=lambda o: o["hora_local"])
        en_punto = sum(1 for o in obs if o["tipo"] == "METAR" and o["hora_local"][14:16] == "00")
        registro = {
            "estacion": icao,
            **est,
            "etiqueta": "medido",
            "minima_c": None,
            "hora_minima_local": None,
            "reportes_en_punto": en_punto,
            "reportes_esperados": esperadas,
            "ventana_completa": en_punto >= esperadas,
            "observaciones": obs,
            "fuente": {**FUENTE_METAR, "url_consulta": url, "consultado_utc": iso(consulta)},
        }
        if obs:
            minima = min(o["temperatura_c"] for o in obs)
            registro["minima_c"] = minima
            # Primera hora en que se alcanzó la mínima.
            registro["hora_minima_local"] = next(o["hora_local"] for o in obs if o["temperatura_c"] == minima)
            registro["noche_fria"] = minima < UMBRAL_NOCHE_FRIA_C
            registro["helada_a_2m"] = minima <= UMBRAL_HELADA_C
        resultado.append(registro)
    return resultado


def leer_pronostico(fecha: date, consulta: datetime) -> list[dict]:
    noches = [fecha + timedelta(days=d) for d in range(1, NOCHES_PRONOSTICO + 1)]
    params = urllib.parse.urlencode({
        "latitude": ",".join(str(e["lat"]) for e in ESTACIONES.values()),
        "longitude": ",".join(str(e["lon"]) for e in ESTACIONES.values()),
        "elevation": ",".join(str(e["altura_m"]) for e in ESTACIONES.values()),
        "hourly": "temperature_2m",
        "models": ",".join(MODELOS),
        "timezone": "GMT",
        "start_date": (noches[0] - timedelta(days=1)).isoformat(),
        "end_date": noches[-1].isoformat(),
    })
    url = f"{FUENTE_OPEN_METEO['url']}?{params}"
    datos = pedir_json(url)
    if isinstance(datos, dict) and datos.get("error"):
        raise ValueError(f"Open-Meteo: {datos.get('reason')}")
    if isinstance(datos, dict):
        datos = [datos]

    resultado = []
    for (icao, est), punto in zip(ESTACIONES.items(), datos):
        horas = punto["hourly"]["time"]
        indice = {h: i for i, h in enumerate(horas)}
        for anticipacion, noche in enumerate(noches, start=1):
            claves = [h.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M") for h in horas_ventana(noche)]
            por_modelo = {}
            sin_dato = []
            for modelo in MODELOS:
                serie = punto["hourly"].get(f"temperature_2m_{modelo}")
                valores = [serie[indice[c]] for c in claves if serie is not None and c in indice and serie[indice[c]] is not None]
                if len(valores) == len(claves):
                    por_modelo[modelo] = round(min(valores), 1)
                else:
                    sin_dato.append(modelo)
            valores = sorted(por_modelo.values())
            inicio, fin = ventana(noche)
            resultado.append({
                "estacion": icao,
                "nombre": est["nombre"],
                "etiqueta": "estimado",  # los pronósticos son estimado; archivos viejos dicen "pronostico" y el sitio los traduce
                "noche_que_termina": noche.isoformat(),
                "ventana_local": {"inicio": iso(inicio), "fin": iso(fin)},
                "anticipacion_dias": anticipacion,
                "minima_c_por_modelo": por_modelo,
                "modelos_sin_dato": sin_dato,
                "rango_c": {"bajo": valores[0], "alto": valores[-1]} if valores else None,
                "mediana_c": round(statistics.median(valores), 1) if valores else None,
                "modelos_bajo_umbral_noche_fria": sum(1 for v in valores if v < UMBRAL_NOCHE_FRIA_C),
                "punto_modelo": {"lat": punto.get("latitude"), "lon": punto.get("longitude"),
                                 "altura_m": punto.get("elevation")},
                "fuente": {**FUENTE_OPEN_METEO, "url_consulta": url, "consultado_utc": iso(consulta)},
            })
    return resultado


def fechas_a_registrar(hoy: date, consulta: datetime, carpeta: Path, rellenar: int) -> list[date]:
    """Hoy, si su noche ya cerró, y los días anteriores (hasta «rellenar») que no tengan archivo.

    Si el trabajo llega después de la medianoche de Bogotá, la noche de «ayer» no se pierde:
    entra por el relleno, solo con lo medido."""
    fechas = []
    _, fin_hoy = ventana(hoy)
    if fin_hoy <= consulta and not (carpeta / f"{hoy.isoformat()}.json").exists():
        fechas.append(hoy)
    for k in range(1, rellenar + 1):
        d = hoy - timedelta(days=k)
        inicio, _ = ventana(d)
        if (consulta - inicio).total_seconds() > 30 * 24 * 3600:
            break
        if not (carpeta / f"{d.isoformat()}.json").exists():
            fechas.append(d)
    return sorted(fechas)


def registrar(fecha: date, consulta: datetime, hoy_bogota: date, salida: Path, sobrescribir: bool) -> int:
    archivo = salida / f"{fecha.isoformat()}.json"
    if archivo.exists() and not sobrescribir:
        # El primer registro es el que vale: reescribirlo cambiaría el pronóstico guardado.
        print(f"Ya existe {archivo}; no se toca. Usa --sobrescribir si de verdad hace falta.")
        return 0

    errores = []
    try:
        medido = leer_medido(fecha, consulta)
    except Exception as exc:  # se anota y se sigue con el pronóstico
        medido = []
        errores.append({"parte": "medido", "error": f"{type(exc).__name__}: {exc}"})

    pronostico: list[dict] = []
    notas = []
    relleno = fecha != hoy_bogota
    if not relleno:
        try:
            pronostico = leer_pronostico(fecha, consulta)
        except Exception as exc:
            errores.append({"parte": "pronostico", "error": f"{type(exc).__name__}: {exc}"})
    else:
        notas.append("Registro hecho después del día (relleno): solo lleva lo medido. El pronóstico de esa "
                     "mañana no se guardó y no se rellena, porque sería un pronóstico hecho a posteriori.")

    if not medido and not pronostico:
        print(f"{fecha}: " + json.dumps(errores, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2

    inicio, fin = ventana(fecha)
    registro = {
        "esquema": ESQUEMA,
        "fecha": fecha.isoformat(),
        "consultado_utc": iso(consulta),
        "relleno": relleno,
        "pronostico_faltante": relleno or not pronostico,
        "ventana_noche": {
            "inicio_local": iso(inicio),
            "fin_local": iso(fin),
            "regla": "Noche que termina la mañana de «fecha»: de 18:00 del día anterior a 06:00, "
                     "hora de Bogotá (UTC-5), ambas incluidas. Misma ventana para lo medido y lo pronosticado.",
        },
        "umbrales": {
            "noche_fria_c": UMBRAL_NOCHE_FRIA_C,
            "helada_c": UMBRAL_HELADA_C,
            "nota": "«Helada» solo si una estación midió 0 °C o menos a 2 m. "
                    "Esto es un registro, no una alerta: las alertas oficiales son del IDEAM y del IDIGER.",
        },
        "medido": medido,
        "pronostico": pronostico,
        "errores": errores,
        "notas": notas,
        "licencia_registro": "CC BY 4.0. Cita las fuentes de cada valor.",
    }

    salida.mkdir(parents=True, exist_ok=True)
    tmp = archivo.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(registro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(archivo)

    for m in medido:
        print(f"{fecha} {m['estacion']} medido: mínima {m['minima_c']} °C a las {m['hora_minima_local']} "
              f"({m['reportes_en_punto']}/{m['reportes_esperados']} reportes en punto)")
    for p in pronostico:
        r = p["rango_c"]
        print(f"{p['estacion']} noche al {p['noche_que_termina']}: "
              f"{r['bajo'] if r else '?'} a {r['alto'] if r else '?'} °C ({len(p['minima_c_por_modelo'])} modelos)")
    for e in errores:
        print(f"Aviso en {fecha} {e['parte']}: {e['error']}", file=sys.stderr)
    print(f"Escrito {archivo.relative_to(RAIZ) if archivo.is_relative_to(RAIZ) else archivo}")
    return 1 if errores else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Registro diario de noches frías de Bogotá")
    parser.add_argument("--fecha", help="Mañana en que termina la noche, AAAA-MM-DD (por defecto hoy en Bogotá)")
    parser.add_argument("--sobrescribir", action="store_true", help="Reescribe el archivo si ya existe")
    parser.add_argument("--rellenar", type=int, default=0, metavar="N",
                        help="Además de hoy, registra lo medido de los N días anteriores que no tengan archivo (máx. 29)")
    parser.add_argument("--salida", type=Path, default=CARPETA_DATOS, help="Carpeta de salida")
    args = parser.parse_args()

    consulta = ahora_utc()
    hoy_bogota = consulta.astimezone(BOGOTA).date()
    if args.fecha:
        fecha = date.fromisoformat(args.fecha)
        _, fin = ventana(fecha)
        if fin > consulta:
            print(f"La noche que termina el {fecha} todavía no termina (cierra a las 06:00 de Bogotá).", file=sys.stderr)
            return 2
        return registrar(fecha, consulta, hoy_bogota, args.salida, args.sobrescribir)

    fechas = fechas_a_registrar(hoy_bogota, consulta, args.salida, min(max(args.rellenar, 0), 29))
    if not fechas:
        _, fin = ventana(hoy_bogota)
        if fin > consulta and not args.rellenar:
            print(f"La noche que termina el {hoy_bogota} todavía no termina (cierra a las 06:00 de Bogotá).", file=sys.stderr)
            return 2
        print("Nada que registrar: hoy y los días anteriores ya tienen archivo.")
        return 0
    codigos = [registrar(f, consulta, hoy_bogota, args.salida, args.sobrescribir) for f in fechas]
    if all(c == 2 for c in codigos):
        return 2
    return 1 if any(c for c in codigos) else 0


if __name__ == "__main__":
    sys.exit(main())
