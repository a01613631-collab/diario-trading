"""Inicio (disciplina), calendario, costo de patrones, cerrar, deshacer, tickers y ejemplos."""
from fastapi.testclient import TestClient

from app import calculos, patrones
from app.main import app
from app.sintetico import SESGOS, generar

OP = {"tipo": "real", "ticker": "AMXL", "direccion": "compra", "moneda": "MXN",
      "entrada_fecha": "2026-03-02T10:00", "entrada_precio": 100, "cantidad": 10,
      "stop_inicial": 95, "objetivo": 110, "comision": 0, "emocion": "calma"}


def cliente():
    c = TestClient(app)
    c.__enter__()
    c.delete("/api/todo")
    return c


def op(i, entrada, salida, precio_salida, **k):
    base = dict(id=i, tipo="real", ticker="X", direccion="compra", moneda="MXN", entrada_fecha=entrada,
                entrada_precio=100.0, salida_fecha=salida, salida_precio=precio_salida, cantidad=10,
                stop_inicial=95.0, stop_final=95.0, objetivo=110.0, comision=0, emocion="calma")
    base.update(k)
    return base


def test_calendario_y_emocion():
    ops = [op(1, "2026-03-02 10:00", "2026-03-03 10:00", 110), op(2, "2026-03-02 11:00", "2026-03-03 12:00", 97),
           op(3, "2026-03-04 10:00", "2026-03-04 11:00", 105, emocion="euforia")]
    s = calculos.estadisticas(ops)
    assert s["por_fecha"] == {"2026-03-03": {"resultado": 70, "operaciones": 2}, "2026-03-04": {"resultado": 50, "operaciones": 1}}
    assert s["por_emocion"] == {"calma": 70, "euforia": 50}


def test_disciplina_perfecta_y_con_fallas():
    limpias = generar(5, set(), n=30)
    d = patrones.disciplina(limpias, {"riesgo_max_mxn": 1000})
    assert d["puntaje"] == 100 and d["operaciones"] == 20 and d["racha_dias"] >= 1
    sucias = generar(5, set(SESGOS), n=60)
    assert patrones.disciplina(sucias, {"riesgo_max_mxn": 1000})["puntaje"] < 100
    assert patrones.disciplina([], {})["puntaje"] is None


def test_disciplina_sin_riesgo_maximo_no_evalua_esa_regla():
    d = patrones.disciplina(generar(5, set(), n=25), {})
    assert "riesgo_ok" not in {r["clave"] for r in d["revisiones"]}


def test_racha_se_corta_con_un_dia_que_rompe_el_plan():
    ops = [op(1, "2026-03-02 10:00", "2026-03-02 11:00", 110),
           op(2, "2026-03-03 10:00", "2026-03-03 11:00", 110, stop_inicial=None, stop_final=None),  # sin stop
           op(3, "2026-03-04 10:00", "2026-03-04 11:00", 110), op(4, "2026-03-05 10:00", "2026-03-05 11:00", 97)]
    assert patrones.disciplina(ops, {})["racha_dias"] == 2


def test_costo_del_patron():
    ops = generar(9, {"sin_stop"})
    p = next(p for p in patrones.detectar(ops, {})["patrones"] if p["clave"] == "sin_stop")
    esperado = sum(calculos.resultado(o) for o in ops if o["stop_inicial"] is None)
    assert p["costo"] == round(esperado, 2) and p["promedio_resto"] is not None


def test_inicio_endpoint():
    c = cliente()
    assert c.get("/api/inicio?tipo=real&moneda=MXN").json()["total_operaciones"] == 0
    c.post("/api/operaciones", json={**OP, "salida_fecha": "2026-03-02T12:00", "salida_precio": 108})
    r = c.get("/api/inicio?tipo=real&moneda=MXN").json()
    assert r["total_operaciones"] == 1 and r["disciplina"]["puntaje"] == 100 and len(r["ultimas"]) == 1


def test_cerrar_operacion_abierta():
    c = cliente()
    i = c.post("/api/operaciones", json=OP).json()["id"]
    assert c.post(f"/api/operaciones/{i}/cerrar", json={"salida_fecha": "2026-03-02T09:00", "salida_precio": 105}).status_code == 422
    assert c.post(f"/api/operaciones/{i}/cerrar", json={"salida_fecha": "2026-03-02T15:00", "salida_precio": 105}).status_code == 200
    assert c.get("/api/operaciones").json()[0]["_resultado"] == 50


def test_borrar_y_deshacer_conserva_id_y_notas():
    c = cliente()
    i = c.post("/api/operaciones", json=OP).json()["id"]
    c.post(f"/api/operaciones/{i}/notas", json={"texto": "entré tarde"})
    borrado = c.delete(f"/api/operaciones/{i}").json()
    assert c.get("/api/operaciones").json() == []
    assert c.post("/api/operaciones/restaurar", json={"operacion": borrado["operacion"], "notas": borrado["notas"]}).status_code == 200
    assert c.get("/api/operaciones").json()[0]["id"] == i
    assert c.get(f"/api/operaciones/{i}/notas").json()[0]["texto"] == "entré tarde"
    assert c.post("/api/operaciones/restaurar", json={"operacion": borrado["operacion"]}).status_code == 409


def test_tickers_y_ejemplos():
    c = cliente()
    r = c.post("/api/ejemplos").json()
    assert r["importadas"] == 128 and r["errores"] == []
    t = c.get("/api/tickers").json()
    assert "WALMEX" in t and "AAPL" in t


def test_pwa():
    c = cliente()
    assert c.get("/manifest.webmanifest").status_code == 200
    assert "caches" in c.get("/sw.js").text
