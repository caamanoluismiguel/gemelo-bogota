"""Paso 5: rejilla de horizonte (gruesa de 500 m + bloques de 100 m, 26 direcciones) sobre el mosaico del paso 2.

Uso: .venv/bin/python -I horizonte.py
Lee salida/terreno/mosaico.npy y crudos de GLO-30 (solo para la calibración); deja en salida/terreno/:
  horizonte-bogota.hzn.gz   la rejilla para el navegador (formato abajo)
  horizonte.json            parámetros, pesos y resultado de la prueba contra los 16 puntos

Método (el mismo del panel, panel/sombras-scripts/horizonte.py, con el mosaico en lugar de GLO-30):
  ojo a 1,7 m sobre el suelo del nodo; rayos de 250 m a 40 km; curvatura con refracción k = 0,13;
  ángulo del horizonte = máximo de atan((z - h0) / d). Muestreo bilineal del mosaico; paso del rayo
  30 m hasta 3 km, 60 m hasta 10 km y 120 m hasta 40 km.
  El rayo empieza a 250 m (una celda): lo que hay dentro de la celda no se puede representar en una
  rejilla de 250 m y solo mete ruido que no comprime (medido: rayo desde 60 m pesa un 5 % más y no
  mejora la prueba). B ignoró 400 m porque GLO-30 trae edificios; el mosaico es suelo desnudo.
Extensión: la de la ciudad que usó DM para medir los 151 KB del panel (-74,23 a -74,00; 4,47 a 4,83).
  Medido: la caja completa del visor pesa 300 a 430 KB con gzip, el doble del presupuesto.

Rejilla fina (HZN2, 2026-11-23): la gruesa sola falla al pie de los cerros, donde el horizonte cambia
en pocos metros. Se calcula también una rejilla de 100 m (rayo desde 100 m) y se guarda solo en bloques de
1 km (10 x 10 nodos) que tocan la huella urbana del MDT, ordenados por el error de la gruesa en sus nodos
(máximo en las 26 direcciones de |fina - bilineal(gruesa)|). Entran los n mejores que caben en LIMITE_GZ.
Gruesa de 500 m: medido, a igual peso deja más bloques finos que la de 250 m y pasa los mismos puntos.

Formato HZN2 (little endian), pensado para leerse con DecompressionStream('gzip') y un DataView:
  bytes 0..3     "HZN2";  uint16 nrejillas (1 o 2: gruesa y después fina)
  por cada rejilla:
  uint16 ncol, uint16 nfil, uint16 ndir, uint16 bandera (bit 1: delta entre direcciones; bit 2: máscara)
  float64 lon0, lat0   centro del nodo (col 0, fila 0); fila 0 es la del norte
  float64 dlon, dlat   paso en grados (dlat positivo, las filas bajan hacia el sur)
  float32 escala, desplazamiento   ángulo_grados = v * escala + desplazamiento
  float32 azimut[ndir]             grados desde el norte, en el sentido del reloj
  si bandera bit 2: uint16 bloque, nbx, nby; uint8 mascara[nby][nbx] (1 = el bloque trae datos)
  uint8 datos[ndir][nfil][ncol]    si bandera bit 1: la primera dirección de cada abanico (60° y 240°)
                                   va tal cual y cada una de las demás guarda v[d] - v[d-1] (mod 256);
                                   fuera de los bloques con datos van ceros (gzip los aplasta)
Consulta: la fina si los 4 nodos vecinos caen en bloques con datos; si no, la gruesa (consultar()).
Valor v = round((ángulo + 2) * 2): pasos de 0,5° desde -2° hasta 125,5°. Medio grado es un minuto de
sol en Bogotá (el sol sube unos 0,25° por minuto al amanecer), así que el error de redondeo es de ±1 min.
Para un punto: bilineal entre los 4 nodos en cada azimut y lineal entre azimuts (fuera de los dos
abanicos 60° a 120° y 240° a 300° el sol está alto y el horizonte no importa).
"""
import gzip
import json
import math
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comun as C  # noqa: E402

PASO_M = float(os.environ.get("HZN_PASO_M", 500.0))   # rejilla gruesa (250 m en HZN1)
AZ = [float(a) for a in list(range(60, 121, 5)) + list(range(240, 301, 5))]   # 26 direcciones
OJO_M = 1.7
K_REFR = 0.13
R_TIERRA = 6371000.0
ESCALA, DESPL = 0.5, -2.0
DMIN_M = PASO_M
PASO_FINO_M = 100.0          # rejilla fina, solo en bloques del piedemonte y del Cerro de Suba
DMIN_FINO_M = 100.0
BLOQUE = 10                  # nodos finos por lado de bloque (1 km)
UMBRALES = [4.0, 3.0, 2.5, 2.0, 1.5, 1.25, 1.0, 0.75, 0.5]   # grados; se queda el menor que cabe en LIMITE_GZ
EXTENSION = dict(oeste=-74.23, este=-74.00, sur=4.47, norte=4.83)   # la de DM
PRESUPUESTO_APROBADO = 160_000   # el del panel (DM)
LIMITE_GZ = int(os.environ.get("HZN_LIMITE", 220_000))   # PROPUESTO en panel/terreno-arreglos.md, sin aprobar
N_BARRIDO = [25, 50, 75, 100, 150, 200]
TOL_MIN = 5.0
SEMI_DISCO = 0.267          # el sol llega con su borde superior (calibrado contra la tabla de B)
FECHAS = {"21 dic": 355, "20 mar": 79, "21 jun": 172}


def distancias():
    return np.concatenate([np.arange(60, 3000, 30.0), np.arange(3000, 10000, 60.0), np.arange(10000, 40001, 120.0)])


def horizonte(dem, lon, lat, az_list, d=None, dmin=0.0, muestreo="bilineal"):
    """Ángulo del horizonte (grados) para arreglos de puntos y una lista de azimuts."""
    d = distancias() if d is None else d
    d = d[d >= dmin]
    lon = np.asarray(lon, float)
    lat = np.asarray(lat, float)

    def z_en(lo, la):
        if muestreo == "bilineal":
            return C.bilineal(dem, C.col_de_lon(lo), C.fil_de_lat(la))
        c = np.clip(np.round(C.col_de_lon(lo)).astype(int), 0, C.NCOL - 1)
        r = np.clip(np.round(C.fil_de_lat(la)).astype(int), 0, C.NFIL - 1)
        return dem[r, c]

    h0 = z_en(lon, lat) + OJO_M
    mlon = C.MLAT * np.cos(np.radians(lat))
    caida = d * d / (2 * R_TIERRA / (1 - K_REFR))
    out = np.empty((len(az_list),) + lon.shape, np.float32)
    for i, az in enumerate(az_list):
        s, c = math.sin(math.radians(az)), math.cos(math.radians(az))
        mejor = np.full(lon.shape, -90.0)
        for dk, ck in zip(d, caida):
            z = z_en(lon + dk * s / mlon, lat + dk * c / C.MLAT) - ck
            np.maximum(mejor, np.degrees(np.arctan((z - h0) / dk)), out=mejor)
        out[i] = mejor
    return out


def sol(lat, lon, doy, hora_local):
    """Posición del sol (NOAA simplificado, igual que el panel). Hora local UTC-5."""
    g = 2 * math.pi / 365 * (doy - 1 + (hora_local - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    dec = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
           + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = hora_local * 60 + eqt + 4 * lon + 300
    ha = math.radians(tst / 4 - 180)
    la = math.radians(lat)
    cz = math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(ha)
    el = 90 - math.degrees(math.acos(max(-1, min(1, cz))))
    az = math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(la) - math.tan(dec) * math.cos(la))) + 180
    return el, az % 360


def llegada(azs, hz, lon, lat, doy):
    """Minuto del día (hora local) en que el borde superior del sol pasa el horizonte, de mañana."""
    azs = np.asarray(azs)
    for s in range(4 * 3600, 11 * 3600, 15):
        el, az = sol(lat, lon, doy, s / 3600)
        if el + SEMI_DISCO > np.interp(az, azs, hz):
            return s / 60.0
    return None


def hm(t):
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def a_texto(m):
    return f"{int(m // 60)}:{int(round(m % 60)):02d}" if m is not None else None


def rejilla(dem, paso_m, dmin_m, filas_por_bloque):
    caja = EXTENSION
    dlat = paso_m / C.MLAT
    dlon = paso_m / (C.MLAT * math.cos(math.radians((caja["norte"] + caja["sur"]) / 2)))
    lons = np.arange(caja["oeste"], caja["este"] + 1e-9, dlon)
    lats = np.arange(caja["norte"], caja["sur"] - 1e-9, -dlat)
    LO, LA = np.meshgrid(lons, lats)
    print("rejilla", paso_m, "m:", LO.shape, "nodos", LO.size, "direcciones", len(AZ))
    H = np.empty((len(AZ),) + LO.shape, np.float32)
    for f0 in range(0, LO.shape[0], filas_por_bloque):     # por bloques de filas, para no pasar de ~1 GB
        H[:, f0:f0 + filas_por_bloque] = horizonte(dem, LO[f0:f0 + filas_por_bloque], LA[f0:f0 + filas_por_bloque], AZ, dmin=dmin_m)
    return dict(lons=lons, lats=lats, dlon=dlon, dlat=dlat, H=H)


def cuantizar(H):
    return np.clip(np.round((H - DESPL) / ESCALA), 0, 255).astype(np.uint8)


def con_delta(q):
    datos = q.copy()
    for d in range(1, len(AZ)):            # entre direcciones vecinas de cada abanico (comprime mejor que por fila)
        if AZ[d] - AZ[d - 1] == 5.0:
            datos[d] = (q[d].astype(np.int16) - q[d - 1].astype(np.int16)).astype(np.uint8)
    return datos


def bloque_rejilla(r, q, mascara=None):
    """Una rejilla del formato HZN2 (cabecera + máscara opcional + datos con delta)."""
    nd, nf, nc = q.shape
    band = 2 | (4 if mascara is not None else 0)
    b = struct.pack("<4H", nc, nf, nd, band) + struct.pack("<4d", r["lons"][0], r["lats"][0], r["dlon"], r["dlat"])
    b += struct.pack("<2f", ESCALA, DESPL) + struct.pack(f"<{nd}f", *AZ)
    if mascara is not None:
        b += struct.pack("<3H", BLOQUE, mascara.shape[1], mascara.shape[0]) + mascara.astype(np.uint8).tobytes()
    return b + con_delta(q).tobytes()


def leer_hzn2(raw):
    """Decodifica el archivo como lo haría el navegador. Devuelve una lista de rejillas."""
    assert raw[:4] == b"HZN2"
    (n,) = struct.unpack_from("<H", raw, 4)
    off, out = 6, []
    for _ in range(n):
        nc, nf, nd, band = struct.unpack_from("<4H", raw, off); off += 8
        lon0, lat0, dlon, dlat = struct.unpack_from("<4d", raw, off); off += 32
        esc, des = struct.unpack_from("<2f", raw, off); off += 8
        az = struct.unpack_from(f"<{nd}f", raw, off); off += 4 * nd
        masc, blq = None, None
        if band & 4:
            blq, nbx, nby = struct.unpack_from("<3H", raw, off); off += 6
            masc = np.frombuffer(raw, np.uint8, nbx * nby, off).reshape(nby, nbx).astype(bool); off += nbx * nby
        v = np.frombuffer(raw, np.uint8, nd * nf * nc, off).reshape(nd, nf, nc).astype(np.int64).copy(); off += nd * nf * nc
        if band & 2:
            for d in range(1, nd):
                if az[d] - az[d - 1] == 5.0:
                    v[d] = (v[d] + v[d - 1]) % 256
        out.append(dict(lon0=lon0, lat0=lat0, dlon=dlon, dlat=dlat, H=v * esc + des, q=v.astype(np.uint8),
                        mascara=masc, bloque=blq, az=az))
    assert off == len(raw)
    return out


def consultar(rejillas, lon, lat):
    """Horizonte en un punto: la rejilla fina si sus 4 nodos caen en bloques con datos; si no, la gruesa."""
    for r in reversed(rejillas):              # la fina va al final
        cf = (lon - r["lon0"]) / r["dlon"]
        ff = (r["lat0"] - lat) / r["dlat"]
        nf, nc = r["H"].shape[1:]
        if not (0 <= cf <= nc - 1 and 0 <= ff <= nf - 1):
            continue
        if r["mascara"] is not None:
            c0, f0 = min(int(cf), nc - 2), min(int(ff), nf - 2)
            b = r["bloque"]
            if not all(r["mascara"][f // b, c // b] for f in (f0, f0 + 1) for c in (c0, c0 + 1)):
                continue
        return np.array([C.bilineal(r["H"][i], np.array([cf]), np.array([ff]))[0] for i in range(len(AZ))]), r
    raise ValueError("punto fuera de la rejilla")


def main():
    dem = np.load(os.path.join(C.SALIDA, "mosaico.npy"))
    gr = rejilla(dem, PASO_M, DMIN_M, 40)
    qg = cuantizar(gr["H"])
    fi = rejilla(dem, PASO_FINO_M, DMIN_FINO_M, 16)
    qf = cuantizar(fi["H"])
    recortados = int(((gr["H"] - DESPL) / ESCALA > 255.5).sum() + ((fi["H"] - DESPL) / ESCALA > 255.5).sum())

    # Error de la gruesa en cada nodo fino: máximo en las 26 direcciones de |fina - bilineal(gruesa)|
    Hg = qg * ESCALA + DESPL
    LOf, LAf = np.meshgrid(fi["lons"], fi["lats"])
    cf = (LOf - gr["lons"][0]) / gr["dlon"]
    ff = (gr["lats"][0] - LAf) / gr["dlat"]
    err = np.zeros(LOf.shape, np.float32)
    for d in range(len(AZ)):
        np.maximum(err, np.abs(qf[d] * ESCALA + DESPL - C.bilineal(Hg[d], cf, ff)), out=err)
    # Bloques candidatos: los que tocan la huella urbana del MDT (donde vive la gente)
    urb = np.load(os.path.join(C.SALIDA, "mascaras.npz"))["urbano"]
    cc = np.clip(np.round(C.col_de_lon(LOf)).astype(int), 0, C.NCOL - 1)
    rr = np.clip(np.round(C.fil_de_lat(LAf)).astype(int), 0, C.NFIL - 1)
    u = urb[rr, cc]
    nf, nc = LOf.shape
    nby, nbx = -(-nf // BLOQUE), -(-nc // BLOQUE)
    pad = lambda a, v: np.pad(a, ((0, nby * BLOQUE - nf), (0, nbx * BLOQUE - nc)), constant_values=v)
    err_b = pad(err, 0).reshape(nby, BLOQUE, nbx, BLOQUE).max(axis=(1, 3))
    urb_b = pad(u, False).reshape(nby, BLOQUE, nbx, BLOQUE).any(axis=(1, 3))

    def armar(umbral=None, n=None):
        if n is None:
            masc = urb_b & (err_b > umbral)
        else:                                   # los n bloques urbanos con más error
            orden = np.argsort(np.where(urb_b, err_b, -1).ravel())[::-1][:n]
            masc = np.zeros(urb_b.size, bool); masc[orden] = True; masc = masc.reshape(urb_b.shape)
        nodo = np.repeat(np.repeat(masc, BLOQUE, 0), BLOQUE, 1)[:nf, :nc]
        q = np.where(nodo[None], qf, 0).astype(np.uint8)
        crudo = b"HZN2" + struct.pack("<H", 2) + bloque_rejilla(gr, qg) + bloque_rejilla(fi, q, masc)
        return masc, crudo, gzip.compress(crudo, compresslevel=9, mtime=0)

    ref = json.load(open(os.path.join(C.AQUI, "puntos-referencia.json"), encoding="utf-8"))

    def puntos_ok(gz):
        rejs = leer_hzn2(gzip.decompress(gz))
        n_ok = 0
        for p in ref["puntos"]:
            hz, _ = consultar(rejs, p["lon"], p["lat"])
            n_ok += all(abs(llegada(AZ, hz, p["lon"], p["lat"], doy) - hm(p["b"][dn])) <= TOL_MIN for dn, doy in ref["fechas"].items())
        return int(n_ok)

    def fila_tabla(masc, gz, **k):
        return dict(k, bloques_finos=int(masc.sum()), km2_finos=round(float(masc.sum()) * (BLOQUE * PASO_FINO_M / 1000) ** 2, 1),
                    bytes_gzip=len(gz), puntos_que_pasan=puntos_ok(gz))

    solo_gruesa = gzip.compress(b"HZN2" + struct.pack("<H", 1) + bloque_rejilla(gr, qg), compresslevel=9, mtime=0)
    print("solo la gruesa:", len(solo_gruesa), "bytes")
    tabla, elegido = [], None
    for umbral in UMBRALES:
        masc, crudo, gz = armar(umbral=umbral)
        tabla.append(fila_tabla(masc, gz, umbral_grados=umbral))
        print(tabla[-1])
        if len(gz) <= LIMITE_GZ and elegido is None:
            elegido = (f"umbral {umbral}°", masc, crudo, gz)
    for n in N_BARRIDO:                         # cuánto cuesta cada punto de la prueba, sin elegir bloques a mano
        masc, crudo, gz = armar(n=n)
        tabla.append(fila_tabla(masc, gz, seleccion="mejores_n", umbral_grados=round(float(err_b[masc].min()), 2)))
        print(tabla[-1])
    if elegido is None:
        # ningún umbral cabe: los n bloques urbanos con más error que quepan en el presupuesto
        lo_n, hi_n = 0, int(urb_b.sum())
        while lo_n < hi_n:
            mid = (lo_n + hi_n + 1) // 2
            if len(armar(n=mid)[2]) <= LIMITE_GZ:
                lo_n = mid
            else:
                hi_n = mid - 1
        masc, crudo, gz = armar(n=lo_n)
        elegido = (f"los {lo_n} bloques urbanos con más error que caben en {LIMITE_GZ} bytes", masc, crudo, gz)
        tabla.append(fila_tabla(masc, gz, umbral_grados=round(float(err_b[masc].min()), 2) if lo_n else None, seleccion="mejores_n"))
        print(tabla[-1])
    umbral, masc, crudo, gz = elegido
    ruta = os.path.join(C.SALIDA, "horizonte-bogota.hzn.gz")
    with open(ruta, "wb") as f:
        f.write(gz)

    # comprobación de ida y vuelta: decodificar el archivo como lo haría el navegador
    rejs = leer_hzn2(gzip.decompress(open(ruta, "rb").read()))
    assert np.array_equal(rejs[0]["q"], qg)
    nodo = np.repeat(np.repeat(masc, BLOQUE, 0), BLOQUE, 1)[:nf, :nc]
    assert np.array_equal(rejs[1]["q"][:, nodo], qf[:, nodo])

    res = {"formato": "HZN2 (ver cabecera de horizonte.py)",
           "gruesa": {"paso_m": PASO_M, "nodos": [int(qg.shape[2]), int(qg.shape[1])], "rayo_desde_m": DMIN_M},
           "fina": {"paso_m": PASO_FINO_M, "nodos": [int(nc), int(nf)], "rayo_desde_m": DMIN_FINO_M, "bloque_nodos": BLOQUE,
                    "bloques_con_datos": int(masc.sum()), "bloques_candidatos_urbanos": int(urb_b.sum()),
                    "criterio_bloque": "toca la huella urbana del MDT y el error de la gruesa en algún nodo pasa el umbral",
                    "seleccion": umbral},
           "error_de_la_gruesa_en_nodos_finos_urbanos": {"p50_grados": round(float(np.percentile(err[u], 50)), 2),
                                                          "p95_grados": round(float(np.percentile(err[u], 95)), 2),
                                                          "p99_grados": round(float(np.percentile(err[u], 99)), 2),
                                                          "max_grados": round(float(err[u].max()), 2)},
           "tabla_umbral_peso": tabla,
           "direcciones": AZ, "ojo_m": OJO_M, "k_refraccion": K_REFR, "rayo_hasta_m": 40000, "extension": EXTENSION,
           "escala_grados": ESCALA, "valores_recortados_arriba": recortados,
           "bytes_crudos": len(crudo), "bytes_gzip_solo_gruesa": len(solo_gruesa),
           "archivo": {"ruta": os.path.relpath(ruta, C.MAPA_BASE), "bytes": os.path.getsize(ruta), "sha256": C.sha256(ruta)},
           "prueba_peso_presupuesto_aprobado": {"limite_bytes": PRESUPUESTO_APROBADO, "medido_bytes": os.path.getsize(ruta),
                                                 "pasa": os.path.getsize(ruta) <= PRESUPUESTO_APROBADO},
           "prueba_peso": {"limite_bytes": LIMITE_GZ, "nota": "presupuesto propuesto, sin aprobar", "medido_bytes": os.path.getsize(ruta), "pasa": os.path.getsize(ruta) <= LIMITE_GZ}}

    # ---------- Prueba contra los 16 puntos ----------
    import mosaico as M  # solo para leer GLO-30 crudo (método de B, para ver si la referencia es de ese lugar)
    glo = M.glo30()
    gruesa_sola = [rejs[0]]
    filas = []
    for p in ref["puntos"]:
        lo, la = p["lon"], p["lat"]
        hz_rej, r_usada = consultar(rejs, lo, la)
        hz_gru, _ = consultar(gruesa_sola, lo, la)
        hz_pto = horizonte(dem, np.array([lo]), np.array([la]), AZ, dmin=60.0)[:, 0]
        hz_b = horizonte(glo, np.array([lo]), np.array([la]), AZ, d=np.arange(400, 40001, 30.0), muestreo="cercano")[:, 0]
        fila = {"lugar": p["lugar"], "lon": lo, "lat": la, "rejilla_usada": "fina" if r_usada["mascara"] is not None else "gruesa",
                "fechas": {}}
        for dn, doy in ref["fechas"].items():
            t_b = hm(p["b"][dn])
            t_rej, t_gru, t_pto, t_mb = (llegada(AZ, h, lo, la, doy) for h in (hz_rej, hz_gru, hz_pto, hz_b))
            fila["fechas"][dn] = {"b": p["b"][dn], "rejilla": a_texto(t_rej), "dif_rejilla_min": round(t_rej - t_b, 1),
                                  "dif_solo_gruesa_min": round(t_gru - t_b, 1),
                                  "rayo_mosaico": a_texto(t_pto), "dif_rayo_mosaico_min": round(t_pto - t_b, 1),
                                  "metodo_b_glo30": a_texto(t_mb), "dif_metodo_b_min": round(t_mb - t_b, 1),
                                  "rejilla_menos_rayo_min": round(t_rej - t_pto, 1)}
        for k, campo in (("rejilla", "dif_rejilla_min"), ("solo_gruesa", "dif_solo_gruesa_min"),
                         ("rayo_mosaico", "dif_rayo_mosaico_min"), ("metodo_b", "dif_metodo_b_min"),
                         ("rejilla_contra_rayo", "rejilla_menos_rayo_min")):
            fila["pasa_" + k] = all(abs(x[campo]) <= TOL_MIN for x in fila["fechas"].values())
        filas.append(fila)
        print(p["lugar"], fila["rejilla_usada"], {d: (x["dif_rejilla_min"], x["dif_solo_gruesa_min"], x["dif_rayo_mosaico_min"], x["dif_metodo_b_min"]) for d, x in fila["fechas"].items()})
    n_ok = sum(f["pasa_rejilla"] for f in filas)
    res["prueba_16_puntos"] = {
        "criterio": "hora del primer sol (borde superior) a ±5 min de la tabla de B en las 3 fechas; meta 14 de 16",
        "puntos": "puntos-referencia.json versión %d" % ref.get("version", 1),
        "puntos_que_pasan_rejilla": n_ok,
        "puntos_que_pasan_solo_gruesa": sum(f["pasa_solo_gruesa"] for f in filas),
        "puntos_que_pasan_rayo_sobre_mosaico": sum(f["pasa_rayo_mosaico"] for f in filas),
        "puntos_que_pasan_metodo_b_sobre_glo30": sum(f["pasa_metodo_b"] for f in filas),
        "puntos_rejilla_a_5_min_del_rayo": sum(f["pasa_rejilla_contra_rayo"] for f in filas),
        "fechas_dentro_de_5_min_rejilla": sum(abs(x["dif_rejilla_min"]) <= TOL_MIN for f in filas for x in f["fechas"].values()),
        "pasa": n_ok >= 14, "detalle": filas}
    with open(os.path.join(C.SALIDA, "horizonte.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k not in ("prueba_16_puntos", "tabla_umbral_peso", "direcciones")}, ensure_ascii=False, indent=1))
    print({k: v for k, v in res["prueba_16_puntos"].items() if k != "detalle"})


if __name__ == "__main__":
    main()
