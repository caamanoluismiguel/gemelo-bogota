"""Servidor local mínimo con soporte de rangos HTTP (PMTiles los necesita).

`python3 -m http.server` no responde rangos, por eso este archivo. Solo escucha en
127.0.0.1 y solo sirve la carpeta mapa-base/. Uso, desde mapa-base/:
  python3 -I scripts/servir.py [puerto]     y abre http://127.0.0.1:8106/vista.html
"""
import http.server
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RANGO = re.compile(r"^bytes=(\d*)-(\d*)$")


class Manejador(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=RAIZ, **k)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        rango = self.headers.get("Range")
        ruta = self.translate_path(self.path)
        if not rango or not os.path.isfile(ruta):
            return super().do_GET()
        m = RANGO.match(rango.strip())
        total = os.path.getsize(ruta)
        if not m or (m.group(1) == "" and m.group(2) == ""):
            self.send_error(416)
            return
        if m.group(1) == "":
            ini, fin = max(0, total - int(m.group(2))), total - 1
        else:
            ini = int(m.group(1))
            fin = min(int(m.group(2)) if m.group(2) else total - 1, total - 1)
        if ini > fin or ini >= total:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{total}")
            self.end_headers()
            return
        n = fin - ini + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(ruta))
        self.send_header("Content-Range", f"bytes {ini}-{fin}/{total}")
        self.send_header("Content-Length", str(n))
        self.end_headers()
        with open(ruta, "rb") as f:
            f.seek(ini)
            self.wfile.write(f.read(n))


if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8106
    print(f"http://127.0.0.1:{puerto}/vista.html  (Ctrl+C para parar)")
    http.server.ThreadingHTTPServer(("127.0.0.1", puerto), Manejador).serve_forever()
