#!/usr/bin/env python3
"""Buses troncales de TransMilenio por hora, según la programación del GTFS estático.

No es dato en vivo. TransMilenio publica cada madrugada un GTFS nuevo en el bucket
público gtfs-estaticos. Este script toma el más reciente y cuenta, para cada tramo
entre dos estaciones troncales vecinas, cuántos buses troncales tienen programado
pasar en cada hora del día, en los dos sentidos, para día hábil, sábado y domingo o
festivo. Lo mismo para cada estación: cuántos buses paran.

Cada corrida:
  1. Revisa la licencia en la ficha de Datos Abiertos Bogotá. Si deja de ser una de
     las aceptadas, para sin publicar nada nuevo.
  2. Lista el bucket. Si el GTFS más reciente es el mismo que ya está publicado,
     no baja nada (la corrida tarda un segundo).
  3. Si hay uno nuevo, lo baja (unos 120 MB), lo lee sin descomprimirlo a disco y
     escribe frecuencia/troncal.json.

Lo derivado del GTFS queda bajo CC BY-SA 4.0, como el GTFS. Va en un archivo aparte
y no se mezcla con datos CC BY-NC ni con OpenStreetMap.
Solo biblioteca estándar. Sin claves.

Uso:
    python3 -I pipelines/frecuencia/frecuencia.py --salida _site/frecuencia
    python3 -I pipelines/frecuencia/frecuencia.py --salida site/datos/transporte --nombre troncal-frecuencia.json
    python3 -I pipelines/frecuencia/frecuencia.py --zip GTFS.zip --sin-red --salida /tmp/x   (sin red, para probar)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import math
import re
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vivo"))
import comun  # noqa: E402

ESQUEMA = "bogotwin/troncal-frecuencia/1"
BUCKET = "https://storage.googleapis.com/gtfs-estaticos/"
FICHA = "https://datosabiertos.bogota.gov.co/dataset/especificacion-gtfs-general-transport-feed-specification-sitp"
FICHA_API = "https://datosabiertos.bogota.gov.co/api/3/action/package_show?id=especificacion-gtfs-general-transport-feed-specification-sitp"
LICENCIAS_OK = {"CC0-1.0", "CC-BY-4.0", "ODbL-1.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0"}
LICENCIA_URL = {
    "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/deed.es",
    "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/deed.es",
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/deed.es",
    "ODbL-1.0": "https://opendatacommons.org/licenses/odbl/1-0/",
    "CC-BY-NC-4.0": "https://creativecommons.org/licenses/by-nc/4.0/deed.es",
}
AGENCIA_TRONCAL = "1"            # agency.txt: 1 = Transmilenio-Troncal
TIPOS_DIA = ["habil", "sabado", "domingo"]
CERCA_M = 40                     # una estación a menos de esto del recorrido queda en el camino
MIN_TRAMO_M = 40                 # menos que esto es un paso entre dos estaciones pegadas, no un tramo
TOLERANCIA_M = 6                 # simplificación de la línea de cada tramo
NOMBRE_ZIP = re.compile(r"^GTFS_(\d{8})\.zip$")


class LicenciaNoAceptada(Exception):
    pass


# ── Geometría en metros alrededor de Bogotá (equirectangular, basta para 30 km) ──
LAT0 = 4.65
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0


def xy(lon: float, lat: float) -> tuple[float, float]:
    return lon * KX, lat * KY


def proyectar(p: tuple[float, float], linea: list[tuple[float, float]], desde: int = 0):
    """Punto más cercano de la polilínea (en metros) a p, desde el segmento `desde`.
    Devuelve (distancia, posición a lo largo en metros, índice del segmento, fracción)."""
    mejor = (float("inf"), 0.0, desde, 0.0)
    largo = 0.0
    for i in range(len(linea) - 1):
        (x1, y1), (x2, y2) = linea[i], linea[i + 1]
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        seg = math.sqrt(l2)
        if i >= desde:
            t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2))
            d = math.hypot(x1 + t * dx - p[0], y1 + t * dy - p[1])
            if d < mejor[0]:
                mejor = (d, largo + t * seg, i, t)
        largo += seg
    return mejor


def pasadas(p: tuple[float, float], linea: list[tuple[float, float]], radio: float) -> list:
    """Cada vez que la polilínea pasa a menos de `radio` de p (una ruta que va y vuelve por la
    misma vía pasa dos veces). Devuelve, por pasada, el punto más cercano como en proyectar."""
    salida, mejor, largo = [], None, 0.0
    for i in range(len(linea) - 1):
        (x1, y1), (x2, y2) = linea[i], linea[i + 1]
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2))
        d = math.hypot(x1 + t * dx - p[0], y1 + t * dy - p[1])
        if d <= radio:
            if mejor is None or d < mejor[0]:
                mejor = (d, largo + t * math.sqrt(l2), i, t)
        elif mejor is not None:
            salida.append(mejor)
            mejor = None
        largo += math.sqrt(l2)
    if mejor is not None:
        salida.append(mejor)
    return salida


def cortar(linea_ll: list[tuple[float, float]], a: tuple[int, float], b: tuple[int, float]) -> list[tuple[float, float]]:
    """Trozo de la polilínea (lon, lat) entre dos puntos dados como (segmento, fracción)."""
    def punto(i, t):
        (x1, y1), (x2, y2) = linea_ll[i], linea_ll[min(i + 1, len(linea_ll) - 1)]
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    (ia, ta), (ib, tb) = a, b
    salida = [punto(ia, ta)]
    salida += linea_ll[ia + 1: ib + 1]
    salida.append(punto(ib, tb))
    return salida


def simplificar(pts: list[tuple[float, float]], tol_m: float) -> list[tuple[float, float]]:
    """Douglas-Peucker en metros, sin recursión."""
    if len(pts) < 3:
        return pts
    m = [xy(*p) for p in pts]
    guardar = [False] * len(pts)
    guardar[0] = guardar[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        i, j = pila.pop()
        (x1, y1), (x2, y2) = m[i], m[j]
        dx, dy = x2 - x1, y2 - y1
        l = math.hypot(dx, dy) or 1e-9
        k, dmax = -1, 0.0
        for q in range(i + 1, j):
            d = abs(dy * (m[q][0] - x1) - dx * (m[q][1] - y1)) / l
            if d > dmax:
                k, dmax = q, d
        if dmax > tol_m and k > 0:
            guardar[k] = True
            pila += [(i, k), (k, j)]
    return [p for p, g in zip(pts, guardar) if g]


def segundos(hhmmss: str) -> int | None:
    try:
        h, m, s = hhmmss.strip().split(":")
        return int(h) * 3600 + int(m) * 60 + int(s)
    except (ValueError, AttributeError):
        return None


def leer_csv(z: zipfile.ZipFile, nombre: str):
    with z.open(nombre) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))


def tipos_de_servicio(z: zipfile.ZipFile) -> tuple[dict, list]:
    """service_id → lista de tipos de día, y la lista de festivos (días en que se agrega un
    servicio que solo corre el domingo)."""
    tipos, solo_domingo = {}, set()
    for r in leer_csv(z, "calendar.txt"):
        t = []
        if any(r.get(d) == "1" for d in ("monday", "tuesday", "wednesday", "thursday", "friday")):
            t.append("habil")
        if r.get("saturday") == "1":
            t.append("sabado")
        if r.get("sunday") == "1":
            t.append("domingo")
        tipos[r["service_id"]] = t
        if t == ["domingo"]:
            solo_domingo.add(r["service_id"])
    festivos = set()
    if "calendar_dates.txt" in z.namelist():
        for r in leer_csv(z, "calendar_dates.txt"):
            if r.get("exception_type") == "1" and r.get("service_id") in solo_domingo:
                d = r["date"]
                festivos.add(f"{d[:4]}-{d[4:6]}-{d[6:]}")
    return tipos, sorted(festivos)


def nombre_estacion(n: str) -> str:
    """Espacios de más fuera; un nombre todo en mayúsculas pasa a mayúscula inicial."""
    n = " ".join(n.split())
    return n.title() if n.isupper() else n


def calcular(ruta_zip: Path) -> dict:
    """Lee el GTFS y arma estaciones y tramos con buses por hora. Función pura sobre el zip."""
    z = zipfile.ZipFile(ruta_zip)
    tipos, festivos = tipos_de_servicio(z)

    rutas = {r["route_id"]: r for r in leer_csv(z, "routes.txt") if r.get("agency_id") == AGENCIA_TRONCAL}
    viajes = {}
    for r in leer_csv(z, "trips.txt"):
        if r["route_id"] in rutas and tipos.get(r["service_id"]):
            viajes[r["trip_id"]] = (r["service_id"], r.get("shape_id") or "")

    padre, estaciones = {}, {}
    hijos: dict[str, list] = {}
    for r in leer_csv(z, "stops.txt"):
        lat, lon = float(r["stop_lat"]), float(r["stop_lon"])
        if r.get("location_type") == "1":
            estaciones[r["stop_id"]] = {"nombre": nombre_estacion(r["stop_name"]), "lat": lat, "lon": lon}
        elif r.get("parent_station"):
            padre[r["stop_id"]] = r["parent_station"]
            hijos.setdefault(r["parent_station"], []).append(xy(lon, lat))
        padre.setdefault(r["stop_id"], r["stop_id"] if r.get("location_type") == "1" else None)

    # stop_times es enorme (más de 500 MB): se mira el trip_id antes de leer la fila con csv.
    paradas: dict[str, list] = {}
    with z.open("stop_times.txt") as f:
        texto = io.TextIOWrapper(f, encoding="utf-8-sig", newline="")
        cab = next(csv.reader([texto.readline()]))
        ix = {c: i for i, c in enumerate(cab)}
        it, idep, iarr, istop, iseq = ix["trip_id"], ix["departure_time"], ix["arrival_time"], ix["stop_id"], ix["stop_sequence"]
        for linea in texto:
            tid = linea.split(",", 1)[0] if it == 0 else None
            if tid is not None and tid not in viajes:
                continue
            fila = next(csv.reader([linea]))
            tid = fila[it]
            if tid not in viajes:
                continue
            seg = segundos(fila[idep]) if fila[idep] else segundos(fila[iarr])
            paradas.setdefault(tid, []).append((int(fila[iseq]), seg, fila[istop]))

    formas_necesarias = {viajes[t][1] for t in paradas}
    formas: dict[str, list] = {}
    for r in leer_csv(z, "shapes.txt"):
        if r["shape_id"] in formas_necesarias:
            formas.setdefault(r["shape_id"], []).append((int(r["shape_pt_sequence"]), float(r["shape_pt_lon"]), float(r["shape_pt_lat"])))
    for k in formas:
        formas[k] = [(lo, la) for _, lo, la in sorted(formas[k])]
    formas_m = {k: [xy(*p) for p in v] for k, v in formas.items()}

    # Estaciones cerca de cada forma, en orden a lo largo del recorrido (una vez por forma).
    pos_est = {e: [xy(v["lon"], v["lat"])] + hijos.get(e, []) for e, v in estaciones.items()}
    camino_de_forma: dict[str, list] = {}

    def camino(fid: str) -> list:
        if fid in camino_de_forma:
            return camino_de_forma[fid]
        lm = formas_m.get(fid) or []
        if len(lm) < 2:
            camino_de_forma[fid] = []
            return []
        xs = [p[0] for p in lm]
        ys = [p[1] for p in lm]
        caja = (min(xs) - CERCA_M, min(ys) - CERCA_M, max(xs) + CERCA_M, max(ys) + CERCA_M)
        cerca = []
        for e, pts in pos_est.items():
            if not any(caja[0] <= x <= caja[2] and caja[1] <= y <= caja[3] for x, y in pts):
                continue
            vistas = sorted((pa for p in pts for pa in pasadas(p, lm, CERCA_M)), key=lambda r: r[1])
            # Los vagones de una misma estación dan pasadas a pocos metros: cuenta una por cada 150 m.
            ultima = -1e9
            for d, s, i, t in vistas:
                if s - ultima > 150:
                    cerca.append((s, e, i, t))
                    ultima = s
        cerca.sort()
        camino_de_forma[fid] = cerca
        return cerca

    cuenta_est = {e: {t: [0] * 24 for t in TIPOS_DIA} for e in estaciones}
    tramos: dict[tuple, dict] = {}
    recorridos: dict[tuple, list] = {}
    sin_forma = 0
    for tid, ps in paradas.items():
        servicio, fid = viajes[tid]
        dias = tipos[servicio]
        ps.sort()
        # Paradas por estación, sin repetir la misma estación seguida (varios vagones).
        serie = []
        for _, seg, sid in ps:
            e = padre.get(sid)
            if e is None or e not in estaciones or seg is None:
                continue
            if serie and serie[-1][0] == e:
                continue
            serie.append((e, seg))
        if len(serie) < 2:
            continue
        for e, seg in serie[:-1]:
            h = (seg // 3600) % 24
            for d in dias:
                cuenta_est[e][d][h] += 1
        lm = formas_m.get(fid)
        if not lm or len(lm) < 2:
            sin_forma += 1
            continue
        # El recorrido (forma y estaciones servidas) se repite en miles de viajes: se calcula
        # una vez por patrón y cada viaje solo pone sus horas.
        patron = (fid, tuple(e for e, _ in serie))
        todo = recorridos.get(patron)
        if todo is None:
            servidas, desde = [], 0
            for j, (e, _) in enumerate(serie):
                pr = min((proyectar(p, lm, desde) for p in pos_est[e]), key=lambda r: r[0])
                servidas.append((pr[1], e, j, pr[2], pr[3]))
                desde = pr[2]
            ini, fin = servidas[0][0], servidas[-1][0]
            # Una estación servida no se vuelve a contar en la misma pasada, pero sí si la ruta
            # vuelve a pasar por ella más adelante sin parar.
            ya = [(x[1], x[0]) for x in servidas]
            intermedias = [(s, e, None, i, t) for s, e, i, t in camino(fid)
                           if ini < s < fin and not any(e == e2 and abs(s - s2) <= 150 for e2, s2 in ya)]
            todo = sorted(servidas + intermedias, key=lambda x: x[0])
            recorridos[patron] = todo
        # Hora de paso por cada estación: la de la parada servida, o interpolada por distancia.
        horas = []
        for k, (s, e, j, i, t) in enumerate(todo):
            if j is not None:
                horas.append(serie[j][1])
                continue
            antes = next(x for x in reversed(todo[:k]) if x[2] is not None)
            despues = next((x for x in todo[k + 1:] if x[2] is not None), antes)
            frac = 0 if despues[0] == antes[0] else (s - antes[0]) / (despues[0] - antes[0])
            horas.append(serie[antes[2]][1] + frac * (serie[despues[2]][1] - serie[antes[2]][1]))
        for k in range(len(todo) - 1):
            a, b = todo[k], todo[k + 1]
            if a[1] == b[1] or b[0] - a[0] < MIN_TRAMO_M:
                continue
            clave = tuple(sorted((a[1], b[1])))
            tr = tramos.get(clave)
            if tr is None:
                linea = cortar(formas[fid], (a[3], a[4]), (b[3], b[4]))
                if a[1] != clave[0]:
                    linea = linea[::-1]
                tr = {"linea": simplificar(linea, TOLERANCIA_M), "f": {t: [0] * 24 for t in TIPOS_DIA}, "m": round(b[0] - a[0])}
                tramos[clave] = tr
            h = int(horas[k] // 3600) % 24
            for d in dias:
                tr["f"][d][h] += 1

    usadas = sorted({e for c in tramos for e in c} | {e for e, c in cuenta_est.items() if any(sum(v) for v in c.values())})
    indice = {e: i for i, e in enumerate(usadas)}
    salida_est = [{"id": e, "nombre": estaciones[e]["nombre"], "lat": round(estaciones[e]["lat"], 5),
                   "lon": round(estaciones[e]["lon"], 5), "f": cuenta_est[e]} for e in usadas]
    salida_tr = [{"a": indice[a], "b": indice[b], "m": tr["m"],
                  "c": [[round(lo, 5), round(la, 5)] for lo, la in tr["linea"]], "f": tr["f"]}
                 for (a, b), tr in sorted(tramos.items())]
    feed = {}
    if "feed_info.txt" in z.namelist():
        feed = next(leer_csv(z, "feed_info.txt"), {})
    return {
        "estaciones": salida_est,
        "tramos": salida_tr,
        "festivos": festivos,
        "vigencia": [feed.get("feed_start_date"), feed.get("feed_end_date")],
        "totales": {"rutas_troncales": len(rutas), "viajes": len(paradas), "viajes_sin_forma": sin_forma,
                    "estaciones": len(salida_est), "tramos": len(salida_tr)},
    }


# ── Red: licencia, bucket y descarga ──
def licencia_de_ficha() -> dict:
    j = comun.bajar_json(FICHA_API, intentos=3)
    r = j.get("result", {})
    lid = r.get("license_id")
    if lid not in LICENCIAS_OK:
        raise LicenciaNoAceptada(f"license_id={lid!r} en {FICHA}")
    return {"id": lid, "nombre": r.get("license_title") or lid, "url": LICENCIA_URL.get(lid), "ficha": FICHA,
            "revisada": comun.iso(comun.ahora_utc())}


def ultimo_del_bucket() -> dict:
    """El GTFS_AAAAMMDD.zip más reciente del bucket público, con su tamaño y fecha."""
    xml = comun.bajar(BUCKET, acepta="application/xml").decode("utf-8")
    mejor = None
    for m in re.finditer(r"<Contents>(.*?)</Contents>", xml, re.S):
        bloque = m.group(1)
        clave = re.search(r"<Key>([^<]+)</Key>", bloque).group(1)
        if not NOMBRE_ZIP.match(clave):
            continue
        mod = re.search(r"<LastModified>([^<]+)</LastModified>", bloque).group(1)
        tam = int(re.search(r"<Size>(\d+)</Size>", bloque).group(1))
        if mejor is None or clave > mejor["archivo"]:
            mejor = {"archivo": clave, "url": BUCKET + clave, "bytes": tam, "modificado": mod}
    if mejor is None:
        raise RuntimeError("El bucket no tiene ningún GTFS_AAAAMMDD.zip")
    return mejor


def bajar_a(url: str, destino: Path) -> str:
    h = hashlib.sha256()
    req = urllib.request.Request(url, headers={"User-Agent": comun.AGENTE})
    with urllib.request.urlopen(req, timeout=120) as r, open(destino, "wb") as f:
        for bloque in iter(lambda: r.read(1 << 20), b""):
            h.update(bloque)
            f.write(bloque)
    return h.hexdigest()


def armar(datos: dict, fuente: dict, licencia: dict) -> dict:
    return {
        "esquema": ESQUEMA,
        "generado": comun.iso(comun.ahora_utc()),
        "marca": "programado",
        "que": "Buses troncales programados por hora en cada tramo entre estaciones vecinas, sumando los dos sentidos, "
               "y buses que paran en cada estación. Sale de la programación publicada (GTFS), no de los buses en la calle.",
        "fuente": dict(fuente, nombre="TransMilenio S.A., GTFS estático del SITP", vigencia=datos["vigencia"]),
        "licencia": licencia,
        "etiquetas": {"buses_por_hora": "inferido", "geometria": "de_fuente"},
        "tipos_dia": TIPOS_DIA,
        "festivos": datos["festivos"],
        "totales": datos["totales"],
        "corrida": comun.corrida(),
        "estaciones": datos["estaciones"],
        "tramos": datos["tramos"],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", type=Path, required=True)
    ap.add_argument("--nombre", default="troncal.json")
    ap.add_argument("--zip", type=Path, help="GTFS ya bajado")
    ap.add_argument("--sin-red", action="store_true", help="con --zip: no consulta la licencia (pruebas)")
    a = ap.parse_args()
    destino = a.salida / a.nombre
    anterior = comun.leer_json(destino) or {}

    if a.zip:
        fuente = {"archivo": a.zip.name, "url": BUCKET + a.zip.name, "bytes": a.zip.stat().st_size,
                  "sha256": comun.sha256(a.zip), "modificado": None}
        licencia = anterior.get("licencia") or {"id": "CC-BY-SA-4.0", "nombre": "Creative Commons Attribution Share-Alike 4.0",
                                                "url": LICENCIA_URL["CC-BY-SA-4.0"], "ficha": FICHA, "revisada": None}
        if not a.sin_red:
            try:
                licencia = licencia_de_ficha()
            except LicenciaNoAceptada as exc:
                print(f"::error::La licencia del GTFS cambió ({exc}).")
                return 1
            except Exception as exc:
                print(f"::warning::Ficha sin respuesta ({type(exc).__name__}); queda la licencia anterior")
            try:
                ultimo = ultimo_del_bucket()
                if ultimo["archivo"] == a.zip.name and ultimo["bytes"] == fuente["bytes"]:
                    fuente["modificado"] = ultimo["modificado"]
            except Exception:
                pass
        datos = calcular(a.zip)
    else:
        try:
            licencia = licencia_de_ficha()
        except LicenciaNoAceptada as exc:
            print(f"::error::La licencia del GTFS cambió ({exc}). No se publica nada nuevo.")
            return 1
        except Exception as exc:
            # Sin respuesta de la ficha: vale la última revisión si existe.
            if not anterior.get("licencia"):
                print(f"::error::No se pudo leer la licencia ({type(exc).__name__}) y no hay una revisión anterior.")
                return 1
            licencia = anterior["licencia"]
            print(f"::warning::Ficha sin respuesta ({type(exc).__name__}); vale la licencia revisada el {licencia.get('revisada')}")
        nuevo = ultimo_del_bucket()
        fa = anterior.get("fuente") or {}
        if fa.get("archivo") == nuevo["archivo"] and fa.get("bytes") == nuevo["bytes"] and anterior.get("esquema") == ESQUEMA:
            print(f"{nuevo['archivo']} ya está publicado; no se baja de nuevo.")
            return 0
        with tempfile.TemporaryDirectory() as tmp:
            zp = Path(tmp) / nuevo["archivo"]
            print(f"Bajando {nuevo['url']} ({nuevo['bytes'] / 1e6:.1f} MB)")
            nuevo["sha256"] = bajar_a(nuevo["url"], zp)
            datos = calcular(zp)
        fuente = nuevo
    doc = armar(datos, fuente, licencia)
    if not doc["tramos"]:
        print("::error::El GTFS no dio ningún tramo troncal; no se publica.")
        return 1
    tam = comun.escribir_json(destino, doc)
    print(f"{destino}: {tam} B, {datos['totales']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
