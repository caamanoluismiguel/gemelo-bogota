#!/usr/bin/env python3
"""Bicicletas compartidas de Bogotá: estado de cada estación desde el feed GBFS 3.0.

Cada corrida (cada 10 minutos):
  1. Revisa la licencia en system_information. Si el feed declara una licencia
     que no está en la lista aceptada, para sin publicar nada nuevo.
  2. Baja station_information, station_status y vehicle_types.
  3. Escribe bicis/ahora.json (estado de ahora, compacto, para el visor).
  4. Suma una fila a bicis/serie-48h.ndjson.gz y borra lo de más de 48 h.
  5. Cada día de Bogotá ya cerrado que siga en la serie y no esté en el manifiesto
     se escribe como bicis-AAAA-MM-DD.ndjson.gz en la carpeta de cierres, para
     subirlo a la Release mensual bicis-AAAA-MM con su sha256.

Nada de esto entra a git salvo el manifiesto mensual (una vez al día).
Solo biblioteca estándar. Sin claves.

Uso:
    python3 -I pipelines/bicis/bicis.py --sitio _site --cierres _cierres --manifiestos vivo/manifiestos
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vivo"))
import comun  # noqa: E402

ESQUEMA = "bogotwin/bicis/1"
BASE = "https://bogota.publicbikesystem.net/customer/gbfs/v3.0/"
HORAS_SERIE = 48
CADENCIA_MIN = 10
# Licencias que el proyecto acepta publicar (identificadores SPDX).
LICENCIAS_OK = {"CC0-1.0", "CC-BY-4.0", "ODbL-1.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0"}
CAMPOS = ["bicis", "electricas", "anclajes_libres", "bicis_fuera_de_servicio",
          "anclajes_fuera_de_servicio", "estado", "min_desde_reporte"]
ESTADO_BITS = {"instalada": 1, "presta": 2, "recibe": 4, "dato_dudoso": 8}


class LicenciaNoAceptada(Exception):
    pass


def texto_es(lista) -> str | None:
    if isinstance(lista, str):
        return lista
    if not lista:
        return None
    for t in lista:
        if t.get("language") == "es":
            return t.get("text")
    return lista[0].get("text")


def revisar_licencia(sistema: dict) -> dict:
    d = sistema.get("data", {})
    lid, lurl = d.get("license_id"), d.get("license_url")
    if not lid and not lurl:
        return {
            "nombre": "CC0 1.0",
            "url": "https://creativecommons.org/publicdomain/zero/1.0/",
            "por_que": "El feed no declara license_id ni license_url. La especificación GBFS 3.0 "
                       "dice que en ese caso los datos están bajo CC0 1.0. Se revisa en cada corrida.",
        }
    if lid in LICENCIAS_OK and not lurl:
        return {"nombre": lid, "url": f"https://spdx.org/licenses/{lid}.html",
                "por_que": "Declarada por el feed en system_information.license_id."}
    raise LicenciaNoAceptada(f"license_id={lid!r} license_url={lurl!r}")


def dudoso(bicis: int, libres, capacidad, suma_tipos) -> bool:
    """Conteo que no cuadra: más bicis y anclajes que el doble de la capacidad, o el desglose por
    tipo no suma lo disponible. El 24 nov 2026 dos estaciones de capacidad 1 reportaban 198 bicis
    y 99 anclajes, sin reportar hace años. Se dejan en la lista con la marca y fuera de los totales."""
    if suma_tipos is not None and suma_tipos != bicis:
        return True
    if capacidad is not None and bicis + (libres or 0) > 2 * capacidad + 5:
        return True
    return False


def en_sabana(e: dict) -> bool:
    """Caja amplia de la Sabana de Bogotá. Una estación fuera de aquí tiene la ubicación mal."""
    try:
        return 4.2 <= float(e["lat"]) <= 5.2 and -74.5 <= float(e["lon"]) <= -73.7
    except (KeyError, TypeError, ValueError):
        return False


def armar_estado(info: dict, estado: dict, tipos: dict) -> tuple[list, dict]:
    """Une station_information con station_status. Devuelve la lista de estaciones y los totales."""
    electricos = {t["vehicle_type_id"] for t in tipos.get("data", {}).get("vehicle_types", [])
                  if t.get("propulsion_type") not in (None, "human")}
    ref = comun.de_iso(estado.get("last_updated"))
    por_id = {s["station_id"]: s for s in estado.get("data", {}).get("stations", [])}
    estaciones = []
    tot = {"estaciones": 0, "con_estado": 0, "bicis": 0, "electricas": 0, "anclajes_libres": 0,
           "vacias": 0, "llenas": 0, "sin_servicio": 0, "dudosas": 0}
    for e in info.get("data", {}).get("stations", []):
        sid = str(e["station_id"])
        s = por_id.get(e["station_id"])
        tot["estaciones"] += 1
        fila = None
        if s is not None:
            bits = (ESTADO_BITS["instalada"] if s.get("is_installed") else 0) \
                | (ESTADO_BITS["presta"] if s.get("is_renting") else 0) \
                | (ESTADO_BITS["recibe"] if s.get("is_returning") else 0)
            lr = comun.de_iso(s.get("last_reported"))
            min_rep = None if (lr is None or ref is None) else max(0, round((ref - lr).total_seconds() / 60))
            bicis = int(s.get("num_vehicles_available", 0))
            libres = s.get("num_docks_available")
            por_tipo = s.get("vehicle_types_available", [])
            suma_tipos = sum(v.get("count", 0) for v in por_tipo)
            elec = sum(v.get("count", 0) for v in por_tipo if v.get("vehicle_type_id") in electricos)
            if dudoso(bicis, libres, e.get("capacity"), suma_tipos if por_tipo else None) or not en_sabana(e):
                bits |= ESTADO_BITS["dato_dudoso"]
                elec = None
            fila = [bicis, elec, libres, s.get("num_vehicles_disabled"), s.get("num_docks_disabled"), bits, min_rep]
            if bits & ESTADO_BITS["dato_dudoso"]:
                tot["dudosas"] += 1
                estaciones.append({"id": sid, "nombre": texto_es(e.get("name")), "lat": round(float(e["lat"]), 6),
                                   "lon": round(float(e["lon"]), 6), "capacidad": e.get("capacity"), "v": fila})
                continue
            tot["con_estado"] += 1
            tot["bicis"] += bicis
            tot["electricas"] += elec
            tot["anclajes_libres"] += libres or 0
            operando = bits & 3 == 3
            if not operando:
                tot["sin_servicio"] += 1
            elif bicis == 0:
                tot["vacias"] += 1
            elif libres == 0:
                tot["llenas"] += 1
        estaciones.append({
            "id": sid,
            "nombre": texto_es(e.get("name")),
            "lat": round(float(e["lat"]), 6),
            "lon": round(float(e["lon"]), 6),
            "capacidad": e.get("capacity"),
            "v": fila,
        })
    return estaciones, tot


def fila_serie(hora: str, estaciones: list) -> dict:
    con = [e for e in estaciones if e["v"] is not None]
    return {"t": hora, "ids": [e["id"] for e in con], "v": [e["v"] for e in con]}


def podar(filas: list, ref, horas: int = HORAS_SERIE) -> list:
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
    """Días de Bogotá anteriores a hoy que tienen filas en la serie (el de hoy no ha cerrado)."""
    return sorted(d for d in {comun.dia_bogota(comun.de_iso(f["t"])) for f in filas} if d < hoy)


def cerrar_dia(d: date, filas: list, estaciones: list, licencia: dict, cierres: Path, manifiestos: Path) -> dict | None:
    del_dia = [f for f in filas if comun.dia_bogota(comun.de_iso(f["t"])) == d]
    if not del_dia:
        return None
    release = f"bicis-{d:%Y-%m}"
    nombre = f"bicis-{d.isoformat()}.ndjson.gz"
    if comun.ya_en_manifiesto(manifiestos, release, nombre):
        return None
    cabecera = {
        "tipo": "cabecera",
        "esquema": ESQUEMA + "/dia",
        "fecha_bogota": d.isoformat(),
        "campos": CAMPOS,
        "estado_bits": ESTADO_BITS,
        "estaciones": [{k: e[k] for k in ("id", "nombre", "lat", "lon", "capacidad")} for e in estaciones],
        "nota_estaciones": "Ubicación y nombre tomados al cerrar el día; si una estación se movió ese día, vale la del cierre.",
        "fuente": {"url": BASE, "licencia": licencia},
        "filas": len(del_dia),
        "filas_esperadas": 24 * 60 // CADENCIA_MIN,
        "primera": del_dia[0]["t"],
        "ultima": del_dia[-1]["t"],
        "nota_huecos": "Una fila por corrida. Si GitHub o el feed fallaron, falta la fila: los huecos quedan como huecos.",
    }
    ruta = cierres / release / nombre
    filas_dia = [cabecera] + [{"tipo": "fila", **f} for f in del_dia]
    tam = comun.escribir_ndjson_gz(ruta, filas_dia)
    entrada = {
        "nombre": nombre,
        "fecha_bogota": d.isoformat(),
        "bytes": tam,
        "sha256": comun.sha256(ruta),
        "filas": len(del_dia),
        "filas_esperadas": cabecera["filas_esperadas"],
        "fuente": BASE,
        "licencia": licencia["nombre"],
        "script": "pipelines/bicis/bicis.py (repo gemelo-bogota)",
        "corrida": comun.corrida(),
        "url": f"https://github.com/caamanoluismiguel/gemelo-bogota-vivo/releases/download/{release}/{nombre}",
    }
    comun.agregar_manifiesto(manifiestos, release, entrada)
    return entrada


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sitio", type=Path, required=True)
    ap.add_argument("--cierres", type=Path, required=True)
    ap.add_argument("--manifiestos", type=Path, required=True)
    a = ap.parse_args()
    consulta = comun.ahora_utc()

    try:
        licencia = revisar_licencia(comun.bajar_json(BASE + "system_information"))
    except LicenciaNoAceptada as exc:
        print(f"::error::El feed declara una licencia fuera de la lista aceptada ({exc}). Se para la cosecha.")
        return 3
    info = comun.bajar_json(BASE + "station_information")
    estado = comun.bajar_json(BASE + "station_status")
    tipos = comun.bajar_json(BASE + "vehicle_types")
    estaciones, tot = armar_estado(info, estado, tipos)
    if not tot["con_estado"]:
        print("::error::station_status vino sin estaciones.")
        return 1
    hora = comun.iso(comun.de_iso(estado.get("last_updated"))) or comun.iso(consulta)

    ahora = {
        "esquema": ESQUEMA,
        "generado": comun.iso(consulta),
        "hora_dato": hora,
        "cadencia_min": CADENCIA_MIN,
        "etiqueta": "de_fuente",
        "fuente": {
            "nombre": "Bicicletas compartidas de Bogotá, feed GBFS 3.0 del sistema",
            "url": BASE + "gbfs.json",
            "sistema": estado.get("data", {}).get("system_id") or "bogota_bike",
            "licencia": licencia,
            "nota": "Cuentas que reporta el propio sistema. No es un conteo nuestro en sitio.",
        },
        "campos": CAMPOS,
        "estado_bits": ESTADO_BITS,
        "totales": tot,
        "estaciones": estaciones,
        "corrida": comun.corrida(),
    }
    tam = comun.escribir_json(a.sitio / "bicis" / "ahora.json", ahora)

    ruta_serie = a.sitio / "bicis" / "serie-48h.ndjson.gz"
    filas = podar(comun.leer_ndjson_gz(ruta_serie) + [fila_serie(hora, estaciones)], consulta)
    tam_serie = comun.escribir_ndjson_gz(ruta_serie, filas)

    hoy = comun.dia_bogota(consulta)
    cerrados = []
    for d in dias_para_cerrar(filas, hoy):
        e = cerrar_dia(d, filas, estaciones, licencia, a.cierres, a.manifiestos)
        if e:
            cerrados.append(e)
    print(f"bicis/ahora.json {tam} B; serie {len(filas)} filas, {tam_serie} B; "
          f"{tot['bicis']} bicis en {tot['con_estado']} estaciones, {tot['vacias']} vacías, {tot['llenas']} llenas")
    for e in cerrados:
        print(f"Día cerrado {e['nombre']}: {e['filas']}/{e['filas_esperadas']} filas, {e['bytes']} B, sha256 {e['sha256'][:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
