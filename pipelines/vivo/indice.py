#!/usr/bin/env python3
"""Escribe indice.json del sitio vivo: cada archivo con bytes, sha256 y, si es un
JSON con «generado», su hora. La próxima corrida lo usa para recuperar el sitio
y el visor puede usarlo para saber qué hay.

Uso:
    python3 -I pipelines/vivo/indice.py --sitio _site [--tope-kb 3072]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comun  # noqa: E402

CADENCIAS_MIN = {  # cada cuánto se busca dato nuevo; el visor marca «sin dato reciente» al doble
    "cielo/ahora.json": 20,
    "bicis/ahora.json": 10,
    "bicis/serie-48h.ndjson.gz": 10,
    "pronostico/ahora.json": 60,
    "pronostico/emitidos-5d.ndjson.gz": 60,
    "pronostico/acierto.json": 1440,
    "aire/pronostico.json": 60,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sitio", type=Path, required=True)
    ap.add_argument("--tope-kb", type=int, default=3072, help="peso total máximo del sitio vivo")
    a = ap.parse_args()
    archivos = {}
    total = 0
    for p in sorted(a.sitio.rglob("*")):
        if not p.is_file() or p.name == "indice.json" or p.name.endswith(".tmp") or p.name.startswith("."):
            continue
        nombre = p.relative_to(a.sitio).as_posix()
        info = {"bytes": p.stat().st_size, "sha256": comun.sha256(p)}
        if p.suffix == ".json":
            j = comun.leer_json(p)
            if isinstance(j, dict) and j.get("generado"):
                info["generado"] = j["generado"]
        if nombre in CADENCIAS_MIN:
            info["cadencia_min"] = CADENCIAS_MIN[nombre]
        archivos[nombre] = info
        total += info["bytes"]
    indice = {
        "esquema": "bogotwin/indice/1",
        "generado": comun.iso(comun.ahora_utc()),
        "corrida": comun.corrida(),
        "regla": "Un archivo está «sin dato reciente» cuando su edad pasa del doble de cadencia_min.",
        "bytes_total": total,
        "archivos": archivos,
    }
    comun.escribir_json(a.sitio / "indice.json", indice, compacto=False)
    print(json.dumps({k: (v["bytes"], v.get("generado")) for k, v in archivos.items()}, ensure_ascii=False, indent=1))
    if total > a.tope_kb * 1024:
        print(f"::error::El sitio vivo pesa {total} B, más del tope de {a.tope_kb} KB. No se publica.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
