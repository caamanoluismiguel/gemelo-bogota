#!/usr/bin/env python3
"""Marcador de acierto del pronóstico de El Dorado contra el METAR de El Dorado.

Una vez al día (la primera corrida después de las 00:30 de Bogotá), califica el día
que acaba de cerrar, y el anterior si quedó pendiente:

  * Temperatura: por cada hora en punto con METAR, error del pronóstico emitido con
    24 h de anticipación (entre 24 y 29 h, la emisión más reciente) y con 48 h
    (entre 48 y 54 h). Da el error medio absoluto y el sesgo, en °C.
  * Lluvia sí o no por bloques de 6 h (0 a 6, 6 a 12, 12 a 18 y 18 a 24, hora de Bogotá):
      - pronóstico «sí» si alguna hora del bloque tiene probabilidad de lluvia de 50 % o más;
      - medido «sí» si algún METAR o SPECI del bloque reporta precipitación en la estación
        (llovizna, lluvia, chubasco, granizo); «VC» (en las cercanías) no cuenta.
    Un bloque se califica solo si tiene al menos 4 reportes.

Publica pronostico/acierto.json con los días calificados (35 como máximo) y el resumen
de los últimos 7 y 30 días. Las reglas van dentro del JSON.

Fuentes: emisiones guardadas por pronostico.py (Open-Meteo, CC BY 4.0) y METAR de la
Aerocivil vía aviationweather.gov (dominio público, NOAA/NWS). Sin llaves.

Uso:
    python3 -I pipelines/pronostico/acierto.py --sitio _site
"""

from __future__ import annotations

import argparse
import sys
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vivo"))
import comun  # noqa: E402

PLAZOS = {"a24h": (24, 29), "a48h": (48, 54)}
UMBRAL_PROB = 50
MIN_REPORTES_BLOQUE = 4
DIAS_GUARDADOS = 35
CODIGOS_LLUVIA = ("DZ", "RA", "SN", "SG", "PL", "GR", "GS", "UP")
METAR_URL = "https://aviationweather.gov/api/data/metar"

REGLAS = {
    "temperatura": "Error = pronóstico menos METAR en cada hora en punto. error_medio_c es el promedio del valor "
                   "absoluto; sesgo_c es el promedio con signo (positivo: el pronóstico se pasó de caliente). "
                   "El METAR redondea a grados enteros, así que un error menor de 0,5 °C no se distingue.",
    "plazos": "a24h usa la emisión más reciente hecha entre 24 y 29 h antes; a48h, entre 48 y 54 h antes. "
              "Si no hay emisión en esa ventana, la hora no se califica.",
    "lluvia": f"Bloques de 6 h en hora de Bogotá. Pronóstico «sí» si alguna hora tiene probabilidad de "
              f"{UMBRAL_PROB} % o más. Medido «sí» si algún METAR o SPECI reporta precipitación en la "
              f"estación (DZ, RA, SN, SG, PL, GR, GS, UP; no cuenta VC). Se califica con {MIN_REPORTES_BLOQUE} "
              "reportes o más en el bloque. El METAR ve la lluvia en la pista, no en toda la ciudad.",
    "conteos": "si_si: dijo que llovería y llovió. si_no: dijo que sí y no llovió. no_si: dijo que no y llovió. "
               "no_no: dijo que no y no llovió. porcentaje = (si_si + no_no) / bloques.",
}


def llueve(wx: str | None) -> bool:
    if not wx:
        return False
    for tok in wx.split():
        t = tok.lstrip("+-")
        if t.startswith("VC") or t.startswith("RE"):
            continue
        if any(c in t for c in CODIGOS_LLUVIA):
            return True
    return False


def leer_metar(d: date) -> list[dict]:
    """Reportes de SKBO del día d de Bogotá. Se pide con «date» porque «hours» corta en 400 filas."""
    fin = comun.inicio_dia_bogota(d + timedelta(days=1)) + timedelta(hours=1)
    url = METAR_URL + "?" + urllib.parse.urlencode({
        "ids": "SKBO", "format": "json", "hours": 26, "date": fin.strftime("%Y-%m-%dT%H:%M:%SZ")})
    datos = comun.bajar_json(url)
    out = []
    for m in datos if isinstance(datos, list) else []:
        if m.get("obsTime") is None:
            continue
        t = datetime.fromtimestamp(int(m["obsTime"]), timezone.utc)
        if comun.dia_bogota(t) != d:
            continue
        out.append({"t": t, "temp": m.get("temp"), "tipo": m.get("metarType"), "wx": m.get("wxString")})
    return out


def valor_en(em: dict, campo: str, hora: datetime):
    i = round((hora - comun.de_iso(em["h0"])).total_seconds() / 3600)
    serie = em.get(campo) or []
    return serie[i] if 0 <= i < len(serie) else None


def emision_para(emisiones: list, hora: datetime, plazo: tuple[int, int]) -> dict | None:
    mejor = None
    for em in emisiones:
        t = comun.de_iso(em["emitido"])
        ant = (hora - t).total_seconds() / 3600
        if plazo[0] <= ant < plazo[1] and (mejor is None or t > comun.de_iso(mejor["emitido"])):
            mejor = em
    return mejor


def calificar_dia(d: date, emisiones: list, metar: list) -> dict:
    fila = {"fecha_bogota": d.isoformat(), "reportes_metar": len(metar), "temperatura": {}, "lluvia": {}}
    en_punto = {}
    for m in metar:
        if m["tipo"] == "METAR" and m["t"].minute == 0 and m["temp"] is not None:
            en_punto[m["t"]] = float(m["temp"])
    for clave, plazo in PLAZOS.items():
        errores = []
        for h, medido in sorted(en_punto.items()):
            em = emision_para(emisiones, h, plazo)
            p = valor_en(em, "temp", h) if em else None
            if p is not None:
                errores.append(p - medido)
        fila["temperatura"][clave] = {
            "horas": len(errores),
            "error_medio_c": round(sum(abs(e) for e in errores) / len(errores), 2) if errores else None,
            "sesgo_c": round(sum(errores) / len(errores), 2) if errores else None,
        }
        cuenta = {"bloques": 0, "si_si": 0, "si_no": 0, "no_si": 0, "no_no": 0}
        inicio = comun.inicio_dia_bogota(d)
        for b in range(4):
            a, z = inicio + timedelta(hours=6 * b), inicio + timedelta(hours=6 * (b + 1))
            reps = [m for m in metar if a <= m["t"] < z]
            em = emision_para(emisiones, a, plazo)
            if len(reps) < MIN_REPORTES_BLOQUE or em is None:
                continue
            probs = [valor_en(em, "prob", a + timedelta(hours=k)) for k in range(6)]
            probs = [p for p in probs if p is not None]
            if len(probs) < 6:
                continue
            dijo = max(probs) >= UMBRAL_PROB
            llovio = any(llueve(m["wx"]) for m in reps)
            cuenta["bloques"] += 1
            cuenta[("si" if dijo else "no") + "_" + ("si" if llovio else "no")] += 1
        fila["lluvia"][clave] = cuenta
    return fila


def resumir(dias: list, hasta: date, n: int) -> dict:
    desde = hasta - timedelta(days=n - 1)
    elegidos = [f for f in dias if desde.isoformat() <= f["fecha_bogota"] <= hasta.isoformat()]
    out = {"desde": desde.isoformat(), "hasta": hasta.isoformat(), "dias_calificados": 0}
    for clave in PLAZOS:
        horas = sum(f["temperatura"][clave]["horas"] for f in elegidos)
        sa = sum(f["temperatura"][clave]["error_medio_c"] * f["temperatura"][clave]["horas"]
                 for f in elegidos if f["temperatura"][clave]["horas"])
        ss = sum(f["temperatura"][clave]["sesgo_c"] * f["temperatura"][clave]["horas"]
                 for f in elegidos if f["temperatura"][clave]["horas"])
        ll = {k: sum(f["lluvia"][clave][k] for f in elegidos) for k in ("bloques", "si_si", "si_no", "no_si", "no_no")}
        ll["aciertos"] = ll["si_si"] + ll["no_no"]
        ll["porcentaje"] = round(100 * ll["aciertos"] / ll["bloques"], 1) if ll["bloques"] else None
        out[clave] = {
            "temperatura": {"horas": horas, "error_medio_c": round(sa / horas, 2) if horas else None,
                            "sesgo_c": round(ss / horas, 2) if horas else None},
            "lluvia": ll,
        }
    out["dias_calificados"] = sum(1 for f in elegidos if any(f["temperatura"][c]["horas"] for c in PLAZOS))
    return out


def pendientes(hechos: set, hoy: date, ahora_local_min: int) -> list[date]:
    """Ayer y anteayer si faltan. Ayer solo desde las 00:30 de Bogotá (el METAR de las 23:00 ya llegó)."""
    ayer = hoy - timedelta(days=1)
    dias = [ayer - timedelta(days=1)]
    if ahora_local_min >= 30:
        dias.append(ayer)
    return [d for d in dias if d.isoformat() not in hechos]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sitio", type=Path, required=True)
    a = ap.parse_args()
    consulta = comun.ahora_utc()
    ruta = a.sitio / "pronostico" / "acierto.json"
    previo = comun.leer_json(ruta) or {}
    dias = previo.get("dias", [])
    hechos = {f["fecha_bogota"] for f in dias}
    local = consulta.astimezone(comun.BOGOTA)
    hoy = local.date()
    faltan = pendientes(hechos, hoy, local.hour * 60 + local.minute)
    emisiones = comun.leer_ndjson_gz(a.sitio / "pronostico" / "emitidos-5d.ndjson.gz")
    nuevos = 0
    if not faltan:
        print("acierto: nada pendiente")
    elif not emisiones:
        print("acierto: todavía no hay emisiones guardadas")
        faltan = []
    primera = min((comun.de_iso(e["emitido"]) for e in emisiones), default=None)
    for d in faltan:
        # Un día que empezó antes de la primera emisión + 24 h no tiene nada que calificar a 24 h.
        if comun.inicio_dia_bogota(d + timedelta(days=1)) <= primera + timedelta(hours=24):
            continue
        try:
            metar = leer_metar(d)
        except Exception as exc:
            print(f"::warning::METAR del {d} sin leer: {type(exc).__name__}: {exc}")
            continue
        fila = calificar_dia(d, emisiones, metar)
        dias = [f for f in dias if f["fecha_bogota"] != fila["fecha_bogota"]] + [fila]
        nuevos += 1
        t = fila["temperatura"]["a24h"]
        print(f"acierto {d}: {t['horas']} h a 24 h, error medio {t['error_medio_c']} °C; lluvia {fila['lluvia']['a24h']}")
    if not nuevos and previo:
        print("acierto: sin días nuevos que calificar")
        return 0
    # La primera vez se publica el archivo aunque no haya días calificados: resumen en cero y
    # porcentajes en null. Así quien lo lea encuentra el formato y no un 404.
    dias = sorted(dias, key=lambda f: f["fecha_bogota"])[-DIAS_GUARDADOS:]
    hasta = date.fromisoformat(dias[-1]["fecha_bogota"]) if dias else hoy - timedelta(days=1)
    salida = {
        "esquema": "bogotwin/acierto/1",
        "generado": comun.iso(consulta),
        "cadencia_min": 1440,
        "etiqueta": "inferido",
        "que_califica": "pronostico/ahora.json (Open-Meteo, punto del aeropuerto El Dorado) contra el METAR de El Dorado",
        "reglas": REGLAS,
        "resumen": {"ultimos_7_dias": resumir(dias, hasta, 7), "ultimos_30_dias": resumir(dias, hasta, 30)},
        "dias": dias,
        "fuentes": {
            "pronostico": {"nombre": "Open-Meteo", "url": "https://open-meteo.com/", "licencia": "CC BY 4.0"},
            "medido": {"nombre": "METAR de la Aerocivil vía aviationweather.gov (NOAA/NWS)", "url": METAR_URL,
                       "licencia": "Dominio público (NOAA/NWS)"},
        },
        "licencia_del_archivo": "CC BY 4.0. Cita a Open-Meteo y al METAR de la Aerocivil vía NOAA/NWS.",
        "corrida": comun.corrida(),
    }
    tam = comun.escribir_json(ruta, salida)
    print(f"pronostico/acierto.json {tam} B; {len(dias)} días")
    return 0


if __name__ == "__main__":
    sys.exit(main())
