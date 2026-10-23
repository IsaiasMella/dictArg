import { useEffect, useRef } from "react";

/**
 * Confirmación para acciones destructivas.
 *
 * **No usa `confirm()` del navegador a propósito.** El `confirm` nativo bloquea el
 * hilo del webview mientras está abierto, y en esta app ese webview es el que sostiene
 * la máquina de estados del dictado: un diálogo abierto es un dictado que no puede
 * arrancar ni terminar.
 *
 * Sobre `<dialog>` nativo y no un div flotante: da el foco atrapado, el cierre con
 * Escape y el `::backdrop` sin escribirlos a mano, y `showModal()` no bloquea nada
 * porque es un elemento del DOM, no una llamada síncrona del host.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancelar",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Pinta el botón de confirmar como destructivo y le deja el foco al de cancelar. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className="confirm"
      // El evento `cancel` es Escape y el clic en el backdrop. Se previene el cierre
      // nativo y se avisa hacia arriba, para que el estado de React siga siendo el
      // dueño de si el diálogo está abierto.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 className="confirm__title">{title}</h2>
      <div className="confirm__body">{body}</div>
      <div className="confirm__actions">
        {/* El foco arranca en Cancelar: en una acción irreversible, el Enter reflejo
            tiene que no hacer nada. */}
        <button type="button" className="btn" onClick={onCancel} autoFocus={danger}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? "btn btn--destructive" : "btn btn--primary"}
          onClick={onConfirm}
          autoFocus={!danger}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
