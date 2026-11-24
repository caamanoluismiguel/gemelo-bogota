#!/usr/bin/env python3
"""Estaciones de transporte para Bogotwin (fase 1).

Escribe en site/datos/transporte/:
  troncales.geojson      estaciones troncales de TransMilenio (CC BY 4.0)
  metro-l1.geojson       estaciones y trazado de la Línea 1 del Metro (CC BY 4.0)
  paraderos-sitp.geojson paraderos del GTFS de TransMilenio (CC BY-SA 4.0), capa APARTE

Cada archivo lleva su fuente, su licencia y la hora de consulta en el miembro
«bogotwin» del GeoJSON. Las capas CC BY y la CC BY-SA nunca se juntan en un archivo.

Sin dependencias: biblioteca estándar de Python 3.10 o más nuevo.
Uso:  python3 -I pipelines/estaciones/estaciones.py [--gtfs RUTA_AL_ZIP]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "site" / "datos" / "transporte"
AGENTE = "bogotwin-estaciones/1 (+https://github.com/caamanoluismiguel/gemelo-bogota)"

TM = ("https://gis.transmilenio.gov.co/arcgis/rest/services/ConsultaSubgerenciaPlanificacionSITP/"
      "Consulta_Planificacion_SITP/FeatureServer/2/query")
METRO = "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer/{capa}/query"
GTFS = "https://storage.googleapis.com/gtfs-estaticos/GTFS_20261013.zip"
GTFS_FECHA = "2026-10-13"

CC_BY = {"nombre": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/deed.es", "familia": "cc_by"}
CC_BY_SA = {"nombre": "CC BY-SA 4.0", "url": "https://creativecommons.org/licenses/by-sa/4.0/deed.es", "familia": "cc_by_sa"}


def ahora() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def bajar(url: str, params: dict | None = None, tiempo: int = 60) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE})
    with urllib.request.urlopen(req, timeout=tiempo) as r:
        return r.read()


def redondear(coords, n=6):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], n), round(coords[1], n)]
    return [redondear(c, n) for c in coords]


def centroide(geom: dict) -> list[float]:
    """Promedio de los vértices del anillo exterior más grande. Basta para poner un rótulo."""
    anillos = geom["coordinates"] if geom["type"] == "Polygon" else [p[0] for p in geom["coordinates"]]
    anillo = max(anillos if geom["type"] == "MultiPolygon" else [anillos[0]], key=len)
    xs = [p[0] for p in anillo[:-1]] or [anillo[0][0]]
    ys = [p[1] for p in anillo[:-1]] or [anillo[0][1]]
    return [round(sum(xs) / len(xs), 6), round(sum(ys) / len(ys), 6)]


def escribir(nombre: str, features: list, meta: dict) -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    datos = {"type": "FeatureCollection", "bogotwin": meta, "features": features}
    (SALIDA / nombre).write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{nombre}: {len(features)} elementos")


def troncales() -> None:
    consulta = ahora()
    d = json.loads(bajar(TM, {"where": "1=1", "outFields": "nom_est,num_est", "outSR": "4326", "f": "geojson"}))
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": redondear(f["geometry"]["coordinates"])},
              "properties": {"nombre": f["properties"]["nom_est"].strip(), "codigo": f["properties"]["num_est"]}}
             for f in d["features"] if f.get("geometry")]
    if len(feats) < 100:
        raise ValueError(f"TransMilenio devolvió solo {len(feats)} estaciones")
    escribir("troncales.geojson", feats, {
        "titulo": "Estaciones troncales de TransMilenio",
        "fuente": "TransMilenio S.A., capa de planeación del SITP",
        "ficha": "https://datosabiertos.bogota.gov.co/dataset/estaciones-troncales-de-transmilenio1",
        "servicio": TM.removesuffix("/query"),
        "licencia": CC_BY, "etiqueta": "de_fuente", "consultado_utc": consulta,
        "nota": "La capa trae un código de etapa sin descripción publicada; no se interpreta ni se muestra.",
    })


def metro() -> None:
    consulta = ahora()
    est = json.loads(bajar(METRO.format(capa=0), {"where": "1=1", "outFields": "NOMBRE,NUMERO,ESTADO", "outSR": "4326", "f": "geojson"}))
    traz = json.loads(bajar(METRO.format(capa=1), {"where": "1=1", "outFields": "NOMBRE", "outSR": "4326", "f": "geojson"}))
    feats = []
    for f in est["features"]:
        p = f["properties"]
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": centroide(f["geometry"])},
                      "properties": {"tipo": "estacion", "nombre": p["NOMBRE"].strip(), "numero": p["NUMERO"],
                                     "estado": (p.get("ESTADO") or "").strip()}})
    for f in traz["features"]:
        feats.append({"type": "Feature", "geometry": {"type": f["geometry"]["type"], "coordinates": redondear(f["geometry"]["coordinates"], 5)},
                      "properties": {"tipo": "trazado", "nombre": f["properties"]["NOMBRE"].strip()}})
    if sum(1 for f in feats if f["properties"]["tipo"] == "estacion") < 10:
        raise ValueError("Metro: muy pocas estaciones")
    escribir("metro-l1.geojson", feats, {
        "titulo": "Primera línea del Metro de Bogotá: estaciones y trazado",
        "fuente": "Empresa Metro de Bogotá, publicado por IDECA",
        "fichas": ["https://datosabiertos.bogota.gov.co/dataset/estaciones-de-la-primera-linea-del-metro-de-bogota",
                   "https://datosabiertos.bogota.gov.co/dataset/trazado-primera-linea-del-metro-de-bogota"],
        "servicio": METRO.format(capa="0 y 1").removesuffix("/query"),
        "licencia": CC_BY, "etiqueta": "de_fuente", "consultado_utc": consulta,
        "nota": "La estación es un polígono en la fuente; aquí se pone un punto en el promedio de sus vértices. En obra: no hay operación ni horarios.",
    })


def paraderos(ruta_zip: str | None) -> None:
    consulta = ahora()
    if ruta_zip:
        contenido = Path(ruta_zip).read_bytes()
    else:
        contenido = bajar(GTFS, tiempo=600)
    with zipfile.ZipFile(io.BytesIO(contenido)) as z:
        nombre = next(n for n in z.namelist() if n.rsplit("/", 1)[-1] == "stops.txt")
        texto = z.read(nombre).decode("utf-8-sig")
    feats = []
    for fila in csv.DictReader(io.StringIO(texto)):
        if fila.get("location_type") not in (None, "", "0"):
            continue  # solo paradas, no estaciones padre ni accesos
        try:
            lon, lat = float(fila["stop_lon"]), float(fila["stop_lat"])
        except (KeyError, ValueError):
            continue
        if not (-74.5 < lon < -73.9 and 4.3 < lat < 5.0):
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                      "properties": {"nombre": (fila.get("stop_name") or "").strip(), "codigo": fila.get("stop_code") or fila["stop_id"]}})
    if len(feats) < 5000:
        raise ValueError(f"GTFS: solo {len(feats)} paradas")
    escribir("paraderos-sitp.geojson", feats, {
        "titulo": "Paraderos y paradas del GTFS de TransMilenio",
        "fuente": "TransMilenio S.A., GTFS estático",
        "archivo": GTFS, "fecha_archivo": GTFS_FECHA,
        "ficha": "https://datosabiertos.bogota.gov.co/dataset/especificacion-gtfs-general-transport-feed-specification-sitp",
        "licencia": CC_BY_SA, "etiqueta": "de_fuente", "consultado_utc": consulta,
        "nota": "Programación, no tiempo real. Capa CC BY-SA: se publica aparte y no se mezcla con capas de otra familia.",
    })


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gtfs", help="ZIP del GTFS ya descargado (si no, se baja de la fuente)")
    ap.add_argument("--sin-gtfs", action="store_true", help="No toca los paraderos")
    a = ap.parse_args()
    troncales()
    metro()
    if not a.sin_gtfs:
        paraderos(a.gtfs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
