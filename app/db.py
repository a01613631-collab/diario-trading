"""Base de datos SQLite: esquema, versión, respaldos y acceso simple.

Todo vive en un solo archivo: data/diario.db
"""
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CARPETA_DATOS = Path(os.environ.get("DIARIO_DATOS", RAIZ / "data"))
ARCHIVO_DB = CARPETA_DATOS / "diario.db"
CARPETA_RESPALDOS = CARPETA_DATOS / "respaldos"
COPIAS_A_GUARDAR = 7

# Cada versión agrega cambios sin borrar datos. Para agregar un campo nuevo,
# agrega una entrada {3: "ALTER TABLE ..."} y nunca modifiques las anteriores.
MIGRACIONES = {
    1: """
    CREATE TABLE operaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK (tipo IN ('real','simulada')),
        ticker TEXT NOT NULL,
        direccion TEXT NOT NULL CHECK (direccion IN ('compra','venta')),
        moneda TEXT NOT NULL CHECK (moneda IN ('MXN','USD')),
        entrada_fecha TEXT NOT NULL,      -- 'AAAA-MM-DD HH:MM' hora del centro de México
        entrada_precio REAL NOT NULL,
        salida_fecha TEXT,                -- vacía = operación abierta
        salida_precio REAL,
        cantidad REAL NOT NULL CHECK (cantidad > 0),
        stop_inicial REAL,
        stop_final REAL,
        objetivo REAL,
        comision REAL NOT NULL DEFAULT 0,
        motivo_entrada TEXT,
        emocion TEXT,
        creada TEXT NOT NULL,
        editada TEXT
    );
    CREATE TABLE notas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operacion_id INTEGER NOT NULL REFERENCES operaciones(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        fecha TEXT NOT NULL
    );
    CREATE TABLE hallazgos_ia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        tipo TEXT NOT NULL,               -- 'patron' o 'resumen'
        texto TEXT NOT NULL,              -- JSON con los hallazgos
        operaciones_citadas TEXT NOT NULL,-- JSON con ids
        version_prompt TEXT NOT NULL,
        modelo TEXT,
        huella TEXT                       -- hash del paquete enviado (para no repetir llamadas)
    );
    CREATE TABLE noticias_explicadas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        texto_original TEXT NOT NULL,
        explicacion TEXT NOT NULL,        -- JSON
        terminos TEXT NOT NULL,           -- JSON
        huella TEXT NOT NULL UNIQUE
    );
    CREATE TABLE ajustes (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        moneda TEXT NOT NULL DEFAULT 'MXN',
        riesgo_max_mxn REAL,
        riesgo_max_usd REAL,
        reglas_plan TEXT NOT NULL DEFAULT '',
        enviar_motivos_a_ia INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO ajustes (id) VALUES (1);
    -- Registro de TODAS las respuestas de la IA (también las bloqueadas) para revisarlas.
    CREATE TABLE registro_ia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        funcion TEXT NOT NULL,
        modelo TEXT,
        version_prompt TEXT,
        estado TEXT NOT NULL,             -- ok, bloqueada, invalida, error
        respuesta TEXT
    );
    """,
    # v2: más monedas (EUR, JPY, GBP, CNY). SQLite no permite cambiar un CHECK, así que se
    # reconstruye la tabla copiando todo (procedimiento oficial de SQLite, con llaves foráneas
    # apagadas para que las notas no se borren en cascada). La moneda la valida la app.
    2: """
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE operaciones_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK (tipo IN ('real','simulada')),
        ticker TEXT NOT NULL,
        direccion TEXT NOT NULL CHECK (direccion IN ('compra','venta')),
        moneda TEXT NOT NULL CHECK (length(moneda) = 3),
        entrada_fecha TEXT NOT NULL,
        entrada_precio REAL NOT NULL,
        salida_fecha TEXT,
        salida_precio REAL,
        cantidad REAL NOT NULL CHECK (cantidad > 0),
        stop_inicial REAL,
        stop_final REAL,
        objetivo REAL,
        comision REAL NOT NULL DEFAULT 0,
        motivo_entrada TEXT,
        emocion TEXT,
        creada TEXT NOT NULL,
        editada TEXT
    );
    INSERT INTO operaciones_v2 SELECT * FROM operaciones;
    DROP TABLE operaciones;
    ALTER TABLE operaciones_v2 RENAME TO operaciones;
    ALTER TABLE ajustes ADD COLUMN riesgo_max_eur REAL;
    ALTER TABLE ajustes ADD COLUMN riesgo_max_jpy REAL;
    ALTER TABLE ajustes ADD COLUMN riesgo_max_gbp REAL;
    ALTER TABLE ajustes ADD COLUMN riesgo_max_cny REAL;
    PRAGMA user_version = 2;
    COMMIT;
    PRAGMA foreign_keys = ON;
    """,
}


def conectar(ruta: Path | None = None) -> sqlite3.Connection:
    ruta = ruta or ARCHIVO_DB
    con = sqlite3.connect(ruta)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def respaldar(ruta: Path | None = None) -> None:
    """Copia el archivo de la base al iniciar y conserva solo las últimas 7 copias."""
    ruta = ruta or ARCHIVO_DB
    if not ruta.exists():
        return
    carpeta = ruta.parent / "respaldos"
    carpeta.mkdir(parents=True, exist_ok=True)
    marca = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    shutil.copy2(ruta, carpeta / f"diario-{marca}.db")
    copias = sorted(carpeta.glob("diario-*.db"))
    for vieja in copias[:-COPIAS_A_GUARDAR]:
        vieja.unlink()


def inicializar(ruta: Path | None = None) -> None:
    """Crea la base si no existe y aplica las migraciones pendientes."""
    ruta = ruta or ARCHIVO_DB
    ruta.parent.mkdir(parents=True, exist_ok=True)
    respaldar(ruta)
    with conectar(ruta) as con:
        version = con.execute("PRAGMA user_version").fetchone()[0]
        for numero in sorted(MIGRACIONES):
            if numero > version:
                con.executescript(MIGRACIONES[numero])
                con.execute(f"PRAGMA user_version = {numero}")
                con.commit()
