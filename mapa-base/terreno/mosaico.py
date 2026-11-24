"""Paso 2: mosaico de terreno MDT 2025 (dentro del Distrito) + GLO-30 filtrado (fuera).

Uso: .venv/bin/python -I mosaico.py
Lee salida/crudos/terreno/{glo30,mdt2025}/ y deja en salida/terreno/:
  mosaico.npy        float32, metros ortométricos, rejilla de comun.py (filas norte a sur)
  mascaras.npz       dentro (MDT), peso de la costura, urbano (huella LiDAR 1 m)
  mosaico.json       rejilla, parámetros y resultados de las pruebas del paso 2

Pruebas (sombras-DEBATE §3, paso 2):
  A. Ninguna celda urbana sobresale más de 3 m de la mediana de su vecindad de 300 m.
  B. El salto que añade la costura entre dos celdas vecinas es menor a 2 m.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comun as C  # noqa: E402

# Ancho de la franja de mezcla, hacia dentro del Distrito. El panel pedía 500 m; con 500 m el salto en la
# caja del visor llegaba a 3,1 m y con 1.000 m baja a 1,94 m (panel/terreno-arreglos.md §2). La rampa sigue
# siendo smoothstep: su pendiente máxima es 1,5/ancho; la de un coseno es pi/2/ancho, un 5 % peor.
COSTURA_M = float(os.environ.get("TERRENO_COSTURA_M", 1000.0))
FILTRO_M = 300.0        # diámetro del disco del filtro de GLO-30 fuera del Distrito
PERCENTIL = 10          # percentil del residuo que se toma como suelo (medido: ver mosaico.json)
PEND_PLANA, PEND_LADERA = 0.05, 0.10   # filtro pleno bajo 5 %, sin filtro sobre 10 %
SUB = 3
Image.MAX_IMAGE_PIXELS = None


def leer_tif(ruta):
    im = Image.open(ruta)
    a = np.array(im, dtype=np.float32)
    tags = im.tag_v2
    return a, tags.get(33922), tags.get(33550)


def glo30():
    d = os.path.join(C.CRUDOS, "glo30")
    a, tp_a, _ = leer_tif(os.path.join(d, "Copernicus_DSM_COG_10_N04_00_W075_00_DEM.tif"))
    b, tp_b, _ = leer_tif(os.path.join(d, "Copernicus_DSM_COG_10_N04_00_W074_00_DEM.tif"))
    assert tuple(tp_a)[3:5] == (-75.0, 5.0) and tuple(tp_b)[3:5] == (-74.0, 5.0), (tp_a, tp_b)
    dem = np.concatenate([a, b], axis=1)            # lon -75 .. -73 (centros), lat 5 .. 4+1/3600
    c0 = int(round((C.LON_MIN + 75.0) * 3600))
    dem = dem[:, c0:c0 + C.NCOL]
    assert dem.shape == (C.NFIL, C.NCOL), dem.shape
    malos = ~np.isfinite(dem) | (dem < -1000)
    assert not malos.any(), "GLO-30 trae vacíos en la zona"
    return dem


def mdt2025():
    """Promedio 3x3 de los exportes (~10 m) a la rejilla de 1 segundo. NaN donde no hay dato."""
    d = os.path.join(C.CRUDOS, "mdt2025")
    out = np.full((C.NFIL, C.NCOL), np.nan, dtype=np.float32)
    for n in sorted(os.listdir(d)):
        if not (n.startswith("mdt_c") and n.endswith(".tif")):
            continue
        a, tp, esc = leer_tif(os.path.join(d, n))
        c0 = int(n.split("_c")[1].split("_")[0])
        fa, fb = (int(x) for x in n.split("_f")[1].split(".")[0].split("-"))
        # comprobación de alineación: la esquina del exporte es el borde de la celda (c0, fa)
        assert abs(tp[3] - (C.lon_de_col(c0) - C.P / 2)) < 1e-7 and abs(tp[4] - (C.lat_de_fil(fa) + C.P / 2)) < 1e-7, (n, tp)
        assert abs(esc[0] - C.P / SUB) < 1e-9
        a[a <= -9000] = np.nan
        h, w = a.shape[0] // SUB, a.shape[1] // SUB
        bl = a[:h * SUB, :w * SUB].reshape(h, SUB, w, SUB)
        n_ok = np.isfinite(bl).sum(axis=(1, 3))
        with np.errstate(invalid="ignore"):
            media = np.nanmean(bl, axis=(1, 3))
        media[n_ok < 5] = np.nan                      # menos de 5 de 9 subpíxeles: sin dato
        out[fa:fa + h, c0:c0 + w] = media
        del a, bl
    return out


def rasterizar(anillos):
    im = Image.new("L", (C.NCOL, C.NFIL), 0)
    dr = ImageDraw.Draw(im)
    for anillo, valor in anillos:
        xy = [(C.col_de_lon(x) + 0.5, C.fil_de_lat(y) + 0.5) for x, y in anillo]
        dr.polygon(xy, fill=valor)
    return np.array(im) > 0


def disco(diam_m):
    r = diam_m / 2.0
    ry = r / (C.MLAT * C.P)
    rx = r / (C.MLAT * np.cos(np.radians(4.6)) * C.P)
    n = int(np.ceil(max(rx, ry)))
    y, x = np.mgrid[-n:n + 1, -n:n + 1]
    return (x / rx) ** 2 + (y / ry) ** 2 <= 1.0


def main():
    os.makedirs(C.SALIDA, exist_ok=True)
    res = {}
    print("leyendo GLO-30")
    glo = glo30()
    print("leyendo MDT 2025")
    mdt = mdt2025()
    valido = np.isfinite(mdt)

    # huecos internos del MDT (costuras de su propio mosaico): se rellenan con convolución normalizada
    lleno = ndimage.binary_fill_holes(valido)
    huecos = lleno & ~valido
    res["mdt_celdas_validas"] = int(valido.sum())
    res["mdt_huecos_rellenados"] = int(huecos.sum())
    if huecos.any():
        z = np.where(valido, mdt, 0.0).astype(np.float64)
        wv = valido.astype(np.float64)
        for sigma in (1, 2, 4, 8, 16):
            num = ndimage.gaussian_filter(z, sigma)
            den = ndimage.gaussian_filter(wv, sigma)
            faltan = huecos & ~np.isfinite(mdt)
            ok = faltan & (den > 0.05)
            mdt[ok] = (num[ok] / den[ok]).astype(np.float32)
            if not (huecos & ~np.isfinite(mdt)).any():
                break
    # límite del Distrito (Localidades, SDP)
    gj = json.load(open(C.DC_GEOJSON, encoding="utf-8"))
    geom = gj["features"][0]["geometry"]
    anillos = geom["coordinates"] if geom["type"] == "Polygon" else [p[0] for p in geom["coordinates"]]
    dc = rasterizar([(anillos[0], 1)])
    con_mdt = np.isfinite(mdt)
    res["iou_dc_vs_huella_mdt"] = round(float((dc & con_mdt).sum() / (dc | con_mdt).sum()), 4)

    # Celdas sin MDT dentro de la huella urbana del catálogo (LiDAR 1 m). Es el aeropuerto El Dorado:
    # el servicio no trae dato ahí y el hueco no queda encerrado, así que entraba GLO-30 con
    # edificios (+20 m). Se rellenan desde el MDT vecino. Primera versión (todo el Distrito sin MDT a
    # menos de 2 km) medida y descartada: en la franja de los cerros al este de -73,99, donde el MDT
    # termina antes que el límite del Distrito, extrapolar inventaba hasta 170 m.
    cat = json.load(open(os.path.join(C.CRUDOS, "mdt2025", "catalogo.json"), encoding="utf-8"))
    urb_an = [r for f in cat["features"] if f["attributes"]["Name"] == "MDT_BOGOTA_4326" for r in f["geometry"]["rings"]]
    urb_pol = rasterizar([(urb_an[0], 1)])
    for r in urb_an[1:]:
        urb_pol &= ~rasterizar([(r, 1)])
    sin = dc & ~con_mdt
    objetivo = urb_pol & ~con_mdt
    res["dc_sin_mdt_celdas"] = int(sin.sum())
    res["huella_urbana_sin_mdt_celdas"] = int(objetivo.sum())
    if objetivo.any():
        z = np.where(con_mdt, mdt, 0.0).astype(np.float64)
        wv = con_mdt.astype(np.float64)
        for sigma in (2, 4, 8, 16, 32):
            num = ndimage.gaussian_filter(z, sigma)
            den = ndimage.gaussian_filter(wv, sigma)
            ok = objetivo & ~np.isfinite(mdt) & (den > 0.02)
            mdt[ok] = (num[ok] / den[ok]).astype(np.float32)
        del z, wv, num, den
    res["huella_urbana_rellenadas_desde_mdt"] = int((objetivo & np.isfinite(mdt)).sum())
    res["nota_relleno"] = "celdas sin dato dentro de la huella urbana del catálogo (aeropuerto El Dorado) rellenadas desde el MDT vecino; el resto del Distrito sin MDT queda en GLO-30 filtrado"
    dentro = np.isfinite(mdt)

    # huella urbana del MDT (LiDAR 1 m): ítem MDT_BOGOTA_4326 del catálogo
    cat = json.load(open(os.path.join(C.CRUDOS, "mdt2025", "catalogo.json"), encoding="utf-8"))
    urb_an = [r for f in cat["features"] if f["attributes"]["Name"] == "MDT_BOGOTA_4326" for r in f["geometry"]["rings"]]
    urbano = rasterizar([(r, 1) for r in urb_an[:1]])
    for r in urb_an[1:]:
        urbano &= ~rasterizar([(r, 1)])
    urbano &= dentro
    res["celdas_urbanas"] = int(urbano.sum())
    # GLO-30 crudo menos MDT por componente del MDT (urbano LiDAR, cerros LiDAR, rural ZY3)
    lejos_borde = ndimage.distance_transform_edt(dentro) > 20
    res["glo_crudo_menos_mdt_por_componente"] = {}
    for f in cat["features"]:
        if f["attributes"].get("Category") != 1:
            continue
        mk = rasterizar([(f["geometry"]["rings"][0], 1)]) & dentro & lejos_borde
        d = (glo - mdt)[mk]
        res["glo_crudo_menos_mdt_por_componente"][f["attributes"]["Name"]] = {
            "celdas": int(mk.sum()), "p5_m": round(float(np.percentile(d, 5)), 1),
            "mediana_m": round(float(np.median(d)), 1), "p95_m": round(float(np.percentile(d, 95)), 1)}

    # GLO-30 filtrado con un disco de 300 m. Primera versión (mediana sola) medida y descartada:
    # dejaba +3,2 m de edificios en lo plano y bajaba crestas y subía cañadas hasta 80 m en el
    # borde del Distrito, que corre por divisorias y ríos. Versión que queda:
    #   tendencia = mediana del disco (sigue las lomas y las laderas planas)
    #   suelo     = tendencia + percentil 10 de (GLO - tendencia) en el mismo disco, suavizado 7x7
    #   se aplica solo en terreno suave (pendiente de la tendencia < 5 %); en laderas de más de
    #   10 % queda GLO-30 sin filtrar (ahí no hay casi nada construido y el filtro dañaba el relieve).
    print("filtrando GLO-30 (disco de 300 m, percentil 10 sobre la tendencia)")
    fp = disco(FILTRO_M)
    tend = ndimage.median_filter(glo, footprint=fp, mode="nearest")
    r10 = ndimage.percentile_filter(glo - tend, PERCENTIL, footprint=fp, mode="nearest")
    suelo = tend + ndimage.uniform_filter(r10, 7, mode="nearest")
    # la pendiente se mide sobre una tendencia más amplia (15 celdas, unos 460 m) para que un bloque
    # de bodegas grandes no cuente como ladera y se salve del filtro
    gyt, gxt = np.gradient(ndimage.uniform_filter(tend, 15, mode="nearest"),
                           C.MLAT * C.P, C.MLAT * np.cos(np.radians(4.6)) * C.P)
    pend_t = np.hypot(gxt, gyt)
    a = np.clip((pend_t - PEND_PLANA) / (PEND_LADERA - PEND_PLANA), 0.0, 1.0).astype(np.float32)
    glof = (a * glo + (1 - a) * suelo).astype(np.float32)
    del r10, gyt, gxt
    res["filtro"] = {"tipo": "tendencia (mediana) + percentil 10 del residuo, solo en terreno suave",
                     "diametro_m": FILTRO_M, "pixeles_disco": int(fp.sum()), "percentil": PERCENTIL,
                     "pendiente_plana": PEND_PLANA, "pendiente_ladera": PEND_LADERA}

    # Qué tanto deja el filtro: GLO-30 filtrado menos MDT dentro de lo urbano (lejos del borde)
    lejos = urbano & (ndimage.distance_transform_edt(dentro) > 20)
    dif = (glof - mdt)[lejos]
    dif_crudo = (glo - mdt)[lejos]
    res["glo_vs_mdt_urbano"] = {
        "glo_crudo_menos_mdt_mediana_m": round(float(np.median(dif_crudo)), 2),
        "glo_filtrado_menos_mdt_mediana_m": round(float(np.median(dif)), 2),
        "glo_filtrado_menos_mdt_p95_m": round(float(np.percentile(dif, 95)), 2),
        "glo_filtrado_menos_mdt_p5_m": round(float(np.percentile(dif, 5)), 2)}

    # Costura: peso del MDT de 0 en su borde a 1 a COSTURA_M hacia dentro (paso suave, sin quiebre)
    dy = C.MLAT * C.P
    dx = C.MLAT * np.cos(np.radians(4.6)) * C.P
    dist = ndimage.distance_transform_edt(dentro, sampling=(dy, dx))
    t = np.clip(dist / COSTURA_M, 0.0, 1.0)
    w = (t * t * (3 - 2 * t)).astype(np.float32)
    mos = np.where(dentro, w * np.nan_to_num(mdt) + (1 - w) * glof, glof).astype(np.float32)

    # ---------- Prueba A: celdas urbanas que sobresalen de su vecindad de 300 m ----------
    print("prueba A")
    med300 = ndimage.median_filter(mos, footprint=fp, mode="nearest")
    resid = mos - med300
    ru = resid[urbano]
    n3 = int((ru > 3.0).sum())
    peores = np.argwhere(urbano & (resid > 3.0))
    orden = np.argsort(-resid[urbano & (resid > 3.0)])[:15] if n3 else []
    lista = [{"lon": round(C.lon_de_col(int(peores[i][1])), 5), "lat": round(C.lat_de_fil(int(peores[i][0])), 5),
              "sobresale_m": round(float(resid[peores[i][0], peores[i][1]]), 2)} for i in orden]
    # pendiente local para distinguir lomas de edificios
    gy, gx = np.gradient(mos, dy, dx)
    pend = np.hypot(gx, gy)
    # Lectura complementaria: solo la sabana (pendiente de la mediana de 300 m < 5 %). Ahí una celda
    # que sobresale no puede ser loma; sería un edificio o un árbol que quedó en el suelo.
    gym, gxm = np.gradient(med300, dy, dx)
    sabana = urbano & (np.hypot(gxm, gym) < 0.05)
    rs = resid[sabana]
    ns = int((rs > 3.0).sum())
    ps = np.argwhere(sabana & (resid > 3.0))
    os_ = np.argsort(-resid[sabana & (resid > 3.0)])[:10] if ns else []
    res["prueba_A_sabana"] = {"criterio": "igual, solo celdas urbanas de sabana (pendiente de la mediana de 300 m < 5 %)",
                              "celdas": int(sabana.sum()), "max_m": round(float(rs.max()), 2),
                              "p99_9_m": round(float(np.percentile(rs, 99.9)), 2), "celdas_mayor_3m": ns,
                              "peores": [{"lon": round(C.lon_de_col(int(ps[i][1])), 5), "lat": round(C.lat_de_fil(int(ps[i][0])), 5),
                                          "sobresale_m": round(float(resid[ps[i][0], ps[i][1]]), 2)} for i in os_],
                              "pasa": ns == 0}
    res["prueba_A_ladera"] = {"celdas_urbanas_con_pendiente_mayor_5pct": int((urbano & ~sabana).sum()),
                              "de_ellas_mayor_3m": int((urbano & ~sabana & (resid > 3)).sum())}
    res["prueba_A"] = {"criterio": "ninguna celda urbana > 3 m sobre la mediana de su disco de 300 m",
                       "celdas_urbanas": int(urbano.sum()), "max_m": round(float(ru.max()), 2),
                       "p99_9_m": round(float(np.percentile(ru, 99.9)), 2), "celdas_mayor_3m": n3,
                       "fraccion_mayor_3m": round(n3 / max(1, ru.size), 6),
                       "pendiente_mediana_en_esas_celdas_pct": round(float(np.median(pend[urbano & (resid > 3)]) * 100), 1) if n3 else None,
                       "peores": lista, "pasa": n3 == 0}

    # Control con Catastro: si el suelo trajera edificios, las celdas con torres sobresaldrían más
    # que las de casas. Se compara el residuo por clase de pisos máximos en la celda.
    ruta_p = os.path.join(C.SALIDA, "pisos_por_celda.csv")
    if os.path.exists(ruta_p):
        tab = np.loadtxt(ruta_p, delimiter=",", skiprows=1)
        pisos = np.zeros(mos.shape, dtype=np.int16)
        f_, c_ = tab[:, 0].astype(int), tab[:, 1].astype(int)
        ok = (f_ >= 0) & (f_ < C.NFIL) & (c_ >= 0) & (c_ < C.NCOL)
        pisos[f_[ok], c_[ok]] = np.minimum(tab[ok, 2], 200).astype(np.int16)
        ctrl = {}
        for nombre, m in (("sin_construcciones", pisos == 0), ("1_a_2_pisos", (pisos >= 1) & (pisos <= 2)),
                          ("3_a_4_pisos", (pisos >= 3) & (pisos <= 4)), ("5_a_9_pisos", (pisos >= 5) & (pisos <= 9)),
                          ("10_o_mas_pisos", pisos >= 10)):
            for zona, base in (("urbano", urbano), ("sabana", sabana)):
                v = resid[base & m]
                if v.size:
                    ctrl.setdefault(nombre, {})[zona] = {
                        "celdas": int(v.size), "mediana_m": round(float(np.median(v)), 2),
                        "p95_m": round(float(np.percentile(v, 95)), 2), "fraccion_mayor_3m": round(float((v > 3).mean()), 5)}
        res["prueba_A_control_pisos"] = ctrl
        del pisos, tab

    # ---------- Prueba B: salto en la costura ----------
    print("prueba B")
    franja = dentro & (dist < COSTURA_M + 60)
    d_src = np.where(dentro, np.nan_to_num(mdt) - glof, 0.0)
    saltos = []
    for eje in (0, 1):
        dw = np.abs(np.diff(w, axis=eje))
        dprom = 0.5 * (np.take(d_src, range(0, d_src.shape[eje] - 1), axis=eje) + np.take(d_src, range(1, d_src.shape[eje]), axis=eje))
        f2 = np.take(franja, range(0, franja.shape[eje] - 1), axis=eje) | np.take(franja, range(1, franja.shape[eje]), axis=eje)
        saltos.append((dw * np.abs(dprom))[f2])
    # dónde están los peores saltos (para diagnosticar, no para esconderlos)
    sx = np.zeros(mos.shape, dtype=np.float32)
    for eje in (0, 1):
        dw = np.abs(np.diff(w, axis=eje))
        v = dw * np.abs(0.5 * (np.take(d_src, range(0, d_src.shape[eje] - 1), axis=eje)
                               + np.take(d_src, range(1, d_src.shape[eje]), axis=eje)))
        if eje == 0:
            sx[:-1, :] = np.maximum(sx[:-1, :], v)
        else:
            sx[:, :-1] = np.maximum(sx[:, :-1], v)
    sx[~franja] = 0
    top = np.argsort(-sx, axis=None)[:12]
    peores_b = [{"lon": round(C.lon_de_col(int(i % C.NCOL)), 5), "lat": round(C.lat_de_fil(int(i // C.NCOL)), 5),
                 "salto_m": round(float(sx.flat[i]), 2), "pendiente_pct": round(float(pend.flat[i]) * 100, 1),
                 "componente": "urbano" if urbano.flat[i] else "no urbano"} for i in top]
    n2 = int((sx > 2).sum())
    pend_altas = pend[sx > 2]
    saltos = np.concatenate(saltos)
    borde = dentro & (dist < 2 * dx)
    db = d_src[borde]
    res["prueba_B"] = {"criterio": "salto añadido por la costura entre celdas vecinas < 2 m",
                       "salto_max_m": round(float(saltos.max()), 3), "salto_p99_m": round(float(np.percentile(saltos, 99)), 3),
                       "mdt_menos_glof_en_el_borde": {"mediana_m": round(float(np.median(db)), 2),
                                                      "p5_m": round(float(np.percentile(db, 5)), 2),
                                                      "p95_m": round(float(np.percentile(db, 95)), 2),
                                                      "max_abs_m": round(float(np.abs(db).max()), 2)},
                       "celdas_con_salto_mayor_2m": n2,
                       "pendiente_mediana_en_esas_celdas_pct": round(float(np.median(pend_altas)) * 100, 1) if n2 else None,
                       "peores": peores_b,
                       "pasa": bool(saltos.max() < 2.0)}
    # misma prueba solo dentro de la caja del visor (lo que se publica en teselas)
    fa_, fb_ = int(C.fil_de_lat(C.CAJA["norte"])), int(np.ceil(C.fil_de_lat(C.CAJA["sur"])))
    ca_, cb_ = int(C.col_de_lon(C.CAJA["oeste"])), int(np.ceil(C.col_de_lon(C.CAJA["este"])))
    sc = sx[fa_:fb_ + 1, ca_:cb_ + 1]
    ib = np.argmax(np.abs(np.where(borde, d_src, 0)))
    tc = np.argsort(-sc, axis=None)[:5]
    res["prueba_B_en_caja"] = {"salto_max_m": round(float(sc.max()), 3),
                               "celdas_con_salto_mayor_2m": int((sc > 2).sum()),
                               "celdas_con_salto_mayor_1m": int((sc > 1).sum()),
                               "peores": [{"lon": round(C.lon_de_col(ca_ + int(i % sc.shape[1])), 5),
                                           "lat": round(C.lat_de_fil(fa_ + int(i // sc.shape[1])), 5),
                                           "salto_m": round(float(sc.flat[i]), 2)} for i in tc],
                               "pasa": bool(sc.max() < 2.0)}
    res["prueba_B"]["donde_max_abs_borde"] = {"lon": round(C.lon_de_col(int(ib % C.NCOL)), 5),
                                              "lat": round(C.lat_de_fil(int(ib // C.NCOL)), 5)}

    np.save(os.path.join(C.SALIDA, "mosaico.npy"), mos)
    np.savez_compressed(os.path.join(C.SALIDA, "mascaras.npz"), dentro=dentro, urbano=urbano, peso=w)
    meta = {"rejilla": {"lon_min_centro": C.LON_MIN, "lat_max_centro": C.LAT_MAX, "paso_grados": C.P,
                        "ncol": C.NCOL, "nfil": C.NFIL, "orden": "filas de norte a sur"},
            "alturas": "ortométricas: MDT en GEOCOL2004, GLO-30 en EGM2008 (sin corrección entre ambos; ver prueba B)",
            "costura_m": COSTURA_M, **res}
    with open(os.path.join(C.SALIDA, "mosaico.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
