"""Baja una sola vez las teselas de la ortofoto 2025 de IDECA (CC BY 4.0) para servirlas desde aquí.

El visor nunca le pide nada a los servidores del Distrito: este script corre en local,
guarda cada tesela tal como llega y orto.sh arma el PMTiles con ellas.

  salida/orto-crudo/<servicio>/<z>/<x>/<y>.jpg   tesela llena (JPEG)
  salida/orto-crudo/<servicio>/<z>/<x>/<y>.png   tesela de borde (PNG con transparencia)
  salida/orto-crudo/<servicio>/<z>/<x>/<y>.vacia fuera de la cobertura, no va al PMTiles

Pide format=jpgpng: el servidor manda JPEG cuando toda la tesela tiene imagen y PNG con
alfa cuando parte queda fuera. Las teselas del todo transparentes, o un JPEG blanco
parejo, se marcan .vacia. Lo que ya está en disco no se vuelve a pedir: si se cae, se
corre otra vez y sigue donde iba.

Cortesía con el servidor: 6 pedidos a la vez como máximo, reintentos con espera creciente
y un User-Agent sin datos personales.

Uso (desde mapa-base/, con el .venv de terreno, que trae Pillow):
  terreno/.venv/bin/python -I scripts/orto_bajar.py --servicio orthourbana2025funcion \
      --zoom 16-18 [--caja LON,LAT,RADIO_KM --zoom-caja 19] [--px 512] [--nodata 255] [--lista ARCHIVO]
"""
import argparse
import io
import math
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
CRUDO = os.path.join(AQUI, "..", "salida", "orto-crudo")
URL = ("https://serviciosgis.catastrobogota.gov.co/image/rest/services/imagenesfunciones/"
       "{servicio}/ImageServer/exportImage?bbox={bbox}&bboxSR=3857&imageSR=3857"
       "&size={px},{px}&format=jpgpng&compressionQuality=85{nodata}&f=image")
UA = "gemelo-bogota-teselas/1.0 (descarga unica, sitio estatico)"
R = 20037508.342789244
CONCURRENCIA = 6
INTENTOS = 6


def tesela(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def caja_3857(z, x, y):
    s = 2 * R / 2 ** z
    return f"{-R + x * s:.3f},{R - (y + 1) * s:.3f},{-R + (x + 1) * s:.3f},{R - y * s:.3f}"


def teselas_en(oeste, sur, este, norte, z):
    x0, y0 = tesela(oeste, norte, z)
    x1, y1 = tesela(este, sur, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield z, x, y


def extension(servicio):
    import json
    u = (f"https://serviciosgis.catastrobogota.gov.co/image/rest/services/imagenesfunciones/"
         f"{servicio}/ImageServer?f=json")
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60) as r:
        e = json.load(r)["extent"]
    assert e["spatialReference"]["wkid"] == 4326, e
    return e["xmin"], e["ymin"], e["xmax"], e["ymax"]


PX = 256      # lado de la tesela; con --px 512 se guarda en <servicio>@512/
NODATA = ""   # con --nodata 255: «&noData=255», el borde llega transparente y no blanco


def carpeta(servicio):
    return servicio if PX == 256 else f"{servicio}@{PX}"


def ruta(servicio, z, x, y, ext):
    return os.path.join(CRUDO, carpeta(servicio), str(z), str(x), f"{y}.{ext}")


def hecha(servicio, z, x, y):
    return any(os.path.exists(ruta(servicio, z, x, y, e)) for e in ("jpg", "png", "vacia"))


def clasificar(datos):
    """Devuelve 'jpg', 'png' o 'vacia' según el contenido."""
    im = Image.open(io.BytesIO(datos))
    im.load()
    if im.format == "PNG":
        if im.mode != "RGBA":
            im = im.convert("RGBA")
        a = im.getchannel("A")
        if a.getextrema()[1] == 0:
            return "vacia"
        return "png"
    if im.format == "JPEG":
        # Respaldo: el servicio con format=jpg rellena fuera de cobertura con blanco opaco.
        g = im.convert("L")
        lo, _ = g.getextrema()
        if lo >= 245:
            return "vacia"
        return "jpg"
    raise ValueError(f"formato inesperado {im.format}")


def escribir(destino, datos):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    tmp = destino + ".tmp"
    with open(tmp, "wb") as f:
        f.write(datos)
    os.replace(tmp, destino)


def bajar(servicio, z, x, y):
    u = URL.format(servicio=servicio, bbox=caja_3857(z, x, y), px=PX, nodata=NODATA)
    for intento in range(INTENTOS):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60) as r:
                tipo = r.headers.get("Content-Type", "")
                datos = r.read()
            if not tipo.startswith("image/"):
                raise ValueError(f"respuesta no es imagen ({tipo}): {datos[:200]!r}")
            clase = clasificar(datos)
            escribir(ruta(servicio, z, x, y, clase), b"" if clase == "vacia" else datos)
            return clase
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            if intento == INTENTOS - 1:
                raise RuntimeError(f"{servicio} {z}/{x}/{y}: {e}") from e
            time.sleep(min(120, 2 ** (intento + 1)) + random.random())


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--servicio", required=True)
    p.add_argument("--zoom", help="ej. 14-18")
    p.add_argument("--caja", help="LON,LAT,RADIO_KM: zona central para --zoom-caja")
    p.add_argument("--zoom-caja", type=int)
    p.add_argument("--px", type=int, default=256, choices=(256, 512))
    p.add_argument("--nodata", type=int, help="valor NoData del servicio (cerros y rural: 255)")
    p.add_argument("--lista", help="archivo con z/x/y por línea; reemplaza la extensión")
    a = p.parse_args()
    global PX, NODATA
    PX = a.px
    NODATA = f"&noData={a.nodata}" if a.nodata is not None else ""
    assert "2017" not in a.servicio and "2014" not in a.servicio, "Ortho2017 y Ortho2014 no se usan"

    if a.lista:
        todas = [tuple(int(v) for v in l.strip().split("/")) for l in open(a.lista) if l.strip()]
    else:
        oeste, sur, este, norte = extension(a.servicio)
        z0, z1 = (int(v) for v in a.zoom.split("-"))
        todas = [t for z in range(z0, z1 + 1) for t in teselas_en(oeste, sur, este, norte, z)]
        if a.caja and a.zoom_caja:
            lon, lat, km = (float(v) for v in a.caja.split(","))
            dlat = km / 111.32
            dlon = km / (111.32 * math.cos(math.radians(lat)))
            o, s_, e, n = max(oeste, lon - dlon), max(sur, lat - dlat), min(este, lon + dlon), min(norte, lat + dlat)
            todas += list(teselas_en(o, s_, e, n, a.zoom_caja))

    pendientes = [t for t in todas if not hecha(a.servicio, *t)]
    total, faltan = len(todas), len(pendientes)
    print(f"{a.servicio}: {total} teselas, {total - faltan} ya en disco, {faltan} por bajar", flush=True)
    cuenta = {"jpg": 0, "png": 0, "vacia": 0, "error": 0}
    candado = threading.Lock()
    t0 = time.time()

    def una(t):
        try:
            c = bajar(a.servicio, *t)
        except Exception as e:  # se anota y se sigue; la próxima corrida la vuelve a pedir
            print(f"ERROR {e}", file=sys.stderr, flush=True)
            c = "error"
        with candado:
            cuenta[c] += 1
            n = sum(cuenta.values())
            if n % 500 == 0 or n == faltan:
                v = n / max(1e-9, time.time() - t0)
                print(f"{n}/{faltan} {cuenta} {v:.1f}/s faltan ~{(faltan - n) / max(v, 1e-9) / 60:.0f} min", flush=True)

    with ThreadPoolExecutor(CONCURRENCIA) as ex:
        list(ex.map(una, pendientes))
    print(f"listo {cuenta} en {(time.time() - t0) / 60:.1f} min", flush=True)
    sys.exit(1 if cuenta["error"] else 0)


if __name__ == "__main__":
    main()
