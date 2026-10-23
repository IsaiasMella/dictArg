import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { emit } from "@tauri-apps/api/event";

import { listMicrophones, type MicDevice } from "../lib/audio";
import {
  deleteApiKey,
  getAutostart,
  getSettings,
  saveSettings,
  setApiKey,
  setAutostart,
  type AutostartStatus,
  type KeyStorage,
  type Provider,
  type Settings as SettingsShape,
  type SettingsView,
} from "../lib/bridge";
import { EVENTS } from "../lib/events";
import { verifyDeepgramKey, verifyGroqKey } from "../lib/transcription";
import type { DictationController } from "../state/controller";
import PanelHeader from "./PanelHeader";
import ShortcutRecorder from "./ShortcutRecorder";
import UsagePanel from "./UsagePanel";

const LANGUAGES = [
  { id: "es", label: "Español" },
  { id: "en", label: "Inglés" },
  { id: "", label: "Detectar solo" },
];

const RETENTION = [
  { id: "30", label: "1 mes" },
  { id: "90", label: "3 meses" },
  { id: "180", label: "6 meses" },
  { id: "365", label: "1 año (máximo)" },
];

const STORAGE_COPY: Record<KeyStorage, string> = {
  env: "Viene de una variable de entorno, que tiene prioridad sobre lo guardado acá.",
  keyring: "Guardada en el llavero del sistema.",
  file: "No hay llavero disponible: quedó en un archivo local protegido.",
  none: "Todavía no configurada.",
};

type Feedback = { kind: "ok" | "error"; text: string } | null;

export default function Settings({ controller }: { controller: DictationController }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<SettingsShape | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [micReady, setMicReady] = useState(false);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [autostart, setAutostartState] = useState<AutostartStatus | null>(null);
  const [version, setVersion] = useState("");

  const apply = useCallback((next: SettingsView) => {
    setView(next);
    setDraft({
      shortcut: next.shortcut,
      language: next.language,
      restoreClipboard: next.restoreClipboard,
      showPillWhenIdle: next.showPillWhenIdle,
      micDeviceId: next.micDeviceId,
      userName: next.userName,
      pushToTalk: next.pushToTalk,
      playSounds: next.playSounds,
      historyRetentionDays: next.historyRetentionDays,
      formatting: next.formatting,
      // Lo escribe `set_autostart` del lado de Rust. Viaja igual, y por el mismo
      // motivo: si no viajara, guardar cualquier otra cosa volvería a prender el
      // arranque automático que la persona acababa de apagar.
      autostartOptout: next.autostartOptout,
    });
  }, []);

  useEffect(() => {
    void getSettings().then(apply);
    void getAutostart().then(setAutostartState);
    // La versión sale del binario, no de un texto escrito a mano: es la única forma
    // de que lo que dice la pantalla sea de verdad lo que está corriendo. Vive acá y
    // no suelta en la barra lateral, donde era un número perdido abajo a la izquierda
    // que no le decía nada a nadie hasta que alguien lo necesitaba para soporte.
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, [apply]);

  /**
   * Relee la configuración después de tocar una credencial.
   *
   * También avisa al controlador: si acaba de aparecer la key de Deepgram, el
   * próximo dictado tiene que poder salir sin reiniciar la app.
   */
  const reload = useCallback(async () => {
    apply(await getSettings());
    await controller.reloadSettings();
    // Y al resto de la aplicación: las pantallas que dependen de los ajustes escuchan
    // este aviso para releerlos.
    await emit(EVENTS.settingsChanged);
  }, [apply, controller]);

  const run = async (job: string, task: () => Promise<Feedback>) => {
    setBusy(job);
    setFeedback(null);
    try {
      setFeedback(await task());
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  if (!view || !draft) {
    return (
      <>
        <PanelHeader title="Ajustes" subtitle="Micrófono, atajo y transcripción." />
        <div className="panel__body scroll">
          <div className="skeleton__stack" aria-hidden="true">
            <span className="skeleton skeleton--card" />
            <span className="skeleton skeleton--card skeleton--card-tall" />
            <span className="skeleton skeleton--card" />
          </div>
        </div>
      </>
    );
  }

  const dirty =
    draft.shortcut !== view.shortcut ||
    draft.language !== view.language ||
    draft.restoreClipboard !== view.restoreClipboard ||
    draft.showPillWhenIdle !== view.showPillWhenIdle ||
    draft.micDeviceId !== view.micDeviceId ||
    draft.historyRetentionDays !== view.historyRetentionDays ||
    draft.userName !== view.userName ||
    draft.pushToTalk !== view.pushToTalk ||
    draft.playSounds !== view.playSounds ||
    draft.formatting !== view.formatting;

  const shortcutFellBack =
    view.effectiveShortcut !== "" && view.effectiveShortcut !== view.shortcut;

  const save = () =>
    run("save", async () => {
      const next = await saveSettings(draft);
      apply(next);
      await controller.reloadSettings();
      await emit(EVENTS.settingsChanged);
      // Si cambió el dispositivo hay que reabrir el stream ya: si no, el próximo
      // dictado seguiría grabando del micrófono anterior.
      if (draft.micDeviceId !== view.micDeviceId && controller.micReady) {
        await controller.warmUpMic(draft.micDeviceId);
      }
      return next.effectiveShortcut === draft.shortcut
        ? { kind: "ok", text: "Guardado." }
        : {
            kind: "error",
            text: `Guardado, pero el sistema rechazó ${draft.shortcut}. Quedó activo ${next.effectiveShortcut}.`,
          };
    });

  return (
    <>
      <PanelHeader title="Ajustes" subtitle="Micrófono, atajo y transcripción.">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!dirty || busy !== null}
          onClick={() => void save()}
        >
          {busy === "save" ? "Guardando…" : "Guardar cambios"}
        </button>
      </PanelHeader>

      <div className="panel__body scroll">
      {feedback && <p className={`notice notice--${feedback.kind}`}>{feedback.text}</p>}

      <div className="settings">
        {/* ── Nombre ── */}
        <div className="setting">
          <div className="setting__text">
            <span className="setting__label">Tu nombre</span>
            <span className="setting__note">
              Para el saludo de Inicio y para identificar el informe de uso cuando lo compartas.
            </span>
          </div>
          <div className="setting__control">
            <input
              type="text"
              className="input input--boxed input--narrow"
              placeholder="Cómo te llamamos"
              value={draft.userName}
              maxLength={40}
              onChange={(event) => setDraft({ ...draft, userName: event.target.value })}
            />
          </div>
        </div>

        {/* La clave queda en el llavero local y el pedido sale desde Rust. */}
        <ApiKeyField
          provider="deepgram"
          label="API key de Deepgram"
          requirement="Necesaria para transcribir con tu cuenta de Deepgram."
          placeholder="Pegá tu key de console.deepgram.com"
          storage={view.keyStorage.transcription}
          present={view.keys.transcription}
          verify={verifyDeepgramKey}
          busy={busy}
          run={run}
          onChanged={reload}
        />

        <Toggle
          label="Formatear el texto"
          note="Antes de pegar, saca muletillas, corrige la puntuación y pasa números y listas a su forma escrita. Usa Groq: sin su API key, el texto se pega tal cual salió de la transcripción."
          on={draft.formatting}
          onChange={(formatting) => setDraft({ ...draft, formatting })}
          // Sólo avisa: el dictado sigue funcionando y pega el texto sin formatear.
          warning={
            draft.formatting && !view.keys.formatting
              ? "Falta la API key de Groq. Sin ella, el texto se pega sin formatear. Cargala acá abajo o en el .env."
              : undefined
          }
        />

        {draft.formatting && (
          <ApiKeyField
            provider="groq"
            label="API key de Groq"
            requirement="Opcional: sin esto se dicta igual, pero el texto sale sin formatear."
            placeholder="gsk_..."
            storage={view.keyStorage.formatting}
            present={view.keys.formatting}
            verify={verifyGroqKey}
            busy={busy}
            run={run}
            onChanged={reload}
          />
        )}

        {/* ── Micrófono ── */}
        <div className="setting setting--stacked">
          <div className="setting__text">
            <span className="setting__label">Micrófono</span>
            <span className="setting__note">
              El permiso se pide una sola vez y el micrófono queda abierto, para que grabar arranque
              al instante. Conectalo con esta ventana a la vista: escondida en la bandeja, el
              diálogo del sistema no se vería.
            </span>
          </div>
          <div className="inputrow">
            <select
              className="input input--boxed inputrow__field"
              value={draft.micDeviceId ?? ""}
              disabled={mics.length === 0}
              onChange={(event) => setDraft({ ...draft, micDeviceId: event.target.value || null })}
            >
              <option value="">Micrófono por defecto del sistema</option>
              {mics.map((mic) => (
                <option key={mic.deviceId} value={mic.deviceId}>
                  {mic.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() =>
                run("mic", async () => {
                  await controller.warmUpMic(draft.micDeviceId);
                  setMicReady(true);
                  // Los nombres de los dispositivos recién aparecen con el permiso dado.
                  setMics(await listMicrophones());
                  return { kind: "ok", text: "Micrófono listo." };
                })
              }
            >
              {busy === "mic"
                ? "Pidiendo…"
                : micReady || controller.micReady
                  ? "Reconectar"
                  : "Conectar"}
            </button>
          </div>
        </div>

        {/* ── Atajo ── */}
        <div className="setting setting--stacked">
          <div className="setting__text">
            <span className="setting__label">Atajo global</span>
            <span className="setting__note">
              Primera pulsación graba, segunda transcribe e inserta. Sirve un modificador más una
              tecla, o dos modificadores juntos como el <code>Ctrl+Win</code> que viene por defecto.
            </span>
          </div>
          <ShortcutRecorder
            value={draft.shortcut}
            active={view.effectiveShortcut}
            onChange={(shortcut) => setDraft({ ...draft, shortcut })}
            onCapturingChange={(capturing) => controller.setCapturing(capturing)}
          />
          {/* Alt como único modificador rompe el foco de la aplicación destino:
              el sistema le pasa el Alt suelto y ésta lo lee como acceso al menú. */}
          {/^alt+/i.test(draft.shortcut) && (
            <span className="setting__note setting__note--warn">
              Con Alt como único modificador, Windows le entrega el Alt suelto a la aplicación
              donde estás escribiendo y ésta se lleva el foco al menú: el texto termina pegándose
              en otro lado. Agregale Ctrl o Shift.
            </span>
          )}
          {shortcutFellBack && (
            <span className="setting__note setting__note--warn">
              El sistema rechazó {view.shortcut}. Activo ahora: {view.effectiveShortcut}.
            </span>
          )}
          {view.effectiveShortcut === "" && (
            <span className="setting__note setting__note--warn">
              No hay ningún atajo activo. Probá con otra combinación.
            </span>
          )}
        </div>

        <Toggle
          label="Mantener apretado para hablar"
          note={
            draft.pushToTalk
              ? "Grabás mientras sostenés el atajo y se transcribe al soltarlo. Cómodo para frases cortas."
              : "Ahora alterna: una pulsación empieza, otra termina. Activalo para grabar sosteniendo el atajo."
          }
          on={draft.pushToTalk}
          onChange={(pushToTalk) => setDraft({ ...draft, pushToTalk })}
        />
        <Toggle
          label="Sonidos al empezar y terminar"
          note="Un sonido corto cuando empieza y termina la grabación, para saber que te escuchó sin mirar la pantalla."
          on={draft.playSounds}
          onChange={(playSounds) => setDraft({ ...draft, playSounds })}
        />

        {/* ── Transcripción ── */}
        <Choice
          label="Idioma"
          note="Fijarlo da mejor precisión que dejar que lo detecte solo."
          value={draft.language}
          options={LANGUAGES}
          onChange={(language) => setDraft({ ...draft, language })}
        />
        <Choice
          label="Conservar el historial"
          note="Lo más viejo se borra solo. No hay opción de «para siempre» a propósito: un archivo que nunca se poda crece sin límite."
          value={String(draft.historyRetentionDays)}
          options={RETENTION}
          onChange={(days) => setDraft({ ...draft, historyRetentionDays: Number(days) })}
        />

        <Toggle
          label="No perder lo que tenías copiado"
          note="Después de pegar el dictado, el portapapeles vuelve a lo que tenías antes. Copiás un enlace, dictás, y el enlace sigue ahí. Sólo se devuelve si nadie copió otra cosa mientras tanto."
          on={draft.restoreClipboard}
          onChange={(restoreClipboard) => setDraft({ ...draft, restoreClipboard })}
        />
        <Toggle
          label="Pastilla siempre visible"
          note="Muestra la barrita abajo de la pantalla también cuando no estás dictando."
          on={draft.showPillWhenIdle}
          onChange={(showPillWhenIdle) => setDraft({ ...draft, showPillWhenIdle })}
        />

        {/* ── Arranque: se aplica al instante, no espera a «Guardar cambios» ── */}
        <Toggle
          label="Arrancar con el sistema"
          note={
            autostart?.devBuild
              ? "En modo desarrollo se registra el binario de debug, que necesita el servidor de Vite. Activalo sobre la app instalada."
              : "Dictarg arranca solo al iniciar sesión y se queda en la bandeja."
          }
          on={autostart?.enabled ?? false}
          disabled={autostart === null || busy !== null}
          onChange={(enabled) =>
            void run("autostart", async () => {
              setAutostartState(await setAutostart(enabled));
              // Rust ya guardó la decisión en `settings.json`. El borrador tiene que
              // seguirla, o el próximo «Guardar cambios» la pisaría con el valor
              // viejo. Se actualiza en el lugar y no releyendo todo, para no tirar
              // los cambios que la persona todavía no guardó.
              setDraft((previo) => (previo ? { ...previo, autostartOptout: !enabled } : previo));
              return {
                kind: "ok",
                text: enabled
                  ? "Va a arrancar solo con el sistema."
                  : "Inicio automático desactivado.",
              };
            })
          }
        />
      </div>

        <UsagePanel model={view.model} userName={view.userName} />

        {version && <p className="version">Dictarg v{version}</p>}
      </div>
    </>
  );
}

function Choice({
  label,
  note,
  value,
  options,
  onChange,
}: {
  label: string;
  note: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        <span className="setting__note">{note}</span>
      </div>
      <div className="setting__control">
        <select
          className="input input--boxed"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.id || "auto"} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Toggle({
  label,
  note,
  warning,
  on,
  disabled,
  onChange,
}: {
  label: string;
  note: string;
  /** Un problema a la vista, debajo de la nota. */
  warning?: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        <span className="setting__note">{note}</span>
        {warning && <span className="setting__note setting__note--warn">{warning}</span>}
      </div>
      <div className="setting__control">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          className={`switch ${on ? "is-on" : ""}`}
          disabled={disabled}
          onClick={() => onChange(!on)}
        />
      </div>
    </div>
  );
}

/**
 * Un campo de credencial: pegar, validar contra el proveedor, guardar.
 *
 * Es un componente y no dos bloques copiados porque los dos proveedores hacen
 * exactamente lo mismo con distinta etiqueta y distinto validador.
 */
function ApiKeyField({
  provider,
  label,
  requirement,
  placeholder,
  storage,
  present,
  verify,
  busy,
  run,
  onChanged,
}: {
  provider: Provider;
  label: string;
  /** Si el producto funciona sin esta credencial o no. Es el dato que importa. */
  requirement: string;
  placeholder: string;
  storage: KeyStorage;
  present: boolean;
  verify: (key: string) => Promise<void>;
  busy: string | null;
  run: (job: string, task: () => Promise<Feedback>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [input, setInput] = useState("");

  const saving = busy === `key:${provider}`;
  const deleting = busy === `delete:${provider}`;

  return (
    <div className="setting setting--stacked">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        <span className="setting__note">
          {requirement} {STORAGE_COPY[storage]}
        </span>
      </div>
      <div className="inputrow">
        <input
          type="password"
          className="input input--boxed inputrow__field"
          placeholder={present ? "Pegá una nueva para reemplazarla" : placeholder}
          value={input}
          spellCheck={false}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy !== null || input.trim() === ""}
          onClick={() =>
            void run(`key:${provider}`, async () => {
              const key = input.trim();
              // Se valida ANTES de guardar: una key inválida en el llavero es peor
              // que ninguna, porque la pantalla dice "configurada" y el dictado
              // falla igual.
              await verify(key);
              const stored = await setApiKey(provider, key);
              setInput("");
              await onChanged();
              return {
                kind: "ok",
                text:
                  stored === "keyring"
                    ? "Validada y guardada en el llavero del sistema."
                    : "Validada. Sin llavero: quedó en un archivo local protegido.",
              };
            })
          }
        >
          {saving ? "Probando…" : "Guardar y probar"}
        </button>
      </div>
      {present && storage !== "env" && (
        <button
          type="button"
          className="btn btn--quiet btn--danger btn--start"
          disabled={busy !== null}
          onClick={() =>
            void run(`delete:${provider}`, async () => {
              await deleteApiKey(provider);
              await onChanged();
              return { kind: "ok", text: "API key borrada." };
            })
          }
        >
          {deleting ? "Borrando…" : "Borrar API key"}
        </button>
      )}
    </div>
  );
}
