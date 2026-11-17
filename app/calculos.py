"""Fórmulas exactas del panel. Todos los números salen de aquí, nunca de la IA.

Una operación es un dict con las columnas de la tabla `operaciones`.
Los resultados NO se guardan: se calculan cada vez con estas funciones.
"""
from collections import defaultdict
from datetime import datetime

FORMATO_FECHA = "%Y-%m-%d %H:%M"
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def a_fecha(texto: str) -> datetime:
    return datetime.strptime(texto, FORMATO_FECHA)


def esta_cerrada(op: dict) -> bool:
    return op.get("salida_fecha") is not None and op.get("salida_precio") is not None


def resultado(op: dict) -> float | None:
    """Compra: (salida − entrada) × cantidad − comisión. Venta en corto: (entrada − salida) × cantidad − comisión.
    Operación abierta: None (no entra en ninguna estadística)."""
    if not esta_cerrada(op):
        return None
    if op["direccion"] == "compra":
        bruto = (op["salida_precio"] - op["entrada_precio"]) * op["cantidad"]
    else:
        bruto = (op["entrada_precio"] - op["salida_precio"]) * op["cantidad"]
    return round(bruto - (op.get("comision") or 0), 6)


def riesgo_inicial(op: dict) -> float | None:
    """|entrada − stop inicial| × cantidad. Sin stop: None (se marca 'sin stop')."""
    if op.get("stop_inicial") is None:
        return None
    return abs(op["entrada_precio"] - op["stop_inicial"]) * op["cantidad"]


def multiplo_r(op: dict) -> float | None:
    """Resultado / riesgo inicial. Sin stop o abierta: None (se omite del promedio)."""
    res, riesgo = resultado(op), riesgo_inicial(op)
    if res is None or not riesgo:
        return None
    return res / riesgo


def clasificar(res: float) -> str:
    if res > 0:
        return "ganadora"
    if res < 0:
        return "perdedora"
    return "neutra"  # resultado igual a 0 no cuenta como ganadora


def caida_maxima(cerradas: list[dict]) -> float | None:
    """Mayor baja desde un pico de la curva de capital (ordenada por fecha de salida).
    Con menos de 2 operaciones: None (no se muestra)."""
    if len(cerradas) < 2:
        return None
    capital, pico, caida = 0.0, 0.0, 0.0
    for op in sorted(cerradas, key=lambda o: o["salida_fecha"]):
        capital += resultado(op)
        pico = max(pico, capital)
        caida = max(caida, pico - capital)
    return round(caida, 6)


def curva_capital(cerradas: list[dict]) -> list[dict]:
    capital, puntos = 0.0, []
    for op in sorted(cerradas, key=lambda o: o["salida_fecha"]):
        capital += resultado(op)
        puntos.append({"fecha": op["salida_fecha"], "capital": round(capital, 2), "id": op["id"]})
    return puntos


def estadisticas(operaciones: list[dict]) -> dict:
    """Estadísticas de UN grupo (un tipo y una moneda). Quien llama separa reales/simuladas y monedas."""
    cerradas = [op for op in operaciones if esta_cerrada(op)]
    abiertas = len(operaciones) - len(cerradas)
    resultados = [resultado(op) for op in cerradas]
    ganancias = [r for r in resultados if r > 0]
    perdidas = [r for r in resultados if r < 0]
    neutras = [r for r in resultados if r == 0]
    rs = [r for r in (multiplo_r(op) for op in cerradas) if r is not None]

    if perdidas:
        factor = round(sum(ganancias) / abs(sum(perdidas)), 4)
    elif ganancias:
        factor = "aún sin pérdidas"
    else:
        factor = None

    por_activo: dict[str, float] = defaultdict(float)
    por_dia: dict[str, float] = defaultdict(float)
    for op, res in zip(cerradas, resultados):
        por_activo[op["ticker"]] += res
        por_dia[DIAS[a_fecha(op["entrada_fecha"]).weekday()]] += res

    return {
        "total": len(operaciones),
        "cerradas": len(cerradas),
        "abiertas": abiertas,
        "ganadoras": len(ganancias),
        "perdedoras": len(perdidas),
        "neutras": len(neutras),
        "tasa_acierto": round(len(ganancias) / len(cerradas), 4) if cerradas else None,
        "ganancia_promedio": round(sum(ganancias) / len(ganancias), 2) if ganancias else None,
        "perdida_promedio": round(sum(perdidas) / len(perdidas), 2) if perdidas else None,
        "factor_beneficio": factor,
        "caida_maxima": caida_maxima(cerradas),
        "resultado_total": round(sum(resultados), 2),
        "r_promedio": round(sum(rs) / len(rs), 3) if rs else None,
        "sin_stop": sum(1 for op in operaciones if op.get("stop_inicial") is None),
        "por_activo": {k: round(v, 2) for k, v in sorted(por_activo.items())},
        "por_dia": {d: round(por_dia[d], 2) for d in DIAS if d in por_dia},
        "curva": curva_capital(cerradas),
    }
