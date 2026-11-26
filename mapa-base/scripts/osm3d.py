"""Piezas 3D de OpenStreetMap (ODbL) para los edificios emblemáticos de Bogotá.

Lee el GeoJSONSeq que exporta osmium (building y building:part con sus etiquetas) y escribe
las piezas que el visor dibuja encima de Catastro, más la lista de construcciones de Catastro
que quedan tapadas. No une nada con Catastro: Catastro solo se LEE para comparar alturas y para
saber qué cajas esconder; en el archivo de salida no va ni una geometría ni un dato suyo, solo
los números de sus construcciones (ids de tesela) y el alto de referencia en el reporte.

Qué entra
  * building:part con height, min_height, roof:shape, roof:height o niveles.
  * building con height, min_height o techo que no sea plano, si no tiene partes con datos
    adentro (si las tiene, la regla de OSM es dibujar las partes y no el contorno).
Alturas
  * alto: height (en metros, como está en OSM); si falta, niveles × 3 m (el mismo supuesto de
    Catastro) más roof:levels × 3 m, o más el alto del techo inclinado si no hay roof:levels. base: min_height; si falta, building:min_level × 3 m.
  * Piezas apiladas con un hueco de hasta 6 m entre la de abajo y la de arriba (BD Bacatá Torre
    Sur, 54 → 59 m): la de abajo sube hasta la base de la de arriba y queda marcada.
Comparación con Catastro (pisos × 3 m, un supuesto)
  * Cada pieza se compara con la construcción de Catastro que más huella le comparte. Si el
    alto difiere más de 30 %, queda marcada. Se usa la de OSM si es coherente: (a) height y
    niveles de OSM concuerdan (de 2,4 a 6 m por nivel), o (b) la pieza es parte de un conjunto
    modelado a mano (dos o más piezas 3D del mismo edificio), o (c) no hay Catastro debajo.
    Si no es coherente, la pieza no se dibuja y se queda la caja de Catastro.
Techos (aproximados, supuesto): pyramidal, hipped, dome, onion, gabled, skillion, cone y round
  se arman en escalones: el cuerpo hasta el arranque del techo y 4 anillos cada vez más chicos.
  roof:height si está; si no, roof:levels × 3 m; si no, un valor por forma (ver alto_techo).
Cajas de Catastro tapadas: una construcción z16 se esconde si las piezas cubren al menos la
  mitad de su huella (muestreo en una grilla de 1 m); las huellas unidas de z14 y z15, igual.

Uso: python3 -I osm3d.py ENTRADA.geojsonseq CATASTRO.pmtiles SALIDA.geojsonseq OCULTAS.json REPORTE.json
"""
import gzip
import json
import math
import re
import subprocess
import sys
from collections import Counter, defaultdict

PISO_M = 3.0
UMBRAL = 0.30          # diferencia relativa con Catastro que marca la pieza
HUECO_MAX = 6.0        # m: hueco entre piezas apiladas que se cierra
CUBRE = 0.5            # fracción de la huella de Catastro cubierta para esconderla
M_POR_NIVEL = (2.4, 6.0)
PASOS_TECHO = 4
FORMAS = {'pyramidal', 'hipped', 'dome', 'onion', 'gabled', 'skillion', 'cone', 'round', 'half-hipped', 'gambrel', 'mansard'}
NUM = re.compile(r"^\s*(-?\d+(?:[.,]\d+)?)\s*(m|mt|mts|metros)?\s*$", re.I)
LAT0 = 4.65
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0


def numero(v):
    if v is None:
        return None
    m = NUM.match(str(v))
    return float(m.group(1).replace(',', '.')) if m else None


def aplanar(geom):
    """Lista de polígonos, cada uno lista de anillos [[lon, lat], ...]."""
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def a_m(p):
    return ((p[0]) * KX, (p[1]) * KY)


def area_anillo(r):
    a = 0.0
    for i in range(len(r) - 1):
        a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
    return a / 2


def caja(anillos):
    xs = [p[0] for r in anillos for p in r]
    ys = [p[1] for r in anillos for p in r]
    return (min(xs), min(ys), max(xs), max(ys))


def dentro(x, y, anillos):
    """Par-impar sobre todos los anillos: los huecos quedan afuera solos."""
    si = False
    for r in anillos:
        n = len(r)
        j = n - 1
        for i in range(n):
            xi, yi = r[i]
            xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                si = not si
            j = i
    return si


def centroide(anillo):
    a = cx = cy = 0.0
    for i in range(len(anillo) - 1):
        x0, y0 = anillo[i]
        x1, y1 = anillo[i + 1]
        k = x0 * y1 - x1 * y0
        a += k
        cx += (x0 + x1) * k
        cy += (y0 + y1) * k
    if abs(a) < 1e-12:
        return anillo[0]
    return (cx / (3 * a), cy / (3 * a))


def muestras(anillos_m, paso):
    x0, y0, x1, y1 = caja(anillos_m)
    pts = []
    y = y0 + paso / 2
    while y < y1:
        x = x0 + paso / 2
        while x < x1:
            if dentro(x, y, anillos_m):
                pts.append((x, y))
            x += paso
        y += paso
    return pts


def paso_para(anillos_m, tope=600):
    x0, y0, x1, y1 = caja(anillos_m)
    area = max(1.0, (x1 - x0) * (y1 - y0))
    return max(1.0, math.sqrt(area / tope))


class Rejilla:
    """Índice espacial simple: celdas de CELDA metros con lo que toca cada una."""
    CELDA = 60.0

    def __init__(self):
        self.c = defaultdict(list)

    def _rango(self, bb):
        k = self.CELDA
        return range(int(bb[0] // k), int(bb[2] // k) + 1), range(int(bb[1] // k), int(bb[3] // k) + 1)

    def poner(self, bb, cosa):
        xs, ys = self._rango(bb)
        for i in xs:
            for j in ys:
                self.c[(i, j)].append((bb, cosa))

    def en(self, x, y):
        for bb, cosa in self.c.get((int(x // self.CELDA), int(y // self.CELDA)), ()):
            if bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3]:
                yield cosa

    def toca(self, bb):
        xs, ys = self._rango(bb)
        visto = set()
        for i in xs:
            for j in ys:
                for b2, cosa in self.c.get((i, j), ()):
                    if id(cosa) not in visto and not (b2[2] < bb[0] or b2[0] > bb[2] or b2[3] < bb[1] or b2[1] > bb[3]):
                        visto.add(id(cosa))
                        yield cosa


def aviso(*a):
    print(*a, file=sys.stderr, flush=True)


# ── Lectura de OSM ───────────────────────────────────────────────────────────

def leer(ruta):
    for linea in open(ruta, encoding='utf-8'):
        linea = linea.strip('\x1e\n ')
        if linea:
            yield json.loads(linea)


def tiene_3d(p, es_parte):
    forma = p.get('roof:shape')
    if any(k in p for k in ('height', 'min_height', 'roof:height')):
        return True
    if forma and forma != 'flat':
        return True
    if es_parte and any(k in p for k in ('building:levels', 'building:min_level')):
        return True
    return False


def alturas(p):
    alto = numero(p.get('height'))
    niveles = numero(p.get('building:levels'))
    nivel_min = numero(p.get('building:min_level'))
    techo_niv = numero(p.get('roof:levels')) or 0
    fuente = 'height'
    if alto is None and niveles is not None:
        alto = (niveles + techo_niv) * PISO_M
        fuente = 'niveles'
    base = numero(p.get('min_height'))
    fuente_base = 'min_height'
    if base is None and nivel_min is not None:
        base = nivel_min * PISO_M
        fuente_base = 'min_level'
    if base is None:
        base, fuente_base = 0.0, 'suelo'
    return alto, base, fuente, fuente_base, niveles, nivel_min


def alto_techo(p, forma, alto, base, r_eq):
    rh = numero(p.get('roof:height'))
    if rh is None and numero(p.get('roof:levels')):
        rh = numero(p.get('roof:levels')) * PISO_M
    supuesto = rh is None
    if rh is None:
        cuerpo = max(0.0, alto - base)
        if forma in ('dome', 'onion', 'round'):
            rh = min(r_eq, 0.6 * cuerpo)
        elif forma == 'cone':
            rh = min(2 * r_eq, 0.6 * cuerpo)
        else:   # pyramidal, hipped, gabled...: unos 30° sobre el radio, sin pasar un tercio del alto
            rh = min(0.6 * r_eq, cuerpo / 3)
    rh = max(0.0, min(rh, alto - base))
    return rh, supuesto


# ── Techos en escalones ──────────────────────────────────────────────────────

def escalar(anillos, c, sx, sy, eje):
    """Escala alrededor de c. eje (coseno, seno) gira la escala: sx a lo largo, sy de través."""
    ca, sa = eje
    salida = []
    for r in anillos:
        nr = []
        for x, y in r:
            dx, dy = x - c[0], y - c[1]
            u = dx * ca + dy * sa
            v = -dx * sa + dy * ca
            u *= sx
            v *= sy
            nr.append([c[0] + u * ca - v * sa, c[1] + u * sa + v * ca])
        salida.append(nr)
    return salida


def eje_largo(anillo_m):
    """Dirección del lado más largo (la cumbrera de un techo a dos aguas va por ahí)."""
    mejor, eje = -1, (1.0, 0.0)
    for i in range(len(anillo_m) - 1):
        dx = anillo_m[i + 1][0] - anillo_m[i][0]
        dy = anillo_m[i + 1][1] - anillo_m[i][1]
        d = math.hypot(dx, dy)
        if d > mejor:
            mejor, eje = d, (dx / d, dy / d) if d else (1.0, 0.0)
    return eje


def techo_en_escalones(anillos_ll, forma, arranque, alto):
    """Lista de (anillos, base, alto) para el techo, de abajo arriba."""
    m = [[a_m(p) for p in r] for r in anillos_ll]
    c = centroide(m[0])
    eje = eje_largo(m[0])
    piezas = []
    rh = alto - arranque
    for i in range(PASOS_TECHO):
        b = arranque + rh * i / PASOS_TECHO
        t = arranque + rh * (i + 1) / PASOS_TECHO
        # Ancho del escalón a media altura del escalón, según el perfil de la forma.
        f = (i + 0.5) / PASOS_TECHO
        if forma in ('dome', 'round'):
            s = math.sqrt(max(0.0, 1 - f * f))
        elif forma == 'onion':
            s = min(1.15, math.sin(math.pi * (0.35 + 0.65 * f)) * 1.15) * (1 - f) ** 0.3
        else:
            s = 1 - f
        s = max(0.08, s)
        if forma in ('gabled', 'gambrel', 'round', 'half-hipped'):
            sx, sy = (1.0, s)          # a dos aguas: se angosta solo de través
        elif forma == 'skillion':
            sx, sy = (1.0, s)
        else:
            sx, sy = (s, s)
        em = escalar(m, c, sx, sy, eje)
        ll = [[[x / KX, y / KY] for x, y in r] for r in em]
        piezas.append((ll, b, t))
    return piezas


# ── Teselas de Catastro ──────────────────────────────────────────────────────

def varint(b, p):
    r = s = 0
    while True:
        c = b[p]
        p += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, p


def campos(b, a, z):
    p = a
    while p < z:
        k, p = varint(b, p)
        f, t = k >> 3, k & 7
        if t == 0:
            v, p = varint(b, p)
            yield f, v
        elif t == 2:
            n, p = varint(b, p)
            yield f, (p, p + n)
            p += n
        elif t == 5:
            p += 4
        elif t == 1:
            p += 8


def zz(v):
    return (v >> 1) ^ -(v & 1)


def leer_tesela(b, capa_buscada):
    """[(id, {props}, anillos en unidades de tesela, extensión)] de la capa pedida."""
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    salida = []
    for f, v in campos(b, 0, len(b)):
        if f != 3:
            continue
        nombre, claves, valores, feats, ext = None, [], [], [], 4096
        for g, w in campos(b, *v):
            if g == 1:
                nombre = b[w[0]:w[1]].decode()
            elif g == 3:
                claves.append(b[w[0]:w[1]].decode())
            elif g == 4:
                val = None
                for h, x in campos(b, *w):
                    if h == 1:
                        val = b[x[0]:x[1]].decode()
                    elif h in (4, 5):
                        val = x
                    elif h == 6:
                        val = zz(x)
                valores.append(val)
            elif g == 2:
                feats.append(w)
            elif g == 5:
                ext = w
        if nombre != capa_buscada:
            continue
        for w in feats:
            fid, tags, geom = None, [], []
            for h, x in campos(b, *w):
                if h == 1:
                    fid = x
                elif h == 2:
                    q = x[0]
                    while q < x[1]:
                        t, q = varint(b, q)
                        tags.append(t)
                elif h == 4:
                    q = x[0]
                    while q < x[1]:
                        t, q = varint(b, q)
                        geom.append(t)
            props = {claves[tags[i]]: valores[tags[i + 1]] for i in range(0, len(tags), 2)}
            anillos, cx, cy, i, actual = [], 0, 0, 0, None
            while i < len(geom):
                cmd, n = geom[i] & 7, geom[i] >> 3
                i += 1
                if cmd in (1, 2):
                    for _ in range(n):
                        cx += zz(geom[i])
                        cy += zz(geom[i + 1])
                        i += 2
                        if cmd == 1:
                            actual = [(cx, cy)]
                            anillos.append(actual)
                        else:
                            actual.append((cx, cy))
                elif cmd == 7 and actual:
                    actual.append(actual[0])
            salida.append((fid, props, anillos, ext))
    return salida


def tesela_de(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def a_lonlat(z, x, y, ext, px, py):
    n = 2 ** z
    lon = (x + px / ext) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / n))))
    return lon, lat


def bajar_tesela(archivo, z, x, y):
    r = subprocess.run(['pmtiles', 'tile', archivo, str(z), str(x), str(y)], capture_output=True, check=False)
    return r.stdout if r.returncode == 0 else b''


# ── Principal ────────────────────────────────────────────────────────────────

def main(entrada, catastro, salida, ocultas_ruta, reporte_ruta):
    partes, edificios = [], []
    for f in leer(entrada):
        p = f['properties']
        es_parte = 'building:part' in p
        if p.get('building:part') == 'no' or not tiene_3d(p, es_parte):
            if not es_parte and 'building' in p:
                edificios.append(f)    # contorno sin datos 3D: sirve para el nombre de sus partes
            continue
        f['_parte'] = es_parte
        (partes if es_parte else edificios).append(f)

    # Contornos de edificio (con o sin datos 3D) para saber a quién pertenece cada parte.
    contornos = Rejilla()
    for f in edificios:
        for poli in aplanar(f['geometry']):
            m = [[a_m(q) for q in r] for r in poli]
            contornos.poner(caja(m), (m, f))
    candidatos = [f for f in partes] + [f for f in edificios if '_parte' in f]

    def edificio_de(f):
        poli = aplanar(f['geometry'])[0]
        c = centroide([a_m(q) for q in poli[0]])
        mejor = None
        for m, e in contornos.en(c[0], c[1]):
            if e is f:
                continue
            if dentro(c[0], c[1], m):
                a = abs(area_anillo(m[0]))
                if mejor is None or a < mejor[0]:
                    mejor = (a, e)
        return mejor[1] if mejor else None

    piezas = []      # una por polígono, antes de los techos
    partes_de = defaultdict(list)
    for f in partes:
        e = edificio_de(f)
        f['_edif'] = e
        if e is not None:
            partes_de[id(e)].extend([[a_m(q) for q in r] for r in poli] for poli in aplanar(f['geometry']))
    con_partes = set()
    for f in candidatos:
        if f['_parte'] or id(f) not in partes_de:
            continue
        # Regla de OSM: si el edificio tiene partes, se dibujan las partes y no el contorno. Pero
        # muchas veces solo está la cúpula o la torre; si las partes no cubren al menos 80 % del
        # contorno, el contorno también se dibuja (con su propio alto) para que no quede flotando.
        cuenta = si = 0
        for poli in aplanar(f['geometry']):
            m = [[a_m(q) for q in r] for r in poli]
            for xm, ym in muestras(m, paso_para(m, 300)):
                cuenta += 1
                si += any(dentro(xm, ym, pm) for pm in partes_de[id(f)])
        if cuenta and si / cuenta >= 0.8:
            con_partes.add(id(f))
        else:
            f['_bajo_partes'] = True
    for f in candidatos:
        p = f['properties']
        if not f['_parte'] and id(f) in con_partes:
            continue      # el contorno de un edificio con partes no se dibuja
        alto, base, fuente, fuente_base, niveles, nivel_min = alturas(p)
        if alto is None:
            continue
        e = f.get('_edif')
        nombre = p.get('name') or (e['properties'].get('name') if e else None) or ''
        for poli in aplanar(f['geometry']):
            if not poli or len(poli[0]) < 4:
                continue
            piezas.append({
                'osm': f"{p.get('@type', 'way')}/{p.get('@id', '')}", 'edif': id(e) if e else id(f),
                'nombre': nombre, 'anillos': poli, 'alto': alto, 'base': base, 'fuente': fuente,
                'fuente_base': fuente_base, 'niveles': niveles, 'nivel_min': nivel_min,
                'forma': p.get('roof:shape') or 'flat', 'tags': p, 'parte': f['_parte'] or f.get('_bajo_partes', False), 'avisos': []})

    for x in piezas:
        x['m'] = [[a_m(q) for q in r] for r in x['anillos']]
        x['caja'] = caja(x['m'])
        x['c'] = centroide(x['m'][0])
    # Con niveles y sin height, el techo inclinado va encima de los niveles (en OSM,
    # building:levels no cuenta el techo). roof:levels ya entró en alturas().
    for x in piezas:
        forma = x['forma']
        if x['fuente'] == 'niveles' and forma in FORMAS and numero(x['tags'].get('roof:levels')) is None:
            r_eq = math.sqrt(abs(area_anillo(x['m'][0])) / math.pi)
            rh = numero(x['tags'].get('roof:height'))
            if rh is None:
                rh = min(0.6 * r_eq, (x['alto'] - x['base']) / 3)
            x['techo_m'] = max(0.0, rh)
            x['techo_supuesto'] = numero(x['tags'].get('roof:height')) is None
            x['alto'] += x['techo_m']
            x['fuente'] = 'niveles+techo'
    # Conjuntos modelados a mano: dos o más piezas (partes, o el edificio que las lleva) que se
    # tocan o son del mismo edificio. Ahí la forma la dibujó alguien a propósito, pieza por pieza.
    padre = list(range(len(piezas)))

    def raiz_de(i):
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i
    rejp = Rejilla()
    for i, x in enumerate(piezas):
        if x['parte']:
            rejp.poner(x['caja'], i)
    for i, x in enumerate(piezas):
        if not x['parte']:
            continue
        for j in rejp.toca(x['caja']):
            y = piezas[j]
            if j != i and (x['edif'] == y['edif'] or dentro(x['c'][0], x['c'][1], y['m']) or dentro(y['c'][0], y['c'][1], x['m'])):
                padre[raiz_de(i)] = raiz_de(j)
    tam = Counter(raiz_de(i) for i in range(len(piezas)))
    for i, x in enumerate(piezas):
        x['conjunto'] = x['parte'] and tam[raiz_de(i)] >= 2

    # Huecos entre piezas apiladas (la de arriba empieza un poco más arriba de donde acaba la de abajo).
    for arriba in piezas:
        if arriba['base'] <= 0:
            continue
        for abajo in piezas:
            if abajo is arriba:
                continue
            hueco = arriba['base'] - abajo['alto']
            if 0 < hueco <= HUECO_MAX and abajo['base'] < arriba['base'] and dentro(arriba['c'][0], arriba['c'][1], abajo['m']):
                abajo['avisos'].append(f"hueco de {hueco:.1f} m con la pieza de arriba, cerrado aquí")
                abajo['alto_osm'] = abajo['alto']
                abajo['alto'] = arriba['base']

    # Catastro: teselas z16 que tocan las piezas.
    t16 = set()
    for x in piezas:
        x0, y0, x1, y1 = x['caja']
        a = tesela_de(x0 / KX, y1 / KY, 16)
        b = tesela_de(x1 / KX, y0 / KY, 16)
        for tx in range(a[0], b[0] + 1):
            for ty in range(a[1], b[1] + 1):
                t16.add((tx, ty))
    cat16 = []   # (id, pisos, anillos en m, caja)
    aviso(f'{len(piezas)} piezas, {len(t16)} teselas z16 de Catastro')
    for (tx, ty) in sorted(t16):
        for fid, props, anillos, ext in leer_tesela(bajar_tesela(catastro, 16, tx, ty), 'construcciones'):
            if 'tono' not in props or not anillos:
                continue
            # Solo lo que cae dentro de la tesela (sin el margen) para no contar dos veces.
            m = [[a_m(a_lonlat(16, tx, ty, ext, min(max(px, 0), ext), min(max(py, 0), ext))) for px, py in r] for r in anillos]
            if abs(sum(area_anillo(r) for r in m)) < 0.5:
                continue
            cat16.append((fid, int(props.get('pisos') or 1), m, caja(m)))

    rej16 = Rejilla()
    for c16 in cat16:
        rej16.poner(c16[3], c16)

    def bajo(xm, ym, _lista=None):
        for fid, pisos, m, bb in rej16.en(xm, ym):
            if dentro(xm, ym, m):
                yield fid, pisos

    # Comparación pieza por pieza con la construcción que más huella le comparte.
    for x in piezas:
        cuenta = Counter()
        pisos_de = {}
        pts = muestras(x['m'], paso_para(x['m']))
        for xm, ym in pts:
            for fid, pisos in bajo(xm, ym, cat16):
                cuenta[fid] += 1
                pisos_de[fid] = pisos
        if not cuenta:
            x['cat_m'] = None
            x['decision'] = 'osm-sin-catastro'
            continue
        fid, _ = cuenta.most_common(1)[0]
        cat_m = pisos_de[fid] * PISO_M
        x['cat_m'] = cat_m
        dif = (x['alto'] - cat_m) / cat_m
        x['dif'] = round(dif, 3)
        if abs(dif) <= UMBRAL:
            x['decision'] = 'osm'
            continue
        por_nivel = None
        if x['fuente'] == 'height' and x['niveles']:
            niveles = x['niveles'] - (x['nivel_min'] or 0)
            if niveles > 0:
                por_nivel = (x['alto'] - x['base']) / niveles
        if por_nivel is not None and M_POR_NIVEL[0] <= por_nivel <= M_POR_NIVEL[1]:
            x['decision'] = 'osm-coherente'
        elif x['conjunto']:
            x['decision'] = 'osm-conjunto'
        else:
            x['decision'] = 'catastro'
        x['avisos'].append(f"Catastro dibuja {cat_m:.0f} m; OSM {x['alto']:.0f} m ({dif * 100:+.0f} %)")

    dibujadas = [x for x in piezas if x['decision'] != 'catastro']
    rejd = Rejilla()
    for x in dibujadas:
        rejd.poner(x['caja'], x)
    aviso('comparación lista; buscando cajas tapadas')

    # Cajas de Catastro tapadas (z16): cubiertas al menos la mitad por las piezas que se dibujan.
    def cubierta(m_cat, paso=1.0):
        pts = muestras(m_cat, max(paso, paso_para(m_cat, 400)))
        if not pts:
            return 0.0
        si = 0
        for xm, ym in pts:
            for x in rejd.en(xm, ym):
                if dentro(xm, ym, x['m']):
                    si += 1
                    break
        return si / len(pts)

    area_cubierta = defaultdict(float)
    area_total = defaultdict(float)
    for fid, pisos, m, bb in cat16:
        a = abs(sum(area_anillo(r) for r in m))
        area_total[fid] += a
        if next(rejd.toca(bb), None) is not None:
            area_cubierta[fid] += a * cubierta(m)
    ocultas16 = sorted(fid for fid in area_total if area_cubierta[fid] / area_total[fid] >= CUBRE)

    # Huellas unidas de lejos (z14 y z15): las mismas reglas, por tesela.
    ocultas_lejos = set()
    for z in (15, 14):
        tz = {(tx >> (16 - z), ty >> (16 - z)) for tx, ty in t16}
        cub, tot = defaultdict(float), defaultdict(float)
        for (tx, ty) in sorted(tz):
            for fid, props, anillos, ext in leer_tesela(bajar_tesela(catastro, z, tx, ty), 'construcciones'):
                if 'tono' in props or not anillos:
                    continue
                m = [[a_m(a_lonlat(z, tx, ty, ext, min(max(px, 0), ext), min(max(py, 0), ext))) for px, py in r] for r in anillos]
                bb = caja(m)
                if next(rejd.toca(bb), None) is None:
                    continue
                a = abs(sum(area_anillo(r) for r in m))
                if a < 0.5:
                    continue
                tot[fid] += a
                cub[fid] += a * cubierta(m, 2.0)
        ocultas_lejos |= {fid for fid in tot if cub[fid] / tot[fid] >= CUBRE}

    # Salida: cuerpo y escalones del techo.
    n_techos = 0
    with open(salida, 'w', encoding='utf-8') as out:
        for i, x in enumerate(dibujadas):
            forma = x['forma'] if x['forma'] in FORMAS else 'flat'
            r_eq = math.sqrt(abs(area_anillo(x['m'][0])) / math.pi)
            if forma == 'flat':
                rh, techo_supuesto = 0.0, False
            elif 'techo_m' in x:
                rh, techo_supuesto = x['techo_m'], x['techo_supuesto']
            else:
                rh, techo_supuesto = alto_techo(x['tags'], forma, x['alto'], x['base'], r_eq)
            arranque = x['alto'] - rh
            pisos = max(1, round(x['alto'] / PISO_M))
            tono = (int(re.sub(r'\D', '', x['osm']) or 0) * 2654435761 >> 7) % 16
            # Color de la lente «Cómo se ve» (comun.js): bajo 12 pisos-equivalentes, ladrillo solo
            # si OSM dice ladrillo; si no, pañete claro (tonos 13 a 15). Desde 12, concreto.
            mat = (x['tags'].get('building:material') or '') + (x['tags'].get('building:facade:material') or '')
            if pisos < 12 and 'brick' not in mat:
                tono = 13 + tono % 3
            elif pisos < 12:
                tono = tono % 13
            comun = {'id_osm': x['osm'], 'nombre': x['nombre'][:80], 'alto_total': round(x['alto'], 1),
                     'base_osm': round(x['base'], 1), 'fuente_alto': x['fuente'], 'fuente_base': x['fuente_base'],
                     'techo': forma, 'decision': x['decision'], 'pisos': pisos, 'tono': tono}
            # La comparación con Catastro (CC BY 4.0) queda en el reporte, no en la tesela: el
            # archivo es ODbL y no mezcla valores de Catastro (fuentes.html). Solo viaja la
            # decisión, que es nuestra, y los ids de las cajas que se esconden.
            avisos = [a for a in x['avisos'] if not a.startswith('Catastro')]
            if avisos:
                comun['aviso'] = '; '.join(avisos)[:200]
            if 'alto_osm' in x:
                comun['alto_osm'] = round(x['alto_osm'], 1)
            cuerpo = dict(comun, pieza='cuerpo', base=round(x['base'], 2), alto=round(arranque, 2))
            if arranque > x['base'] + 0.1:
                out.write(json.dumps({'type': 'Feature', 'properties': cuerpo,
                                      'geometry': {'type': 'Polygon', 'coordinates': x['anillos']}}, ensure_ascii=False) + '\n')
            if rh > 0.1:
                n_techos += 1
                for anillos, b, t in techo_en_escalones(x['anillos'], forma, arranque, x['alto']):
                    tp = dict(comun, pieza='techo', techo_supuesto=techo_supuesto, base=round(b, 2), alto=round(t, 2))
                    out.write(json.dumps({'type': 'Feature', 'properties': tp,
                                          'geometry': {'type': 'Polygon', 'coordinates': anillos}}, ensure_ascii=False) + '\n')

    ocultas = {'origen': 'osm-3d', 'catastro': 'catastro-pisos-bogota.pmtiles', 'cerca': ocultas16, 'lejos': sorted(ocultas_lejos)}
    with open(ocultas_ruta, 'w', encoding='utf-8') as f:
        json.dump(ocultas, f, separators=(',', ':'))
    rep = {
        'piezas': len(piezas), 'dibujadas': len(dibujadas), 'techos': n_techos,
        'decisiones': Counter(x['decision'] for x in piezas),
        'marcadas': [{k: x.get(k) for k in ('osm', 'nombre', 'alto', 'base', 'cat_m', 'dif', 'decision', 'fuente', 'niveles')} | {'avisos': x['avisos']}
                     for x in piezas if x['avisos']],
        'ocultas_cerca': len(ocultas16), 'ocultas_lejos': len(ocultas_lejos),
    }
    with open(reporte_ruta, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: rep[k] for k in ('piezas', 'dibujadas', 'techos', 'decisiones', 'ocultas_cerca', 'ocultas_lejos')}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) != 6:
        print(__doc__)
        sys.exit(2)
    main(*sys.argv[1:])
