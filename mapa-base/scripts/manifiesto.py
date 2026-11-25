"""Escribe salida/manifest.json: sha256 y bytes de cada PMTiles, fuentes crudas
(de salida/crudos/descargas.tsv), versiones de herramientas y licencia por archivo.

Uso (desde mapa-base/): python3 -I scripts/manifiesto.py
"""
import csv
import datetime
import hashlib
import json
import os
import subprocess

SALIDA = "salida"
LICENCIAS = {
    "osm-bogota.pmtiles": {
        "licencia": "ODbL 1.0",
        "atribucion": "© colaboradores de OpenStreetMap",
        "fuentes": ["colombia-latest.osm.pbf", "localidades.gpkg"],
        "scripts": ["scripts/osm.sh", "scripts/clasificar_osm.py", "scripts/osmium-export.json"],
    },
    "limites-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "SDP y UAECD, Datos Abiertos Bogotá",
        "fuentes": ["localidades.gpkg", "upl.gpkg", "barrios-legalizados.gpkg", "sector-catastral.gpkg.zip"],
        "scripts": ["scripts/limites.sh", "scripts/limites.sql"],
    },
    "catastro-pisos-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "UAECD (Catastro Bogotá), Datos Abiertos Bogotá",
        "fuentes": ["construcciones.gpkg.zip", "sector-catastral.gpkg.zip"],
        "scripts": ["scripts/catastro.sh", "scripts/catastro.sql"],
    },
    "catastro-lejos-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "UAECD (Catastro Bogotá), Datos Abiertos Bogotá. Modificada: huellas unidas por manzana y simplificadas.",
        "fuentes": ["construcciones.gpkg.zip"],
        "scripts": ["scripts/catastro.sh", "scripts/catastro.sql"],
    },
    "arboles-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "Jardín Botánico de Bogotá José Celestino Mutis (JBB), censo SIGAU, Datos Abiertos Bogotá",
        "fuentes": ["arboladourbano.zip"],
        "scripts": ["scripts/arboles.sh", "scripts/arboles.sql"],
    },
    "orto-urbana-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "Ortoimagen urbana 2025, SDP, publicada por IDECA (UAECD). Modificada: reproyectada, recortada en teselas y comprimida.",
        "fuentes": [],
        "scripts": ["scripts/orto.sh", "scripts/orto_bajar.py", "scripts/orto_armar.py"],
    },
    # La urbana se publica partida en ocho franjas de filas, cada una bajo 60 MB (Pages da
    # 503 con el archivo entero). El archivo entero queda como paso intermedio.
    **{f"orto-urbana-bogota-{n}.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "Ortoimagen urbana 2025, SDP, publicada por IDECA (UAECD). Modificada: reproyectada, recortada en teselas, comprimida y partida en franjas.",
        "fuentes": ["orto-urbana-bogota.pmtiles"],
        "scripts": ["scripts/orto.sh", "scripts/orto_bajar.py", "scripts/orto_armar.py", "scripts/orto_partir.py"],
    } for n in range(1, 9)},
    "orto-urbana-cerca-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "Ortoimagen urbana 2025, SDP, publicada por IDECA (UAECD). Modificada: reproyectada, recortada en teselas y comprimida.",
        "fuentes": [],
        "scripts": ["scripts/orto.sh", "scripts/orto_bajar.py", "scripts/orto_armar.py"],
    },
    "orto-cerros-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "Ortoimagen Cerros Orientales 2025, SDP, publicada por IDECA (UAECD). Modificada: reproyectada, recortada en teselas y comprimida.",
        "fuentes": [],
        "scripts": ["scripts/orto.sh", "scripts/orto_bajar.py", "scripts/orto_armar.py"],
    },
    "orto-cerros-lejos-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "Ortoimagen Cerros Orientales 2025, SDP, publicada por IDECA (UAECD). Modificada: reproyectada, recortada en teselas y comprimida.",
        "fuentes": [],
        "scripts": ["scripts/orto.sh", "scripts/orto_bajar.py", "scripts/orto_armar.py"],
    },
    "orto-rural-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "Ortoimagen satelital rural 2025, UAECD, publicada por IDECA. Producida por SIGLA S.A.S. con imágenes EarthScanner y Pléiades. Modificada: reproyectada, recortada en teselas y comprimida.",
        "fuentes": [],
        "scripts": ["scripts/orto.sh", "scripts/orto_bajar.py", "scripts/orto_armar.py"],
    },
    "orto-lejos-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "Ortoimágenes 2025 de Bogotá (urbana y Cerros Orientales, SDP; rural, UAECD), publicadas por IDECA. Modificada: reproyectada, recortada en teselas, reducida, unida y comprimida.",
        "fuentes": [],
        "scripts": ["scripts/orto_lejos.py"],
    },
    "satelite-entorno-bogota.pmtiles": {
        "licencia": "CC BY 4.0",
        "atribucion": "ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. Modificada: recortada, rellenada, tono ajustado, reproyectada y comprimida.",
        "fuentes": [],
        "scripts": ["scripts/satelite_entorno.py"],
    },
}
HERRAMIENTAS = {
    "tippecanoe (incluye tile-join)": ["tippecanoe", "--version"],
    "pmtiles": ["brew", "list", "--versions", "pmtiles"],
    "osmium": ["osmium", "--version"],
    "duckdb": ["duckdb", "--version"],
}


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def version(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return ((r.stdout or r.stderr).strip().splitlines() or ["?"])[0]
    except (OSError, subprocess.TimeoutExpired):
        return "no encontrada"


def main():
    fuentes = {}
    tsv = os.path.join(SALIDA, "crudos", "descargas.tsv")
    if os.path.exists(tsv):
        with open(tsv, encoding="utf-8") as f:
            for fila in csv.DictReader(f, delimiter="\t"):
                fuentes[fila["archivo"]] = fila
    productos = {}
    for nombre, meta in LICENCIAS.items():
        ruta = os.path.join(SALIDA, nombre)
        if not os.path.exists(ruta):
            continue
        productos[nombre] = {
            "bytes": os.path.getsize(ruta),
            "sha256": sha256(ruta),
            **meta,
            "sha256_scripts": {s: sha256(s) for s in meta["scripts"] if os.path.exists(s)},
        }
    man = {
        "generado_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "productos": productos,
        "fuentes": fuentes,
        "herramientas": {k: version(v) for k, v in HERRAMIENTAS.items()},
        "nota": "Cada archivo PMTiles tiene una sola licencia. No unir OSM (ODbL) con capas CC BY en un mismo archivo.",
    }
    with open(os.path.join(SALIDA, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(man, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: (v["bytes"], v["sha256"][:12]) for k, v in productos.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
