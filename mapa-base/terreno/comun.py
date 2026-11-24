"""Constantes y utilidades compartidas del terreno de Bogotwin.

La rejilla del mosaico es la de Copernicus GLO-30: un segundo de arco,
centros de píxel en lon = -75 + i/3600 y lat = 5 - j/3600 (registro por punto,
así lo declaran las teselas COG). Todo lo demás se remuestrea a esta rejilla.
"""
import hashlib
import math
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
MAPA_BASE = os.path.dirname(AQUI)
SALIDA = os.environ.get("TERRENO_SALIDA", os.path.join(MAPA_BASE, "salida", "terreno"))
CRUDOS = os.environ.get("TERRENO_CRUDOS", os.path.join(MAPA_BASE, "salida", "crudos", "terreno"))
DC_GEOJSON = os.path.join(MAPA_BASE, "salida", "trabajo", "bogota-dc.geojson")

P = 1.0 / 3600.0                    # paso de la rejilla (grados)
# Extensión del mosaico (centros de píxel). Cubre la caja del visor y 30 a 40 km
# alrededor para los rayos del horizonte (60° a 120° y 240° a 300°).
LON_MIN, LON_MAX = -74.65, -73.0 - P   # columnas de W075 (desde 1260) y W074 completa
LAT_MAX, LAT_MIN = 5.0, 4.0 + P        # filas de la fila de teselas N04
NCOL = int(round((LON_MAX - LON_MIN) / P)) + 1
NFIL = int(round((LAT_MAX - LAT_MIN) / P)) + 1

# Caja del visor (decisión del panel, sombras-DEBATE §2.5)
CAJA = dict(oeste=-74.27, este=-73.93, sur=4.43, norte=4.87)

MLAT = 111320.0                     # metros por grado de latitud (aprox. esférica)


def col_de_lon(lon):
    return (lon - LON_MIN) / P


def fil_de_lat(lat):
    return (LAT_MAX - lat) / P


def lon_de_col(c):
    return LON_MIN + c * P


def lat_de_fil(f):
    return LAT_MAX - f * P


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def tesela_de(lon, lat, z):
    x = (lon + 180.0) / 360.0 * 2 ** z
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** z
    return int(x), int(y)


def bilineal(dem, cols, fils):
    """Muestreo bilineal en índices fraccionarios (centros de píxel en enteros)."""
    import numpy as np
    c0 = np.clip(np.floor(cols).astype(np.int64), 0, dem.shape[1] - 2)
    f0 = np.clip(np.floor(fils).astype(np.int64), 0, dem.shape[0] - 2)
    fc = np.clip(cols - c0, 0.0, 1.0)
    ff = np.clip(fils - f0, 0.0, 1.0)
    return (dem[f0, c0] * (1 - fc) * (1 - ff) + dem[f0, c0 + 1] * fc * (1 - ff)
            + dem[f0 + 1, c0] * (1 - fc) * ff + dem[f0 + 1, c0 + 1] * fc * ff)
