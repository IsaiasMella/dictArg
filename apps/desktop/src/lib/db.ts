import Database from "@tauri-apps/plugin-sql";

/** Debe coincidir con `DB_URL` en `src-tauri/src/db.rs`. */
const DB_URL = "sqlite:voice.db";

export interface Transcription {
  id: number;
  text: string;
  /** ISO 8601 en UTC. */
  createdAt: string;
  durationSeconds: number;
  model: string;
}

/** Fila cruda tal como la devuelve SQLite (snake_case). */
interface Row {
  id: number;
  text: string;
  created_at: string;
  duration_seconds: number;
  model: string;
}

const toTranscription = (row: Row): Transcription => ({
  id: row.id,
  text: row.text,
  createdAt: row.created_at,
  durationSeconds: row.duration_seconds,
  model: row.model,
});

// Una sola conexión por ventana, reusada. `Database.load` corre las migraciones
// pendientes la primera vez, así que conviene no repetirla en cada consulta.
let connection: Promise<Database> | null = null;

function db(): Promise<Database> {
  connection ??= Database.load(DB_URL);
  return connection;
}

/**
 * Un término del vocabulario del usuario.
 *
 * Vive en SQLite, en la tabla `dictionary_terms`. Al dictar, `transcription.ts` manda
 * los términos a Deepgram para sesgar el reconocimiento y reemplaza las confusiones
 * en el texto.
 */
export interface DictionaryTerm {
  id: string;
  /** Cómo hay que escribirlo. */
  termino: string;
  /** Cómo suele salir mal. Vacío = el término sólo sesga el reconocimiento. */
  confusiones: string[];
  creadoEn: string;
}

interface DictionaryRow {
  id: number;
  term: string;
  confusions: string;
  created_at: string;
}

function toDictionaryTerm(row: DictionaryRow): DictionaryTerm {
  return {
    id: String(row.id),
    termino: row.term,
    confusiones: JSON.parse(row.confusions) as string[],
    creadoEn: row.created_at,
  };
}

export async function listDictionary(): Promise<DictionaryTerm[]> {
  const rows = await (await db()).select<DictionaryRow[]>(
    "SELECT id, term, confusions, created_at FROM dictionary_terms ORDER BY term COLLATE NOCASE",
  );
  return rows.map(toDictionaryTerm);
}

export async function addDictionaryTerm(termino: string, confusiones: string[]): Promise<DictionaryTerm> {
  const term = termino.trim();
  if (!term || term.length > 80) throw new Error("La palabra debe tener entre 1 y 80 caracteres.");
  const clean = [...new Set(confusiones.map((c) => c.trim()).filter(Boolean))];
  const handle = await db();
  await handle.execute(
    `INSERT INTO dictionary_terms (term, confusions, created_at) VALUES ($1, $2, $3)
     ON CONFLICT(term) DO UPDATE SET term = excluded.term, confusions = excluded.confusions`,
    [term, JSON.stringify(clean), new Date().toISOString()],
  );
  const rows = await handle.select<DictionaryRow[]>(
    "SELECT id, term, confusions, created_at FROM dictionary_terms WHERE term = $1 COLLATE NOCASE",
    [term],
  );
  return toDictionaryTerm(rows[0]);
}

export async function removeDictionaryTerm(id: string): Promise<void> {
  await (await db()).execute("DELETE FROM dictionary_terms WHERE id = $1", [Number(id)]);
}

export async function saveTranscription(entry: {
  text: string;
  durationSeconds: number;
  model: string;
}): Promise<void> {
  const handle = await db();
  await handle.execute(
    "INSERT INTO transcriptions (text, created_at, duration_seconds, model) VALUES ($1, $2, $3, $4)",
    [entry.text, new Date().toISOString(), entry.durationSeconds, entry.model],
  );
}

/** Los comodines de `LIKE`, mas la propia barra de escape. */
const WILDCARDS = /[\\%_]/g;
const BACKSLASH = "\\";

/**
 * Escapa los comodines de `LIKE` para que un `%` o un `_` tecleados se busquen
 * como caracteres y no como "cualquier cosa".
 *
 * Sin esto, buscar "100%" devuelve todo el historial y buscar "a_b" trae "aXb": el
 * usuario no ve un error, ve resultados equivocados sin saber por que. La barra
 * invertida tambien se escapa porque es el `ESCAPE` de la consulta.
 *
 * Esta afuera de la consulta para poder testearla.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(WILDCARDS, (char) => BACKSLASH + char);
}

/**
 * Cuántos dictados trae cada página del historial.
 *
 * Cincuenta entran de sobra en una pantalla larga y se traen en un parpadeo; el
 * resto llega solo al llegar al final del scroll.
 */
export const PAGE_SIZE = 50;

/** Desde dónde seguir listando. `null` = desde el principio. */
export interface Cursor {
  createdAt: string;
  id: number;
}

export interface Page {
  items: Transcription[];
  /** Con qué seguir pidiendo. `null` = no hay más. */
  next: Cursor | null;
}

/**
 * Una página del historial, más reciente arriba.
 *
 * **La búsqueda consulta toda la base, no lo que está cargado en pantalla.**
 * Antes esto traía 200 filas de una y no había forma de llegar a la 201: con
 * retención de un año y uso diario se pasan las 200 en pocas semanas, y a partir de
 * ahí buscar algo viejo devolvía "Ningún dictado coincide" con el dictado ahí
 * guardado. Con el historial viviendo sólo en la máquina del usuario, lo que
 * no se puede ver desde acá no se puede ver desde ningún lado.
 *
 * La paginación va por cursor sobre `(created_at, id)` y no por `OFFSET`: con
 * OFFSET, un dictado nuevo mientras se scrollea corre todas las páginas siguientes y
 * se termina viendo una fila repetida. El índice `idx_transcriptions_cursor` cubre
 * exactamente ese orden.
 *
 * La búsqueda va por `LIKE` y no por FTS: para un historial personal de unos miles
 * de filas el índice de texto completo no se paga, y así el esquema queda en una
 * sola tabla. Se escapan los comodines para que un `%` tecleado por el usuario se
 * busque como carácter y no como "cualquier cosa".
 */
export async function listTranscriptions(
  search = "",
  cursor: Cursor | null = null,
  limit = PAGE_SIZE,
): Promise<Page> {
  const handle = await db();
  const term = search.trim();

  // Se pide una fila de más para saber si hay página siguiente, sin tener que
  // contar el total en cada scroll.
  const pedido = limit + 1;

  const condiciones: string[] = [];
  const parametros: (string | number)[] = [];

  if (term) {
    parametros.push(`%${escapeLikePattern(term)}%`);
    condiciones.push(`text LIKE $${parametros.length} ESCAPE '${BACKSLASH}'`);
  }

  if (cursor) {
    // El orden es (created_at DESC, id DESC), así que "lo que sigue" es lo que tiene
    // fecha menor, o la misma fecha y un id menor. El id desempata: dos dictados
    // guardados en el mismo milisegundo no pueden hacer que una página saltee uno.
    parametros.push(cursor.createdAt);
    const fecha = `$${parametros.length}`;
    parametros.push(cursor.id);
    const id = `$${parametros.length}`;
    condiciones.push(`(created_at < ${fecha} OR (created_at = ${fecha} AND id < ${id}))`);
  }

  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
  parametros.push(pedido);

  const rows = await handle.select<Row[]>(
    `SELECT * FROM transcriptions
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${parametros.length}`,
    parametros,
  );

  const hayMas = rows.length > limit;
  const items = rows.slice(0, limit).map(toTranscription);
  const ultimo = items[items.length - 1];

  return {
    items,
    next: hayMas && ultimo ? { createdAt: ultimo.createdAt, id: ultimo.id } : null,
  };
}

/** Cuántos dictados coinciden con la búsqueda. Sin término, cuenta todos. */
export async function countTranscriptionsMatching(search = ""): Promise<number> {
  const term = search.trim();
  if (!term) return countTranscriptions();

  const handle = await db();
  const rows = await handle.select<{ total: number }[]>(
    `SELECT COUNT(*) AS total FROM transcriptions WHERE text LIKE $1 ESCAPE '${BACKSLASH}'`,
    [`%${escapeLikePattern(term)}%`],
  );
  return rows[0]?.total ?? 0;
}

export async function deleteTranscription(id: number): Promise<void> {
  const handle = await db();
  await handle.execute("DELETE FROM transcriptions WHERE id = $1", [id]);
}

export async function clearTranscriptions(): Promise<void> {
  const handle = await db();
  await handle.execute("DELETE FROM transcriptions");
}

export async function countTranscriptions(): Promise<number> {
  const handle = await db();
  const rows = await handle.select<{ total: number }[]>(
    "SELECT COUNT(*) AS total FROM transcriptions",
  );
  return rows[0]?.total ?? 0;
}

/**
 * La fecha de corte de la poda, o `null` si no hay que podar nada.
 *
 * Separada del borrado para poder testearla: esta cuenta decide qué datos del
 * usuario se destruyen y **no hay copia en ningún lado**.
 * Un `days` sin sentido —cero, negativo, `NaN`, infinito— tiene que dar `null` y no
 * una fecha cualquiera.
 */
export function pruneCutoff(days: number, now: Date = new Date()): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Borra los dictados más viejos que `days`. `0` conserva todo.
 *
 * Se ejecuta al arrancar y después de cada dictado: el historial se poda solo,
 * sin que el usuario tenga que acordarse. Es también lo mínimo decente en
 * privacidad — nadie quiere que su dictado de hace dos años siga en el disco.
 */
export async function pruneOldTranscriptions(days: number): Promise<number> {
  const cutoff = pruneCutoff(days);
  if (cutoff === null) return 0;

  const handle = await db();
  const result = await handle.execute(
    "DELETE FROM transcriptions WHERE created_at < $1",
    [cutoff],
  );
  return result.rowsAffected ?? 0;
}

/**
 * Una fila liviana por dictado, para las cuentas del panel.
 *
 * El texto no viaja: lo único que interesa de él es cuántas palabras tiene, y
 * eso lo cuenta SQLite contando espacios. Traer miles de transcripciones enteras
 * a memoria para después descartarlas sería tirar megabytes al pedo.
 *
 * El resto de las cuentas se hacen en TypeScript y no en SQL a propósito: casi
 * todas dependen del **día local** del usuario, y `created_at` está en UTC. Con
 * unos pocos miles de filas —un año de uso, que es el techo de retención— la
 * diferencia de velocidad no existe, y el `Date` del navegador sabe de zonas
 * horarias y de horario de verano mucho mejor que un `substr`.
 */
export interface UsageRow {
  createdAt: string;
  seconds: number;
  model: string;
  words: number;
}

export async function listUsageRows(): Promise<UsageRow[]> {
  const handle = await db();
  const rows = await handle.select<
    { created_at: string; duration_seconds: number; model: string; words: number }[]
  >(
    `WITH plano AS (
       SELECT created_at, duration_seconds, model,
              -- Tabulaciones y saltos de linea a espacio. Sin esto no contaban
              -- como separador: tres palabras separadas por saltos daban 1.
              replace(replace(replace(text, char(9), ' '), char(10), ' '), char(13), ' ') AS t
       FROM transcriptions
     ),
     junto AS (
       SELECT created_at, duration_seconds, model,
              -- Colapsa las corridas de espacios. Cuatro pasadas cubren hasta 16
              -- seguidos, que es más de lo que produce cualquier transcriptor; lo que
              -- sobre de ahí sólo puede inflar el número, nunca desinflarlo.
              trim(replace(replace(replace(replace(t, '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')) AS t
       FROM plano
     )
     SELECT created_at,
            duration_seconds,
            model,
            -- Palabras = separadores + 1. Antes se contaban los espacios del texto
            -- crudo, así que dos espacios seguidos inflaban el número y con él las
            -- "palabras por minuto" y el costo por mil palabras.
            CASE
              WHEN t = '' THEN 0
              ELSE length(t) - length(replace(t, ' ', '')) + 1
            END AS words
     FROM junto
     ORDER BY created_at ASC`,
  );

  return rows.map((row) => ({
    createdAt: row.created_at,
    seconds: row.duration_seconds ?? 0,
    model: row.model ?? "",
    words: row.words ?? 0,
  }));
}

export interface UsageSummary {
  dictations: number;
  totalSeconds: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Uso por mes, más reciente primero. */
  months: { month: string; dictations: number; seconds: number }[];
  /**
   * Segundos agrupados por el modelo con el que se transcribió cada dictado.
   *
   * Está acá para que quien muestre plata pueda cotizar **por modelo**, que es la
   * única forma de que dé bien: la tarifa no es la misma para todos y el historial
   * viejo tiene modelos que ya no se usan. Cotizar el total contra un solo modelo
   * da un número equivocado.
   *
   * Agrupar en SQL y no fila por fila da el mismo número —el costo es lineal en los
   * segundos— y evita traerse la tabla entera a memoria para sumar.
   */
  byModel: { model: string; seconds: number }[];
}

/**
 * Resumen de uso agregado.
 *
 * Deliberadamente **no incluye ni una palabra del texto dictado**: son cuentas,
 * no contenido. Así el informe se puede compartir sin entregar nada privado.
 */
export async function usageSummary(): Promise<UsageSummary> {
  const handle = await db();

  const totals = await handle.select<
    { dictations: number; total_seconds: number | null; first_at: string | null; last_at: string | null }[]
  >(
    `SELECT COUNT(*)              AS dictations,
            SUM(duration_seconds) AS total_seconds,
            MIN(created_at)        AS first_at,
            MAX(created_at)        AS last_at
     FROM transcriptions`,
  );

  const months = await handle.select<
    { month: string; dictations: number; seconds: number | null }[]
  >(
    `SELECT substr(created_at, 1, 7) AS month,
            COUNT(*)                 AS dictations,
            SUM(duration_seconds)    AS seconds
     FROM transcriptions
     GROUP BY month
     ORDER BY month DESC`,
  );

  const byModel = await handle.select<{ model: string | null; seconds: number | null }[]>(
    `SELECT model, SUM(duration_seconds) AS seconds
     FROM transcriptions
     GROUP BY model`,
  );

  const row = totals[0];
  return {
    dictations: row?.dictations ?? 0,
    totalSeconds: row?.total_seconds ?? 0,
    firstAt: row?.first_at ?? null,
    lastAt: row?.last_at ?? null,
    months: months.map((m) => ({
      month: m.month,
      dictations: m.dictations,
      seconds: m.seconds ?? 0,
    })),
    byModel: byModel.map((m) => ({
      model: m.model ?? "",
      seconds: m.seconds ?? 0,
    })),
  };
}
