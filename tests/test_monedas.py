"""Más monedas: validación, separación por moneda y migración v1 → v2 sin perder datos."""
import sqlite3

from fastapi.testclient import TestClient

from app import calculos, db, patrones
from app.main import app
from tests.test_api import OP


def cliente():
    c = TestClient(app)
    c.__enter__()
    c.delete("/api/todo")
    return c


def test_top5_mas_mxn_disponibles():
    assert set(calculos.MONEDAS) == {"MXN", "USD", "EUR", "JPY", "GBP", "CNY"}
    estado = TestClient(app).get("/api/estado").json()
    assert [m["codigo"] for m in estado["monedas"]] == list(calculos.MONEDAS)


def test_operaciones_por_moneda_no_se_mezclan():
    c = cliente()
    for moneda in ("EUR", "jpy", "GBP", "CNY"):
        assert c.post("/api/operaciones", json={**OP, "moneda": moneda}).status_code == 200
    assert c.get("/api/operaciones?tipo=simulada&moneda=JPY").json()[0]["moneda"] == "JPY"
    s = c.get("/api/estadisticas?tipo=simulada&moneda=EUR").json()["estadisticas"]
    assert s["cerradas"] == 1 and s["resultado_total"] == 95
    assert c.get("/api/estadisticas?tipo=simulada&moneda=MXN").json()["estadisticas"]["cerradas"] == 0


def test_moneda_no_soportada_se_rechaza():
    c = cliente()
    r = c.post("/api/operaciones", json={**OP, "moneda": "ARS"})
    assert r.status_code == 422 and "moneda no válida" in r.text
    assert c.put("/api/ajustes", json={"moneda": "XXX"}).status_code == 422


def test_ajustes_guardan_riesgo_de_cada_moneda():
    c = cliente()
    datos = {"moneda": "GBP", "riesgo_max_gbp": 300, "riesgo_max_jpy": 50000, "reglas_plan": "x"}
    assert c.put("/api/ajustes", json=datos).status_code == 200
    a = c.get("/api/ajustes").json()
    assert a["moneda"] == "GBP" and a["riesgo_max_gbp"] == 300 and a["riesgo_max_jpy"] == 50000


def test_romper_riesgo_usa_el_maximo_de_su_moneda():
    op = {**OP, "id": 1, "moneda": "JPY", "cantidad": 10, "entrada_precio": 100, "stop_inicial": 50}
    casos, oportunidades = patrones.romper_riesgo([op], {"riesgo_max_jpy": 400})
    assert oportunidades == 1 and casos[0]["ids"] == [1]


def test_migracion_v1_conserva_operaciones_y_notas(tmp_path):
    ruta = tmp_path / "viejo.db"
    con = sqlite3.connect(ruta)
    con.executescript(db.MIGRACIONES[1])
    con.execute("PRAGMA user_version = 1")
    con.execute("INSERT INTO operaciones (tipo, ticker, direccion, moneda, entrada_fecha, entrada_precio, cantidad, creada)"
                " VALUES ('real','AAPL','compra','USD','2026-01-01 10:00',100,1,'2026-01-01 10:00')")
    con.execute("INSERT INTO notas (operacion_id, texto, fecha) VALUES (1, 'nota vieja', '2026-01-01 11:00')")
    con.execute("UPDATE ajustes SET riesgo_max_usd = 200")
    con.commit(); con.close()

    db.inicializar(ruta)
    with db.conectar(ruta) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == max(db.MIGRACIONES)
        assert con.execute("SELECT ticker FROM operaciones").fetchone()[0] == "AAPL"
        assert con.execute("SELECT texto FROM notas").fetchone()[0] == "nota vieja"
        assert tuple(con.execute("SELECT riesgo_max_usd, riesgo_max_eur FROM ajustes").fetchone()) == (200, None)
        con.execute("INSERT INTO operaciones (tipo, ticker, direccion, moneda, entrada_fecha, entrada_precio, cantidad, creada)"
                    " VALUES ('real','SAP','compra','EUR','2026-01-02 10:00',100,1,'2026-01-02 10:00')")
        assert con.execute("PRAGMA foreign_key_check").fetchall() == []
        con.execute("DELETE FROM operaciones WHERE id = 1")  # la cascada sigue funcionando
        assert con.execute("SELECT COUNT(*) FROM notas").fetchone()[0] == 0
