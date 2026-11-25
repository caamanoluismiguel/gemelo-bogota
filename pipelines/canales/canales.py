#!/usr/bin/env python3
"""Nivel de quebradas, ríos y canales de Bogotá: cuánto le falta al agua para llegar al desborde.

Fuente: sensores de nivel del Sistema de Alerta de Bogotá (SAB) del IDIGER,
`ServletTipoSensores?idtiposensor=3`, el mismo servicio que la ficha de lluvia minutal.

Qué mide VALORLECTURA (comprobado el 24 nov 2026, ver pipelines/canales/README.md):
  * IDTIPOLECTURA 1: altura del agua sobre el fondo del sensor (MINSENSOR).
        espejo = MINSENSOR + VALORLECTURA
  * IDTIPOLECTURA 2: distancia desde el sensor (COTASENSOR) hacia abajo hasta el agua.
        espejo = COTASENSOR - VALORLECTURA
  * IDTIPOLECTURA 0: estaciones del acueducto que el SAB muestra sin lectura. No se cosechan.
  * Cualquier otro valor: no sabemos leerlo, así que el sensor va sin espejo ni borde libre.
  Borde libre = NIVELDESBORDAMIENTO - espejo, la misma cuenta del visor oficial del SAB.

Cada corrida (cada 10 minutos):
  1. Baja el servicio de nivel.
  2. Escribe canales/ahora.json (compacto, para el visor).
  3. Suma una fila a canales/serie-48h.ndjson.gz y borra lo de más de 48 h.
  4. Cada día de Bogotá ya cerrado que siga en la serie y no esté en el manifiesto se escribe
     como canales-AAAA-MM-DD.ndjson.gz para la Release mensual canales-AAAA-MM.

Licencia: la del SAB, CC BY-NC 4.0, con crédito al IDIGER. Este archivo solo lleva datos del
SAB y cálculos hechos solo con datos del SAB: no se mezcla con nada CC BY-SA.
El gemelo no emite alertas. Los niveles bajo, medio y alto son los umbrales del IDIGER.

Solo biblioteca estándar. Sin claves.

Uso:
    python3 -I pipelines/canales/canales.py --sitio _site --cierres _cierres --manifiestos vivo/manifiestos
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vivo"))
import comun  # noqa: E402

ESQUEMA = "bogotwin/canales/1"
URL = "https://app.sab.gov.co//sab/ServletTipoSensores?idtiposensor=3"
VISOR_OFICIAL = "https://app.sab.gov.co/sab/niveles_umbrales.htm"
HORAS_SERIE = 48
CADENCIA_MIN = 10
CAMPOS = ["lectura_m", "espejo_msnm", "borde_libre_m", "min_desde_lectura", "dudoso"]
LICENCIA = {
    "nombre": "CC BY-NC 4.0",
    "url": "https://creativecommons.org/licenses/by-nc/4.0/deed.es",
    "ficha": "https://datosabiertos.bogota.gov.co/dataset/sab-sistema-de-alerta-de-bogota-lluvia-minutal-idiger-bogota-d-c",
    "credito": "Datos: IDIGER, Sistema de Alerta de Bogotá (SAB). Crudos, sin validar por completo.",
    "por_que": ("El IDIGER publica el SAB en Datos Abiertos Bogotá bajo CC BY-NC 4.0. Esa ficha documenta "
                "el mismo servicio con idtiposensor=5 (lluvia); el nivel (idtiposensor=3) no tiene ficha propia "
                "y le aplicamos la del SAB [inferido]. Evidencia en pipelines/canales/evidencia-licencia.json."),
}
# Lo que no cuadra con la geometría del propio sensor: el agua no puede estar más de 1 m por
# debajo del fondo de su gráfica ni más de 3 m por encima del desborde sin que sea un error.
HOLGURA_FONDO_M = 1.0
HOLGURA_DESBORDE_M = 3.0
CAJA = {"lat_min": 4.2, "lat_max": 5.2, "lon_min": -74.5, "lon_max": -73.7}


def num(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def hora_sab(s: str | None) -> datetime | None:
    """FECHALECTURA viene en hora de Bogotá, sin zona (comprobado: 19:10 cuando eran 00:10 UTC)."""
    if not s:
        return None
    try:
        return datetime.strptime(s.split(".")[0], "%Y-%m-%d %H:%M:%S").replace(tzinfo=comun.BOGOTA)
    except ValueError:
        return None


def espejo_de(tipo: int, lectura: float | None, cota: float | None, fondo: float | None) -> float | None:
    """Cota del agua en m s. n. m. según el tipo de lectura, como lo hace el visor oficial del SAB."""
    if lectura is None:
        return None
    if tipo == 1 and fondo is not None:
        return fondo + lectura
    if tipo == 2 and cota is not None:
        return cota - lectura
    return None


def redondo(x: float | None, n: int = 3) -> float | None:
    return None if x is None else round(x, n)


def armar(datos: list, consulta: datetime) -> tuple[list, dict]:
    sensores = []
    tot = {"sensores": 0, "con_lectura": 0, "con_umbrales": 0, "dudosos": 0,
           "sin_lectura_acueducto": 0, "tipo_desconocido": 0}
    for s in datos:
        if s.get("VISIBLE") != 1:
            continue
        tipo = s.get("IDTIPOLECTURA")
        if tipo == 0:
            tot["sin_lectura_acueducto"] += 1
            continue
        lat, lon = num(s.get("LATITUD")), num(s.get("LONGITUD"))
        if lat is None or lon is None or not (CAJA["lat_min"] <= lat <= CAJA["lat_max"] and CAJA["lon_min"] <= lon <= CAJA["lon_max"]):
            continue
        tot["sensores"] += 1
        cota, fondo = num(s.get("COTASENSOR")), num(s.get("MINSENSOR"))
        desborde, fondo_graf = num(s.get("NIVELDESBORDAMIENTO")), num(s.get("MINGRAFICA"))
        bajo, medio, alto = num(s.get("NIVELBAJO")), num(s.get("NIVELMEDIO")), num(s.get("NIVELALTO"))
        umbrales = {"bajo": bajo, "medio": medio, "alto": alto} if None not in (bajo, medio, alto) else None
        if tipo not in (1, 2):
            tot["tipo_desconocido"] += 1
        lectura = num(s.get("VALORLECTURA"))
        t = hora_sab(s.get("FECHALECTURA"))
        espejo = espejo_de(tipo, lectura, cota, fondo) if tipo in (1, 2) else None
        borde = None if espejo is None or desborde is None else desborde - espejo
        dudoso = 0
        if espejo is not None:
            piso = min(v for v in (fondo, fondo_graf) if v is not None) if (fondo is not None or fondo_graf is not None) else None
            if lectura < 0 or (piso is not None and espejo < piso - HOLGURA_FONDO_M) \
                    or (desborde is not None and espejo > desborde + HOLGURA_DESBORDE_M):
                dudoso = 1
        min_lect = None if t is None else max(0, round((consulta - t).total_seconds() / 60))
        if lectura is not None:
            tot["con_lectura"] += 1
        if umbrales:
            tot["con_umbrales"] += 1
        tot["dudosos"] += dudoso
        sensores.append({
            "id": str(s.get("IDSENSOR")),
            "nombre": (s.get("ESTACION") or "").strip(),
            "cauce": " ".join((s.get("TITULO") or "").split()),
            "localidad": (s.get("LOCALIDAD") or "").strip(),
            "lat": round(lat, 6), "lon": round(lon, 6),
            "tipo_lectura": tipo,
            "cota_sensor_msnm": cota,
            "fondo_msnm": fondo,
            "desborde_msnm": desborde,
            "umbrales_msnm": umbrales,
            "hora": comun.iso(t),
            "v": [lectura, redondo(espejo), redondo(borde), min_lect, dudoso],
        })
    return sensores, tot


def fila_serie(hora: str, sensores: list) -> dict:
    con = [s for s in sensores if s["v"][0] is not None]
    return {"t": hora, "ids": [s["id"] for s in con], "v": [s["v"] for s in con]}


def podar(filas: list, ref: datetime, horas: int = HORAS_SERIE) -> list:
    corte = ref - timedelta(hours=horas)
    vistas, out = set(), []
    for f in sorted(filas, key=lambda f: f["t"]):
        t = comun.de_iso(f["t"])
        if t is None or t < corte or f["t"] in vistas:
            continue
        vistas.add(f["t"])
        out.append(f)
    return out


def dias_para_cerrar(filas: list, hoy: date) -> list[date]:
    return sorted(d for d in {comun.dia_bogota(comun.de_iso(f["t"])) for f in filas} if d < hoy)


def cerrar_dia(d: date, filas: list, sensores: list, cierres: Path, manifiestos: Path) -> dict | None:
    del_dia = [f for f in filas if comun.dia_bogota(comun.de_iso(f["t"])) == d]
    if not del_dia:
        return None
    release = f"canales-{d:%Y-%m}"
    nombre = f"canales-{d.isoformat()}.ndjson.gz"
    if comun.ya_en_manifiesto(manifiestos, release, nombre):
        return None
    fijos = ("id", "nombre", "cauce", "localidad", "lat", "lon", "tipo_lectura", "cota_sensor_msnm",
             "fondo_msnm", "desborde_msnm", "umbrales_msnm")
    cabecera = {
        "tipo": "cabecera",
        "esquema": ESQUEMA + "/dia",
        "fecha_bogota": d.isoformat(),
        "campos": CAMPOS,
        "sensores": [{k: s[k] for k in fijos} for s in sensores],
        "nota_sensores": "Cotas y umbrales tomados al cerrar el día; si el IDIGER los cambió ese día, valen los del cierre.",
        "fuente": {"url": URL, "licencia": LICENCIA},
        "filas": len(del_dia),
        "filas_esperadas": 24 * 60 // CADENCIA_MIN,
        "primera": del_dia[0]["t"],
        "ultima": del_dia[-1]["t"],
        "nota_huecos": "Una fila por corrida. Si GitHub o el SAB fallaron, falta la fila: los huecos quedan como huecos.",
    }
    ruta = cierres / release / nombre
    tam = comun.escribir_ndjson_gz(ruta, [cabecera] + [{"tipo": "fila", **f} for f in del_dia])
    entrada = {
        "nombre": nombre,
        "fecha_bogota": d.isoformat(),
        "bytes": tam,
        "sha256": comun.sha256(ruta),
        "filas": len(del_dia),
        "filas_esperadas": cabecera["filas_esperadas"],
        "fuente": URL,
        "licencia": LICENCIA["nombre"],
        "script": "pipelines/canales/canales.py (repo gemelo-bogota)",
        "corrida": comun.corrida(),
        "url": f"https://github.com/caamanoluismiguel/gemelo-bogota-vivo/releases/download/{release}/{nombre}",
    }
    comun.agregar_manifiesto(manifiestos, release, entrada)
    return entrada


def documento(sensores: list, tot: dict, consulta: datetime) -> dict:
    horas = [comun.de_iso(s["hora"]) for s in sensores if s["hora"]]
    return {
        "esquema": ESQUEMA,
        "generado": comun.iso(consulta),
        "hora_dato": comun.iso(max(horas)) if horas else None,
        "cadencia_min": CADENCIA_MIN,
        "etiqueta": "medido",
        "etiquetas": {
            "lectura_m": "medido",
            "espejo_msnm": "inferido",
            "borde_libre_m": "inferido",
            "desborde_msnm": "de_fuente",
            "umbrales_msnm": "de_fuente",
        },
        "fuente": {
            "nombre": "IDIGER, Sistema de Alerta de Bogotá (SAB), sensores de nivel",
            "url": URL,
            "visor_oficial": VISOR_OFICIAL,
            "licencia": LICENCIA,
            "nota": "Datos crudos, sin validar por completo, según el IDIGER. Las alertas oficiales son del IDIGER.",
        },
        "como_se_calcula": {
            "espejo_msnm": "Tipo de lectura 1: fondo del sensor + lectura. Tipo 2: cota del sensor - lectura. Es la cuenta del visor oficial del SAB.",
            "borde_libre_m": "Cota de desborde - espejo. Lo que le falta al agua para llegar a la cota de desborde que publica el IDIGER.",
            "umbrales": "Niveles bajo, medio y alto del IDIGER, en m s. n. m. Solo algunos sensores los tienen. Si no, va null y no se inventan.",
            "dudoso": "1 si la lectura es negativa o deja el agua más de 1 m bajo el fondo o más de 3 m sobre el desborde.",
        },
        "campos": CAMPOS,
        "totales": tot,
        "sensores": sensores,
        "aviso": "El gemelo no emite alertas. Para alertas oficiales: IDIGER (https://www.idiger.gov.co).",
        "corrida": comun.corrida(),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sitio", type=Path, required=True)
    ap.add_argument("--cierres", type=Path, required=True)
    ap.add_argument("--manifiestos", type=Path, required=True)
    a = ap.parse_args()
    consulta = comun.ahora_utc()

    crudo = comun.bajar_json(URL)
    datos = crudo.get("TipoSensores") if isinstance(crudo, dict) else None
    if not isinstance(datos, list):
        print("::error::El SAB respondió sin la lista TipoSensores.")
        return 1
    sensores, tot = armar(datos, consulta)
    if not tot["con_lectura"]:
        print("::error::Ningún sensor de nivel trajo lectura. No se publica nada nuevo.")
        return 1
    doc = documento(sensores, tot, consulta)
    tam = comun.escribir_json(a.sitio / "canales" / "ahora.json", doc)

    ruta_serie = a.sitio / "canales" / "serie-48h.ndjson.gz"
    filas = podar(comun.leer_ndjson_gz(ruta_serie) + [fila_serie(doc["hora_dato"] or doc["generado"], sensores)], consulta)
    tam_serie = comun.escribir_ndjson_gz(ruta_serie, filas)

    cerrados = []
    for d in dias_para_cerrar(filas, comun.dia_bogota(consulta)):
        e = cerrar_dia(d, filas, sensores, a.cierres, a.manifiestos)
        if e:
            cerrados.append(e)
    print(f"canales/ahora.json {tam} B; serie {len(filas)} filas, {tam_serie} B; "
          f"{tot['con_lectura']} de {tot['sensores']} sensores con lectura, {tot['con_umbrales']} con umbrales, {tot['dudosos']} dudosos")
    for e in cerrados:
        print(f"Día cerrado {e['nombre']}: {e['filas']}/{e['filas_esperadas']} filas, {e['bytes']} B, sha256 {e['sha256'][:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
