"""Color de techo de cada construcción de Catastro, medido en la Ortoimagen urbana 2025.

  python -I scripts/techos.py medir       salida/trabajo/catastro/techos-medidas.csv
  python -I scripts/techos.py cuantizar   salida/trabajo/catastro/techos.csv

medir: lee las huellas encogidas 1 m de techos-huellas.csv (scripts/techos.sql, solo hasta
4 pisos), las agrupa por tesela z15 y, bloque por bloque, arma la foto z18 de ese bloque con
las teselas JPEG/PNG tal como llegaron del servicio (salida/orto-crudo, sin recomprimir) más
una tesela de margen alrededor. Dibuja cada huella en una imagen de etiquetas y saca, por
construcción, la mediana de R, G y B de sus píxeles de techo. Nunca hay más de un bloque en
memoria (unos 20 MB de foto): el Mac tiene 16 GB y esto corre solo, con nice.

Qué píxeles cuentan: los que tienen foto (no los del borde transparente), que no son verdes
(2G - R - B > 25 y G > R: copa de árbol, prado, techo verde) y que no son sombra (luminancia
menor que 45). Se descarta el color de la construcción si:
  - más del 30 % de sus píxeles son verdes (un árbol tapa el techo);
  - más del 50 % son sombra;
  - quedan menos de 20 píxeles útiles (unos 7 m²: la muestra es muy pequeña);
  - menos de la mitad de la huella tiene foto.
Los de más de 4 pisos no llegan aquí (techos.sql).

cuantizar: pasa cada mediana a la paleta corta PALETA (el más cercano en CIELAB) y escribe
fid, techo (índice en la paleta) y techo_q (2: muestra grande y limpia; 1: el resto). Ese
CSV lo une catastro.sql con las construcciones. La paleta está repetida en site/comun.js
(TECHO_COLOR); pruebas/techos.prueba.js revisa que sean iguales.

Licencias: la foto es CC BY 4.0 (SDP, publicada por IDECA) y Catastro también: el resultado
va solo en los archivos de Catastro, nunca con datos de OpenStreetMap (ODbL).
"""
import csv
import math
import os
import struct
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.normpath(os.path.join(AQUI, "..", "salida"))
CAT = os.path.join(SALIDA, "trabajo", "catastro")
CRUDO = os.path.join(SALIDA, "orto-crudo", "orthourbana2025funcion", "18")
R = 20037508.342789244
Z = 18
PX = 256
BLOQUE = 8          # teselas z18 por lado en una tesela z15
MARGEN = 1          # teselas de margen alrededor del bloque
LADO = (BLOQUE + 2 * MARGEN) * PX
ESCALA = PX * 2 ** Z / (2 * R)   # píxeles z18 por metro de EPSG:3857

VERDE_EXG = 25
OSCURO_LUM = 45
MAX_VERDE = 0.30
MAX_OSCURO = 0.50
MIN_UTILES = 20
MIN_FOTO = 0.5
Q_UTILES = 60       # techo_q = 2 desde aquí, si además lo descartado es menos del 20 %
Q_LIMPIO = 0.20

# Paleta corta de techos de Bogotá. Sale de agrupar en 12 (k-medias en CIELAB, `proponer 12`)
# las medianas de toda la ciudad medidas el 25 nov 2026: casi 8 de cada 10 techos bajos son
# grises (fibrocemento, placa, lámina), uno de cada 10 es teja o ladrillo y unos 6 de cada 100
# son azules. Dos grupos casi iguales se juntaron. El orden importa: el índice va en la tesela.
PALETA = [
    "#494549",  # 0 gris muy oscuro: lámina, asfalto, teja de concreto oscura
    "#5c5658",  # 1 gris oscuro
    "#6f6a6b",  # 2 gris medio: fibrocemento, placa de concreto
    "#858082",  # 3 gris
    "#a19b9e",  # 4 gris claro
    "#bebabd",  # 5 claro: placa pintada, impermeabilizante blanco
    "#6d4c4d",  # 6 teja de barro oscura
    "#916a67",  # 7 teja de barro clara, pardo
    "#914954",  # 8 ladrillo y teja roja
    "#466191",  # 9 azul: lámina o teja plástica
    "#6e7f9b",  # 10 azul grisáceo
]


def a_lab(rgb):
    """sRGB (0 a 255, forma (n, 3)) a CIELAB D65."""
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], axis=1)


def hex_rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def anillos(wkb):
    """WKB (little endian, 2D) de Polygon o MultiPolygon a lista de polígonos [[anillo, ...], ...]."""
    b = bytes.fromhex(wkb)
    pos = 0

    def u32():
        nonlocal pos
        v = struct.unpack_from("<I", b, pos)[0]
        pos += 4
        return v

    def poligono():
        nonlocal pos
        assert b[pos] == 1
        pos += 1
        t = u32()
        assert t == 3, t
        out = []
        for _ in range(u32()):
            n = u32()
            out.append(np.frombuffer(b, dtype="<f8", count=2 * n, offset=pos).reshape(n, 2))
            pos += 16 * n
        return out

    assert b[0] == 1
    t = struct.unpack_from("<I", b, 1)[0]
    if t == 3:
        return [poligono()]
    assert t == 6, t
    pos = 5
    return [poligono() for _ in range(u32())]


def leer_tesela(x, y):
    """RGB (256, 256, 3) y máscara de foto (256, 256) de la tesela z18, o None."""
    base = os.path.join(CRUDO, str(x), str(y))
    for ext in (".jpg", ".png"):
        if os.path.exists(base + ext):
            im = Image.open(base + ext)
            im.load()
            if im.mode == "RGB":
                return np.asarray(im), None
            im = im.convert("RGBA")
            a = np.asarray(im)
            return a[:, :, :3], a[:, :, 3] > 0
    return None


def bloque_foto(tx, ty):
    rgb = np.zeros((LADO, LADO, 3), dtype=np.uint8)
    hay = np.zeros((LADO, LADO), dtype=bool)
    x0, y0 = tx * BLOQUE - MARGEN, ty * BLOQUE - MARGEN
    for j in range(BLOQUE + 2 * MARGEN):
        for i in range(BLOQUE + 2 * MARGEN):
            t = leer_tesela(x0 + i, y0 + j)
            if t is None:
                continue
            sl = (slice(j * PX, (j + 1) * PX), slice(i * PX, (i + 1) * PX))
            rgb[sl] = t[0]
            hay[sl] = True if t[1] is None else t[1]
    return rgb, hay, x0 * PX, y0 * PX


def medir_bloque(tx, ty, filas, out):
    rgb, hay, ox, oy = bloque_foto(tx, ty)
    if not hay.any():
        for fid, _ in filas:
            out.writerow([fid, "", "", "", 0, 0, 0, 0, "sin foto"])
        return
    etiquetas = Image.new("I", (LADO, LADO), 0)
    d = ImageDraw.Draw(etiquetas)
    total = np.zeros(len(filas) + 1, dtype=np.int64)
    # Primero las huellas con patio: su hueco no debe borrar a una construcción del patio.
    orden = sorted(range(len(filas)), key=lambda k: -max(len(p) for p in filas[k][1]))
    for k in orden:
        for p in filas[k][1]:
            for n, anillo in enumerate(p):
                xs = (anillo[:, 0] + R) * ESCALA - ox
                ys = (R - anillo[:, 1]) * ESCALA - oy
                pts = list(zip(xs.tolist(), ys.tolist()))
                if len(pts) >= 3:
                    d.polygon(pts, fill=(k + 1) if n == 0 else 0)
    lab = np.asarray(etiquetas, dtype=np.int32).ravel()
    del etiquetas, d
    n_lab = len(filas) + 1
    total = np.bincount(lab, minlength=n_lab)
    con_foto = np.bincount(lab, weights=hay.ravel(), minlength=n_lab)
    r = rgb[:, :, 0].ravel().astype(np.int32)
    g = rgb[:, :, 1].ravel().astype(np.int32)
    b = rgb[:, :, 2].ravel().astype(np.int32)
    h = hay.ravel()
    lum = (299 * r + 587 * g + 114 * b) // 1000
    verde = h & (2 * g - r - b > VERDE_EXG) & (g > r)
    oscuro = h & ~verde & (lum < OSCURO_LUM)
    util = h & ~verde & ~oscuro & (lab > 0)
    n_verde = np.bincount(lab, weights=verde, minlength=n_lab)
    n_oscuro = np.bincount(lab, weights=oscuro, minlength=n_lab)
    lu = lab[util]
    n_util = np.bincount(lu, minlength=n_lab)
    medianas = []
    for canal in (r, g, b):
        hist = np.bincount(lu * 256 + canal[util], minlength=n_lab * 256).reshape(n_lab, 256)
        acum = np.cumsum(hist, axis=1)
        medianas.append(np.argmax(acum >= ((n_util + 1) // 2)[:, None], axis=1))
    for k, (fid, _) in enumerate(filas):
        e = k + 1
        t, f = int(total[e]), int(con_foto[e])
        if t == 0 or f < MIN_FOTO * t:
            motivo = "sin foto"
        elif n_verde[e] > MAX_VERDE * f:
            motivo = "verde"
        elif n_oscuro[e] > MAX_OSCURO * f:
            motivo = "sombra"
        elif n_util[e] < MIN_UTILES:
            motivo = "pequeña"
        else:
            motivo = ""
        if motivo:
            out.writerow([fid, "", "", "", t, int(n_util[e]), int(n_verde[e]), int(n_oscuro[e]), motivo])
        else:
            out.writerow([fid, int(medianas[0][e]), int(medianas[1][e]), int(medianas[2][e]), t, int(n_util[e]),
                          int(n_verde[e]), int(n_oscuro[e]), ""])


def medir():
    entrada = os.path.join(CAT, "techos-huellas.csv")
    destino = os.path.join(CAT, "techos-medidas.csv")
    tmp = destino + ".parcial"
    csv.field_size_limit(1 << 30)
    t0 = time.time()
    bloques = n = 0
    with open(entrada, newline="") as fe, open(tmp, "w", newline="") as fs:
        out = csv.writer(fs)
        out.writerow(["fid", "r", "g", "b", "pixeles", "utiles", "verdes", "oscuros", "descarte"])
        actual, filas = None, []
        for fila in csv.DictReader(fe):
            clave = (int(fila["tx"]), int(fila["ty"]))
            if clave != actual and filas:
                medir_bloque(*actual, filas, out)
                bloques += 1
                n += len(filas)
                filas = []
                if bloques % 50 == 0:
                    print(f"  {bloques} bloques, {n} construcciones, {time.time() - t0:.0f} s", flush=True)
            actual = clave
            filas.append((fila["fid"], anillos(fila["wkb"])))
        if filas:
            medir_bloque(*actual, filas, out)
            bloques += 1
            n += len(filas)
    os.replace(tmp, destino)
    print(f"medir: {bloques} bloques, {n} construcciones en {time.time() - t0:.0f} s -> {destino}")


def cuantizar():
    origen = os.path.join(CAT, "techos-medidas.csv")
    destino = os.path.join(CAT, "techos.csv")
    fids, rgb, q = [], [], []
    motivos = {}
    total = 0
    with open(origen, newline="") as f:
        for fila in csv.DictReader(f):
            total += 1
            if fila["descarte"]:
                motivos[fila["descarte"]] = motivos.get(fila["descarte"], 0) + 1
                continue
            fids.append(fila["fid"])
            rgb.append((int(fila["r"]), int(fila["g"]), int(fila["b"])))
            px, util = int(fila["pixeles"]), int(fila["utiles"])
            q.append(2 if util >= Q_UTILES and (px - util) <= Q_LIMPIO * px else 1)
    lab = a_lab(np.array(rgb))
    pal = a_lab(np.array([hex_rgb(c) for c in PALETA]))
    idx = np.empty(len(lab), dtype=np.int64)
    for i in range(0, len(lab), 200000):
        dd = ((lab[i:i + 200000, None, :] - pal[None, :, :]) ** 2).sum(axis=2)
        idx[i:i + 200000] = dd.argmin(axis=1)
    with open(destino + ".parcial", "w", newline="") as f:
        out = csv.writer(f)
        out.writerow(["fid", "techo", "techo_q"])
        for fid, i, qq in zip(fids, idx.tolist(), q):
            out.writerow([fid, i, qq])
    os.replace(destino + ".parcial", destino)
    cuenta = np.bincount(idx, minlength=len(PALETA))
    print(f"cuantizar: {len(fids)} con color de {total} medidas; descartes: {motivos}")
    print("paleta: " + ", ".join(f"{i} {c} {n / max(1, len(fids)):.1%}" for i, (c, n) in enumerate(zip(PALETA, cuenta))))
    err = np.sqrt(((lab - pal[idx]) ** 2).sum(axis=1))
    print(f"error ΔE76 a la paleta: mediana {np.median(err):.1f}, p90 {np.percentile(err, 90):.1f}")


def proponer(k=10, muestra=200000, semilla=1):
    """Ayuda para fijar PALETA: k-medias en CIELAB sobre una muestra de las medianas."""
    rgb = []
    with open(os.path.join(CAT, "techos-medidas.csv"), newline="") as f:
        for fila in csv.DictReader(f):
            if not fila["descarte"]:
                rgb.append((int(fila["r"]), int(fila["g"]), int(fila["b"])))
    rgb = np.array(rgb)
    rng = np.random.default_rng(semilla)
    m = rgb[rng.choice(len(rgb), min(muestra, len(rgb)), replace=False)]
    lab = a_lab(m)
    c = lab[rng.choice(len(lab), k, replace=False)]
    for _ in range(40):
        a = ((lab[:, None, :] - c[None]) ** 2).sum(axis=2).argmin(axis=1)
        c = np.array([lab[a == i].mean(axis=0) if (a == i).any() else c[i] for i in range(k)])
    for i in np.argsort(-np.bincount(a, minlength=k)):
        med = np.median(m[a == i], axis=0).astype(int)
        print(f"#{med[0]:02x}{med[1]:02x}{med[2]:02x}  {np.mean(a == i):.1%}  L={c[i][0]:.0f} a={c[i][1]:.0f} b={c[i][2]:.0f}")


if __name__ == "__main__":
    paso = sys.argv[1] if len(sys.argv) > 1 else ""
    if paso == "medir":
        medir()
    elif paso == "cuantizar":
        cuantizar()
    elif paso == "proponer":
        proponer(int(sys.argv[2]) if len(sys.argv) > 2 else 10)
    else:
        print(__doc__)
        sys.exit(2)
