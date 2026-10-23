import { useCallback, useEffect, useRef, useState } from "react";

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

/** Traduce un `KeyboardEvent.code` al nombre que entiende el plugin de Tauri. */
function keyName(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Backquote: "Backquote",
    Minus: "Minus",
    Equal: "Equal",
    BracketLeft: "BracketLeft",
    BracketRight: "BracketRight",
    Semicolon: "Semicolon",
    Quote: "Quote",
    Comma: "Comma",
    Period: "Period",
    Slash: "Slash",
    Backslash: "Backslash",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
  };
  return named[code] ?? null;
}

export default function ShortcutRecorder({
  value,
  active,
  onChange,
  onCapturingChange,
}: {
  value: string;
  /** Atajo realmente registrado en el sistema, si hay uno. */
  active: string;
  onChange: (accelerator: string) => void;
  onCapturingChange: (capturing: boolean) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  /** Combinación de solo modificadores a la espera de que se suelten. */
  const pending = useRef<string | null>(null);

  const stop = useCallback(() => setCapturing(false), []);

  useEffect(() => {
    onCapturingChange(capturing);
  }, [capturing, onCapturingChange]);

  useEffect(() => {
    if (!capturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape") {
        setWarning(null);
        stop();
        return;
      }
      const parts: string[] = [];
      if (event.ctrlKey) parts.push("Ctrl");
      if (event.altKey) parts.push("Alt");
      if (event.shiftKey) parts.push("Shift");
      if (event.metaKey) parts.push("Super");

      // Solo modificadores: válido a partir de dos, como Ctrl+Win. Se toma
      // cuando se suelta la combinación, no al apretarla, porque hasta ese
      // momento el usuario podría seguir sumando teclas.
      if (MODIFIER_CODES.has(event.code)) {
        pending.current = parts.length >= 2 ? parts.join("+") : null;
        return;
      }

      const key = keyName(event.code);
      if (!key) {
        setWarning("Esa tecla no se puede usar en un atajo global.");
        return;
      }

      if (parts.length === 0) {
        setWarning("Un atajo necesita al menos un modificador, o dos modificadores juntos.");
        return;
      }

      pending.current = null;
      parts.push(key);
      setWarning(null);
      onChange(parts.join("+"));
      stop();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!MODIFIER_CODES.has(event.code)) return;
      const combo = pending.current;
      if (!combo) return;
      event.preventDefault();
      pending.current = null;
      setWarning(null);
      onChange(combo);
      stop();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [capturing, onChange, stop]);

  return (
    <div>
      <button
        type="button"
        className={`shortcut__button ${capturing ? "is-capturing" : ""}`}
        onClick={() => {
          setWarning(null);
          setCapturing((previous) => !previous);
        }}
        onBlur={stop}
      >
        {capturing ? "Apretá la combinación…" : value || "Sin atajo"}
      </button>

      {capturing && active && (
        // El atajo activo lo sigue interceptando el sistema operativo, así que
        // nunca llega hasta acá. No es un error: ya es el que está puesto.
        <p className="setting__note setting__note--spaced">
          Elegí una combinación distinta de {active}. Esa ya es la actual y el sistema la
          intercepta antes de que llegue acá. <kbd className="kbd">Esc</kbd> para cancelar.
        </p>
      )}

      {warning && <p className="field__error">{warning}</p>}
    </div>
  );
}
