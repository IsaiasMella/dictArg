//! Esquema del historial de transcripciones.
//!
//! SQLite alcanza y sobra: es un archivo local, sin servicio aparte, para un
//! único usuario. El archivo vive en el directorio de datos de la app, así que
//! sobrevive a reinstalaciones y actualizaciones.
//!
//! Las migraciones son acumulativas y se aplican solas al arrancar: nunca borrar
//! ni reescribir una versión ya publicada, agregar una nueva abajo. El plugin
//! lleva la cuenta de cuáles corrió y no repite las viejas.
//!
//! El plugin guarda además un checksum del SQL de cada versión: si una base tiene
//! aplicada una versión que acá no está, o el SQL cambió aunque sea un espacio, la
//! base entera deja de abrirse ("migration N was previously applied but is missing
//! in the resolved migrations") y el historial no se lee ni se guarda. Por eso las
//! versiones 3 y 4 siguen acá aunque hoy nada use esas columnas ni la tabla
//! `snippets`: hay bases que ya las tienen, y su SQL tiene que quedar textual.

use tauri_plugin_sql::{Migration, MigrationKind};

/// URL del archivo. El plugin lo resuelve contra el directorio de datos.
pub const DB_URL: &str = "sqlite:voice.db";

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "crea la tabla de transcripciones",
        sql: "
            CREATE TABLE IF NOT EXISTS transcriptions (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                text             TEXT    NOT NULL,
                created_at       TEXT    NOT NULL,
                duration_seconds REAL    NOT NULL DEFAULT 0,
                model            TEXT    NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
                ON transcriptions (created_at DESC);
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "agrega sincronizado_en y el indice para paginar",
        sql: "
            -- Preparación barata para el futuro, decidida en §0.4 de la auditoría.
            -- Hoy no hace nada y cuesta nada. El día que exista app mobile y se
            -- decida sincronizar el historial —con cifrado extremo a extremo, que
            -- es condición innegociable— esta columna es la que dice qué falta
            -- subir. Agregarla ahora evita una migración sobre una base con años
            -- de dictados encima.
            ALTER TABLE transcriptions ADD COLUMN sincronizado_en TEXT;

            -- El índice de la v1 es sólo sobre created_at. La paginación por
            -- cursor ordena por (created_at DESC, id DESC) y necesita las dos
            -- columnas para no terminar escaneando la tabla en cada página.
            CREATE INDEX IF NOT EXISTS idx_transcriptions_cursor
                ON transcriptions (created_at DESC, id DESC);
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 3,
        description: "conserva el crudo, el formateo y la entrega de cada dictado",
        sql: "
            -- Todo nullable: las filas viejas no tienen estos datos y no se les
            -- inventan. Un crudo NULL quiere decir \"no se guardó\", no \"era igual\".
            -- Ver AU-06 de la auditoría del 2026-09-23.

            -- Identificador de la sesión de dictado. Un dictado largo en tramos
            -- comparte el mismo, y `segment_index` los ordena.
            ALTER TABLE transcriptions ADD COLUMN dictation_id TEXT;
            ALTER TABLE transcriptions ADD COLUMN segment_index INTEGER;

            -- Lo que devolvió la transcripción antes de formatear. `text` sigue
            -- siendo el final, el que se pegó.
            ALTER TABLE transcriptions ADD COLUMN raw_text TEXT;

            -- omitido | aplicado | fallback, y un código de por qué. Nunca contenido.
            ALTER TABLE transcriptions ADD COLUMN format_status TEXT;
            ALTER TABLE transcriptions ADD COLUMN format_reason TEXT;

            -- Qué pasó al entregarlo: pendiente | enviado_sin_verificar | no_pegado.
            -- \"enviado_sin_verificar\" es honesto: se mandó Ctrl+V y ninguna app
            -- confirma que lo recibió.
            ALTER TABLE transcriptions ADD COLUMN delivery_status TEXT;

            -- El id del pedido en el servidor y la duración que se cobró, para
            -- soporte. `duration_seconds` sigue siendo la que midió la grabación.
            ALTER TABLE transcriptions ADD COLUMN request_id TEXT;
            ALTER TABLE transcriptions ADD COLUMN stt_duration_seconds REAL;
            ALTER TABLE transcriptions ADD COLUMN language TEXT;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_transcriptions_dictation
                ON transcriptions (dictation_id, segment_index)
                WHERE dictation_id IS NOT NULL;
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 4,
        description: "textos rapidos",
        sql: "
            -- Una frase que se dice y se reemplaza por un texto fijo. Viven acá y no
            -- en el servidor: pueden tener datos personales y no hace falta que salgan.
            -- `clave` es el disparador normalizado (NFC, sin mayúsculas): es lo que
            -- hace único al disparador aunque se escriba distinto.
            CREATE TABLE IF NOT EXISTS snippets (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                disparador  TEXT NOT NULL,
                clave       TEXT NOT NULL UNIQUE,
                texto       TEXT NOT NULL,
                creado_en   TEXT NOT NULL
            );
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 5,
        description: "guarda el diccionario en esta computadora",
        sql: "
            CREATE TABLE IF NOT EXISTS dictionary_terms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                term TEXT NOT NULL COLLATE NOCASE UNIQUE,
                confusions TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );
        ",
        kind: MigrationKind::Up,
    }]
}
