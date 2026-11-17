"""Generador de operaciones sintéticas con sesgos plantados (semilla fija).

Planta exactamente las reglas del detector, así que sirve como "respuesta correcta"
para medirlo. Uso:  python -m app.sintetico   (carga 200 operaciones simuladas)
"""
import random
from datetime import datetime, timedelta

from .calculos import FORMATO_FECHA

SESGOS = ["revancha", "stop_en_contra", "tamano_tras_perder", "cortar_ganancias", "romper_riesgo", "sin_stop"]
TICKERS = ["AMXL", "WALMEX", "GMEXICOB", "FEMSAUBD", "BIMBOA", "CEMEXCPO", "GFNORTEO", "AAPL", "MSFT", "NVDA"]
RIESGO_BASE = 500.0     # riesgo "disciplinado" por operación
RIESGO_MAXIMO = 1000.0  # el que se pone en ajustes


def generar(semilla: int = 42, sesgos: set[str] | None = None, n: int = 200,
            moneda: str = "MXN", tipo: str = "simulada") -> list[dict]:
    rnd = random.Random(semilla)
    sesgos = set(sesgos or [])
    reloj = datetime(2026, 1, 5, 9, 0)
    ops, anterior_perdio = [], False

    for i in range(1, n + 1):
        # Tiempo entre operaciones: disciplinado = 3 a 30 horas. Revancha = 15 a 50 min.
        if i > 1:
            if "revancha" in sesgos and anterior_perdio and rnd.random() < 0.5:
                reloj += timedelta(minutes=rnd.randint(15, 50))
            else:
                reloj += timedelta(minutes=rnd.randint(180, 1800))
        entrada_fecha = reloj

        direccion = rnd.choice(["compra", "compra", "venta"])
        signo = 1 if direccion == "compra" else -1
        entrada = round(rnd.uniform(50, 500), 2)
        r_accion = round(entrada * 0.02, 2)

        riesgo_deseado = RIESGO_BASE * rnd.uniform(0.95, 1.05)
        # Romper el riesgo se planta en una "racha" al inicio (ops 1-60) y subir el tamaño
        # después (ops 81+), para que la mediana de 20 previas no quede inflada por ambos.
        if "tamano_tras_perder" in sesgos and i > 80 and anterior_perdio and rnd.random() < 0.65:
            riesgo_deseado = RIESGO_BASE * 1.8          # grande pero bajo el máximo
        elif "romper_riesgo" in sesgos and i <= 60 and rnd.random() < 0.85:
            riesgo_deseado = RIESGO_BASE * 2.5          # supera el máximo de 1000
        cantidad = max(1, round(riesgo_deseado / r_accion))

        stop_inicial = round(entrada - signo * r_accion, 2)
        objetivo = round(entrada + signo * 2 * r_accion, 2)
        stop_final = stop_inicial
        if "stop_en_contra" in sesgos and rnd.random() < 0.35:
            stop_final = round(entrada - signo * r_accion * 1.5, 2)

        gana = rnd.random() < 0.55
        if gana:
            salida = objetivo
            if "cortar_ganancias" in sesgos and rnd.random() < 0.4:
                salida = round(entrada + signo * r_accion * rnd.uniform(0.3, 0.8), 2)
        else:
            salida = stop_final

        sin_stop = "sin_stop" in sesgos and rnd.random() < 0.3
        duracion = timedelta(minutes=rnd.randint(20, 240))
        reloj = entrada_fecha + duracion

        ops.append({
            "id": i, "tipo": tipo, "ticker": rnd.choice(TICKERS), "direccion": direccion, "moneda": moneda,
            "entrada_fecha": entrada_fecha.strftime(FORMATO_FECHA), "entrada_precio": entrada,
            "salida_fecha": reloj.strftime(FORMATO_FECHA), "salida_precio": salida,
            "cantidad": cantidad,
            "stop_inicial": None if sin_stop else stop_inicial,
            "stop_final": None if sin_stop else stop_final,
            "objetivo": objetivo, "comision": 5.0,
            "motivo_entrada": "Ruptura de resistencia" if gana else "Rebote en soporte",
            "emocion": rnd.choice(["calma", "calma", "miedo", "euforia"]) if not anterior_perdio else "recuperar pérdida",
        })
        anterior_perdio = not gana
    return ops


def cargar_en_db(semilla: int = 42, sesgos: set[str] | None = None) -> int:
    """Carga 200 operaciones simuladas con todos los sesgos (para la demo)."""
    from . import db
    db.inicializar()
    ops = generar(semilla, set(SESGOS) if sesgos is None else sesgos)
    ahora = datetime.now().strftime(FORMATO_FECHA)
    with db.conectar() as con:
        for op in ops:
            datos = {k: v for k, v in op.items() if k != "id"}
            datos["creada"] = ahora
            columnas = ", ".join(datos)
            con.execute(f"INSERT INTO operaciones ({columnas}) VALUES ({', '.join('?' * len(datos))})",
                        list(datos.values()))
        con.execute("UPDATE ajustes SET riesgo_max_mxn = COALESCE(riesgo_max_mxn, ?)", (RIESGO_MAXIMO,))
    return len(ops)


if __name__ == "__main__":
    print(f"Cargadas {cargar_en_db()} operaciones simuladas con sesgos plantados.")
