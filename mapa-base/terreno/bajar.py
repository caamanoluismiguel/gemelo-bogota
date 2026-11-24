"""Baja las fuentes crudas del terreno y anota URL, hora, bytes y sha256.

Uso (desde cualquier carpeta):  .venv/bin/python -I bajar.py
Salidas (fuera del repo, carpeta ignorada):
  salida/crudos/terreno/glo30/     dos teselas COG de Copernicus GLO-30
  salida/crudos/terreno/mdt2025/   exportes del ImageServer del MDT 2025 y su catálogo
  salida/crudos/terreno/descargas.tsv
Cada fuente en su carpeta. Lo bajado es dato no confiable: aquí solo se guarda,
no se ejecuta ni se descomprime nada.
"""
import datetime
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comun as C  # noqa: E402

UA = "terreno-cliente/1.0"
GLO = "https://copernicus-dem-30m.s3.amazonaws.com"
MDT = ("https://serviciosgis.catastrobogota.gov.co/image/rest/services/"
       "Imagenes/modelodigitalterreno2025funcion/ImageServer")
SUB = 3                      # el MDT se pide a 1/3 de segundo (unos 10 m) y se promedia 3x3
FILAS_POR_PEDIDO = 1008      # 3024 px de alto, bajo el máximo de 4100 del servicio


def registrar(reg, nombre, url, ruta):
    linea = "\t".join([nombre, url, datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                       str(os.path.getsize(ruta)), C.sha256(ruta)])
    with open(reg, "a", encoding="utf-8") as f:
        f.write(linea + "\n")


def bajar(url, destino, reg, nombre):
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        print("ya está:", nombre)
        return
    print("bajando", nombre)
    parcial = destino + ".parcial"
    for intento in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=600) as r, open(parcial, "wb") as f:
                tipo = r.headers.get("Content-Type", "")
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
            break
        except Exception as e:  # reintento simple
            print("  falló:", e)
            time.sleep(10 * (intento + 1))
    else:
        raise SystemExit("no se pudo bajar " + nombre)
    with open(parcial, "rb") as f:
        cabeza = f.read(64)
    if b"Token Required" in cabeza or b'"error"' in cabeza or cabeza.startswith(b"<"):
        os.remove(parcial)
        raise SystemExit(f"{nombre}: el servidor respondió con error o pidió token ({tipo}). Se detiene.")
    os.replace(parcial, destino)
    registrar(reg, nombre, url, destino)


def main():
    glo_dir = os.path.join(C.CRUDOS, "glo30")
    mdt_dir = os.path.join(C.CRUDOS, "mdt2025")
    os.makedirs(glo_dir, exist_ok=True)
    os.makedirs(mdt_dir, exist_ok=True)
    reg = os.path.join(C.CRUDOS, "descargas.tsv")
    if not os.path.exists(reg):
        with open(reg, "w", encoding="utf-8") as f:
            f.write("archivo\turl\tconsultado_utc\tbytes\tsha256\n")

    # 1. Copernicus GLO-30 (bucket público de AWS, sin credenciales)
    for t in ("N04_00_W075_00", "N04_00_W074_00"):
        n = f"Copernicus_DSM_COG_10_{t}_DEM"
        bajar(f"{GLO}/{n}/{n}.tif", os.path.join(glo_dir, n + ".tif"), reg, "glo30/" + n + ".tif")

    # 2. MDT 2025: metadatos del servicio y catálogo (huellas urbano, cerros y rural)
    bajar(MDT + "?f=json", os.path.join(mdt_dir, "servicio.json"), reg, "mdt2025/servicio.json")
    q = urllib.parse.urlencode({"where": "1=1", "outFields": "OBJECTID,Name,MinPS,MaxPS,Category",
                                "returnGeometry": "true", "outSR": "4326", "f": "json"})
    bajar(MDT + "/query?" + q, os.path.join(mdt_dir, "catalogo.json"), reg, "mdt2025/catalogo.json")

    # 3. MDT 2025 por exportes, alineados a la rejilla del mosaico con 3x3 subpíxeles
    c0 = int(round(C.col_de_lon(-74.455)))
    c1 = int(round(C.col_de_lon(-73.985)))
    f0 = int(round(C.fil_de_lat(4.84)))
    f1 = C.NFIL - 1
    ancho = (c1 - c0 + 1) * SUB
    k = 0
    for fa in range(f0, f1 + 1, FILAS_POR_PEDIDO):
        fb = min(fa + FILAS_POR_PEDIDO - 1, f1)
        oeste = C.lon_de_col(c0) - C.P / 2
        este = C.lon_de_col(c1) + C.P / 2
        norte = C.lat_de_fil(fa) + C.P / 2
        sur = C.lat_de_fil(fb) - C.P / 2
        alto = (fb - fa + 1) * SUB
        q = urllib.parse.urlencode({
            "bbox": f"{oeste:.10f},{sur:.10f},{este:.10f},{norte:.10f}", "bboxSR": "4326", "imageSR": "4326",
            "size": f"{ancho},{alto}", "format": "tiff", "pixelType": "F32", "noData": "-9999",
            "noDataInterpretation": "esriNoDataMatchAny", "interpolation": "RSP_BilinearInterpolation",
            "compression": "LZW", "f": "image"})
        nombre = f"mdt2025/mdt_c{c0}_f{fa}-{fb}.tif"
        bajar(MDT + "/exportImage?" + q, os.path.join(C.CRUDOS, nombre), reg, nombre)
        k += 1
    print("listo:", k, "exportes del MDT. Registro en", reg)


if __name__ == "__main__":
    main()
