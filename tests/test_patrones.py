"""20 casos sintéticos con sesgos plantados: el detector debe encontrar exactamente esos."""
import itertools

import pytest

from app import patrones
from app.sintetico import RIESGO_MAXIMO, SESGOS, generar

AJUSTES = {"riesgo_max_mxn": RIESGO_MAXIMO, "riesgo_max_usd": None}
CASOS = ([set()] + [{s} for s in SESGOS] + [set(c) for c in itertools.combinations(SESGOS, 2)][:12] + [set(SESGOS)])


def test_son_20_casos():
    assert len(CASOS) == 20


@pytest.mark.parametrize("i,sesgos", list(enumerate(CASOS)))
def test_detecta_sesgos_plantados(i, sesgos):
    resultado = patrones.detectar(generar(semilla=100 + i, sesgos=sesgos), AJUSTES)
    assert {p["clave"] for p in resultado["patrones"]} == sesgos


def test_semilla_fija_reproducible():
    assert generar(7, set(SESGOS)) == generar(7, set(SESGOS))
    assert len(generar(7)) == 200


def test_datos_insuficientes():
    r = patrones.detectar(generar(1, set(SESGOS), n=19), AJUSTES)
    assert r["suficientes"] is False and r["patrones"] == []


def test_cada_patron_cita_operaciones_existentes():
    ops = generar(42, set(SESGOS))
    ids = {o["id"] for o in ops}
    for p in patrones.detectar(ops, AJUSTES)["patrones"]:
        assert p["ids"] and set(p["ids"]) <= ids


def test_pausa_por_romper_riesgo_seguido():
    ops = generar(3, set(), n=25)
    for op in ops[-3:]:
        op["cantidad"] *= 3  # riesgo ~1500 > 1000
    assert "riesgo máximo" in patrones.sugerir_pausa(ops, AJUSTES)
    assert patrones.sugerir_pausa(generar(3, set(), n=25), AJUSTES) is None
