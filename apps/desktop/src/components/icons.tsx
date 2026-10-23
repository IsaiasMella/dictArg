/**
 * Íconos de la interfaz, dibujados como SVG de trazo sobre una grilla de 20px.
 * Nada de emoji: escalan mal, no se recolorean y cambian de forma según el
 * sistema operativo.
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Icon({ children, size = 17 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      {children}
    </svg>
  );
}

export const HomeIcon = () => (
  <Icon>
    <path d="M3.5 8.2L10 3l6.5 5.2V16a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V8.2z" {...stroke} />
  </Icon>
);

export const HistoryIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7" {...stroke} />
    <path d="M10 6v4.3l2.8 1.7" {...stroke} />
  </Icon>
);

export const BookIcon = () => (
  <Icon>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v14H5.5A1.5 1.5 0 0 1 4 15.5v-11z" {...stroke} />
    <path d="M7 7h5M7 10h6" {...stroke} />
  </Icon>
);

export const ChartIcon = () => (
  <Icon>
    <path d="M3.5 16.5h13" {...stroke} />
    <path d="M6 16.5v-4.2M10 16.5V6.5M14 16.5v-6.6" {...stroke} />
  </Icon>
);

export const GearIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="2.6" {...stroke} />
    <path
      d="M10 2.6v2M10 15.4v2M17.4 10h-2M4.6 10h-2M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4M15.2 15.2l-1.4-1.4M6.2 6.2L4.8 4.8"
      {...stroke}
    />
  </Icon>
);

export const HelpIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7" {...stroke} />
    <path d="M8.2 8a1.9 1.9 0 1 1 2.4 1.8c-.4.1-.6.5-.6.9v.4" {...stroke} />
    <circle cx="10" cy="13.7" r="0.8" fill="currentColor" />
  </Icon>
);

export const PanelIcon = () => (
  <Icon>
    <rect x="2.8" y="4" width="14.4" height="12" rx="2.2" {...stroke} />
    <path d="M8 4v12" {...stroke} />
  </Icon>
);

export const AccountIcon = () => (
  <Icon>
    <circle cx="10" cy="7.6" r="2.9" {...stroke} />
    <path d="M4.6 16.4c.7-2.6 2.8-4 5.4-4s4.7 1.4 5.4 4" {...stroke} />
  </Icon>
);

export const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="icon">
    <circle cx="7" cy="7" r="4.6" fill="none" stroke="#7a7a7a" strokeWidth="1.3" />
    <path d="M10.4 10.4L14 14" stroke="#7a7a7a" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/* Controles de ventana: trazos de 11px, alineados con los de Windows. */
export const MinimizeIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
    <path d="M1 5.5h9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export const MaximizeIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
    <rect x="1.3" y="1.3" width="8.4" height="8.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
    <path
      d="M1.6 1.6l7.8 7.8m0-7.8l-7.8 7.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

export const CopyIcon = () => (
  <Icon size={15}>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2" {...stroke} />
    <path d="M13 4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13" {...stroke} />
  </Icon>
);

export const TrashIcon = () => (
  <Icon size={15}>
    <path d="M3.8 5.6h12.4M8 5.6V4.2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.4" {...stroke} />
    <path d="M5.4 5.6l.7 10a1 1 0 0 0 1 .9h5.8a1 1 0 0 0 1-.9l.7-10" {...stroke} />
  </Icon>
);

export const CheckIcon = () => (
  <Icon size={15}>
    <path d="M4.5 10.4l3.4 3.3 7.6-7.4" {...stroke} />
  </Icon>
);
