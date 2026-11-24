"""Genera terreno/procedencia.json: fuentes, descargas (URL, fecha, sha256), scripts y productos.

Uso: .venv/bin/python -I procedencia.py   (al final de terreno/Makefile)
Licencias y atribuciones exactas: ver PROCEDENCIA.md (texto fijo, revisado a mano).
"""
import csv
import json
import os
import platform
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comun as C  # noqa: E402

SCRIPTS = ["comun.py", "bajar.py", "mosaico.py", "pisos_por_celda.sql", "teselas.py", "horizonte.py",
           "huellas.sql", "prueba_a.py", "procedencia.py", "puntos-referencia.json", "requirements.txt", "Makefile"]
PRODUCTOS = [os.path.join(C.MAPA_BASE, "salida", "terreno-bogota.pmtiles"),
             os.path.join(C.SALIDA, "horizonte-bogota.hzn.gz"),
             os.path.join(C.SALIDA, "mosaico.npy"),
             os.path.join(C.SALIDA, "sombreado-sabana.png")]


def version(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()[0]
    except Exception:
        return None


def main():
    with open(os.path.join(C.CRUDOS, "descargas.tsv"), encoding="utf-8") as f:
        descargas = list(csv.DictReader(f, delimiter="\t"))
    out = {
        "fuentes": {
            "mdt2025": {"nombre": "Modelo Digital de Terreno de Bogotá D.C. 2025",
                        "productor": "Secretaría Distrital de Planeación (urbano y cerros) y UAECD (rural); elaborado por SIGLA S.A.S.",
                        "publica": "IDECA, Infraestructura de Datos Espaciales para el Distrito Capital",
                        "ficha": "https://datosabiertos.bogota.gov.co/dataset/modelo-digital-de-terreno-de-la-ciudad-de-bogota-ano-2025",
                        "servicio": "https://serviciosgis.catastrobogota.gov.co/image/rest/services/Imagenes/modelodigitalterreno2025funcion/ImageServer",
                        "licencia": "CC BY 4.0 (ficha CKAN, modificada 2026-07-02)",
                        "acceso": "servicio abierto, sin token (la ruta /arcgis/rest/ sí pide token; /image/rest/ no)"},
            "glo30": {"nombre": "Copernicus DEM GLO-30 (COP-DEM-GLO-30-F)",
                      "servicio": "https://copernicus-dem-30m.s3.amazonaws.com (registro https://registry.opendata.aws/copernicus-dem)",
                      "licencia": "Licence for Copernicus DEM instance COP-DEM-GLO-30-F Global 30m Full, Free & Open",
                      "licencia_url": "https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf"},
            "catastro_pisos": {"uso": "solo control de la prueba A (pisos por celda y huellas de huellas.sql; no entra en ningún producto)",
                               "archivo": "salida/trabajo/catastro/construcciones.fgb (lo deja scripts/catastro.sql)"}},
        "descargas": descargas,
        "scripts": {s: C.sha256(os.path.join(C.AQUI, s)) for s in SCRIPTS if os.path.exists(os.path.join(C.AQUI, s))},
        "productos": {os.path.relpath(p, C.MAPA_BASE): {"bytes": os.path.getsize(p), "sha256": C.sha256(p)}
                      for p in PRODUCTOS if os.path.exists(p)},
        "pruebas": {n: os.path.relpath(os.path.join(C.SALIDA, n), C.MAPA_BASE)
                    for n in ("mosaico.json", "teselas.json", "horizonte.json", "prueba_a.json")},
        "entorno": {"python": platform.python_version(), "sistema": platform.platform(),
                    "pmtiles": version(["pmtiles", "version"]), "duckdb": version(["duckdb", "--version"])},
    }
    ruta = os.path.join(C.AQUI, "procedencia.json")
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("escrito", ruta)


if __name__ == "__main__":
    main()
