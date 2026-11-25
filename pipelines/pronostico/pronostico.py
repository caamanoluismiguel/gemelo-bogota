#!/usr/bin/env python3
"""Pronóstico a 48 h en El Dorado y pronóstico de PM2,5 (CAMS) para la ciudad.

Cada hora (la corrida es cada 10 min, pero solo trabaja si el archivo tiene 60 min):
  * pronostico/ahora.json: temperatura, probabilidad de lluvia y lluvia por hora,
    las próximas 48 h, en el punto del aeropuerto El Dorado. Es el mismo punto donde
    mide el METAR, así el acierto se califica sin mezclar lugares.
  * pronostico/emitidos-5d.ndjson.gz: cada pronóstico emitido en los últimos 5 días,
    con 55 h por delante (las 7 de más sirven para calificar a 48 h aunque falte una corrida).
  * Cada día de Bogotá cerrado va a la Release mensual pronostico-AAAA-MM con sha256.
  * aire/pronostico.json: PM2,5 de CAMS global a 5 días, un solo valor por hora para la
    ciudad. La celda de CAMS mide unos 45 km: no sirve por barrio y no se pinta por barrio.
    No hay marcador de acierto para el aire: lo medido de la RMCAB no declara licencia.

Fuentes: Open-Meteo (datos CC BY 4.0; API gratis para uso no comercial, sin llave).
Solo biblioteca estándar.

Uso:
    python3 -I pipelines/pronostico/pronostico.py --sitio _site --cierres _cierres --manifiestos vivo/manifiestos [--forzar]
"""

from __future__ import annotations

import argparse
import sys
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vivo"))
import comun  # noqa: E402

CADENCIA_MIN = 60
HORAS_PUBLICADAS = 48
HORAS_GUARDADAS = 55
DIAS_EMITIDOS = 5
HORAS_AIRE = 120  # 5 días desde la hora actual
PUNTO = {"nombre": "Aeropuerto El Dorado", "icao": "SKBO", "lat": 4.706, "lon": -74.151, "altura_m": 2547}
CIUDAD = {"nombre": "Bogotá, centro aproximado", "lat": 4.65, "lon": -74.10}

LIC_OPEN_METEO = {
    "nombre": "CC BY 4.0",
    "url": "https://open-meteo.com/en/licence",
    "atribucion": "Weather data by Open-Meteo.com",
    "nota": "La API gratis de Open-Meteo es para uso no comercial.",
}
LIC_CAMS = {
    "nombre": "CC BY 4.0",
    "url": "https://open-meteo.com/en/licence",
    "atribucion": "Generated using Copernicus Atmosphere Monitoring Service information, served by Open-Meteo.com",
    "nota": "Ni la Comisión Europea ni el ECMWF responden por el uso de esta información.",
}


def url_pronostico() -> str:
    return "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
        "latitude": PUNTO["lat"], "longitude": PUNTO["lon"], "elevation": PUNTO["altura_m"],
        "hourly": "temperature_2m,precipitation_probability,precipitation",
        "forecast_hours": HORAS_GUARDADAS, "timezone": "GMT",
    })


def url_aire() -> str:
    return "https://air-quality-api.open-meteo.com/v1/air-quality?" + urllib.parse.urlencode({
        "latitude": CIUDAD["lat"], "longitude": CIUDAD["lon"], "hourly": "pm2_5",
        "forecast_days": 6, "timezone": "GMT", "domains": "cams_global",
    })


def hora_z(s: str) -> str:
    """Open-Meteo con timezone=GMT da «2026-11-24T23:00»; se publica con Z."""
    return comun.iso(comun.de_iso(s + ":00Z" if len(s) == 16 else s))


def emision(datos: dict, emitido: str) -> dict:
    h = datos["hourly"]
    return {
        "emitido": emitido,
        "h0": hora_z(h["time"][0]),
        "temp": h["temperature_2m"],
        "prob": h["precipitation_probability"],
        "mm": h["precipitation"],
        "celda": {"lat": datos.get("latitude"), "lon": datos.get("longitude"), "altura_m": datos.get("elevation")},
    }


def podar_emisiones(filas: list, ref) -> list:
    corte = ref - timedelta(days=DIAS_EMITIDOS)
    vistas, out = set(), []
    for f in sorted(filas, key=lambda f: f["emitido"]):
        t = comun.de_iso(f["emitido"])
        if t is None or t < corte or f["emitido"] in vistas:
            continue
        vistas.add(f["emitido"])
        out.append(f)
    return out


def cerrar_dias(filas: list, hoy: date, cierres: Path, manifiestos: Path) -> list:
    hechos = []
    for d in sorted({comun.dia_bogota(comun.de_iso(f["emitido"])) for f in filas}):
        if d >= hoy:
            continue
        release, nombre = f"pronostico-{d:%Y-%m}", f"pronostico-{d.isoformat()}.ndjson.gz"
        if comun.ya_en_manifiesto(manifiestos, release, nombre):
            continue
        del_dia = [f for f in filas if comun.dia_bogota(comun.de_iso(f["emitido"])) == d]
        cab = {"tipo": "cabecera", "esquema": "bogotwin/pronostico/1/dia", "fecha_bogota": d.isoformat(),
               "punto": PUNTO, "variables": {"temp": "temperatura a 2 m, °C", "prob": "probabilidad de lluvia, %",
                                             "mm": "lluvia en la hora, mm"},
               "fuente": {"url": url_pronostico(), "licencia": LIC_OPEN_METEO},
               "emisiones": len(del_dia), "emisiones_esperadas": 24}
        ruta = cierres / release / nombre
        tam = comun.escribir_ndjson_gz(ruta, [cab] + [{"tipo": "emision", **f} for f in del_dia])
        entrada = {"nombre": nombre, "fecha_bogota": d.isoformat(), "bytes": tam, "sha256": comun.sha256(ruta),
                   "emisiones": len(del_dia), "fuente": "https://api.open-meteo.com/v1/forecast",
                   "licencia": "CC BY 4.0", "script": "pipelines/pronostico/pronostico.py (repo gemelo-bogota)",
                   "corrida": comun.corrida(),
                   "url": f"https://github.com/caamanoluismiguel/gemelo-bogota-vivo/releases/download/{release}/{nombre}"}
        comun.agregar_manifiesto(manifiestos, release, entrada)
        hechos.append(entrada)
    return hechos


def hacer_pronostico(sitio: Path, cierres: Path, manifiestos: Path, consulta) -> None:
    url = url_pronostico()
    datos = comun.bajar_json(url)
    if datos.get("error"):
        raise ValueError(f"Open-Meteo: {datos.get('reason')}")
    emitido = comun.iso(consulta)
    em = emision(datos, emitido)
    n = HORAS_PUBLICADAS + 1
    horas = []
    t0 = comun.de_iso(em["h0"])
    for i in range(min(n, len(em["temp"]))):
        horas.append({"t": comun.iso(t0 + timedelta(hours=i)), "temp_c": em["temp"][i],
                      "prob_lluvia_pct": em["prob"][i], "lluvia_mm": em["mm"][i]})
    ahora = {
        "esquema": "bogotwin/pronostico/1",
        "generado": emitido,
        "emitido": emitido,
        "cadencia_min": CADENCIA_MIN,
        "etiqueta": "estimado",
        "punto": PUNTO,
        "celda_modelo": em["celda"],
        "modelo": "best_match de Open-Meteo (mezcla los mejores modelos para el punto)",
        "nota": "Pronóstico para el punto del aeropuerto El Dorado, en el occidente. No es el de cada barrio: "
                "los modelos tienen celdas de 2 a 13 km.",
        "horas": horas,
        "fuente": {"nombre": "Open-Meteo, API de pronóstico", "url": url, "licencia": LIC_OPEN_METEO},
        "acierto": "pronostico/acierto.json",
        "corrida": comun.corrida(),
    }
    tam = comun.escribir_json(sitio / "pronostico" / "ahora.json", ahora)
    ruta = sitio / "pronostico" / "emitidos-5d.ndjson.gz"
    filas = podar_emisiones(comun.leer_ndjson_gz(ruta) + [em], consulta)
    tam_e = comun.escribir_ndjson_gz(ruta, filas)
    cerrados = cerrar_dias(filas, comun.dia_bogota(consulta), cierres, manifiestos)
    print(f"pronostico/ahora.json {tam} B; {len(filas)} emisiones guardadas, {tam_e} B")
    for e in cerrados:
        print(f"Día cerrado {e['nombre']}: {e['emisiones']} emisiones, sha256 {e['sha256'][:12]}")


def hacer_aire(sitio: Path, consulta) -> None:
    url = url_aire()
    datos = comun.bajar_json(url)
    if datos.get("error"):
        raise ValueError(f"Open-Meteo calidad del aire: {datos.get('reason')}")
    h = datos["hourly"]
    desde = consulta.replace(minute=0, second=0)
    horas, por_dia = [], {}
    for t, v in zip(h["time"], h["pm2_5"]):
        tz = comun.de_iso(t + ":00Z")
        if v is None or tz < desde or tz >= desde + timedelta(hours=HORAS_AIRE):
            continue
        horas.append([comun.iso(tz), round(v, 1)])
        por_dia.setdefault(comun.dia_bogota(tz).isoformat(), []).append(v)
    dias = [{"fecha_bogota": d, "media": round(sum(v) / len(v), 1), "maxima": round(max(v), 1), "horas": len(v)}
            for d, v in sorted(por_dia.items())]
    aire = {
        "esquema": "bogotwin/aire/1",
        "generado": comun.iso(consulta),
        "cadencia_min": CADENCIA_MIN,
        "etiqueta": "estimado",
        "variable": {"clave": "pm25", "nombre": "PM2,5", "unidad": "µg/m³"},
        "punto": {**CIUDAD, "celda_modelo": {"lat": datos.get("latitude"), "lon": datos.get("longitude")},
                  "tamano_celda_km": 45},
        "nota": "Un solo valor para toda la ciudad: la celda de CAMS mide unos 45 km. No sirve por barrio ni por "
                "localidad. No hay marcador de acierto porque lo medido de la RMCAB no declara licencia. "
                "Esto no es un índice oficial ni una alerta.",
        "horas_campos": ["t", "pm25"],
        "horas": horas,
        "dias": dias,
        "fuente": {"nombre": "CAMS global (Copernicus), servido por Open-Meteo", "url": url, "licencia": LIC_CAMS},
        "corrida": comun.corrida(),
    }
    tam = comun.escribir_json(sitio / "aire" / "pronostico.json", aire)
    print(f"aire/pronostico.json {tam} B; {len(horas)} horas, {len(dias)} días")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sitio", type=Path, required=True)
    ap.add_argument("--cierres", type=Path, required=True)
    ap.add_argument("--manifiestos", type=Path, required=True)
    ap.add_argument("--forzar", action="store_true")
    a = ap.parse_args()
    consulta = comun.ahora_utc()
    fallas = 0
    if a.forzar or comun.toca(a.sitio / "pronostico" / "ahora.json", CADENCIA_MIN, consulta):
        try:
            hacer_pronostico(a.sitio, a.cierres, a.manifiestos, consulta)
        except Exception as exc:
            fallas += 1
            print(f"::warning::Pronóstico sin actualizar: {type(exc).__name__}: {exc}")
    else:
        print("pronóstico: todavía no toca")
    if a.forzar or comun.toca(a.sitio / "aire" / "pronostico.json", CADENCIA_MIN, consulta):
        try:
            hacer_aire(a.sitio, consulta)
        except Exception as exc:
            fallas += 1
            print(f"::warning::Aire sin actualizar: {type(exc).__name__}: {exc}")
    else:
        print("aire: todavía no toca")
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
