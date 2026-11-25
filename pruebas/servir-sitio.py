#!/usr/bin/env python3
"""Sirve site/ en la red local, con pedidos por partes (Range), para probar en el teléfono.

python -m http.server no responde Range y PMTiles los necesita. Las teselas no se copian:
/teselas/<archivo>.pmtiles se lee, solo para leer, de mapa-base/salida/ (lo que publica
pages.yml), y /teselas/horizonte-bogota.hzn.gz de mapa-base/salida/terreno/. Como pages.yml,
/datos/noches-frias/ sale de data/noches-frias/: ultima.json es el último día registrado.
Solo atiende GET y HEAD, y solo nombres de archivo sin rutas.

Uso: python3 pruebas/servir-sitio.py [puerto]   (8086 por defecto)
"""
import http.server
import os
import re
import socket
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITIO = os.path.join(RAIZ, 'site')
TESELAS = os.path.join(RAIZ, 'mapa-base', 'salida')
NOMBRE = re.compile(r'^[a-z0-9-]+\.pmtiles$')
# Archivos de teselas/ que no son PMTiles y viven en otra carpeta de salida (lista cerrada).
OTROS = {'horizonte-bogota.hzn.gz': os.path.join('terreno', 'horizonte-bogota.hzn.gz')}
NOCHES = os.path.join(RAIZ, 'data', 'noches-frias')
DIA = re.compile(r'^\d{4}-\d{2}-\d{2}\.json$')


def noches_frias(nombre):
    """Lo mismo que arma pages.yml en publicar/datos/noches-frias/, sin copiar nada."""
    dias = sorted(f for f in os.listdir(NOCHES) if DIA.match(f)) if os.path.isdir(NOCHES) else []
    if nombre == 'ultima.json':
        return os.path.join(NOCHES, dias[-1]) if dias else None
    if DIA.match(nombre) and nombre in dias:
        return os.path.join(NOCHES, nombre)
    return None


class Manejador(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITIO, **k)

    def ruta_real(self):
        ruta = self.path.split('?', 1)[0].split('#', 1)[0]
        if ruta.startswith('/teselas/'):
            nombre = ruta[len('/teselas/'):]
            if nombre in OTROS:
                return os.path.join(TESELAS, OTROS[nombre])
            if not NOMBRE.match(nombre):
                return None
            return os.path.join(TESELAS, nombre)
        if ruta.startswith('/datos/noches-frias/'):
            # Sin registro todavía: 404, igual que en Pages antes del primer día.
            return noches_frias(ruta[len('/datos/noches-frias/'):]) or ''
        return None

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        self.servir(True)

    def do_HEAD(self):
        self.servir(False)

    def servir(self, cuerpo):
        ruta = self.ruta_real()
        rango = self.headers.get('Range')
        if ruta is None and not rango:
            return super().do_GET() if cuerpo else super().do_HEAD()
        if ruta is None:
            ruta = self.translate_path(self.path)
        if not os.path.isfile(ruta):
            return self.send_error(404)
        total = os.path.getsize(ruta)
        ini, fin = 0, total - 1
        estado = 200
        m = re.match(r'bytes=(\d*)-(\d*)$', rango or '')
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                ini = int(m.group(1))
                fin = min(int(m.group(2)), total - 1) if m.group(2) else total - 1
            else:
                ini = max(0, total - int(m.group(2)))
            if ini > fin or ini >= total:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{total}')
                self.end_headers()
                return
            estado = 206
        self.send_response(estado)
        self.send_header('Content-Type', self.guess_type(ruta))
        self.send_header('Content-Length', str(fin - ini + 1))
        if estado == 206:
            self.send_header('Content-Range', f'bytes {ini}-{fin}/{total}')
        self.end_headers()
        if cuerpo:
            with open(ruta, 'rb') as f:
                f.seek(ini)
                falta = fin - ini + 1
                while falta > 0:
                    trozo = f.read(min(1 << 20, falta))
                    if not trozo:
                        break
                    self.wfile.write(trozo)
                    falta -= len(trozo)

    def log_message(self, fmt, *args):
        pass


def ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


if __name__ == '__main__':
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8086
    Manejador.extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                                '.pmtiles': 'application/octet-stream', '.js': 'text/javascript'}
    srv = http.server.ThreadingHTTPServer(('0.0.0.0', puerto), Manejador)
    print(f'En este Mac: http://localhost:{puerto}/prueba-sombras.html')
    print(f'En el teléfono (misma wifi): http://{ip_local()}:{puerto}/prueba-sombras.html')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
