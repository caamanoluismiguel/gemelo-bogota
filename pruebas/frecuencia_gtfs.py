"""Pruebas sin red de pipelines/frecuencia/frecuencia.py sobre un GTFS de juguete.

Tres estaciones troncales en línea (A, B, C), un expreso que pasa por B sin parar, un servicio
de domingo, un festivo y una ruta alimentadora que no debe contar. Solo biblioteca estándar.
"""

import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SCRIPT = RAIZ / "pipelines" / "frecuencia" / "frecuencia.py"
sys.path.insert(0, str(SCRIPT.parent))
sys.path.insert(0, str(RAIZ / "pipelines" / "vivo"))
import frecuencia as F  # noqa: E402

fallas = 0
pasan = 0


def revisar(nombre, ok, detalle=""):
    global fallas, pasan
    if ok:
        pasan += 1
    else:
        fallas += 1
    print(f"{'PASA ' if ok else 'FALLA'}  {nombre}" + (f"  ({detalle})" if detalle and not ok else ""))


LAT = 4.65
LON = {"A": -74.10, "B": -74.09, "C": -74.08}
ARCHIVOS = {
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\n1,Troncal,https://x.co,America/Bogota\n2,Alimentador,https://x.co,America/Bogota\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_type\nR1,1,B1,3\nR2,2,A1,3\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                    "1,1,1,1,1,1,0,0,20260101,20261231\n2,0,0,0,0,0,1,0,20260101,20261231\n4,0,0,0,0,0,0,1,20260101,20261231\n",
    "calendar_dates.txt": "service_id,date,exception_type\n4,20261208,1\n1,20261208,2\n",
    "feed_info.txt": "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date\nTM,https://x.co,es,20260101,20261231\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
                 + "".join(f"E{k},Estación {k},{LAT},{LON[k]},1,\n" for k in "ABC")
                 + "".join(f"P{k}1,Vagón {k}1,{LAT + 0.0001},{LON[k]},0,E{k}\nP{k}2,Vagón {k}2,{LAT - 0.0001},{LON[k] + 0.0002},0,E{k}\n" for k in "ABC")
                 + "X1,PARADERO ZONAL,4.70,-74.05,0,\n",
    "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
                  + "".join(f"S1,{LAT},{-74.101 + i * 0.001:.3f},{i}\n" for i in range(23))
                  + "".join(f"S2,{LAT},{-74.079 - i * 0.001:.3f},{i}\n" for i in range(23)),
    "trips.txt": "route_id,service_id,trip_id,shape_id\nR1,1,t1,S1\nR1,1,t2,S1\nR1,4,t3,S2\nR1,2,t5,S1\nR2,1,t4,S1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                      "t1,07:10:00,07:10:00,PA1,1\nt1,07:12:00,07:12:00,PA2,2\nt1,07:15:00,07:15:00,PB1,3\nt1,07:20:00,07:20:00,PC1,4\n"
                      "t2,07:50:00,07:50:00,PA1,1\nt2,08:05:00,08:05:00,PC1,2\n"
                      "t3,10:00:00,10:00:00,PC2,1\nt3,10:05:00,10:05:00,PB2,2\nt3,10:10:00,10:10:00,PA2,3\n"
                      "t5,24:30:00,24:30:00,PA1,1\nt5,24:40:00,24:40:00,PB1,2\n"
                      "t4,07:00:00,07:00:00,PA1,1\nt4,07:05:00,07:05:00,PB1,2\nt4,07:09:00,07:09:00,PC1,3\n",
}

with tempfile.TemporaryDirectory() as tmp:
    zp = Path(tmp) / "GTFS_20261208.zip"
    with zipfile.ZipFile(zp, "w") as z:
        for n, t in ARCHIVOS.items():
            z.writestr(n, t)
    d = F.calcular(zp)
    est = {e["id"]: e for e in d["estaciones"]}
    nombre = {i: e["id"] for i, e in enumerate(d["estaciones"])}
    tramos = {tuple(sorted((nombre[t["a"]], nombre[t["b"]]))): t for t in d["tramos"]}

    revisar("dos tramos físicos, A con B y B con C", set(tramos) == {("EA", "EB"), ("EB", "EC")}, str(set(tramos)))
    ab, bc = tramos.get(("EA", "EB")), tramos.get(("EB", "EC"))
    revisar("el alimentador no cuenta y el expreso sí: 2 buses de 7 a 8 entre A y B", ab and ab["f"]["habil"][7] == 2, ab and str(ab["f"]["habil"]))
    revisar("el expreso pasa por B sin parar a las 7:57: cuenta en B a C a las 7", bc and bc["f"]["habil"][7] == 2, bc and str(bc["f"]["habil"]))
    revisar("los dos sentidos se suman en el mismo tramo (domingo a las 10)", ab["f"]["domingo"][10] == 1 and bc["f"]["domingo"][10] == 1)
    revisar("pasadas las 24:00 cuentan en la hora 0 del sábado", ab["f"]["sabado"][0] == 1 and sum(ab["f"]["sabado"]) == 1)
    revisar("B solo cuenta las paradas de verdad (el expreso no para)", est["EB"]["f"]["habil"][7] == 1 and est["EA"]["f"]["habil"][7] == 2)
    revisar("dos vagones seguidos de la misma estación son una sola parada", est["EA"]["f"]["habil"][7] == 2)
    revisar("los paraderos zonales sin estación no entran", "X1" not in est)
    revisar("festivo: el domingo que se agrega un lunes", d["festivos"] == ["2026-12-08"], str(d["festivos"]))
    revisar("vigencia del feed_info", d["vigencia"] == ["20260101", "20261231"])
    largo = ab["m"]
    revisar("largo del tramo en metros, cerca de 1,1 km", 1000 < largo < 1200, str(largo))
    revisar("la línea de cada tramo va de la primera a la segunda estación", abs(ab["c"][0][0] - LON[nombre[ab["a"]][1]]) < 0.0005)

    salida = Path(tmp) / "salida"
    r = subprocess.run([sys.executable, "-I", str(SCRIPT), "--zip", str(zp), "--sin-red", "--salida", str(salida)], capture_output=True, text=True)
    revisar("el script corre sin red con --zip --sin-red", r.returncode == 0, r.stderr[-300:])
    doc = json.loads((salida / "troncal.json").read_text("utf-8")) if r.returncode == 0 else {}
    revisar("esquema, marca «programado» y licencia CC BY-SA 4.0", doc.get("esquema") == F.ESQUEMA and doc.get("marca") == "programado"
            and doc.get("licencia", {}).get("id") == "CC-BY-SA-4.0")
    revisar("los buses por hora van marcados como inferidos", doc.get("etiquetas", {}).get("buses_por_hora") == "inferido")
    revisar("la fuente trae el archivo, su tamaño y su sha256", doc.get("fuente", {}).get("archivo") == zp.name and len(doc["fuente"].get("sha256", "")) == 64)

revisar("solo acepta las licencias de la regla del proyecto", F.LICENCIAS_OK == {"CC0-1.0", "CC-BY-4.0", "ODbL-1.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0"})
revisar("nombres en mayúsculas pasan a mayúscula inicial", F.nombre_estacion("AVENIDA  JIMENEZ") == "Avenida Jimenez" and F.nombre_estacion("Calle 26 - Atrio") == "Calle 26 - Atrio")
codigo = SCRIPT.read_text("utf-8")
revisar("el script solo importa biblioteca estándar y comun", all(m not in codigo for m in ("import requests", "import numpy", "import pandas")))

print(f"Frecuencia troncal (Python): {pasan} pasan, {fallas} fallan\n")
sys.exit(1 if fallas else 0)
