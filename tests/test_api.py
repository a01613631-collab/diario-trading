"""Flujo completo contra el servidor (base temporal, IA simulada)."""
from fastapi.testclient import TestClient

from app import ia
from app.main import app

OP = {"tipo": "simulada", "ticker": "walmex", "direccion": "compra", "moneda": "MXN",
      "entrada_fecha": "2026-03-02T10:00", "entrada_precio": 100, "salida_fecha": "2026-03-02T12:00",
      "salida_precio": 110, "cantidad": 10, "stop_inicial": 95, "objetivo": 120, "comision": 5,
      "motivo_entrada": "ruptura", "emocion": "calma"}


def cliente():
    c = TestClient(app)
    c.__enter__()
    c.delete("/api/todo")
    return c


def test_registro_y_estadisticas():
    c = cliente()
    assert c.post("/api/operaciones", json=OP).status_code == 200
    ops = c.get("/api/operaciones?tipo=simulada&moneda=MXN").json()
    assert ops[0]["ticker"] == "WALMEX" and ops[0]["_resultado"] == 95 and ops[0]["stop_final"] == 95
    s = c.get("/api/estadisticas?tipo=simulada&moneda=MXN").json()["estadisticas"]
    assert s["resultado_total"] == 95
    # reales y simuladas nunca se mezclan
    assert c.get("/api/estadisticas?tipo=real&moneda=MXN").json()["estadisticas"]["cerradas"] == 0


def test_validaciones():
    c = cliente()
    for cambio, texto in [({"cantidad": 0}, "cantidad"), ({"salida_fecha": "2026-03-02T09:00"}, "posterior"),
                          ({"stop_inicial": 105}, "abajo"), ({"emocion": "feliz"}, "emoción")]:
        r = c.post("/api/operaciones", json={**OP, **cambio})
        assert r.status_code == 422 and texto in r.text


def test_editar_guarda_fecha_de_edicion():
    c = cliente()
    i = c.post("/api/operaciones", json=OP).json()["id"]
    c.put(f"/api/operaciones/{i}", json={**OP, "emocion": "miedo"})
    op = c.get("/api/operaciones").json()[0]
    assert op["emocion"] == "miedo" and op["editada"]


def test_csv_ida_y_vuelta_salta_duplicados_y_reporta_errores():
    c = cliente()
    c.post("/api/operaciones", json=OP)
    texto = c.get("/api/csv/exportar").text
    malo = texto + "simulada,AAPL,compra,USD,2026-03-02 10:00,100,,,-1,,,,0,,\n"
    r = c.post("/api/csv/importar", json={"contenido": malo}).json()
    assert r["importadas"] == 0 and r["duplicadas"] == 1 and len(r["errores"]) == 1


def test_demo_y_patrones_con_ia_simulada(monkeypatch):
    c = cliente()
    assert c.post("/api/demo").json()["cargadas"] == 200
    d = c.get("/api/patrones?tipo=simulada&moneda=MXN").json()
    assert d["suficientes"] and len(d["patrones"]) >= 4

    def falsa(esquema, mensaje, funcion):
        import json, re
        datos = json.loads(re.search(r"<datos>\n(.*)\n</datos>", mensaje, re.S).group(1))
        return ia.RespuestaPatrones(hallazgos=[ia.HallazgoIA(patron=p["clave"], explicacion=f"Pasó {p['veces']} veces.",
                                    pregunta_reflexion="¿Qué dice tu plan?", operaciones_citadas=p["ids_validos"][:2])
                                    for p in datos["patrones"]])
    monkeypatch.setattr(ia, "_llamar", falsa)
    r = c.post("/api/patrones/explicar", json={"tipo": "simulada", "moneda": "MXN"}).json()
    assert r["disponible"] and r["hallazgos"] and not r["de_cache"]
    r2 = c.post("/api/patrones/explicar", json={"tipo": "simulada", "moneda": "MXN"}).json()
    assert r2["de_cache"]  # la segunda vez no se llama a la IA


def test_sin_ia_la_app_sigue_funcionando():
    c = cliente()
    c.post("/api/demo")
    r = c.post("/api/patrones/explicar", json={"tipo": "simulada", "moneda": "MXN"}).json()
    assert r["disponible"] is False and "no disponible" in r["mensaje"].lower()
    assert c.get("/").status_code == 200
