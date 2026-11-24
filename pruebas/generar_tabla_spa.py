#!/usr/bin/env python3
"""Arma la tabla de referencia del sol con el algoritmo SPA de NREL (pvlib).

No lo corre el sitio ni las pruebas: solo hace falta para regenerar
pruebas/datos/spa-bogota.json. Necesita pvlib (pip install pvlib) en un
entorno aparte.

Uso:
    python3 pruebas/generar_tabla_spa.py

Qué guarda (semilla fija, así el archivo sale igual cada vez):
  * 200 momentos al azar entre 2001 y 2035, de día (altura SPA > 0°), en
    puntos al azar dentro de la caja de Bogotá. Presión 750 hPa y 14 °C,
    lo mismo que usa site/sol.js por defecto.
  * Salida, mediodía y puesta en el centro de Bogotá para 60 días al azar
    (convención −0,8333°, la de sun_rise_set_transit_spa).
  * Días de sol casi en el cenit en 2026 y 2027 para tres latitudes.
"""
import json
import pathlib

import numpy as np
import pandas as pd
import pvlib

SEMILLA = 20261123
CAJA = {"lat": (4.45, 4.85), "lon": (-74.25, -73.98)}
CENTRO = (4.6097, -74.0817)
PRESION_PA, TEMP_C, ALTITUD = 75000, 14, 2600

rng = np.random.default_rng(SEMILLA)
ini = pd.Timestamp("2001-01-01T00:00Z").value // 10**6
fin = pd.Timestamp("2035-12-31T00:00Z").value // 10**6

momentos = []
while len(momentos) < 200:
    ms = int(rng.integers(ini, fin))
    lat = float(rng.uniform(*CAJA["lat"]))
    lon = float(rng.uniform(*CAJA["lon"]))
    t = pd.DatetimeIndex([pd.Timestamp(ms, unit="ms", tz="UTC")])
    s = pvlib.solarposition.spa_python(t, lat, lon, altitude=ALTITUD, pressure=PRESION_PA, temperature=TEMP_C)
    alt = float(s["apparent_elevation"].iloc[0])
    if alt <= 0:
        continue
    momentos.append({"ms": ms, "lat": round(lat, 5), "lon": round(lon, 5),
                     "altura": round(alt, 5), "altura_geometrica": round(float(s["elevation"].iloc[0]), 5),
                     "azimut": round(float(s["azimuth"].iloc[0]), 5)})

dias = []
base = pd.Timestamp("2026-01-01")
offs = sorted(rng.choice(np.arange(-3650, 3650), size=60, replace=False))
for o in offs:
    d = base + pd.Timedelta(days=int(o))
    idx = pd.DatetimeIndex([pd.Timestamp(d.date(), tz="Etc/GMT+5")])
    r = pvlib.solarposition.sun_rise_set_transit_spa(idx, CENTRO[0], CENTRO[1])
    fila = {"fecha": d.strftime("%Y-%m-%d")}
    for k, nombre in (("sunrise", "salida"), ("transit", "mediodia"), ("sunset", "puesta")):
        fila[nombre] = int(r[k].iloc[0].tz_convert("UTC").value // 10**6)
    dias.append(fila)

cenit = []
for lat in (4.50, 4.6097, 4.80):
    for y in (2026, 2027):
        d = pd.date_range(f"{y}-01-01", f"{y}-12-31", freq="D", tz="Etc/GMT+5")
        tr = pvlib.solarposition.sun_rise_set_transit_spa(d, lat, CENTRO[1])["transit"]
        st = pvlib.solarposition.spa_python(pd.DatetimeIndex(tr), lat, CENTRO[1])
        az = st["azimuth"].values
        norte = np.cos(np.radians(az)) > 0
        el = st["elevation"].values
        for i in range(1, len(d)):
            if norte[i] != norte[i - 1]:
                j = i if el[i] >= el[i - 1] else i - 1
                cenit.append({"lat": lat, "anio": y, "fecha": d[j].strftime("%Y-%m-%d"), "altura": round(float(el[j]), 3)})

salida = {
    "generado_con": f"pvlib {pvlib.__version__}, spa_python y sun_rise_set_transit_spa (NREL SPA)",
    "semilla": SEMILLA,
    "atmosfera": {"presion_hpa": PRESION_PA / 100, "temperatura_c": TEMP_C, "altitud_m": ALTITUD},
    "momentos": momentos,
    "dias": dias,
    "cenit": cenit,
}
ruta = pathlib.Path(__file__).with_name("datos") / "spa-bogota.json"
ruta.write_text(json.dumps(salida, ensure_ascii=False, indent=0))
print(f"escrito {ruta}: {len(momentos)} momentos, {len(dias)} días, {len(cenit)} días casi cenitales")
