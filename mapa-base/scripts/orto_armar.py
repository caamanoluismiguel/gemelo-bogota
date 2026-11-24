"""Pasa las teselas bajadas por orto_bajar.py a WebP y las empaca en un PMTiles.

  python -I scripts/orto_armar.py <carpeta en orto-crudo> <nombre de salida> "<título>" <px> [zmin-zmax]

Lee salida/orto-crudo/<carpeta>/<z>/<x>/<y>.{jpg,png} (las .vacia no entran: el PMTiles
queda con huecos, nunca con cuadros blancos), guarda cada WebP en salida/orto-webp/ para no
recodificar en la próxima corrida, arma un MBTiles y lo convierte con `pmtiles convert`.
Las teselas de borde (PNG con transparencia) pasan a WebP con alfa; las llenas, sin alfa.
Si se cambia cómo se codifica, borrar salida/orto-webp/ para que todo se rehaga.
"""
import os
import sqlite3
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageChops, ImageFilter

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.normpath(os.path.join(AQUI, "..", "salida"))
CALIDAD = 75
# Titular del derecho: la SDP en la urbana y los cerros; la UAECD en la rural (su copyrightText).
TITULAR = os.environ.get("ORTO_TITULAR", "SDP")
ATRIBUCION = (f"{TITULAR}, publicada por IDECA (UAECD), CC BY 4.0. "
              "Modificada: reproyectada, recortada en teselas y comprimida.")


def a_webp(par):
    origen, destino = par
    if os.path.exists(destino) and os.path.getmtime(destino) >= os.path.getmtime(origen):
        return destino, None
    im = Image.open(origen)
    im.load()
    if im.mode != "RGB":
        im = im.convert("RGBA")
        lo, hi = im.getchannel("A").getextrema()
        if hi == 0:
            return destino, "vacia"
        # El servicio vuelve transparente todo píxel igual al NoData (blanco puro en un techo
        # de invernadero, negro puro en la sombra de una nube). Esos agujeros de pocos píxeles
        # se cierran; el borde de la cobertura, que es largo y liso, no cambia.
        a = im.getchannel("A")
        cerrado = a.point(lambda v: 255 if v else 0).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
        im.putalpha(ImageChops.lighter(a, cerrado))
        lo = im.getchannel("A").getextrema()[0]
        if lo == 255:
            im = im.convert("RGB")
    elif min(im.convert("L").getextrema()) >= 245:
        return destino, "vacia"
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    tmp = destino + ".tmp"
    im.save(tmp, "WEBP", quality=CALIDAD, method=5)
    os.replace(tmp, destino)
    return destino, None


def main():
    carpeta, nombre, titulo, px = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    zmin_pedido, zmax_pedido = (int(v) for v in sys.argv[5].split("-")) if len(sys.argv) > 5 else (0, 30)
    crudo = os.path.join(SALIDA, "orto-crudo", carpeta)
    webp = os.path.join(SALIDA, "orto-webp", carpeta)
    pares, llaves = [], []
    for z in sorted((d for d in os.listdir(crudo) if zmin_pedido <= int(d) <= zmax_pedido), key=int):
        for x in os.listdir(os.path.join(crudo, z)):
            for f in os.listdir(os.path.join(crudo, z, x)):
                y, ext = os.path.splitext(f)
                if ext in (".jpg", ".png"):
                    pares.append((os.path.join(crudo, z, x, f), os.path.join(webp, z, x, y + ".webp")))
                    llaves.append((int(z), int(x), int(y)))
    print(f"{carpeta}: {len(pares)} teselas con foto", flush=True)

    with ProcessPoolExecutor(max(1, (os.cpu_count() or 4) - 2)) as ex:
        res = list(ex.map(a_webp, pares, chunksize=64))

    mb = os.path.join(SALIDA, "trabajo", f"{nombre}.mbtiles")
    os.makedirs(os.path.dirname(mb), exist_ok=True)
    if os.path.exists(mb):
        os.remove(mb)
    db = sqlite3.connect(mb)
    db.execute("CREATE TABLE metadata (name text, value text)")
    db.execute("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)")
    db.execute("CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)")
    por_zoom, zs = {}, []
    import math
    oeste = sur = 999.0
    este = norte = -999.0
    for (z, x, y), (destino, marca) in zip(llaves, res):
        if marca == "vacia":
            continue
        with open(destino, "rb") as f:
            datos = f.read()
        db.execute("INSERT INTO tiles VALUES (?,?,?,?)", (z, x, (1 << z) - 1 - y, datos))
        n, b = por_zoom.get(z, (0, 0))
        por_zoom[z] = (n + 1, b + len(datos))
        zs.append(z)
        k = 1 << z
        lon0, lon1 = x / k * 360 - 180, (x + 1) / k * 360 - 180
        lat1 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / k))))
        lat0 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / k))))
        oeste, este, sur, norte = min(oeste, lon0), max(este, lon1), min(sur, lat0), max(norte, lat1)
    zmin, zmax = min(zs), max(zs)
    meta = {
        "name": titulo, "format": "webp", "type": "baselayer", "version": "1",
        "minzoom": str(zmin), "maxzoom": str(zmax),
        "bounds": f"{oeste:.6f},{sur:.6f},{este:.6f},{norte:.6f}",
        "center": f"{(oeste + este) / 2:.6f},{(sur + norte) / 2:.6f},{zmin}",
        "attribution": f"{titulo} © {ATRIBUCION}",
        "description": f"{titulo}. Teselas de {px} px en WebP calidad {CALIDAD}. Fuente: servicio "
                       f"{carpeta.split('@')[0]} de IDECA, bajado una vez; el visor no depende de él.",
    }
    db.executemany("INSERT INTO metadata VALUES (?,?)", meta.items())
    db.commit()
    db.close()
    pm = os.path.join(SALIDA, f"{nombre}.pmtiles")
    subprocess.run(["pmtiles", "convert", "--quiet", mb, pm], check=True)
    for z in sorted(por_zoom):
        n, b = por_zoom[z]
        print(f"  z{z}: {n} teselas, {b / 1e6:.1f} MB, {b / n / 1024:.1f} KB de media", flush=True)
    print(f"  {pm}: {os.path.getsize(pm) / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
