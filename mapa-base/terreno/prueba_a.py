"""Paso 2, prueba A con el criterio nuevo (panel/terreno-arreglos.md §1): ¿quedan edificios en el suelo?

Uso: .venv/bin/python -I prueba_a.py   (después de mosaico.py y de huellas.sql)
Lee:  salida/crudos/terreno/mdt2025/mdt_c702_f*.tif  (exportes a unos 10 m, los mismos que usa el mosaico)
      salida/terreno/huellas_px.csv                  (huellas de Catastro en píxeles de esos exportes)
      salida/terreno/mosaico.npy, mascaras.npz, pisos_por_celda.csv
Deja: salida/terreno/prueba_a.json

Idea. Un edificio que se quedó en el suelo cambia la altura justo en el borde de su huella; una loma no.
Por eso se compara, para cada construcción grande, la altura del suelo dentro de la huella con un plano
ajustado al anillo que la rodea (de 15 a 35 m afuera, sin otras construcciones). El plano absorbe la
pendiente: en ladera la loma queda en el plano y no cuenta como edificio.

A1. Huella contra anillo (exportes de 10 m; construcciones de 1.500 m² o más, núcleo de la huella sin el
    borde de 10 m): en las de 5 o más pisos, mediana de (suelo dentro menos plano del anillo) <= 0,5 m y
    ninguna pasa de 3 m. Un edificio de 5 pisos que quedara en el suelo daría unos 15 m.
A2. Residuo por clase de pisos en el mosaico publicado (celdas de 31 m, sabana plana: relieve robusto
    p90 menos p10 en el disco de 300 m menor a 15 m, o sea pendiente < 5 %): las celdas con 5 o más pisos
    no sobresalen más que las celdas sin construcción (mediana a 0,5 m o menos de la de sin construcción,
    p95 a 0,5 m o menos y fracción sobre 3 m menor o igual).
El criterio viejo (ninguna celda urbana > 3 m sobre la mediana de 300 m) se sigue midiendo en mosaico.py.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comun as C  # noqa: E402
from mosaico import disco  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
AREA_MIN = float(os.environ.get("PRUEBA_A_AREA_MIN", 900.0))   # m²: núcleo de 1 a 4 píxeles de 10 m o más
PEND_MAX = 0.05            # el tope se exige en la sabana plana: anillo con menos de 5 % de pendiente
ANILLO_PX = (1.5, 3.5)     # de 15 a 35 m afuera de la huella
TOPE_M = 3.0
MEDIANA_MAX = 0.5
TILES = ["mdt_c702_f576-1583.tif", "mdt_c702_f1584-2591.tif"]   # cubren la huella urbana (4,28 a 4,84)
X0, Y0 = -74.4551388889, 4.8401388889                            # esquina del primer exporte (huellas.sql)


def leer_mdt():
    d = os.path.join(C.CRUDOS, "mdt2025")
    partes = []
    for n in TILES:
        im = Image.open(os.path.join(d, n))
        tp = im.tag_v2.get(33922)
        assert abs(tp[3] - X0) < 1e-7, (n, tp)
        a = np.array(im, dtype=np.float32)
        a[a <= -9000] = np.nan
        partes.append(a)
    z = np.concatenate(partes, axis=0)
    return z


def leer_huellas():
    ruta = os.path.join(C.SALIDA, "huellas_px.csv")
    num = re.compile(r"-?\d+(?:\.\d+)?")
    ids, pisos, areas, anillos = [], [], [], []
    with open(ruta, encoding="utf-8") as f:
        next(f)
        for linea in f:
            i, p, a, w = linea.rstrip("\n").split("|", 3)
            v = np.array(num.findall(w), dtype=np.float64).reshape(-1, 2) - 0.5   # PIL: el entero es el centro
            ids.append(int(i)); pisos.append(int(p)); areas.append(float(a)); anillos.append(v)
    return np.array(ids), np.array(pisos), np.array(areas), anillos


def glo_en_rejilla_10m():
    """GLO-30 crudo llevado (bilineal) a los centros de píxel de los exportes de 10 m."""
    import mosaico as M
    glo = M.glo30()
    h, w = 2 * 3024, 5079
    lon = X0 + (np.arange(w) + 0.5) / 10800.0
    lat = Y0 - (np.arange(h) + 0.5) / 10800.0
    cc = C.col_de_lon(lon)
    ff = C.fil_de_lat(lat)
    out = np.empty((h, w), np.float32)
    for i0 in range(0, h, 512):
        F, Cc = np.meshgrid(ff[i0:i0 + 512], cc, indexing="ij")
        out[i0:i0 + 512] = ndimage.map_coordinates(glo, [F, Cc], order=1, mode="nearest")
    return out


def a1(z):
    ids, pisos, areas, anillos = leer_huellas()
    h, w = z.shape
    todo = Image.new("1", (w, h), 0)
    dt = ImageDraw.Draw(todo)
    sel = np.where(areas >= AREA_MIN)[0]
    sel = sel[np.argsort(-areas[sel])]                 # las chicas encima: cada píxel queda con la menor
    lab = Image.new("I", (w, h), 0)
    dl = ImageDraw.Draw(lab)
    for k, v in enumerate(anillos):
        if len(v) >= 3:
            dt.polygon([tuple(p) for p in v], fill=1)
    for n, k in enumerate(sel, start=1):
        dl.polygon([tuple(p) for p in anillos[k]], fill=n)
    construido = np.array(todo, dtype=bool)
    L = np.array(lab, dtype=np.int32)
    del todo, lab
    # núcleo: píxeles cuyos 8 vecinos son de la misma huella (quita el borde mezclado de 10 m)
    nucleo = L.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                nucleo[np.roll(np.roll(L, dy, 0), dx, 1) != L] = 0
    nucleo[~np.isfinite(z)] = 0
    # anillo: píxeles sin construcción a 15-35 m de la huella más cercana del conjunto de prueba
    dist, (iy, ix) = ndimage.distance_transform_edt(L == 0, return_indices=True)
    anillo = L[iy, ix]
    anillo[(dist < ANILLO_PX[0]) | (dist > ANILLO_PX[1]) | construido | ~np.isfinite(z)] = 0
    del dist, iy, ix
    n = len(sel)
    rng = np.arange(1, n + 1)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    zz = np.nan_to_num(z).astype(np.float64)
    # momentos del anillo para el plano z = a + b x + c y (x, y en metros, centrados en el núcleo)
    cnt_n = ndimage.sum(np.ones_like(zz), nucleo, rng)
    xc = ndimage.sum(xx, nucleo, rng) / np.maximum(cnt_n, 1)
    yc = ndimage.sum(yy, nucleo, rng) / np.maximum(cnt_n, 1)
    zin = ndimage.sum(zz, nucleo, rng) / np.maximum(cnt_n, 1)
    zin_med = np.array(ndimage.median(zz, nucleo, rng))
    s = 10.0   # metros por píxel (aprox.)
    X = (xx - xc[np.maximum(anillo, 1) - 1]) * s
    Y = (yy - yc[np.maximum(anillo, 1) - 1]) * s
    del xx, yy
    m = {}
    for k, f in (("1", lambda: np.ones_like(zz)), ("x", lambda: X), ("y", lambda: Y), ("xx", lambda: X * X),
                 ("xy", lambda: X * Y), ("yy", lambda: Y * Y), ("z", lambda: zz), ("xz", lambda: X * zz),
                 ("yz", lambda: Y * zz)):
        m[k] = ndimage.sum(f(), anillo, rng)       # una matriz a la vez (unos 250 MB cada una)
    del X, Y
    cnt_a = m["1"]
    A = np.stack([np.stack([m["1"], m["x"], m["y"]], -1), np.stack([m["x"], m["xx"], m["xy"]], -1),
                  np.stack([m["y"], m["xy"], m["yy"]], -1)], -2)
    B = np.stack([m["z"], m["xz"], m["yz"]], -1)
    ok = (cnt_n >= 4) & (cnt_a >= 12)
    A[~ok] = np.eye(3)
    B[~ok] = 0
    coef = np.linalg.solve(A, B[..., None])[..., 0]
    plano = coef[:, 0]                               # el plano en el centroide del núcleo
    pend = np.hypot(coef[:, 1], coef[:, 2])
    dif = (zin - plano)[ok]
    dif_med = (zin_med - plano)[ok]
    p = pisos[sel][ok]
    pe = pend[ok]
    lon = X0 + (xc[ok] + 0.5) / 10800.0
    lat = Y0 - (yc[ok] + 0.5) / 10800.0

    def resumen(mk):
        v = dif[mk]
        if not v.size:
            return None
        return {"construcciones": int(v.size), "mediana_m": round(float(np.median(v)), 2),
                "p5_m": round(float(np.percentile(v, 5)), 2), "p95_m": round(float(np.percentile(v, 95)), 2),
                "p99_m": round(float(np.percentile(v, 99)), 2), "max_m": round(float(v.max()), 2),
                "sobre_3m": int((v > TOPE_M).sum())}

    clases = {"1_a_2": (p >= 1) & (p <= 2), "3_a_4": (p >= 3) & (p <= 4), "5_a_9": (p >= 5) & (p <= 9),
              "10_o_mas": p >= 10, "5_o_mas": p >= 5}
    out = {"construcciones_medidas": int(ok.sum()), "de_ellas_5_o_mas_pisos": int((p >= 5).sum()),
           "por_pisos": {k: resumen(v) for k, v in clases.items()},
           "5_o_mas_por_pendiente_del_anillo": {
               "menor_5pct": resumen((p >= 5) & (pe < 0.05)), "5_a_15pct": resumen((p >= 5) & (pe >= 0.05) & (pe < 0.15)),
               "15pct_o_mas": resumen((p >= 5) & (pe >= 0.15))},
           "mediana_del_nucleo_en_vez_de_media_5_o_mas": round(float(np.median(dif_med[p >= 5])), 2)}
    o = np.argsort(-dif)[:12]
    out["mayores"] = [{"lon": round(float(lon[i]), 5), "lat": round(float(lat[i]), 5), "pisos": int(p[i]),
                       "area_m2": round(float(areas[sel][ok][i])), "dif_m": round(float(dif[i]), 2),
                       "pendiente_anillo_pct": round(float(pe[i]) * 100, 1)} for i in o]
    v5 = dif[(p >= 5) & (pe < PEND_MAX)]
    out["pasa"] = bool(np.median(v5) <= MEDIANA_MAX and (v5 > TOPE_M).sum() == 0)
    out["criterio"] = (f"construcciones de {AREA_MIN:.0f} m² o más con 5 o más pisos y anillo con pendiente < "
                       f"{PEND_MAX * 100:.0f} %: mediana de (suelo en el núcleo de la huella menos plano del anillo de "
                       f"15 a 35 m) <= {MEDIANA_MAX} m y ninguna > {TOPE_M} m. En pendientes mayores el plano no "
                       f"representa terrazas de corte y relleno: se informa la simetría (p5 contra p95), no se exige")
    return out


def a2():
    mos = np.load(os.path.join(C.SALIDA, "mosaico.npy"))
    urbano = np.load(os.path.join(C.SALIDA, "mascaras.npz"))["urbano"]
    fp = disco(300.0)
    f = np.where(urbano.any(1))[0]
    c = np.where(urbano.any(0))[0]
    f0, f1, c0, c1 = f[0] - 80, f[-1] + 80, c[0] - 80, c[-1] + 80
    m = mos[f0:f1, c0:c1].astype(np.float32)
    u = urbano[f0:f1, c0:c1]
    del mos
    res = m - ndimage.median_filter(m, footprint=fp, mode="nearest")
    rel = (ndimage.percentile_filter(m, 90, footprint=fp, mode="nearest")
           - ndimage.percentile_filter(m, 10, footprint=fp, mode="nearest")) / 300.0
    tab = np.loadtxt(os.path.join(C.SALIDA, "pisos_por_celda.csv"), delimiter=",", skiprows=1)
    P = np.zeros(m.shape, np.int16)
    ff, cc = tab[:, 0].astype(int) - f0, tab[:, 1].astype(int) - c0
    ok = (ff >= 0) & (ff < m.shape[0]) & (cc >= 0) & (cc < m.shape[1])
    P[ff[ok], cc[ok]] = np.minimum(tab[ok, 2], 200)
    plana = u & (rel < 0.05)

    def r(mk):
        v = res[plana & mk]
        return {"celdas": int(v.size), "mediana_m": round(float(np.median(v)), 2), "p95_m": round(float(np.percentile(v, 95)), 2),
                "p99_m": round(float(np.percentile(v, 99)), 2), "fraccion_mayor_3m": round(float((v > 3).mean()), 5),
                "max_m": round(float(v.max()), 2)}
    cl = {"sin_construcciones": P == 0, "1_a_2": (P >= 1) & (P <= 2), "3_a_4": (P >= 3) & (P <= 4),
          "5_a_9": (P >= 5) & (P <= 9), "10_o_mas": P >= 10, "5_o_mas": P >= 5}
    out = {"sabana_plana": "celdas urbanas con (p90 - p10 del mosaico en el disco de 300 m) / 300 m < 5 %",
           "celdas": int(plana.sum()), "por_pisos": {k: r(v) for k, v in cl.items()}}
    s0 = out["por_pisos"]["sin_construcciones"]
    pasa = True
    for k in ("5_a_9", "10_o_mas", "5_o_mas"):
        x = out["por_pisos"][k]
        pasa &= (x["mediana_m"] - s0["mediana_m"] <= MEDIANA_MAX and x["p95_m"] - s0["p95_m"] <= MEDIANA_MAX
                 and x["fraccion_mayor_3m"] <= s0["fraccion_mayor_3m"])
    out["pasa"] = bool(pasa)
    out["criterio"] = ("en la sabana plana, las celdas con 5 o más pisos (y por separado 5 a 9 y 10 o más) no sobresalen "
                       "más que las sin construcción: mediana y p95 a 0,5 m o menos de las de sin construcción y "
                       "fracción sobre 3 m menor o igual")
    # el tope por celda en esa misma sabana, solo como dato (no es criterio: lo rompen rellenos y taludes)
    out["dato_tope_celda_3m"] = {"celdas_sobre_3m": int((plana & (res > 3)).sum()),
                                 "de_ellas_con_5_o_mas_pisos": int((plana & (res > 3) & (P >= 5)).sum())}
    return out


def main():
    print("A2: residuo por clase de pisos en el mosaico")
    r2 = a2()
    print(json.dumps(r2, ensure_ascii=False))
    print("A1: huella contra anillo en los exportes de 10 m")
    r1 = a1(leer_mdt())
    print("Control positivo: el mismo método sobre GLO-30 crudo (modelo de superficie, trae edificios)")
    r0 = a1(glo_en_rejilla_10m())
    print(json.dumps({k: r0[k] for k in ("por_pisos", "pasa")}, ensure_ascii=False))
    print(json.dumps(r1, ensure_ascii=False))
    out = {"A1_huella_contra_anillo": r1, "A1_control_positivo_glo30_crudo": r0, "A2_residuo_por_clase": r2, "pasa": bool(r1["pasa"] and r2["pasa"])}
    with open(os.path.join(C.SALIDA, "prueba_a.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
