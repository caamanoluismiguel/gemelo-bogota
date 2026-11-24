#!/usr/bin/env python3
"""Pasa salida/trabajo/buscador.csv (de buscador.sql) a ../site/datos/buscador.json, compacto."""
import csv
import json
from datetime import date
from pathlib import Path

AQUI = Path(__file__).resolve().parents[1]
filas = []
with open(AQUI / "salida/trabajo/buscador.csv", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        filas.append([r["nombre"], r["nivel"], r["localidad"] or "",
                      float(r["x0"]), float(r["y0"]), float(r["x1"]), float(r["y1"])])
salida = {
    "campos": ["nombre", "nivel", "localidad", "x0", "y0", "x1", "y1"],
    "fuente": "Localidades y UPL (SDP), sectores catastrales (UAECD) y barrios legalizados (SDP), Datos Abiertos Bogotá",
    "licencia": {"nombre": "CC BY 4.0", "familia": "cc_by"},
    "generado": date.today().isoformat(),
    "filas": filas,
}
destino = AQUI.parent / "site/datos/buscador.json"
destino.parent.mkdir(parents=True, exist_ok=True)
destino.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{destino.name}: {len(filas)} nombres")
