"""Arma la foto de lejos: las ortoimágenes 2025 de IDECA reducidas a z10 a z15 en un solo PMTiles.

  python -I scripts/orto_lejos.py

Por qué: en la vista de calle (3D, cámara inclinada) MapLibre pide para el suelo lejano teselas
de zoom bajo, z10 a z15. La urbana solo tiene z16 a z19, así que de 1 a 20 km de la cámara no
había foto y se veía el color de fondo del estilo: el «manto blanco» al pie de los cerros.

Qué hace: parte de las teselas WebP que ya dejó orto_armar.py en salida/orto-webp/ (nada se
baja de nuevo) y, de z15 hacia z10, une cada cuatro teselas hijas en una (Lanczos). En cada
zoom pone, de abajo hacia arriba, el mismo orden que el visor: rural, cerros, urbana. Donde
hay tesela propia de ese zoom (cerros z13 a z15, rural z11 a z14 y su z14 estirada en z15,
cerros lejos z11 de 512 px) queda debajo de lo reducido, así no se pierde nada. Bordes con
alfa; nada blanco. Con este archivo el visor ya no necesita orto-rural ni orto-cerros-lejos.

Sale salida/orto-lejos-bogota.pmtiles. Misma licencia que las fuentes (CC BY 4.0, SDP y UAECD
vía IDECA), modificada: reducida y unida.
"""
import io
import math
import os
import sqlite3
import subprocess

from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.normpath(os.path.join(AQUI, "..", "salida"))
WEBP = os.path.join(SALIDA, "orto-webp")
CALIDAD = 75
ZMAX, ZMIN = 15, 10
NOMBRE = "orto-lejos-bogota"
TITULO = "Ortoimágenes 2025 de Bogotá, vista lejana"


def leer(carpeta, z, x, y, px=256):
    ruta = os.path.join(WEBP, carpeta, str(z), str(x), f"{y}.webp")
    if not os.path.exists(ruta):
        return None
    im = Image.open(ruta).convert("RGBA")
    return im if im.size == (px, px) else im.resize((px, px), Image.LANCZOS)


def llaves(carpeta, z):
    base = os.path.join(WEBP, carpeta, str(z))
    if not os.path.isdir(base):
        return set()
    return {(int(x), int(os.path.splitext(f)[0])) for x in os.listdir(base) for f in os.listdir(os.path.join(base, x))
            if f.endswith(".webp")}


def encima(abajo, arriba):
    if abajo is None:
        return arriba
    if arriba is None:
        return abajo
    return Image.alpha_composite(abajo, arriba)


RURAL_ZMAX = 14


def rural(z, x, y):
    """La rural llega hasta z14; en z15 se estira el cuarto de su tesela madre."""
    if z <= RURAL_ZMAX:
        return leer("orthorural2025funcion", z, x, y)
    madre = leer("orthorural2025funcion", RURAL_ZMAX, x >> (z - RURAL_ZMAX), y >> (z - RURAL_ZMAX))
    if madre is None:
        return None
    n = 1 << (z - RURAL_ZMAX)
    lado = 256 // n
    cx, cy = (x % n) * lado, (y % n) * lado
    return madre.crop((cx, cy, cx + lado, cy + lado)).resize((256, 256), Image.BICUBIC)


def nativa(z, x, y):
    """Teselas propias de ese zoom, de abajo hacia arriba: rural, cerros lejos (512), cerros."""
    im = rural(z, x, y)
    if z == 11:
        im = encima(im, leer("orthocerros2025funcion@512", z, x, y))
    return encima(im, leer("orthocerros2025funcion", z, x, y))


def hijas16(x, y):
    # z16: la urbana sobre los cerros, como en el visor.
    return encima(leer("orthocerros2025funcion", 16, x, y), leer("orthourbana2025funcion", 16, x, y))


def reducir(hijas, x, y):
    lienzo = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    hay = False
    for dx in (0, 1):
        for dy in (0, 1):
            im = hijas(2 * x + dx, 2 * y + dy)
            if im is not None:
                lienzo.paste(im, (dx * 256, dy * 256))
                hay = True
    if not hay:
        return None
    # Lanczos con alfa premultiplicado para que el borde transparente no oscurezca la foto.
    return lienzo.convert("RGBa").resize((256, 256), Image.LANCZOS).convert("RGBA")


def a_bytes(im):
    lo = im.getchannel("A").getextrema()[0]
    buf = io.BytesIO()
    (im.convert("RGB") if lo == 255 else im).save(buf, "WEBP", quality=CALIDAD, method=5)
    return buf.getvalue()


def main():
    padres = lambda ks: {(x // 2, y // 2) for x, y in ks}
    teselas = []
    hijas = hijas16
    cubiertas = llaves("orthourbana2025funcion", 16) | llaves("orthocerros2025funcion", 16)
    for z in range(ZMAX, ZMIN - 1, -1):
        propias = llaves("orthocerros2025funcion", z)
        if z <= RURAL_ZMAX:
            propias |= llaves("orthorural2025funcion", z)
        else:
            n = 1 << (z - RURAL_ZMAX)
            propias |= {(x * n + i, y * n + j) for x, y in llaves("orthorural2025funcion", RURAL_ZMAX)
                        for i in range(n) for j in range(n)}
        if z == 11:
            propias |= llaves("orthocerros2025funcion@512", z)
        cubiertas = padres(cubiertas) | propias
        nivel = {}
        for x, y in sorted(cubiertas):
            im = encima(nativa(z, x, y), reducir(hijas, x, y))
            if im is None or im.getchannel("A").getextrema()[1] == 0:
                continue
            nivel[(x, y)] = im
            teselas.append((z, x, y, a_bytes(im)))
        hijas = lambda x, y, n=nivel: n.get((x, y))
        print(f"z{z}: {len(nivel)} teselas", flush=True)

    trabajo = os.path.join(SALIDA, "trabajo")
    os.makedirs(trabajo, exist_ok=True)
    mb = os.path.join(trabajo, f"{NOMBRE}.mbtiles")
    if os.path.exists(mb):
        os.remove(mb)
    db = sqlite3.connect(mb)
    db.execute("CREATE TABLE metadata (name text, value text)")
    db.execute("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)")
    db.execute("CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)")
    oeste = sur = 999.0
    este = norte = -999.0
    por_zoom = {}
    for z, x, y, datos in teselas:
        db.execute("INSERT INTO tiles VALUES (?,?,?,?)", (z, x, (1 << z) - 1 - y, datos))
        n, b = por_zoom.get(z, (0, 0))
        por_zoom[z] = (n + 1, b + len(datos))
        k = 1 << z
        lat = lambda yy: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / k))))
        oeste, este = min(oeste, x / k * 360 - 180), max(este, (x + 1) / k * 360 - 180)
        sur, norte = min(sur, lat(y + 1)), max(norte, lat(y))
    meta = {
        "name": TITULO, "format": "webp", "type": "baselayer", "version": "1",
        "minzoom": str(ZMIN), "maxzoom": str(ZMAX),
        "bounds": f"{oeste:.6f},{sur:.6f},{este:.6f},{norte:.6f}",
        "center": f"{(oeste + este) / 2:.6f},{(sur + norte) / 2:.6f},{ZMIN}",
        "attribution": (f"{TITULO} © SDP y UAECD, publicadas por IDECA, CC BY 4.0. "
                        "Modificada: reproyectada, recortada en teselas, reducida, unida y comprimida."),
        "description": (f"{TITULO}: urbana, cerros y rural 2025 de IDECA reducidas a z{ZMIN} a z{ZMAX} "
                        f"desde las teselas ya bajadas. WebP calidad {CALIDAD}."),
    }
    db.executemany("INSERT INTO metadata VALUES (?,?)", meta.items())
    db.commit()
    db.close()
    pm = os.path.join(SALIDA, f"{NOMBRE}.pmtiles")
    subprocess.run(["pmtiles", "convert", "--quiet", mb, pm], check=True)
    for z in sorted(por_zoom):
        n, b = por_zoom[z]
        print(f"  z{z}: {n} teselas, {b / 1e6:.2f} MB", flush=True)
    print(f"  {pm}: {os.path.getsize(pm) / 1e6:.2f} MB, bounds {meta['bounds']}", flush=True)


if __name__ == "__main__":
    main()
