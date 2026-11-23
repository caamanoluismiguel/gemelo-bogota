"""Costo de descarga por vista de teléfono, medido sobre las teselas reales.

Pantalla vertical de 390 x 844 px CSS con teselas vectoriales de 512 px: a lo sumo
2 columnas x 3 filas por vista sin inclinar. Para cada zoom recorre todas las ventanas
2x3 con datos y suma los bytes comprimidos (gzip) de todos los archivos dados.
Imprime mediana, percentil 95 y máximo. Uso:
  python3 -I scripts/costo_vista.py salida/trabajo/medir/*.mbtiles
"""
import sqlite3
import sys
from collections import defaultdict
from statistics import median


def main(rutas):
    peso = defaultdict(int)  # (z, x, y) -> bytes sumados entre archivos
    for r in rutas:
        con = sqlite3.connect(f"file:{r}?mode=ro", uri=True)
        for z, x, ytms, n in con.execute(
                "SELECT zoom_level, tile_column, tile_row, length(tile_data) FROM tiles"):
            peso[(z, x, (1 << z) - 1 - ytms)] += n
        con.close()
    por_zoom = defaultdict(dict)
    for (z, x, y), n in peso.items():
        por_zoom[z][(x, y)] = n
    print("zoom\tventanas\tmediana_KB\tp95_KB\tmax_KB")
    for z in sorted(por_zoom):
        t = por_zoom[z]
        xs = {x for x, _ in t}
        ys = {y for _, y in t}
        sumas = []
        for x0 in range(min(xs) - 1, max(xs) + 1):
            for y0 in range(min(ys) - 2, max(ys) + 1):
                s = sum(t.get((x0 + dx, y0 + dy), 0) for dx in range(2) for dy in range(3))
                if s:
                    sumas.append(s)
        sumas.sort()
        p95 = sumas[int(0.95 * (len(sumas) - 1))]
        print(f"{z}\t{len(sumas)}\t{median(sumas)/1024:.0f}\t{p95/1024:.0f}\t{sumas[-1]/1024:.0f}")


if __name__ == "__main__":
    main(sys.argv[1:])
