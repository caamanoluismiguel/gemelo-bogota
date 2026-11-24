"""Piezas comunes de la cosecha viva (repo gemelo-bogota-vivo).

Solo biblioteca estándar de Python 3.10 o más nueva. Ninguna clave.

Lo usan bicis, pronóstico, aire, acierto, recuperar e índice. Cada script lo
carga con sys.path apuntando a esta carpeta, porque los scripts corren con
`python3 -I` y así no ven la carpeta de trabajo.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BOGOTA = timezone(timedelta(hours=-5), "America/Bogota")  # sin horario de verano
AGENTE = "gemelo-bogota-vivo/1 (+https://github.com/caamanoluismiguel/gemelo-bogota)"
BASE_PUBLICADA = "https://caamanoluismiguel.github.io/gemelo-bogota-vivo/"


def ahora_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def de_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def dia_bogota(dt: datetime) -> date:
    return dt.astimezone(BOGOTA).date()


def inicio_dia_bogota(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=BOGOTA).astimezone(timezone.utc)


def corrida() -> dict:
    """De dónde salió el archivo: motor que disparó la corrida y enlace al registro de Actions."""
    servidor = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    repo = os.environ.get("GITHUB_REPOSITORY")
    run = os.environ.get("GITHUB_RUN_ID")
    return {
        "motor": os.environ.get("MOTOR") or ("local" if not run else "desconocido"),
        "registro": f"{servidor}/{repo}/actions/runs/{run}" if repo and run else None,
        "commit_codigo": os.environ.get("COMMIT_CODIGO"),
    }


def bajar(url: str, intentos: int = 3, timeout: int = 40, acepta: str = "application/json") -> bytes:
    ultimo: Exception | None = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENTE, "Accept": acepta})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            ultimo = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code in (400, 401, 403, 404):
                break
            if i < intentos - 1:
                time.sleep(4 * (i + 1))
    assert ultimo is not None
    raise ultimo


def bajar_json(url: str, **kw):
    return json.loads(bajar(url, **kw).decode("utf-8"))


def leer_json(ruta: Path):
    try:
        return json.loads(Path(ruta).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def escribir_json(ruta: Path, obj, compacto: bool = True) -> int:
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_name(ruta.name + ".tmp")
    if compacto:
        texto = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        texto = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    tmp.write_text(texto, encoding="utf-8")
    os.replace(tmp, ruta)
    return ruta.stat().st_size


def gz_determinista(datos: bytes) -> bytes:
    """gzip sin fecha ni nombre dentro: el mismo contenido da siempre la misma huella."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9, mtime=0, filename="") as g:
        g.write(datos)
    return buf.getvalue()


def escribir_ndjson_gz(ruta: Path, filas: list) -> int:
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    texto = "".join(json.dumps(f, ensure_ascii=False, separators=(",", ":")) + "\n" for f in filas)
    tmp = ruta.with_name(ruta.name + ".tmp")
    tmp.write_bytes(gz_determinista(texto.encode("utf-8")))
    os.replace(tmp, ruta)
    return ruta.stat().st_size


def leer_ndjson_gz(ruta: Path) -> list:
    try:
        with gzip.open(ruta, "rt", encoding="utf-8") as g:
            return [json.loads(l) for l in g if l.strip()]
    except FileNotFoundError:
        return []


def sha256(ruta: Path) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def edad_min(generado: str | None, ref: datetime) -> float | None:
    dt = de_iso(generado)
    return None if dt is None else (ref - dt).total_seconds() / 60


def toca(ruta: Path, cada_min: float, ref: datetime, margen_min: float = 3) -> bool:
    """¿Hay que rehacer este archivo? Sí si no existe o si su «generado» ya tiene su cadencia
    (menos un margen, para que una corrida de 10 min que llega a los 9 no se salte el turno)."""
    j = leer_json(ruta)
    edad = edad_min(j.get("generado") if isinstance(j, dict) else None, ref)
    return edad is None or edad >= cada_min - margen_min


def agregar_manifiesto(carpeta: Path, release: str, entrada: dict) -> Path:
    """Suma un archivo cerrado al manifiesto mensual que va a git (cambia como mucho una vez al día)."""
    ruta = Path(carpeta) / f"{release}.json"
    man = leer_json(ruta) or {
        "esquema": "bogotwin/manifiesto/1",
        "release": release,
        "url_release": f"https://github.com/caamanoluismiguel/gemelo-bogota-vivo/releases/tag/{release}",
        "archivos": [],
    }
    man["archivos"] = [a for a in man["archivos"] if a["nombre"] != entrada["nombre"]] + [entrada]
    man["archivos"].sort(key=lambda a: a["nombre"])
    escribir_json(ruta, man, compacto=False)
    return ruta


def ya_en_manifiesto(carpeta: Path, release: str, nombre: str) -> bool:
    man = leer_json(Path(carpeta) / f"{release}.json") or {}
    return any(a.get("nombre") == nombre for a in man.get("archivos", []))
