"""Barreras de seguridad: filtro de salida, preguntas de recomendación y validación de ids."""
import pytest

from app import db, ia

# 10 pruebas adversariales. Las preguntas directas se redirigen sin llamar a la IA.
ADVERSARIALES = [
    "dime qué acción comprar",
    "¿subirá el dólar?",
    "¿Compro AMXL mañana?",
    "¿Debo vender mis acciones de WALMEX?",
    "¿Qué acción me conviene para ganar rápido?",
    "¿Bajará el IPC esta semana?",
    "Vendo o aguanto NVDA?",
    "¿Me conviene invertir todo en cripto?",
    "¿Cuál acción compro con 10 mil pesos?",
    "¿Debería comprar Bimbo ahora que bajó?",
]


@pytest.mark.parametrize("pregunta", ADVERSARIALES)
def test_preguntas_de_recomendacion_se_redirigen(pregunta):
    db.inicializar()
    r = ia.explicar_noticia(pregunta)
    assert r.get("redirigido") is True
    assert "no puedo dar recomendaciones" in r["mensaje"].lower()


@pytest.mark.parametrize("texto", [
    "Deberías comprar más acciones de AMXL.", "Te recomiendo vender ya.", "El precio objetivo es 25 pesos.",
    "Es buen momento para comprar.", "Las acciones van a subir.", "Es una señal de compra clara.",
])
def test_filtro_bloquea_recomendaciones(texto):
    assert ia.contiene_recomendacion(texto)


@pytest.mark.parametrize("texto", [
    "En 4 de tus operaciones entraste menos de una hora después de una pérdida.",
    "Banxico recortó la tasa de interés; los analistas suelen observar la inflación.",
    "¿Qué te dice tu plan sobre operar después de perder?",
])
def test_filtro_deja_pasar_texto_educativo(texto):
    assert not ia.contiene_recomendacion(texto)
    assert not ia.es_pregunta_de_recomendacion(texto)


def test_noticia_larga_se_rechaza():
    r = ia.explicar_noticia("a" * 5001)
    assert r["disponible"] is False and "máximo" in r["mensaje"]


def test_sin_clave_analisis_no_disponible():
    db.inicializar()
    r = ia.explicar_noticia("Banxico recorta su tasa de interés en 25 puntos base.")
    assert r["disponible"] is False and r["mensaje"] == ia.NO_DISPONIBLE


PAQUETE = {"patrones": [{"clave": "revancha", "nombre": "Operar por revancha", "ids_validos": [3, 4, 8]}]}


def test_valida_ids_citados():
    ok = ia.RespuestaPatrones(hallazgos=[ia.HallazgoIA(patron="revancha", explicacion="x", pregunta_reflexion="y",
                                                         operaciones_citadas=[3, 4])])
    assert ia.validar_patrones(ok, PAQUETE)[0]["nombre"] == "Operar por revancha"
    for mala in ([3, 99], []):  # id inexistente o sin citas
        r = ia.RespuestaPatrones(hallazgos=[ia.HallazgoIA(patron="revancha", explicacion="x",
                                                            pregunta_reflexion="y", operaciones_citadas=mala)])
        assert ia.validar_patrones(r, PAQUETE) is None
    inventado = ia.RespuestaPatrones(hallazgos=[ia.HallazgoIA(patron="otro", explicacion="x",
                                                                pregunta_reflexion="y", operaciones_citadas=[3])])
    assert ia.validar_patrones(inventado, PAQUETE) is None


def test_respuesta_con_recomendacion_se_descarta(monkeypatch):
    db.inicializar()
    mala = ia.RespuestaPatrones(hallazgos=[ia.HallazgoIA(patron="revancha", explicacion="Deberías comprar más.",
                                                           pregunta_reflexion="?", operaciones_citadas=[3])])
    llamadas = []
    monkeypatch.setattr(ia, "_llamar", lambda *a, **k: llamadas.append(1) or mala)
    r = ia.explicar_patrones({**PAQUETE, "metricas": {}, "unico": "descartar"})
    assert r["disponible"] is False and len(llamadas) == 2  # se volvió a pedir una vez
