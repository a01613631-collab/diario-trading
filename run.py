"""Arranque con un solo comando:  python run.py

Lee .env (si existe), prepara la base de datos y abre el servidor en http://127.0.0.1:8000
"""
import os
from pathlib import Path


def cargar_env():
    archivo = Path(__file__).parent / ".env"
    if not archivo.exists():
        return
    for linea in archivo.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            clave, valor = linea.split("=", 1)
            os.environ.setdefault(clave.strip(), valor.strip())


if __name__ == "__main__":
    cargar_env()
    import uvicorn
    print("Diario de Trading con IA → http://127.0.0.1:8000  (Ctrl+C para salir)")
    # 127.0.0.1: nadie más en tu red Wi-Fi puede ver la app.
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PUERTO", "8000")))
