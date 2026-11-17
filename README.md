# Diario de Trading con IA (MVP)

App web local donde un principiante registra sus operaciones (reales o simuladas) y la IA le explica
**sus propios patrones de conducta** y las noticias en lenguaje simple. **Nunca** dice qué comprar o vender.

> Contenido educativo, no es asesoría de inversión.

## Arranque (un solo comando)

```bash
pip install -r requirements.txt
python run.py
```

Abre http://127.0.0.1:8000. El servidor escucha solo en `127.0.0.1`, así que nadie más en tu Wi-Fi lo ve.

Para activar la IA: copia `.env.example` como `.env` y pon tu `ANTHROPIC_API_KEY`. Sin clave, el diario,
el panel y el detector de patrones funcionan igual; solo las explicaciones dicen "análisis no disponible".

Para probar sin datos reales: en **Ajustes y datos → Cargar 200 operaciones de prueba** (o `python -m app.sintetico`).

## Qué incluye (requerimientos del MVP)

| ID | Qué hace | Dónde |
|----|----------|-------|
| RF1 | Registrar operaciones con entrada/salida (fecha y hora), stop inicial y final, objetivo, comisión, tipo | `app/main.py`, pestaña Registrar |
| RF2 | Motivo de entrada y emoción al entrar (se guarda la fecha si se edita) | Registrar / Diario |
| RF3 | Panel: tasa de acierto, ganancia/pérdida promedio, factor de beneficio, caída máxima, por activo y por día | `app/calculos.py`, pestaña Panel |
| RF4 | Detector de patrones en código + explicación con IA que cita operaciones | `app/patrones.py`, `app/ia.py` |
| RF5 | Explicador de noticias + glosario | `app/ia.py`, pestaña Noticias |
| RF6 | Exportar / importar CSV (salta duplicados, reporta errores por fila) | `app/csv_io.py` |

## Reglas de diseño que el código respeta

- **El código calcula y detecta; la IA solo explica.** Al modelo solo va un paquete con métricas y
  operaciones citadas (sin notas; los motivos de entrada solo si lo activas en Ajustes).
- La IA responde en JSON; cada id citado se valida contra los candidatos del detector o la respuesta se descarta.
- Filtro de salida contra frases de recomendación ("deberías comprar", "precio objetivo"…): se vuelve a pedir
  una vez y, si falla, se muestra un mensaje neutro. Las preguntas tipo "¿compro X?" se redirigen sin llamar a la IA.
- El texto de noticias se trata como dato (no instrucciones), máximo 5,000 caracteres.
- Respuestas guardadas por huella (hash) para no pagar dos veces; tope diario de llamadas (`LIMITE_LLAMADAS_DIARIAS`).
- Todas las respuestas de la IA (también las bloqueadas) quedan en la tabla `registro_ia` para revisarlas.
- Reales y simuladas nunca se mezclan; las estadísticas se muestran por moneda, sin convertir.
- Si rompes tu riesgo máximo 3 veces seguidas o se repite la revancha, aparece una sugerencia de pausa.
- Respaldo automático de `data/diario.db` al iniciar (últimas 7 copias); versión de esquema para migrar sin perder datos.

## Reglas del detector (valores iniciales en `app/patrones.py`)

| Patrón | Regla |
|--------|-------|
| Revancha | Entrada ≤ 60 min después de cerrar una pérdida |
| Stop en contra | Stop final más lejos de la entrada que el inicial |
| Subir tamaño tras perder | Riesgo > 1.5 × mediana de las 20 previas, justo después de una pérdida |
| Cortar ganancias | Ganadora cerrada con menos de la mitad del R planeado |
| Romper regla de riesgo | Riesgo inicial > riesgo máximo de Ajustes |
| Sin stop | Operación sin stop inicial |

Se reporta si aparece ≥ 3 veces y en ≥ 20% de los casos posibles; con menos de 20 operaciones cerradas: "datos insuficientes".

## Pruebas

```bash
python -m pytest -q
```

- `tests/test_calculos.py`: una prueba por fórmula con resultados calculados a mano y casos borde.
- `tests/test_patrones.py`: 20 casos sintéticos (semilla fija) con sesgos plantados; el detector encuentra exactamente esos.
- `tests/test_barreras.py`: 10 preguntas adversariales, filtro de salida, validación de ids.
- `tests/test_api.py`: flujo completo con base temporal e IA simulada.

Pruebas adversariales contra el modelo real (gastan llamadas; córrelas cuando cambies el prompt):

```bash
python -m evals.adversariales_ia
```

## Interfaz

- Modo claro, oscuro o igual al sistema (botones arriba a la derecha; se recuerda tu elección).
- Banner principal por pestaña con tus cifras clave, consejos que rotan y aviso de pausa cuando aplica.
- Animaciones suaves (cambio de pestaña, tarjetas, cifras que cuentan, avisos flotantes) que se
  desactivan solas si tu sistema pide "reducir movimiento".
- Gráficas con los colores del tema: verde/rojo para ganancia/pérdida, siempre con el monto con signo en el tooltip.

## Stack

Python + FastAPI · SQLite · HTML/JS simple + Chart.js · API de Claude (modelo en `MODELO_IA`, por defecto `claude-opus-5-5`;
para bajar costo prueba `claude-haiku-5-5`). Las llamadas usan esfuerzo bajo y el respaldo automático del servidor si
el modelo rechaza una solicitud.
