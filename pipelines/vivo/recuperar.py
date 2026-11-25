#!/usr/bin/env python3
"""Recupera lo que ya está publicado en Pages del repo vivo antes de una corrida.

`deploy-pages` reemplaza el sitio entero. Por eso cada corrida baja primero lo
publicado (según `indice.json`, que trae bytes y sha256 de cada archivo), cambia
solo lo que le toca y vuelve a publicar todo.

Si un archivo del índice no se puede bajar o su huella no coincide, sale con
código 1 y la corrida NO publica: el sitio anterior queda intacto. Es mejor
un dato que envejece a la vista que un sitio al que le falta la mitad.

Uso:
    python3 -I pipelines/vivo/recuperar.py --salida _site [--base URL]
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import time
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comun  # noqa: E402

# Antes de que existiera indice.json solo se publicaba la tarjeta del cielo.
SIN_INDICE = ["cielo/ahora.json", "cielo/goes19-bogota.jpg"]


def ruta_segura(nombre: str) -> bool:
    p = Path(nombre)
    return not p.is_absolute() and ".." not in p.parts and nombre == p.as_posix() and nombre != "indice.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", type=Path, required=True)
    ap.add_argument("--base", default=comun.BASE_PUBLICADA)
    a = ap.parse_args()
    base = a.base.rstrip("/") + "/"
    marca = str(int(time.time()))
    a.salida.mkdir(parents=True, exist_ok=True)

    try:
        indice = comun.bajar_json(f"{base}indice.json?t={marca}", intentos=4)
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            print(f"::error::No se pudo leer indice.json ({exc.code}). No se publica.")
            return 1
        indice = None
    except Exception as exc:
        print(f"::error::No se pudo leer indice.json ({type(exc).__name__}). No se publica.")
        return 1

    if indice is None:
        print("Sin indice.json publicado: primera corrida con índice. Se intenta lo del cielo.")
        for nombre in SIN_INDICE:
            try:
                datos = comun.bajar(f"{base}{nombre}?t={marca}", acepta="*/*")
                destino = a.salida / nombre
                destino.parent.mkdir(parents=True, exist_ok=True)
                destino.write_bytes(datos)
                print(f"{nombre}: {len(datos)} B")
            except Exception as exc:
                print(f"{nombre}: no estaba ({type(exc).__name__}); se arma de cero")
        return 0

    archivos = indice.get("archivos", {})
    mal = []
    for nombre, info in sorted(archivos.items()):
        if not ruta_segura(nombre):
            mal.append(f"{nombre}: nombre no permitido")
            continue
        ok = False
        for intento in range(4):
            try:
                datos = comun.bajar(f"{base}{nombre}?t={marca}-{intento}", acepta="*/*")
            except Exception as exc:
                motivo = type(exc).__name__
                time.sleep(10)
                continue
            if len(datos) == info.get("bytes") and hashlib.sha256(datos).hexdigest() == info.get("sha256"):
                destino = a.salida / nombre
                destino.parent.mkdir(parents=True, exist_ok=True)
                destino.write_bytes(datos)
                ok = True
                break
            motivo = "la huella no coincide (Pages aún propaga o el archivo cambió)"
            time.sleep(15)
        if ok:
            print(f"{nombre}: ok")
        else:
            mal.append(f"{nombre}: {motivo}")
    if mal:
        for m in mal:
            print(f"::error::{m}")
        print("::error::Falta recuperar lo publicado; esta corrida no publica para no borrar nada.")
        return 1
    print(f"Recuperados {len(archivos)} archivos del índice de {indice.get('generado')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
