"""Exportar e importar CSV con formato fijo.

Columnas definidas, fechas AAAA-MM-DD HH:MM, punto decimal.
Al importar se saltan duplicados y se reportan las filas con error sin abortar todo.
"""
import csv
import io

COLUMNAS = ["tipo", "ticker", "direccion", "moneda", "entrada_fecha", "entrada_precio", "salida_fecha",
            "salida_precio", "cantidad", "stop_inicial", "stop_final", "objetivo", "comision",
            "motivo_entrada", "emocion"]
# Lo que hace única a una operación para detectar duplicados
CLAVE = ("tipo", "ticker", "direccion", "entrada_fecha", "entrada_precio", "cantidad")


def exportar(operaciones: list[dict]) -> str:
    salida = io.StringIO()
    escritor = csv.DictWriter(salida, fieldnames=COLUMNAS, extrasaction="ignore", lineterminator="\n")
    escritor.writeheader()
    for op in operaciones:
        escritor.writerow({k: ("" if op.get(k) is None else op[k]) for k in COLUMNAS})
    return salida.getvalue()


def leer(contenido: str) -> tuple[list[dict], list[str]]:
    """Devuelve (filas como dict crudo, errores de encabezado)."""
    lector = csv.DictReader(io.StringIO(contenido.lstrip("﻿")))
    faltan = [c for c in COLUMNAS if c not in (lector.fieldnames or [])]
    if faltan:
        return [], [f"Faltan columnas: {', '.join(faltan)}"]
    filas = []
    for fila in lector:
        filas.append({k: (v.strip() if isinstance(v, str) and v.strip() != "" else None) for k, v in fila.items()
                      if k in COLUMNAS})
    return filas, []


def clave(op: dict) -> tuple:
    return tuple(str(op.get(k)) if not isinstance(op.get(k), float) else f"{op[k]:.6f}" for k in CLAVE)
