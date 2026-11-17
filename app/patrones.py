"""Detector de patrones de comportamiento. Reglas en código, valores ajustables.

La IA NO detecta nada: solo redacta la explicación de lo que encuentra este módulo.
"""
from bisect import bisect_left
from statistics import median

from .calculos import a_fecha, clasificar, esta_cerrada, resultado, riesgo_inicial

# --- Valores iniciales (ajustables) ---
MIN_OPERACIONES = 20          # menos de esto: "datos insuficientes"
MIN_VECES = 3                 # un patrón se reporta si aparece al menos 3 veces...
MIN_PROPORCION = 0.20         # ...y en al menos 20% de los casos donde podía ocurrir
MINUTOS_REVANCHA = 60
FACTOR_TAMANO = 1.5
VENTANA_MEDIANA = 20

NOMBRES = {
    "revancha": "Operar por revancha",
    "stop_en_contra": "Mover el stop en contra",
    "tamano_tras_perder": "Subir el tamaño tras perder",
    "cortar_ganancias": "Cortar ganancias antes de tiempo",
    "romper_riesgo": "Romper su propia regla de riesgo",
    "sin_stop": "Operar sin stop",
}


def _ordenadas(ops: list[dict]) -> list[dict]:
    return sorted(ops, key=lambda o: o["entrada_fecha"])


def revancha(ops):
    """Entrada dentro de los 60 min siguientes al cierre de una pérdida.
    Oportunidad: cada pérdida que tiene una operación posterior."""
    ops = _ordenadas(ops)
    entradas = [o["entrada_fecha"] for o in ops]  # el formato AAAA-MM-DD HH:MM se ordena como texto
    casos, oportunidades = [], 0
    for perdida in ops:
        if clasificar(resultado(perdida)) != "perdedora":
            continue
        cierre = a_fecha(perdida["salida_fecha"])
        # primera operación que entra en o después del cierre de la pérdida
        j = bisect_left(entradas, perdida["salida_fecha"])
        while j < len(ops) and ops[j]["id"] == perdida["id"]:
            j += 1
        if j >= len(ops):
            continue
        oportunidades += 1
        siguiente = ops[j]
        minutos = (a_fecha(siguiente["entrada_fecha"]) - cierre).total_seconds() / 60
        if minutos <= MINUTOS_REVANCHA:
            casos.append({"ids": [perdida["id"], siguiente["id"]],
                          "detalle": f"entró {int(minutos)} min después de cerrar una pérdida"})
    return casos, oportunidades


def stop_en_contra(ops):
    """Stop final más lejos de la entrada que el stop inicial (del lado de la pérdida)."""
    casos, oportunidades = [], 0
    for op in ops:
        if op.get("stop_inicial") is None or op.get("stop_final") is None:
            continue
        oportunidades += 1
        if op["direccion"] == "compra":
            movido = op["stop_final"] < op["stop_inicial"]
        else:
            movido = op["stop_final"] > op["stop_inicial"]
        if movido:
            casos.append({"ids": [op["id"]],
                          "detalle": f"stop de {op['stop_inicial']} a {op['stop_final']}"})
    return casos, oportunidades


def tamano_tras_perder(ops):
    """Riesgo inicial > 1.5 × mediana de las 20 operaciones previas, justo después de una pérdida."""
    ops = _ordenadas(ops)
    casos, oportunidades = [], 0
    for i in range(1, len(ops)):
        anterior, actual = ops[i - 1], ops[i]
        if clasificar(resultado(anterior)) != "perdedora":
            continue
        riesgo = riesgo_inicial(actual)
        previos = [r for r in (riesgo_inicial(o) for o in ops[max(0, i - VENTANA_MEDIANA):i]) if r]
        if riesgo is None or len(previos) < 5:
            continue
        oportunidades += 1
        base = median(previos)
        if riesgo > FACTOR_TAMANO * base:
            casos.append({"ids": [anterior["id"], actual["id"]],
                          "detalle": f"riesgo {riesgo:.0f} vs. mediana {base:.0f}"})
    return casos, oportunidades


def cortar_ganancias(ops):
    """Ganadora cerrada con menos de la mitad del R planeado hacia el objetivo."""
    casos, oportunidades = [], 0
    for op in ops:
        if op.get("objetivo") is None or op.get("stop_inicial") is None:
            continue
        if clasificar(resultado(op)) != "ganadora":
            continue
        riesgo_accion = abs(op["entrada_precio"] - op["stop_inicial"])
        if riesgo_accion == 0:
            continue
        oportunidades += 1
        signo = 1 if op["direccion"] == "compra" else -1
        r_planeado = signo * (op["objetivo"] - op["entrada_precio"]) / riesgo_accion
        r_logrado = signo * (op["salida_precio"] - op["entrada_precio"]) / riesgo_accion
        if r_planeado > 0 and r_logrado < r_planeado / 2:
            casos.append({"ids": [op["id"]],
                          "detalle": f"cerró en {r_logrado:.1f}R de {r_planeado:.1f}R planeados"})
    return casos, oportunidades


def romper_riesgo(ops, ajustes):
    """Riesgo inicial mayor al riesgo máximo definido en ajustes (por moneda)."""
    casos, oportunidades = [], 0
    for op in ops:
        maximo = ajustes.get("riesgo_max_" + op["moneda"].lower())
        riesgo = riesgo_inicial(op)
        if maximo is None or riesgo is None:
            continue
        oportunidades += 1
        if riesgo > maximo:
            casos.append({"ids": [op["id"]], "detalle": f"riesgo {riesgo:.0f} > máximo {maximo:.0f}"})
    return casos, oportunidades


def sin_stop(ops):
    casos = [{"ids": [op["id"]], "detalle": "sin stop inicial"} for op in ops if op.get("stop_inicial") is None]
    return casos, len(ops)


def detectar(operaciones: list[dict], ajustes: dict) -> dict:
    """Corre todas las reglas sobre las operaciones cerradas de UN grupo (tipo + moneda)."""
    cerradas = [op for op in operaciones if esta_cerrada(op)]
    if len(cerradas) < MIN_OPERACIONES:
        return {"suficientes": False, "cerradas": len(cerradas), "minimo": MIN_OPERACIONES, "patrones": []}

    reglas = {
        "revancha": revancha(cerradas),
        "stop_en_contra": stop_en_contra(cerradas),
        "tamano_tras_perder": tamano_tras_perder(cerradas),
        "cortar_ganancias": cortar_ganancias(cerradas),
        "romper_riesgo": romper_riesgo(cerradas, ajustes),
        "sin_stop": sin_stop(cerradas),
    }
    patrones = []
    for clave, (casos, oportunidades) in reglas.items():
        proporcion = len(casos) / oportunidades if oportunidades else 0
        if len(casos) >= MIN_VECES and proporcion >= MIN_PROPORCION:
            ids = sorted({i for c in casos for i in c["ids"]})
            patrones.append({
                "clave": clave, "nombre": NOMBRES[clave], "veces": len(casos),
                "oportunidades": oportunidades, "proporcion": round(proporcion, 3),
                "casos": casos, "ids": ids,
            })
    return {"suficientes": True, "cerradas": len(cerradas), "patrones": patrones}


def sugerir_pausa(operaciones: list[dict], ajustes: dict) -> str | None:
    """Si rompe su riesgo máximo 3 veces seguidas o la revancha se repite en las últimas
    entradas, sugerimos una pausa. Sin juicios y nunca 'opera más para recuperar'."""
    cerradas = _ordenadas([op for op in operaciones if esta_cerrada(op)])
    ultimas = cerradas[-3:]
    if len(ultimas) == 3:
        rotas = romper_riesgo(ultimas, ajustes)[0]
        if len(rotas) == 3:
            return ("Tus últimas 3 operaciones superaron el riesgo máximo que tú mismo definiste. "
                    "Puede ser buen momento para hacer una pausa y revisar tu plan antes de la siguiente.")
    casos, _ = revancha(cerradas[-4:])
    if len(casos) >= 2:
        return ("Varias de tus entradas recientes fueron poco después de una pérdida. "
                "Tomarte un descanso antes de la siguiente operación puede ayudarte a decidir con calma.")
    return None
