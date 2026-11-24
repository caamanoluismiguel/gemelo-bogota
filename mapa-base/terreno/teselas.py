"""Paso 3: teselas raster-dem Terrarium del mosaico, en WebP sin pérdida, dentro de un PMTiles.

Uso: .venv/bin/python -I teselas.py
Lee salida/terreno/mosaico.npy (paso 2) y deja:
  salida/terreno-bogota.pmtiles        lo que va al visor (zoom 8 a 12, 256 px)
  salida/terreno/teselas.json          tamaños, sha256 y resultado de las pruebas del paso 3
  salida/terreno/sombreado-sabana.png  relieve sombreado de prueba (izquierda sin redondeo, derecha a 1 m)
  salida/terreno/sombreado-sabana-025.png  el mismo con redondeo de 0,25 m, para comparar

Codificación Terrarium: altura = R*256 + G + B/256 - 32768. Con redondeo a 1 m, B = 0.
Recorte: solo las teselas que tocan la caja del visor; sus píxeles fuera de la caja toman el valor
del borde de la caja (sin dato inventado, y comprime mucho mejor). También se mide la versión sin
recorte para saber cuánto ahorra.

Pruebas (sombras-DEBATE §3, paso 3): total <= 1,5 MB y ninguna tesela > 150 KB.
"""
import io
import json
import math
import os
import sqlite3
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comun as C  # noqa: E402

ZOOMS = range(8, 13)
T = 256
LIMITE_TOTAL = 1_500_000
LIMITE_TESELA = 150_000
PMTILES = os.path.join(C.MAPA_BASE, "salida", "terreno-bogota.pmtiles")


def lonlat_de_pixel(z, x, y):
    """Centros de los 256x256 píxeles de la tesela (z, x, y) en Web Mercator."""
    n = 2 ** z
    px = (x + (np.arange(T) + 0.5) / T) / n
    py = (y + (np.arange(T) + 0.5) / T) / n
    lon = px * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py))))
    return lon, lat


def suavizado_para(z, base):
    """Prefiltro antialias: la rejilla es de unos 31 m; a zoom bajo un píxel cubre varias celdas."""
    m_px = 40075016.686 * math.cos(math.radians(4.65)) / (2 ** z * T)
    sigma = max(0.0, 0.5 * (m_px / 30.8) - 0.3)
    if sigma < 0.3:
        return base, m_px
    return ndimage.gaussian_filter(base, sigma, mode="nearest"), m_px


def alturas_tesela(dem, z, x, y, recortar):
    lon, lat = lonlat_de_pixel(z, x, y)
    if recortar:
        lon = np.clip(lon, C.CAJA["oeste"], C.CAJA["este"])
        lat = np.clip(lat, C.CAJA["sur"], C.CAJA["norte"])
    cols, fils = np.meshgrid(C.col_de_lon(lon), C.fil_de_lat(lat))
    return C.bilineal(dem, cols, fils)


def terrarium(h, paso):
    h = np.round(h / paso) * paso
    v = h + 32768.0
    r = np.floor(v / 256.0)
    g = np.floor(v - r * 256.0)
    b = np.round((v - r * 256.0 - g) * 256.0)
    return np.dstack([r, g, b]).astype(np.uint8)


def webp(rgb):
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, "WEBP", lossless=True, quality=100, method=6, exact=True)
    return buf.getvalue()


def decodificar(datos):
    a = np.array(Image.open(io.BytesIO(datos)).convert("RGB"), dtype=np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def teselas_de_caja(z):
    x0, y0 = C.tesela_de(C.CAJA["oeste"], C.CAJA["norte"], z)
    x1, y1 = C.tesela_de(C.CAJA["este"], C.CAJA["sur"], z)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def sombreado(h, m_px, az=315.0, alt=35.0, exag=4.0):
    gy, gx = np.gradient(h * exag, m_px)
    pend = np.arctan(np.hypot(gx, gy))
    asp = np.arctan2(-gx, gy)
    a, e = math.radians(az), math.radians(alt)
    s = np.sin(e) * np.cos(pend) + np.cos(e) * np.sin(pend) * np.cos(a - asp)
    return (np.clip(s, 0, 1) * 255).astype(np.uint8)


def main():
    dem = np.load(os.path.join(C.SALIDA, "mosaico.npy")).astype(np.float64)
    res = {"zooms": [min(ZOOMS), max(ZOOMS)], "tamano_px": T, "codificacion": "terrarium",
           "formato": "webp sin pérdida (method 6)", "redondeo_m": 1.0, "caja": C.CAJA}
    filas, por_zoom, sin_recorte = [], {}, 0
    max_err = 0.0
    for z in ZOOMS:
        base, m_px = suavizado_para(z, dem)
        tz = teselas_de_caja(z)
        bz = 0
        for x, y in tz:
            h = alturas_tesela(base, z, x, y, True)
            d = webp(terrarium(h, 1.0))
            max_err = max(max_err, float(np.abs(decodificar(d) - np.round(h)).max()))
            filas.append((z, x, y, d))
            bz += len(d)
            sin_recorte += len(webp(terrarium(alturas_tesela(base, z, x, y, False), 1.0)))
        por_zoom[str(z)] = {"teselas": len(tz), "bytes": bz, "m_por_pixel": round(m_px, 1)}
        print(z, len(tz), bz)
        del base
    tam = [len(f[3]) for f in filas]
    total = sum(tam)
    res["por_zoom"] = por_zoom
    res["teselas"] = len(filas)
    res["bytes_teselas"] = total
    res["tesela_max_bytes"] = max(tam)
    res["bytes_sin_recorte_mismas_teselas"] = sin_recorte
    res["error_decodificado_max_m"] = max_err

    # MBTiles intermedio (filas TMS) y conversión a PMTiles con la herramienta oficial
    mb = os.path.join(C.SALIDA, "terreno-bogota.mbtiles")
    if os.path.exists(mb):
        os.remove(mb)          # intermedio propio, se regenera siempre
    con = sqlite3.connect(mb)
    con.executescript("CREATE TABLE metadata (name text, value text);"
                      "CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);"
                      "CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row);")
    meta = {"name": "terreno-bogota", "format": "webp", "type": "baselayer", "version": "1",
            "minzoom": str(min(ZOOMS)), "maxzoom": str(max(ZOOMS)),
            "bounds": f'{C.CAJA["oeste"]},{C.CAJA["sur"]},{C.CAJA["este"]},{C.CAJA["norte"]}',
            "center": "-74.1,4.65,10", "encoding": "terrarium",
            "description": "Relieve de Bogotá: MDT 2025 (IDECA/SDP) dentro del Distrito y Copernicus GLO-30 filtrado fuera. Terrarium redondeado a 1 m.",
            "attribution": ("MDT 2025 © Secretaría Distrital de Planeación y UAECD, publicado por IDECA (CC BY 4.0); "
                            "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH "
                            "2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved")}
    con.executemany("INSERT INTO metadata VALUES (?, ?)", list(meta.items()))
    con.executemany("INSERT INTO tiles VALUES (?, ?, ?, ?)",
                    [(z, x, (2 ** z - 1 - y), sqlite3.Binary(d)) for z, x, y, d in filas])
    con.commit()
    con.close()
    if os.path.exists(PMTILES):
        os.replace(PMTILES, PMTILES + ".anterior")
    subprocess.run(["pmtiles", "convert", mb, PMTILES], check=True)
    res["pmtiles"] = {"ruta": os.path.relpath(PMTILES, C.MAPA_BASE), "bytes": os.path.getsize(PMTILES),
                      "sha256": C.sha256(PMTILES)}
    res["prueba_total"] = {"limite_bytes": LIMITE_TOTAL, "medido_bytes_pmtiles": res["pmtiles"]["bytes"],
                           "pasa": res["pmtiles"]["bytes"] <= LIMITE_TOTAL}
    res["prueba_tesela"] = {"limite_bytes": LIMITE_TESELA, "medido_max_bytes": max(tam),
                            "pasa": max(tam) <= LIMITE_TESELA}

    # Relieve sombreado de prueba en la sabana (Kennedy y Engativá) a zoom 12: sin redondeo, 1 m y 0,25 m
    z = 12
    oeste, este, sur, norte = -74.19, -74.07, 4.60, 4.72
    x0, y0 = C.tesela_de(oeste, norte, z)
    x1, y1 = C.tesela_de(este, sur, z)
    capas = {}
    for paso in (None, 1.0, 0.25):
        filas_img = []
        for y in range(y0, y1 + 1):
            fila = []
            for x in range(x0, x1 + 1):
                h = alturas_tesela(dem, z, x, y, False)
                fila.append(h if paso is None else decodificar(webp(terrarium(h, paso))))
            filas_img.append(np.hstack(fila))
        capas[paso] = np.vstack(filas_img)
    m_px = 40075016.686 * math.cos(math.radians(4.66)) / (2 ** z * T)
    sh = {k: sombreado(v, m_px) for k, v in capas.items()}
    sep = np.full((sh[None].shape[0], 8), 255, np.uint8)
    Image.fromarray(np.hstack([sh[None], sep, sh[1.0]])).save(os.path.join(C.SALIDA, "sombreado-sabana.png"))
    Image.fromarray(np.hstack([sh[None], sep, sh[0.25]])).save(os.path.join(C.SALIDA, "sombreado-sabana-025.png"))
    # medida de escalones: fracción de píxeles vecinos con salto exacto de 1 m en zonas muy planas
    llano = ndimage.uniform_filter(np.abs(np.gradient(capas[None], axis=1)), 9) < 0.15
    for paso in (1.0, 0.25):
        d = np.abs(np.diff(capas[paso], axis=1))[llano[:, :-1]]
        res.setdefault("escalones_sabana", {})[str(paso)] = {
            "pixeles_llanos": int(d.size), "fraccion_con_salto": round(float((d > 0).mean()), 4),
            "error_rms_m": round(float(np.sqrt(np.mean((capas[paso] - capas[None]) ** 2))), 3)}
    # costo del redondeo fino: bytes si todo se redondeara a 0,25 m
    b025 = 0
    for z in ZOOMS:
        base, _ = suavizado_para(z, dem)
        b025 += sum(len(webp(terrarium(alturas_tesela(base, z, x, y, True), 0.25))) for x, y in teselas_de_caja(z))
        del base
    res["bytes_teselas_si_redondeo_025m"] = b025

    with open(os.path.join(C.SALIDA, "teselas.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
