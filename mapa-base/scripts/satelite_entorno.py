"""Foto satelital del entorno de Bogotá: el compuesto Sentinel-2 2021 de ESA WorldCover en PMTiles.

  python -I scripts/satelite_entorno.py bajar   baja una vez la ventana a salida/satelite-crudo/
  python -I scripts/satelite_entorno.py armar   arma salida/satelite-entorno-bogota.pmtiles

Por qué: las ortoimágenes de IDECA solo cubren el Distrito. En la vista de calle se ve más
allá (la sabana al occidente y al norte, La Calera tras los cerros) y ahí el visor dibujaba el
color de fondo del estilo, una franja blanca. Esta capa va debajo de todas las ortos.

Fuente: «ESA WorldCover Sentinel-2 median L2A (RGBNIR) composite at 10m resolution for year
2021», v2.0.0, teselas N04W075 y N04W074 del bucket público esa-worldcover-s2 (AWS Open Data).
Licencia CC BY 4.0 (la trae el propio archivo en su etiqueta «license»). Crédito pedido:
«ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by
ESA WorldCover consortium». Se lee una sola vez, por rangos del COG, a 20 m (vista general x2):
el visor nunca le pide nada a ese servidor.

Qué hace: mediana del año 2021 en rojo, verde y azul; huecos sin dato (nubes que no se fueron,
agua) rellenos con el promedio de alrededor; tono por reflectancia con una curva suave; teselas
web de z9 a z13 (unos 19 m por píxel en z13) en WebP.

Necesita rasterio, numpy y Pillow (un venv aparte: python3 -m venv v && v/bin/pip install
rasterio numpy pillow) y pmtiles (brew install pmtiles).
"""
import io
import math
import os
import sqlite3
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.normpath(os.path.join(AQUI, "..", "salida"))
CRUDO = os.path.join(SALIDA, "satelite-crudo", "worldcover-s2-2021-20m.npy")
NOMBRE = "satelite-entorno-bogota"
TITULO = "Sentinel-2 2021 (ESA WorldCover), entorno de Bogotá"
CREDITO = ("ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by "
           "ESA WorldCover consortium, CC BY 4.0. Modificada: recortada, rellenada, tono ajustado, "
           "reproyectada y comprimida.")
# Ventana (oeste, sur, este, norte): la caja del relieve (-74.27, 4.43, -73.93, 4.87) con margen.
CAJA = (-74.45, 4.30, -73.75, 5.00)
F = 2                        # vista general del COG: 10 m × 2 = 20 m
RES = F / 12000              # grados por píxel de la ventana
ZMIN, ZMAX = 9, 13
CALIDAD = 72
URL = ("https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021/N04/"
       "ESA_WorldCover_10m_2021_v200_N04W0{}_S2RGBNIR.tif")


def bajar():
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    o_, s_, e_, n_ = CAJA
    w_tot, h_tot = round((e_ - o_) / RES), round((n_ - s_) / RES)
    out = np.zeros((3, h_tot, w_tot), np.uint16)
    for t in (75, 74):
        o, e = max(o_, -t), min(e_, -t + 1)
        if o >= e:
            continue
        with rasterio.open("/vsicurl/" + URL.format(t)) as d:
            assert "CC-BY 4.0" in d.tags().get("license", ""), d.tags()
            w = round((e - o) / RES)
            a = d.read((1, 2, 3), window=from_bounds(o, s_, e, n_, d.transform), out_shape=(3, h_tot, w),
                       resampling=Resampling.average)
        c0 = round((o - o_) / RES)
        out[:, :, c0:c0 + w] = a
        print(f"N04W0{t}: {a.shape[2]} x {a.shape[1]} px", flush=True)
    os.makedirs(os.path.dirname(CRUDO), exist_ok=True)
    np.save(CRUDO, out)
    print(f"{CRUDO}: {os.path.getsize(CRUDO) / 1e6:.1f} MB", flush=True)


def tono(a):
    """Reflectancia (0 a 10000) a 8 bits, con los huecos rellenos."""
    hueco = (a == 0).all(0)
    r = np.clip(a.astype(np.float32) / 10000 * 3.2, 0, 1) ** (1 / 1.6)
    im = (r.transpose(1, 2, 0) * 255).round().astype(np.uint8)
    if hueco.any():
        # Relleno por convolución normalizada a varias escalas: cada hueco toma el color de
        # alrededor. Son pocos y chicos (nubes, agua); de lejos no se distinguen.
        valido = (~hueco).astype(np.float32)
        lleno = im.astype(np.float32)
        falta = hueco.copy()
        for radio in (4, 12, 40, 120):
            m = np.asarray(Image.fromarray((valido * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radio)),
                           np.float32) / 255
            canales = [np.asarray(Image.fromarray((lleno[..., c] * valido).astype(np.uint8))
                                  .filter(ImageFilter.GaussianBlur(radio)), np.float32) / 255 for c in range(3)]
            ok = falta & (m > 0.02)
            for c in range(3):
                lleno[..., c][ok] = (canales[c][ok] / m[ok]) * 255
            falta &= ~ok
        im = lleno.clip(0, 255).astype(np.uint8)
    return im


def tesela(img, z, x, y, px=256, sobre=2):
    """Muestrea la ventana (EPSG:4326) para una tesela web; bilineal con sobremuestreo."""
    n = px * sobre
    k = 1 << z
    i = (np.arange(n) + 0.5) / n
    lon = (x + i) / k * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + i) / k))))
    o_, s_, e_, n_ = CAJA
    cx = (lon - o_) / RES - 0.5
    cy = (n_ - lat) / RES - 0.5
    h, w = img.shape[:2]
    dentro = ((cx >= 0) & (cx <= w - 1))[None, :] & ((cy >= 0) & (cy <= h - 1))[:, None]
    if not dentro.any():
        return None
    cx, cy = np.clip(cx, 0, w - 1.001), np.clip(cy, 0, h - 1.001)
    x0, y0 = cx.astype(int), cy.astype(int)
    fx, fy = (cx - x0)[None, :, None], (cy - y0)[:, None, None]
    f = img.astype(np.float32)
    v = (f[y0][:, x0] * (1 - fx) * (1 - fy) + f[y0][:, x0 + 1] * fx * (1 - fy)
         + f[y0 + 1][:, x0] * (1 - fx) * fy + f[y0 + 1][:, x0 + 1] * fx * fy)
    rgba = np.dstack([v, dentro.astype(np.float32) * 255]).round().astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA").resize((px, px), Image.BOX)
    return im


def armar():
    img = tono(np.load(CRUDO))
    o_, s_, e_, n_ = CAJA
    merc = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2
    trabajo = os.path.join(SALIDA, "trabajo")
    os.makedirs(trabajo, exist_ok=True)
    mb = os.path.join(trabajo, f"{NOMBRE}.mbtiles")
    if os.path.exists(mb):
        os.remove(mb)
    db = sqlite3.connect(mb)
    db.execute("CREATE TABLE metadata (name text, value text)")
    db.execute("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)")
    db.execute("CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)")
    for z in range(ZMIN, ZMAX + 1):
        k = 1 << z
        xs = range(int((o_ + 180) / 360 * k), int((e_ + 180) / 360 * k) + 1)
        ys = range(int(merc(n_) * k), int(merc(s_) * k) + 1)
        n = b = 0
        for x in xs:
            for y in ys:
                im = tesela(img, z, x, y)
                if im is None:
                    continue
                buf = io.BytesIO()
                (im.convert("RGB") if im.getchannel("A").getextrema()[0] == 255 else im).save(
                    buf, "WEBP", quality=CALIDAD, method=5)
                db.execute("INSERT INTO tiles VALUES (?,?,?,?)", (z, x, k - 1 - y, buf.getvalue()))
                n, b = n + 1, b + len(buf.getvalue())
        print(f"  z{z}: {n} teselas, {b / 1e6:.2f} MB", flush=True)
    meta = {
        "name": TITULO, "format": "webp", "type": "baselayer", "version": "1",
        "minzoom": str(ZMIN), "maxzoom": str(ZMAX), "bounds": f"{o_},{s_},{e_},{n_}",
        "center": f"{(o_ + e_) / 2},{(s_ + n_) / 2},{ZMIN}",
        "attribution": f"{TITULO}: {CREDITO}",
        "description": (f"{TITULO}. Mediana L2A de 2021 a 20 m, teselas de 256 px en WebP calidad {CALIDAD}. "
                        "Licencia CC BY 4.0. Bajada una vez; el visor no depende del servidor de origen."),
    }
    db.executemany("INSERT INTO metadata VALUES (?,?)", meta.items())
    db.commit()
    db.close()
    pm = os.path.join(SALIDA, f"{NOMBRE}.pmtiles")
    subprocess.run(["pmtiles", "convert", "--quiet", mb, pm], check=True)
    print(f"  {pm}: {os.path.getsize(pm) / 1e6:.2f} MB", flush=True)


if __name__ == "__main__":
    {"bajar": bajar, "armar": armar}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(
        "uso: python -I scripts/satelite_entorno.py bajar|armar"))()
