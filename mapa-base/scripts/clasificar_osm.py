"""Clasifica el GeoJSONSeq exportado por osmium en las capas del mapa base.

Lee línea por línea (memoria constante) y escribe un GeoJSONSeq por capa con
propiedades mínimas y el bloque "tippecanoe" (capa y zoom mínimo).

Regla de alturas: altura_m solo sale de la etiqueta OSM `height` cuando es un
número en metros. `building:levels` se guarda aparte como pisos_osm y NUNCA se
convierte a metros. Si no hay `height` válido, altura_conocida = false.

Uso: python3 -I clasificar_osm.py ENTRADA.geojsonseq DIR_SALIDA ESTADISTICAS.json
"""
import json
import re
import sys
from collections import Counter

NUM_M = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(m|mt|mts|metros)?\s*$", re.I)
NUM_INT = re.compile(r"^\s*(\d+)\s*$")

VIAS = {
    "motorway": ("troncal", 8), "motorway_link": ("troncal", 10),
    "trunk": ("troncal", 8), "trunk_link": ("troncal", 10),
    "primary": ("primaria", 9), "primary_link": ("primaria", 11),
    "secondary": ("secundaria", 10), "secondary_link": ("secundaria", 12),
    "tertiary": ("terciaria", 12), "tertiary_link": ("terciaria", 13),
    "residential": ("local", 13), "unclassified": ("local", 13),
    "living_street": ("local", 13), "road": ("local", 13),
    "service": ("servicio", 14), "track": ("rural", 13),
    "pedestrian": ("peatonal", 13), "footway": ("peatonal", 14),
    "path": ("peatonal", 14), "steps": ("peatonal", 14),
    "cycleway": ("ciclorruta", 13), "busway": ("troncal", 10),
}

VERDE = {
    ("boundary", "protected_area"): ("reserva", 7),
    ("boundary", "national_park"): ("reserva", 7),
    ("leisure", "nature_reserve"): ("reserva", 7),
    ("landuse", "forest"): ("bosque", 9),
    ("natural", "wood"): ("bosque", 9),
    ("leisure", "park"): ("parque", 10),
    ("leisure", "garden"): ("jardin", 13),
    ("landuse", "recreation_ground"): ("parque", 11),
    ("leisure", "golf_course"): ("parque", 11),
    ("landuse", "grass"): ("pasto", 13),
    ("natural", "grassland"): ("pasto", 12),
    ("landuse", "meadow"): ("pasto", 12),
    ("natural", "scrub"): ("matorral", 11),
    ("natural", "heath"): ("paramo", 9),
}

AGUA_LINEA = {"river": ("rio", 9), "canal": ("canal", 11), "stream": ("quebrada", 12),
              "drain": ("canal", 13), "ditch": ("canal", 14)}


def num_m(v):
    if v is None:
        return None
    m = NUM_M.match(v)
    if not m:
        return None
    x = float(m.group(1).replace(",", "."))
    return round(x, 1) if 0 < x < 400 else None


def area(geom):
    return geom["type"] in ("Polygon", "MultiPolygon")


def main(entrada, dir_salida, estad):
    capas = {n: open(f"{dir_salida}/{n}.geojsonseq", "w") for n in
             ("vias", "edificios", "agua", "verde")}
    c = Counter()

    def emitir(capa, geom, props, minzoom):
        feat = {"type": "Feature", "geometry": geom, "properties": props,
                "tippecanoe": {"layer": capa, "minzoom": minzoom}}
        capas[capa].write(json.dumps(feat, ensure_ascii=False, separators=(",", ":")) + "\n")
        c[f"{capa}"] += 1

    with open(entrada, encoding="utf-8") as f:
        for linea in f:
            linea = linea.lstrip("\x1e").strip()
            if not linea:
                continue
            ft = json.loads(linea)
            t = ft.get("properties") or {}
            g = ft.get("geometry")
            if not g:
                continue
            nombre = t.get("name")

            if "building" in t and area(g) and t.get("building") != "no":
                alt = num_m(t.get("height"))
                pisos = t.get("building:levels")
                pisos = int(NUM_INT.match(pisos).group(1)) if pisos and NUM_INT.match(pisos) else None
                p = {"altura_conocida": alt is not None,
                     "fuente_altura": "osm:height" if alt is not None else "desconocida"}
                if alt is not None:
                    p["altura_m"] = alt
                    mh = num_m(t.get("min_height"))
                    if mh is not None and mh < alt:
                        p["min_altura_m"] = mh
                if pisos is not None:
                    p["pisos_osm"] = pisos
                if t.get("building") not in (None, "yes"):
                    p["tipo"] = t["building"]
                c["edif_height"] += alt is not None
                c["edif_levels"] += pisos is not None
                c["edif_height_invalido"] += (t.get("height") is not None and alt is None)
                emitir("edificios", g, p, 15)
                continue

            hw = t.get("highway")
            if hw in VIAS and not area(g):
                clase, z = VIAS[hw]
                p = {"clase": clase, "tipo": hw}
                if nombre:
                    p["nombre"] = nombre
                if t.get("bridge") not in (None, "no"):
                    p["puente"] = True
                if t.get("tunnel") not in (None, "no"):
                    p["tunel"] = True
                emitir("vias", g, p, z)
                continue

            ww = t.get("waterway")
            if ww in AGUA_LINEA and not area(g):
                clase, z = AGUA_LINEA[ww]
                p = {"clase": clase}
                if nombre:
                    p["nombre"] = nombre
                emitir("agua", g, p, z)
                continue
            if area(g) and (t.get("natural") == "water" or t.get("landuse") in ("reservoir", "basin")
                            or t.get("waterway") == "riverbank" or t.get("natural") == "wetland"):
                clase = "humedal" if t.get("natural") == "wetland" else "cuerpo"
                p = {"clase": clase}
                if nombre:
                    p["nombre"] = nombre
                emitir("agua", g, p, 8 if clase == "cuerpo" else 10)
                continue

            if area(g):
                for (k, v), (clase, z) in VERDE.items():
                    if t.get(k) == v:
                        p = {"clase": clase}
                        if nombre:
                            p["nombre"] = nombre
                        emitir("verde", g, p, z)
                        break
                else:
                    c["descartado"] += 1
            else:
                c["descartado"] += 1

    for fh in capas.values():
        fh.close()
    with open(estad, "w") as fh:
        json.dump(dict(c), fh, indent=1, ensure_ascii=False)
    print(json.dumps(dict(c), ensure_ascii=False))


if __name__ == "__main__":
    main(*sys.argv[1:4])
