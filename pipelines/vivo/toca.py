#!/usr/bin/env python3
"""Sale con 0 si el JSON indicado ya tiene su cadencia (o no existe) y con 1 si todavía no toca.

Uso: python3 -I pipelines/vivo/toca.py _site/cielo/ahora.json 20
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comun  # noqa: E402

if __name__ == "__main__":
    ruta, cada = Path(sys.argv[1]), float(sys.argv[2])
    sys.exit(0 if comun.toca(ruta, cada, comun.ahora_utc()) else 1)
