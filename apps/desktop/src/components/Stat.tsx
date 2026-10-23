/**
 * Un número grande con su etiqueta abajo.
 *
 * Estaba duplicado íntegro en `HomePanel` y en `DashboardPanel`. Dos copias
 * idénticas de siete líneas no molestan hasta que alguien cambia una — y entonces
 * las dos pantallas que muestran las mismas cuentas dejan de verse igual.
 */
export default function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
