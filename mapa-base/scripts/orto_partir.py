"""Parte la ortoimagen urbana (z16 a z18, 420 MB) en franjas de norte a sur, cada una de menos de 60 MB.

  python3 -I scripts/orto_partir.py [entrada.pmtiles] [carpeta_salida]

Por qué: GitHub Pages sirve mal los archivos muy grandes. Con el de 420 MB los pedidos por
partes (Range) respondían 503 en frío y un HEAD tardaba más de 100 s; los de 55 MB responden
206 sin problema. Partido en franjas, cada tesela vive en un solo archivo pequeño.

Cómo: cada franja es un rango de filas de teselas z16 (y16 de FRANJAS[i] a FRANJAS[i+1] - 1).
Una tesela z17 o z18 cae en la franja de su fila z16 (y >> (z - 16)), así que nunca queda en
dos archivos. Los bordes de las franjas van sobre bordes de teselas z16, que también lo son de
z17 y z18. El visor elige el archivo con la misma regla (site/pmtiles-red.js, FRANJAS_URBANA).

Se recorta con «pmtiles extract» (sin volver a codificar nada) y luego se comprueba tesela por
tesela que cada franja trae exactamente las teselas de sus filas, byte por byte iguales a las
del archivo original, y que la unión de las franjas es el original completo.

Por defecto lee salida/orto-urbana-bogota.pmtiles y escribe salida/orto-urbana-bogota-N.pmtiles
(N de 1, el norte, a 8, el sur). Misma licencia que la fuente (CC BY 4.0, SDP vía IDECA).
"""
import gzip
import math
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.normpath(os.path.join(AQUI, "..", "salida"))
NOMBRE = "orto-urbana-bogota"
# Primera fila z16 de cada franja y, al final, la fila siguiente a la última. Elegidas para que
# ninguna pase de 60 MB (la más grande queda en unos 58 MB). Igual en site/pmtiles-red.js.
FRANJAS = [31886, 31901, 31908, 31914, 31920, 31925, 31930, 31938, 31951]
TOPE = 60 * 1000 * 1000
EPS = 1e-6  # grados: la caja va un poco adentro de los bordes para no tocar la fila vecina


def lat_fila(y, z=16):
    """Latitud del borde norte de la fila y de teselas en zoom z (Web Mercator)."""
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))


# --- Lector mínimo de PMTiles v3 (solo para comprobar) ---

def _varints(b):
    p = 0

    def leer():
        nonlocal p
        v, m = 0, 1
        while True:
            c = b[p]
            p += 1
            v += (c & 0x7F) * m
            m *= 128
            if not c & 0x80:
                return v
    return leer


def _directorio(b):
    v = _varints(b)
    n = v()
    ids, runs, lens, offs = [], [], [], []
    i = 0
    for _ in range(n):
        i += v()
        ids.append(i)
    runs = [v() for _ in range(n)]
    lens = [v() for _ in range(n)]
    for k in range(n):
        o = v()
        offs.append(offs[k - 1] + lens[k - 1] if o == 0 and k > 0 else o - 1)
    return list(zip(ids, runs, lens, offs))


def _zxy(tid):
    acc, z = 0, 0
    while tid >= acc + 4 ** z:
        acc += 4 ** z
        z += 1
    d, n, x, y, s = tid - acc, 2 ** z, 0, 0, 1
    while s < n:
        rx = 1 & (d // 2)
        ry = 1 & (d ^ rx)
        if ry == 0:
            if rx == 1:
                x, y = s - 1 - x, s - 1 - y
            x, y = y, x
        x += s * rx
        y += s * ry
        d //= 4
        s *= 2
    return z, x, y


def teselas(ruta):
    """Devuelve {(z, x, y): bytes} con todas las teselas del archivo."""
    with open(ruta, "rb") as f:
        datos = f.read()
    cab = datos[:127]
    if cab[:7] != b"PMTiles" or cab[7] != 3:
        raise SystemExit(f"{ruta}: no es PMTiles v3")
    u = lambda o: int.from_bytes(cab[o:o + 8], "little")
    raiz_off, raiz_len, hoja_off, dato_off = u(8), u(16), u(40), u(56)
    comp = cab[97]
    des = (lambda b: gzip.decompress(b)) if comp == 2 else (lambda b: b)
    out = {}

    def recorrer(dir_):
        for tid, run, ln, off in dir_:
            if run == 0:
                recorrer(_directorio(des(datos[hoja_off + off:hoja_off + off + ln])))
            else:
                t = datos[dato_off + off:dato_off + off + ln]
                for k in range(run):
                    out[_zxy(tid + k)] = t
    recorrer(_directorio(des(datos[raiz_off:raiz_off + raiz_len])))
    return out


def main():
    entrada = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SALIDA, NOMBRE + ".pmtiles")
    destino = sys.argv[2] if len(sys.argv) > 2 else SALIDA
    os.makedirs(destino, exist_ok=True)
    original = teselas(entrada)
    filas = {y >> (z - 16) for (z, _, y) in original}
    if min(filas) < FRANJAS[0] or max(filas) >= FRANJAS[-1]:
        raise SystemExit(f"hay filas z16 fuera de las franjas ({min(filas)} a {max(filas)})")
    vistas = {}
    for i in range(len(FRANJAS) - 1):
        a, b = FRANJAS[i], FRANJAS[i + 1]
        caja = f"-74.40,{lat_fila(b) + EPS:.7f},-73.90,{lat_fila(a) - EPS:.7f}"
        sal = os.path.join(destino, f"{NOMBRE}-{i + 1}.pmtiles")
        subprocess.run(["pmtiles", "extract", entrada, sal, "--bbox=" + caja, "--quiet"], check=True)
        parte = teselas(sal)
        esperado = {k for k in original if a <= (k[2] >> (k[0] - 16)) < b}
        if set(parte) != esperado:
            raise SystemExit(f"{sal}: trae {len(parte)} teselas, se esperaban {len(esperado)}")
        distintas = [k for k, t in parte.items() if t != original[k]]
        if distintas:
            raise SystemExit(f"{sal}: {len(distintas)} teselas no son iguales byte por byte")
        tam = os.path.getsize(sal)
        if tam > TOPE:
            raise SystemExit(f"{sal}: pesa {tam} bytes, más que el tope de {TOPE}")
        for k in parte:
            if k in vistas:
                raise SystemExit(f"tesela {k} en dos franjas")
            vistas[k] = i + 1
        print(f"{os.path.basename(sal)}: filas {a} a {b - 1}, {len(parte)} teselas, {tam} bytes, iguales al original")
    if set(vistas) != set(original):
        raise SystemExit(f"faltan {len(set(original) - set(vistas))} teselas en las franjas")
    print(f"ok: {len(original)} teselas en {len(FRANJAS) - 1} franjas, cada una en un solo archivo")


if __name__ == "__main__":
    main()
