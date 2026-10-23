import type { ReactNode } from "react";

/**
 * Encabezado del panel: título a la izquierda, acción a la derecha.
 *
 * Lo dibuja cada panel y no la ventana, porque la acción depende de la sección.
 * El botón de guardar vive acá y no al final de la lista de ajustes: enterrado
 * abajo de nueve filas era invisible para quien no conoce la pantalla de memoria.
 */
export default function PanelHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="panel__head">
      <div className="panel__heading">
        <h1 className="panel__title">{title}</h1>
        {subtitle && <p className="panel__sub">{subtitle}</p>}
      </div>
      {children && <div className="panel__actions">{children}</div>}
    </header>
  );
}
