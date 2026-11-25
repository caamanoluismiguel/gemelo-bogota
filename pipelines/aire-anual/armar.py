#!/usr/bin/env python3
"""Arma los tres archivos de la capa «Aire de siempre» a partir de lo que bajó bajar.sh.

Uso: python3 -I pipelines/aire-anual/armar.py /ruta/de/la/descarga

Escribe en site/datos/aire/ (un archivo por fuente, nunca mezcladas, cada uno con su licencia):
  pm25-anual-2025.geojson   SDA, CC BY 4.0. Las 8 franjas tal cual, con 5 decimales (~1 m).
  colegios-sed.geojson      SED, CC BY-SA 4.0. Nombre, oficial o no, punto.
  salud-red-publica.geojson SDS, CC BY 4.0. Nombre de la sede y su subred, punto.
y procedencia.json con la URL, la fecha, el sha256 y la licencia de cada crudo y de cada producto.
No cruza colegios con franjas: ese cruce lo hace el navegador al tocar un punto.
"""
import hashlib
import json
import math
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SALIDA = os.path.join(RAIZ, 'site', 'datos', 'aire')
CAJA = (-74.5, 3.7, -73.9, 4.9)   # oeste, sur, este, norte: lo de fuera es un error de georreferencia
PORTAL = 'https://datosabiertos.bogota.gov.co'
FUENTES = {
    'pm25': {
        'crudo': 'pm25.geojson', 'ficha_json': 'ficha-pm25.json', 'producto': 'pm25-anual-2025.geojson',
        'url': PORTAL + '/dataset/a32d342a-fe03-44a9-b006-b5997a816f70/resource/d6b61b68-9e28-4b9e-91dd-1b4dbdce9e94/download/pm25_prom_anual.geojson',
        'ficha': PORTAL + '/dataset/pm-25-promedio-anual-bogota-d-c',
        'productor': 'Secretaría Distrital de Ambiente (SDA), Subdirección de Calidad del Aire, Auditiva y Visual',
        'metodo': ('Especificación técnica de la SDA: estaciones RMCAB con al menos 75 % de datos válidos, '
                   'interpoladas con kriging ordinario o universal; escala 1:150.000; solo área urbana. '
                   'El diccionario dice que Concentracion_PM25 es el valor que representa la franja, sin decir si es mínimo, máximo o promedio.'),
        'otras_evidencias': {
            'servicio_rest': 'https://mapas.ambientebogota.gov.co/server/rest/services/Calidad_aire/PM_25_promedio_anual_2025/MapServer',
            'copyrightText_del_servicio': 'Secretaría Distrital de Ambiente -Subdirección de Calidad del Aire, Auditiva y Visual',
            'especificacion_tecnica_1.1.6_restricciones': 'Ninguna',
        },
        'licencia': {'nombre': 'CC BY 4.0', 'url': 'https://creativecommons.org/licenses/by/4.0/'},
    },
    'colegios': {
        'crudo': 'colegios.geojson', 'ficha_json': 'ficha-colegios.json', 'producto': 'colegios-sed.geojson',
        'url': PORTAL + '/dataset/d451b52f-e30c-43b3-9066-3a7816638fea/resource/4cb45e38-779b-483b-acc4-5673c5db9505/download/colegios092026.geojson',
        'ficha': PORTAL + '/dataset/colegios-bogota-d-c',
        'productor': 'Secretaría de Educación del Distrito (SED), publicado por IDECA',
        'licencia': {'nombre': 'CC BY-SA 4.0', 'url': 'https://creativecommons.org/licenses/by-sa/4.0/'},
    },
    'salud': {
        'crudo': 'salud.geojson', 'ficha_json': 'ficha-salud.json', 'producto': 'salud-red-publica.geojson',
        'url': 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/salud/instituciones/MapServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
        'ficha': PORTAL + '/dataset/red-adscrita-de-salud-para-bogota',
        'productor': 'Secretaría Distrital de Salud (SDS)',
        'licencia': {'nombre': 'CC BY 4.0', 'url': 'https://creativecommons.org/licenses/by/4.0/'},
    },
}


def sha(ruta):
    with open(ruta, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def r5(x):
    return round(x, 5)


def limpiar_anillo(anillo):
    out = []
    for x, y in ((r5(c[0]), r5(c[1])) for c in anillo):
        if not out or out[-1] != [x, y]:
            out.append([x, y])
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def area_firmada(anillo):
    # Positiva si va contra las agujas del reloj (lon, lat), en grados cuadrados.
    return sum(anillo[i][0] * anillo[i + 1][1] - anillo[i + 1][0] * anillo[i][1] for i in range(len(anillo) - 1)) / 2


def en_anillo(x, y, anillo):
    dentro = False
    j = len(anillo) - 1
    for i in range(len(anillo)):
        xi, yi = anillo[i]
        xj, yj = anillo[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            dentro = not dentro
        j = i
    return dentro


MIN_GRADOS2 = 1e-9   # ~0,01 m²: anillos que son una línea de ida y vuelta


def rehacer_poligonos(polis):
    """El GeoJSON del portal mete varias partes exteriores en un mismo polígono, como si fueran
    huecos. Un visor que sigue la norma GeoJSON trata todo anillo después del primero como hueco
    y no dibujaría esas partes. Se separan por el sentido de giro: contra el reloj es exterior y
    a favor es hueco (así vienen en el archivo); cada hueco va con el exterior que lo contiene."""
    exteriores, huecos = [], []
    for poli in polis:
        for r in poli:
            a = limpiar_anillo(r)
            if not a:
                continue
            s = area_firmada(a)
            if abs(s) < MIN_GRADOS2:
                continue
            (exteriores if s > 0 else huecos).append(a)
    salida = [[e] for e in exteriores]
    for h in huecos:
        x, y = h[0]
        dueños = [i for i, e in enumerate(exteriores) if en_anillo(x, y, e)]
        assert dueños, 'hueco sin exterior'
        # El exterior más chico que lo contiene.
        i = min(dueños, key=lambda i: abs(area_firmada(exteriores[i])))
        salida[i].append(h)
    return salida


def armar_pm25(g):
    feats = []
    for f in g['features']:
        p = f['properties']
        assert p['Ano'] == 2025 and p['Periodo_de_interes'] == 'Anual', p
        geom = f['geometry']
        polis = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        nuevos = rehacer_poligonos(polis)
        # El área que resulta debe cuadrar con la que trae la SDA en grados² (st_area_shape_).
        area = sum(abs(area_firmada(pl[0])) - sum(abs(area_firmada(h)) for h in pl[1:]) for pl in nuevos)
        assert abs(area - p['st_area_shape_']) / p['st_area_shape_'] < 0.01, (p['Concentracion_PM25'], area, p['st_area_shape_'])
        feats.append({'type': 'Feature', 'id': int(p['Id_Concentracion']),
                      'properties': {'franja': int(p['Id_Concentracion']), 'pm25': round(float(p['Concentracion_PM25']), 2)},
                      'geometry': {'type': 'MultiPolygon', 'coordinates': nuevos}})
    feats.sort(key=lambda f: f['properties']['pm25'])
    return feats


def de_3857(x, y):
    lon = x / 6378137.0 * 180 / math.pi
    lat = (2 * math.atan(math.exp(y / 6378137.0)) - math.pi / 2) * 180 / math.pi
    return lon, lat


def dentro_caja(lon, lat):
    return CAJA[0] <= lon <= CAJA[2] and CAJA[1] <= lat <= CAJA[3]


def armar_colegios(g):
    crs = (g.get('crs') or {}).get('properties', {}).get('name', '')
    assert '3857' in crs, crs
    feats, fuera = [], 0
    for f in g['features']:
        p = f['properties']
        lon, lat = de_3857(*f['geometry']['coordinates'][:2])
        if not dentro_caja(lon, lat):
            fuera += 1
            continue
        est = (p.get('NOMBRE_EST') or '').strip()
        sede = (p.get('NOMBRE_SED') or '').strip()
        props = {'n': est}
        if sede and sede.upper() not in est.upper():
            props['s'] = sede
        # SECTOR 2 = oficial: 753 de sus 775 sedes llevan «(IED)» en el nombre y ninguna del 1 (inferido).
        props['o'] = 1 if p.get('SECTOR') == 2 else 0
        feats.append({'type': 'Feature', 'properties': props, 'geometry': {'type': 'Point', 'coordinates': [r5(lon), r5(lat)]}})
    return feats, fuera


def armar_salud(g):
    feats, fuera, sin_punto = [], 0, 0
    for f in g['features']:
        p = f['properties']
        c = (f.get('geometry') or {}).get('coordinates') or []
        if len(c) < 2:
            sin_punto += 1   # en el corte bajado, una sede (USS 65 Dindalito) viene sin coordenadas
            continue
        lon, lat = c[:2]
        if not dentro_caja(lon, lat):
            fuera += 1
            continue
        # «SUBRED INTEGRADA DE SERVICIOS DE SALUD SUR OCCIDENTE E.S.E» queda «Sur Occidente».
        subred = (p.get('NOMBRE_DE_') or '').upper().split('DE SALUD', 1)[-1].replace('E.S.E.', '').replace('E.S.E', '')
        feats.append({'type': 'Feature', 'properties': {'n': (p.get('NOMBRE_DEL') or '').strip(), 'r': ' '.join(subred.split()).title()},
                      'geometry': {'type': 'Point', 'coordinates': [r5(lon), r5(lat)]}})
    return feats, fuera, sin_punto


def escribir(nombre, feats, extra):
    fc = dict({'type': 'FeatureCollection'}, **extra)
    fc['features'] = feats
    ruta = os.path.join(SALIDA, nombre)
    with open(ruta, 'w', encoding='utf-8') as f:
        json.dump(fc, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    return ruta


def main():
    d = sys.argv[1]
    os.makedirs(SALIDA, exist_ok=True)
    fecha = open(os.path.join(d, 'fecha.txt')).read().strip()
    leer = lambda k: json.load(open(os.path.join(d, FUENTES[k]['crudo']), encoding='utf-8'))
    resumen = {}

    pm = armar_pm25(leer('pm25'))
    escribir(FUENTES['pm25']['producto'], pm, {
        'fuente': 'SDA, PM2,5 promedio anual 2025 (1 ene a 31 dic 2025), interpolación geoestadística de las estaciones RMCAB',
        'licencia': 'CC BY 4.0', 'bajado': fecha})
    resumen['pm25'] = {'franjas': len(pm), 'valores': [f['properties']['pm25'] for f in pm]}

    col, fuera_c = armar_colegios(leer('colegios'))
    escribir(FUENTES['colegios']['producto'], col, {
        'fuente': 'SED, Colegios. Bogotá D.C., corte del 30 sep 2026', 'licencia': 'CC BY-SA 4.0', 'bajado': fecha,
        'campos': {'n': 'establecimiento', 's': 'sede, si se llama distinto', 'o': '1 oficial, 0 no oficial (inferido del campo SECTOR)'}})
    resumen['colegios'] = {'sedes': len(col), 'oficiales': sum(f['properties']['o'] for f in col), 'fuera_de_caja': fuera_c}

    sal, fuera_s, sin_s = armar_salud(leer('salud'))
    escribir(FUENTES['salud']['producto'], sal, {
        'fuente': 'SDS, Red adscrita de salud para Bogotá D.C. (sedes de las cuatro Subredes)', 'licencia': 'CC BY 4.0', 'bajado': fecha,
        'campos': {'n': 'sede', 'r': 'subred (Norte, Sur, Sur Occidente o Centro Oriente)'}})
    resumen['salud'] = {'sedes': len(sal), 'fuera_de_caja': fuera_s, 'sin_coordenadas': sin_s}

    proc = {'_nota': 'Bajado una sola vez con pipelines/aire-anual/bajar.sh. El visor sirve estos archivos y no llama a los servidores del Distrito.',
            'bajado': fecha, 'fuentes': {}}
    for k, v in FUENTES.items():
        prod = os.path.join(SALIDA, v['producto'])
        proc['fuentes'][k] = {'url': v['url'], **{c: v[c] for c in ('metodo', 'otras_evidencias') if c in v}, 'ficha': v['ficha'], 'productor': v['productor'], 'licencia': v['licencia'],
                              'sha256_crudo': sha(os.path.join(d, v['crudo'])), 'bytes_crudo': os.path.getsize(os.path.join(d, v['crudo'])),
                              'producto': v['producto'], 'sha256_producto': sha(prod), 'bytes_producto': os.path.getsize(prod),
                              'resumen': resumen[k]}
        # Evidencia: lo que dice la ficha del portal, copiado tal cual (no lo escribimos nosotros).
        r = json.load(open(os.path.join(d, v['ficha_json']), encoding='utf-8'))['result']
        assert r['license_url'] == v['licencia']['url'], (k, r['license_url'])
        proc['fuentes'][k]['ficha_dice'] = {c: r.get(c) for c in ('title', 'license_id', 'license_title', 'license_url', 'isopen', 'metadata_modified')}
    with open(os.path.join(SALIDA, 'procedencia.json'), 'w', encoding='utf-8') as f:
        json.dump(proc, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(json.dumps(resumen, ensure_ascii=False))


if __name__ == '__main__':
    main()
