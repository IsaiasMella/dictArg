import { useEffect, useRef, type ReactNode } from "react";

import { CloseIcon } from "./icons";

/**
 * Las pantallas que se abren encima de la aplicación: Ajustes y Ayuda.
 *
 * **Es un `<dialog>` nativo, no un portal.** La razón por la que normalmente se
 * recurre a `createPortal` es escapar del `overflow: hidden` y de los contextos de
 * apilamiento de los padres —acá, el `.panel` recorta y la barra lateral apila—. El
 * `<dialog>` con `showModal()` sale al *top layer* del navegador, que está por encima
 * de todo el documento sin importar dónde esté el nodo en el árbol. Resuelve el mismo
 * problema sin mover nada de lugar, y además trae gratis el foco atrapado, el cierre
 * con Escape y el `::backdrop`.
 *
 * Es el mismo camino que ya tomó `ConfirmDialog`, y por el mismo motivo de fondo: el
 * `confirm()` del navegador bloquea el hilo del webview, y ese webview es el que
 * sostiene la máquina de estados del dictado. `showModal()` no bloquea nada porque es
 * un elemento del DOM, no una llamada síncrona al host.
 *
 * **El contenido se monta al abrir y se desmonta al cerrar.** Es deliberado: Ajustes
 * tiene que releer la configuración cada vez que se abre, porque pudo cambiar por
 * afuera.
 */
export default function Modal({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Para lectores de pantalla: el diálogo no tiene título propio, lo pone el panel. */
  label: string;
  children: ReactNode;
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
      className="modal"
      aria-label={label}
      // Escape y el clic en el fondo. Se previene el cierre nativo y se avisa hacia
      // arriba, para que el estado de React siga siendo el dueño de si está abierto.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // El clic en el `::backdrop` llega con el `<dialog>` como destino: adentro del
      // panel el destino es siempre otro nodo. El panel no tiene margen propio, así
      // que no hay ninguna franja del diálogo que se pueda tocar sin querer.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal__panel">
        {children}
        <button
          type="button"
          className="iconbtn modal__close"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
    </dialog>
  );
}
