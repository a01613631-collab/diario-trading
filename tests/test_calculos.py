"""Una prueba por fórmula, con resultados calculados a mano (incluye casos borde)."""
from app import calculos as c


def op(**k):
    base = dict(id=1, tipo="simulada", ticker="WALMEX", direccion="compra", moneda="MXN",
                entrada_fecha="2026-03-02 10:00", entrada_precio=100.0, salida_fecha="2026-03-02 12:00",
                salida_precio=110.0, cantidad=10, stop_inicial=95.0, stop_final=95.0, objetivo=120.0, comision=5.0)
    base.update(k)
    return base


def test_resultado_compra():
    assert c.resultado(op()) == (110 - 100) * 10 - 5  # 95


def test_resultado_corto():
    assert c.resultado(op(direccion="venta", salida_precio=90, stop_inicial=105)) == (100 - 90) * 10 - 5  # 95


def test_operacion_abierta_no_cuenta():
    abierta = op(salida_fecha=None, salida_precio=None)
    assert c.resultado(abierta) is None
    s = c.estadisticas([abierta, op(id=2)])
    assert s["cerradas"] == 1 and s["abiertas"] == 1


def test_riesgo_inicial_y_sin_stop():
    assert c.riesgo_inicial(op()) == 50  # |100-95| * 10
    assert c.riesgo_inicial(op(stop_inicial=None)) is None


def test_multiplo_r():
    assert c.multiplo_r(op()) == 95 / 50
    assert c.multiplo_r(op(stop_inicial=None)) is None


def test_tasa_acierto_con_neutra():
    ops = [op(id=1), op(id=2, salida_precio=99, comision=0), op(id=3, salida_precio=100, comision=0)]
    s = c.estadisticas(ops)
    assert s["ganadoras"] == 1 and s["perdedoras"] == 1 and s["neutras"] == 1
    assert s["tasa_acierto"] == round(1 / 3, 4)  # la neutra no es ganadora


def test_factor_beneficio():
    ops = [op(id=1), op(id=2, salida_precio=97)]  # +95 y -35
    assert c.estadisticas(ops)["factor_beneficio"] == round(95 / 35, 4)


def test_factor_beneficio_sin_perdidas():
    assert c.estadisticas([op()])["factor_beneficio"] == "aún sin pérdidas"


def test_caida_maxima():
    # curva por fecha de salida: +95, -205 (=-110), +45 (=-65), -105 (=-170) → pico 95, mínimo -170 → caída 265
    ops = [op(id=1, salida_fecha="2026-03-02 12:00"),
           op(id=2, salida_precio=80, salida_fecha="2026-03-03 12:00"),
           op(id=3, salida_precio=105, salida_fecha="2026-03-04 12:00"),
           op(id=4, salida_precio=90, salida_fecha="2026-03-05 12:00")]
    assert c.caida_maxima(ops) == 265


def test_caida_maxima_ordena_por_salida():
    a = op(id=1, salida_precio=80, salida_fecha="2026-03-05 12:00")  # -205 (sale después)
    b = op(id=2, salida_fecha="2026-03-03 12:00")                    # +95  (sale antes)
    assert c.caida_maxima([a, b]) == 205


def test_caida_maxima_menos_de_dos():
    assert c.caida_maxima([op()]) is None


def test_por_activo_y_dia():
    s = c.estadisticas([op(), op(id=2, ticker="AAPL", salida_precio=97)])
    assert s["por_activo"] == {"AAPL": -35, "WALMEX": 95}
    assert s["por_dia"] == {"lunes": 60}  # 2026-03-02 es lunes
