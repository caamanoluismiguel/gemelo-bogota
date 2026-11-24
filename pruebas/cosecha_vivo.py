"""Pruebas sin red de la cosecha viva: bicis, pronóstico, acierto, recuperar y noches frías.

La corre pruebas/cosecha.prueba.js. Imprime PASA o FALLA por línea y sale con 1 si algo falla.
"""
import importlib.util
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "pipelines" / "vivo"))


def cargar(nombre, ruta):
    spec = importlib.util.spec_from_file_location(nombre, RAIZ / ruta)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


comun = cargar("comun", "pipelines/vivo/comun.py")
bicis = cargar("bicis", "pipelines/bicis/bicis.py")
acierto = cargar("acierto", "pipelines/pronostico/acierto.py")
pron = cargar("pronostico", "pipelines/pronostico/pronostico.py")
recuperar = cargar("recuperar", "pipelines/vivo/recuperar.py")
noches = cargar("registrar", "pipelines/noches-frias/registrar.py")

fallas = 0


def revisar(nombre, ok, detalle=""):
    global fallas
    if not ok:
        fallas += 1
    print(f"{'PASA ' if ok else 'FALLA'}  {nombre}" + (f"  ({detalle})" if detalle else ""))


# --- bicis -------------------------------------------------------------------
revisar("licencia ausente = CC0", bicis.revisar_licencia({"data": {}})["nombre"] == "CC0 1.0")
try:
    bicis.revisar_licencia({"data": {"license_url": "https://ejemplo.invalid/terminos"}})
    revisar("licencia propia para la cosecha", False)
except bicis.LicenciaNoAceptada:
    revisar("licencia propia para la cosecha", True)
revisar("CC-BY-4.0 declarada se acepta", bicis.revisar_licencia({"data": {"license_id": "CC-BY-4.0"}})["nombre"] == "CC-BY-4.0")

info = {"data": {"stations": [
    {"station_id": "1", "name": [{"text": "001 - Uno", "language": "es"}], "lat": 4.66, "lon": -74.05, "capacity": 19},
    {"station_id": "2", "name": [{"text": "002 - Dos", "language": "es"}], "lat": 4.60, "lon": -74.07, "capacity": 10},
    {"station_id": "316", "name": [{"text": "Relleno", "language": "es"}], "lat": 4.63, "lon": -74.11, "capacity": 1},
    {"station_id": "9", "name": [{"text": "Lejos", "language": "es"}], "lat": -10.0, "lon": -50.0, "capacity": 10},
]}}
tipos = {"data": {"vehicle_types": [{"vehicle_type_id": "FIT", "propulsion_type": "human"},
                                    {"vehicle_type_id": "EFIT", "propulsion_type": "electric_assist"}]}}
def st(sid, b, d, tipos_):
    return {"station_id": sid, "num_vehicles_available": b, "num_docks_available": d, "num_vehicles_disabled": 0,
            "num_docks_disabled": 0, "is_installed": True, "is_renting": True, "is_returning": True,
            "last_reported": "2026-11-24T23:20:00Z", "vehicle_types_available": tipos_}
estado = {"last_updated": "2026-11-24T23:23:30Z", "data": {"stations": [
    st("1", 12, 7, [{"vehicle_type_id": "FIT", "count": 9}, {"vehicle_type_id": "EFIT", "count": 3}]),
    st("2", 0, 10, [{"vehicle_type_id": "FIT", "count": 0}]),
    st("316", 198, 99, [{"vehicle_type_id": "FIT", "count": 99}, {"vehicle_type_id": "EFIT", "count": 99}, {"vehicle_type_id": "X", "count": 99}]),
    st("9", 3, 7, [{"vehicle_type_id": "FIT", "count": 3}]),
]}}
est, tot = bicis.armar_estado(info, estado, tipos)
revisar("totales sin estaciones dudosas", tot["bicis"] == 12 and tot["dudosas"] == 2 and tot["con_estado"] == 2, str(tot))
revisar("eléctricas por tipo", est[0]["v"][1] == 3)
revisar("vacía contada", tot["vacias"] == 1)
revisar("dudosa lleva el bit 8 y eléctricas nulas", est[2]["v"][5] & 8 and est[2]["v"][1] is None)
revisar("fuera de la Sabana es dudosa", est[3]["v"][5] & 8)
revisar("minutos desde el reporte", est[0]["v"][6] == 4, str(est[0]["v"]))

ref = comun.de_iso("2026-11-26T12:00:00Z")
filas = [{"t": "2026-11-24T10:00:00Z"}, {"t": "2026-11-25T04:59:00Z"}, {"t": "2026-11-25T05:00:00Z"},
         {"t": "2026-11-26T11:50:00Z"}, {"t": "2026-11-26T11:50:00Z"}]
pod = bicis.podar(filas, ref)
revisar("poda a 48 h y sin duplicados", [f["t"] for f in pod] == ["2026-11-25T04:59:00Z", "2026-11-25T05:00:00Z", "2026-11-26T11:50:00Z"])
revisar("días por cerrar en hora de Bogotá", bicis.dias_para_cerrar(pod, date(2026, 11, 26)) == [date(2026, 11, 24), date(2026, 11, 25)])

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    serie = [{"t": "2026-11-25T06:00:00Z", "ids": ["1"], "v": [[1, 0, 2, 0, 0, 7, 0]]},
             {"t": "2026-11-25T06:10:00Z", "ids": ["1"], "v": [[2, 0, 1, 0, 0, 7, 0]]}]
    lic = bicis.revisar_licencia({"data": {}})
    e1 = bicis.cerrar_dia(date(2026, 11, 25), serie, est[:1], lic, tmp / "c1", tmp / "m")
    revisar("día cerrado con manifiesto", e1 and e1["filas"] == 2 and comun.ya_en_manifiesto(tmp / "m", "bicis-2026-11", e1["nombre"]))
    revisar("no se cierra dos veces", bicis.cerrar_dia(date(2026, 11, 25), serie, est[:1], lic, tmp / "c2", tmp / "m") is None)
    e2 = bicis.cerrar_dia(date(2026, 11, 25), serie, est[:1], lic, tmp / "c3", tmp / "m2")
    revisar("cierre determinista (mismo sha256)", e1["sha256"] == e2["sha256"])
    leidas = comun.leer_ndjson_gz(tmp / "c1" / "bicis-2026-11" / e1["nombre"])
    revisar("cabecera y filas", leidas[0]["tipo"] == "cabecera" and len(leidas) == 3)

# --- toca --------------------------------------------------------------------
with tempfile.TemporaryDirectory() as tmp:
    p = Path(tmp) / "a.json"
    ahora = comun.ahora_utc()
    revisar("toca si no existe", comun.toca(p, 20, ahora))
    comun.escribir_json(p, {"generado": comun.iso(ahora - timedelta(minutes=10))})
    revisar("no toca a los 10 de 20", not comun.toca(p, 20, ahora))
    comun.escribir_json(p, {"generado": comun.iso(ahora - timedelta(minutes=18))})
    revisar("toca a los 18 de 20 (margen)", comun.toca(p, 20, ahora))

# --- acierto -----------------------------------------------------------------
revisar("lluvia: RA y -DZ sí", acierto.llueve("-DZ") and acierto.llueve("+RA") and acierto.llueve("TSRA"))
revisar("lluvia: VCSH, BR y VCTS no", not acierto.llueve("VCSH") and not acierto.llueve("BR BCFG") and not acierto.llueve("VCTS VCSH"))
revisar("lluvia: RERA no cuenta", not acierto.llueve("RERA"))

d = date(2026, 11, 25)
ini = comun.inicio_dia_bogota(d)
emi24 = {"emitido": comun.iso(ini - timedelta(hours=24)), "h0": comun.iso(ini - timedelta(hours=24)),
         "temp": [15.0] * 55, "prob": [0] * 24 + [80] * 6 + [10] * 25, "mm": [0] * 55}
emi48 = {"emitido": comun.iso(ini - timedelta(hours=48)), "h0": comun.iso(ini - timedelta(hours=48)),
         "temp": [13.0] * 55, "prob": [0] * 55, "mm": [0] * 55}
metar = []
for h in range(24):
    t = ini + timedelta(hours=h)
    metar.append({"t": t, "temp": 14.0, "tipo": "METAR", "wx": "-RA" if h == 2 else None})
fila = acierto.calificar_dia(d, [emi24, emi48], metar)
t24 = fila["temperatura"]["a24h"]
revisar("temperatura a 24 h: error 1 °C, sesgo +1", t24["error_medio_c"] == 1.0 and t24["sesgo_c"] == 1.0 and t24["horas"] == 5,
        str(t24))
revisar("a 48 h califica con la emisión de 48 h", fila["temperatura"]["a48h"]["error_medio_c"] == 1.0
        and fila["temperatura"]["a48h"]["sesgo_c"] == -1.0 and fila["temperatura"]["a48h"]["horas"] == 6, str(fila["temperatura"]["a48h"]))
l24 = fila["lluvia"]["a24h"]
revisar("lluvia a 24 h: primer bloque dijo sí y llovió", l24["si_si"] == 1, str(l24))
res = acierto.resumir([fila], d, 7)
revisar("resumen de 7 días", res["a24h"]["lluvia"]["porcentaje"] is not None and res["dias_calificados"] == 1)
revisar("pendientes antes de las 00:30", acierto.pendientes(set(), d, 10) == [d - timedelta(days=2)])
revisar("pendientes después de las 00:30", acierto.pendientes({str(d - timedelta(days=2))}, d, 45) == [d - timedelta(days=1)])

# --- pronóstico --------------------------------------------------------------
revisar("hora Z de Open-Meteo", pron.hora_z("2026-11-24T23:00") == "2026-11-24T23:00:00Z")
ems = [{"emitido": "2026-11-20T00:00:00Z"}, {"emitido": "2026-11-24T00:00:00Z"}, {"emitido": "2026-11-24T00:00:00Z"}]
revisar("emisiones de 5 días sin duplicados", [e["emitido"] for e in pron.podar_emisiones(ems, comun.de_iso("2026-11-25T12:00:00Z"))] == ["2026-11-24T00:00:00Z"])

# --- recuperar ---------------------------------------------------------------
revisar("rutas seguras", recuperar.ruta_segura("bicis/ahora.json") and not recuperar.ruta_segura("../x")
        and not recuperar.ruta_segura("/etc/x") and not recuperar.ruta_segura("indice.json"))

# --- noches frías ------------------------------------------------------------
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    hoy = date(2026, 11, 25)
    (tmp / "2026-11-23.json").write_text("{}")
    # 00:30 de Bogotá del 25: la noche del 25 no ha cerrado; la del 24 se rellena.
    consulta = datetime(2026, 11, 25, 5, 30, tzinfo=timezone.utc)
    f = noches.fechas_a_registrar(hoy, consulta, tmp, 3)
    revisar("pasada la medianoche no pierde la noche", f == [date(2026, 11, 22), date(2026, 11, 24)], str(f))
    consulta = datetime(2026, 11, 25, 11, 40, tzinfo=timezone.utc)
    f = noches.fechas_a_registrar(hoy, consulta, tmp, 0)
    revisar("a las 6:40 registra hoy", f == [hoy], str(f))
    f = noches.fechas_a_registrar(hoy, consulta, tmp, 40)
    revisar("el relleno no pasa de 30 días", len(f) <= 30 and min(f) >= hoy - timedelta(days=30), str(len(f)))

print(f"Cosecha viva: {fallas} fallan")
sys.exit(1 if fallas else 0)
