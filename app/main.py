"""Servidor local (FastAPI). Escucha solo en 127.0.0.1."""
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError, field_validator, model_validator

from . import calculos, csv_io, db, ia, patrones, sintetico

ESTATICOS = Path(__file__).resolve().parent.parent / "static"
EMOCIONES = ["calma", "miedo", "euforia", "recuperar pérdida", "duda", "aburrimiento"]

@asynccontextmanager
async def _inicio(app):
    db.inicializar()  # crea la base, aplica migraciones y hace el respaldo del día
    yield


app = FastAPI(title="Diario de Trading con IA", lifespan=_inicio)


# ------------------------------------------------------------------ Modelos

class OperacionEntrada(BaseModel):
    tipo: Literal["real", "simulada"]
    ticker: str
    direccion: Literal["compra", "venta"]
    moneda: Literal["MXN", "USD"]
    entrada_fecha: str
    entrada_precio: float
    salida_fecha: Optional[str] = None
    salida_precio: Optional[float] = None
    cantidad: float
    stop_inicial: Optional[float] = None
    stop_final: Optional[float] = None
    objetivo: Optional[float] = None
    comision: float = 0
    motivo_entrada: Optional[str] = None
    emocion: Optional[str] = None

    @field_validator("ticker")
    @classmethod
    def _ticker(cls, v):
        v = v.strip().upper()
        if not v:
            raise ValueError("el ticker es obligatorio")
        return v

    @field_validator("entrada_fecha", "salida_fecha")
    @classmethod
    def _fecha(cls, v):
        if v in (None, ""):
            return None
        v = v.replace("T", " ")[:16]
        try:
            datetime.strptime(v, calculos.FORMATO_FECHA)
        except ValueError:
            raise ValueError("usa el formato AAAA-MM-DD HH:MM")
        return v

    @field_validator("emocion")
    @classmethod
    def _emocion(cls, v):
        if v in (None, ""):
            return None
        if v not in EMOCIONES:
            raise ValueError(f"emoción no válida; opciones: {', '.join(EMOCIONES)}")
        return v

    @model_validator(mode="after")
    def _reglas(self):
        if self.cantidad <= 0:
            raise ValueError("la cantidad debe ser mayor que 0")
        if self.entrada_precio <= 0:
            raise ValueError("el precio de entrada debe ser mayor que 0")
        if (self.salida_fecha is None) != (self.salida_precio is None):
            raise ValueError("para cerrar la operación captura fecha Y precio de salida")
        if self.salida_fecha and self.salida_fecha <= self.entrada_fecha:
            raise ValueError("la salida debe ser posterior a la entrada")
        if self.stop_inicial is not None:
            if self.direccion == "compra" and self.stop_inicial >= self.entrada_precio:
                raise ValueError("en una compra el stop va abajo del precio de entrada")
            if self.direccion == "venta" and self.stop_inicial <= self.entrada_precio:
                raise ValueError("en una venta en corto el stop va arriba del precio de entrada")
            if self.stop_final is None:
                self.stop_final = self.stop_inicial
        if self.comision < 0:
            raise ValueError("la comisión no puede ser negativa")
        return self


class Ajustes(BaseModel):
    moneda: Literal["MXN", "USD"] = "MXN"
    riesgo_max_mxn: Optional[float] = None
    riesgo_max_usd: Optional[float] = None
    reglas_plan: str = ""
    enviar_motivos_a_ia: bool = False


class Nota(BaseModel):
    texto: str


class Noticia(BaseModel):
    texto: str


class Filtro(BaseModel):
    tipo: Literal["real", "simulada"]
    moneda: Literal["MXN", "USD"]


class ArchivoCSV(BaseModel):
    contenido: str


# ------------------------------------------------------------------ Ayudas

def _ahora():
    return datetime.now().strftime(calculos.FORMATO_FECHA)


def _operaciones(tipo: str | None = None, moneda: str | None = None) -> list[dict]:
    sql, args = "SELECT * FROM operaciones WHERE 1=1", []
    if tipo:
        sql += " AND tipo = ?"; args.append(tipo)
    if moneda:
        sql += " AND moneda = ?"; args.append(moneda)
    with db.conectar() as con:
        filas = [dict(f) for f in con.execute(sql + " ORDER BY entrada_fecha DESC", args)]
    for op in filas:  # valores calculados al vuelo, nunca guardados
        op["_resultado"] = calculos.resultado(op)
        op["_riesgo"] = calculos.riesgo_inicial(op)
        op["_r"] = calculos.multiplo_r(op)
    return filas


def _ajustes() -> dict:
    with db.conectar() as con:
        return dict(con.execute("SELECT * FROM ajustes WHERE id = 1").fetchone())


def _insertar(con, datos: dict) -> int:
    datos = {**datos, "creada": _ahora()}
    cols = ", ".join(datos)
    cur = con.execute(f"INSERT INTO operaciones ({cols}) VALUES ({', '.join('?' * len(datos))})", list(datos.values()))
    return cur.lastrowid


# ------------------------------------------------------------------ Operaciones (RF1, RF2)

@app.get("/api/operaciones")
def listar(tipo: Optional[str] = None, moneda: Optional[str] = None):
    return _operaciones(tipo, moneda)


@app.post("/api/operaciones")
def crear(op: OperacionEntrada):
    with db.conectar() as con:
        nuevo = _insertar(con, op.model_dump())
    return {"id": nuevo}


@app.put("/api/operaciones/{op_id}")
def editar(op_id: int, op: OperacionEntrada):
    datos = op.model_dump()
    datos["editada"] = _ahora()  # si la emoción se edita después, queda la fecha de edición
    with db.conectar() as con:
        sets = ", ".join(f"{k} = ?" for k in datos)
        cur = con.execute(f"UPDATE operaciones SET {sets} WHERE id = ?", [*datos.values(), op_id])
    if cur.rowcount == 0:
        raise HTTPException(404, "operación no encontrada")
    return {"ok": True}


@app.delete("/api/operaciones/{op_id}")
def borrar(op_id: int):
    with db.conectar() as con:
        con.execute("DELETE FROM operaciones WHERE id = ?", (op_id,))
    return {"ok": True}


@app.delete("/api/todo")
def borrar_todo():
    """Borra todos los datos (derecho de cancelación). El respaldo del inicio se conserva."""
    with db.conectar() as con:
        for tabla in ("notas", "operaciones", "hallazgos_ia", "noticias_explicadas", "registro_ia"):
            con.execute(f"DELETE FROM {tabla}")
    return {"ok": True}


@app.get("/api/operaciones/{op_id}/notas")
def notas(op_id: int):
    with db.conectar() as con:
        return [dict(f) for f in con.execute("SELECT * FROM notas WHERE operacion_id = ? ORDER BY fecha", (op_id,))]


@app.post("/api/operaciones/{op_id}/notas")
def agregar_nota(op_id: int, nota: Nota):
    if not nota.texto.strip():
        raise HTTPException(422, "la nota está vacía")
    with db.conectar() as con:
        con.execute("INSERT INTO notas (operacion_id, texto, fecha) VALUES (?, ?, ?)", (op_id, nota.texto.strip(), _ahora()))
    return {"ok": True}


# ------------------------------------------------------------------ Estadísticas (RF3)

@app.get("/api/estadisticas")
def estadisticas(tipo: str = Query(...), moneda: str = Query(...)):
    ops = _operaciones(tipo, moneda)
    return {"estadisticas": calculos.estadisticas(ops), "pausa": patrones.sugerir_pausa(ops, _ajustes())}


# ------------------------------------------------------------------ Comportamiento con IA (RF4)

@app.get("/api/patrones")
def ver_patrones(tipo: str = Query(...), moneda: str = Query(...)):
    return patrones.detectar(_operaciones(tipo, moneda), _ajustes())


@app.post("/api/patrones/explicar")
def explicar(filtro: Filtro):
    ops = _operaciones(filtro.tipo, filtro.moneda)
    ajustes = _ajustes()
    deteccion = patrones.detectar(ops, ajustes)
    if not deteccion["suficientes"]:
        return {"disponible": False, "mensaje": f"Datos insuficientes: se necesitan al menos "
                f"{deteccion['minimo']} operaciones cerradas (tienes {deteccion['cerradas']})."}
    if not deteccion["patrones"]:
        return {"disponible": True, "hallazgos": [], "mensaje": "No se detectaron patrones con los umbrales actuales."}
    paquete = ia.armar_paquete(deteccion, calculos.estadisticas(ops), {o["id"]: o for o in ops},
                               bool(ajustes["enviar_motivos_a_ia"]))
    return ia.explicar_patrones(paquete)


@app.get("/api/hallazgos")
def historial_hallazgos():
    with db.conectar() as con:
        return [dict(f) for f in con.execute("SELECT id, fecha, tipo, texto, modelo, version_prompt FROM hallazgos_ia ORDER BY id DESC LIMIT 20")]


# ------------------------------------------------------------------ Noticias (RF5)

@app.post("/api/noticias")
def noticia(n: Noticia):
    return ia.explicar_noticia(n.texto)


@app.get("/api/noticias")
def historial_noticias():
    with db.conectar() as con:
        return [dict(f) for f in con.execute("SELECT id, fecha, texto_original, explicacion FROM noticias_explicadas ORDER BY id DESC LIMIT 30")]


# ------------------------------------------------------------------ Ajustes

@app.get("/api/ajustes")
def ver_ajustes():
    a = _ajustes()
    a["enviar_motivos_a_ia"] = bool(a["enviar_motivos_a_ia"])
    return a


@app.put("/api/ajustes")
def guardar_ajustes(a: Ajustes):
    with db.conectar() as con:
        con.execute("UPDATE ajustes SET moneda=?, riesgo_max_mxn=?, riesgo_max_usd=?, reglas_plan=?, enviar_motivos_a_ia=? WHERE id=1",
                    (a.moneda, a.riesgo_max_mxn, a.riesgo_max_usd, a.reglas_plan, int(a.enviar_motivos_a_ia)))
    return {"ok": True}


# ------------------------------------------------------------------ CSV (RF6)

@app.get("/api/csv/exportar", response_class=PlainTextResponse)
def exportar_csv():
    ops = sorted(_operaciones(), key=lambda o: o["entrada_fecha"])
    return PlainTextResponse(csv_io.exportar(ops), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=diario.csv"})


@app.post("/api/csv/importar")
def importar_csv(archivo: ArchivoCSV):
    filas, errores = csv_io.leer(archivo.contenido)
    if errores:
        return {"importadas": 0, "duplicadas": 0, "errores": errores}
    existentes = {csv_io.clave(op) for op in _operaciones()}
    importadas, duplicadas, errores = 0, 0, []
    with db.conectar() as con:
        for numero, fila in enumerate(filas, start=2):  # la fila 1 es el encabezado
            try:
                op = OperacionEntrada(**{k: v for k, v in fila.items() if v is not None}).model_dump()
            except ValidationError as e:
                errores.append(f"Fila {numero}: {'; '.join(err['msg'] for err in e.errors())}")
                continue
            if csv_io.clave(op) in existentes:
                duplicadas += 1
                continue
            _insertar(con, op)
            existentes.add(csv_io.clave(op))
            importadas += 1
    return {"importadas": importadas, "duplicadas": duplicadas, "errores": errores}


# ------------------------------------------------------------------ Demo y estado

@app.post("/api/demo")
def cargar_demo():
    """Carga 200 operaciones SIMULADAS con sesgos plantados para probar la app."""
    return {"cargadas": sintetico.cargar_en_db()}


@app.get("/api/estado")
def estado():
    import os
    return {"ia_configurada": bool(os.environ.get("ANTHROPIC_API_KEY")), "modelo": ia.MODELO,
            "llamadas_hoy": ia.llamadas_hoy(), "limite_diario": ia.LIMITE_DIARIO,
            "aviso": ia.AVISO, "emociones": EMOCIONES}


app.mount("/static", StaticFiles(directory=ESTATICOS), name="static")


@app.get("/")
def inicio():
    return FileResponse(ESTATICOS / "index.html")
