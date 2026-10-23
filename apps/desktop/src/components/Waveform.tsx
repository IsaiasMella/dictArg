import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import { EVENTS } from "../lib/events";

const BAR_COUNT = 14;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
// 14 barras de 3px con 2px de separación = 68px, contra los 128px de antes.
// La onda comunica «te estoy escuchando»; para eso no hace falta que sea ancha.
const MIN_BAR = 3;

/**
 * Onda de voz en vivo.
 *
 * La ventana principal manda un nivel (0..1) por frame; acá se acumula un búfer
 * circular con los últimos `BAR_COUNT` y se dibuja, de modo que la onda se
 * desplaza hacia la izquierda como en un osciloscopio.
 *
 * El búfer y el dibujo viven en refs, no en estado de React: son ~25 cuadros por
 * segundo y re-renderizar el árbol a esa frecuencia sería tirar trabajo a la
 * basura. React monta el canvas una vez y de ahí en más sólo se pinta.
 */
export default function Waveform({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levels = useRef<number[]>(new Array(BAR_COUNT).fill(0));
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      levels.current = new Array(BAR_COUNT).fill(0);
      return;
    }

    const pending = listen<number>(EVENTS.levels, (event) => {
      const value = Number.isFinite(event.payload) ? event.payload : 0;
      levels.current = [...levels.current.slice(1), Math.max(0, Math.min(1, value))];
    });

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    const draw = () => {
      frame.current = requestAnimationFrame(draw);
      if (!canvas || !context) return;

      // El canvas se dimensiona en píxeles físicos y se escala por DPR: de otro
      // modo las barras salen borrosas en pantallas HiDPI.
      const ratio = window.devicePixelRatio || 1;
      const width = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
      const height = 18;
      if (canvas.width !== width * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      // Blanco, como el resto de la pastilla: la paleta es monocromática y el rojo
      // hacía que grabar se leyera como una alarma.
      context.fillStyle = "#fefefe";

      levels.current.forEach((level, index) => {
        const barHeight = Math.max(MIN_BAR, level * height);
        const x = index * (BAR_WIDTH + BAR_GAP);
        const y = (height - barHeight) / 2;
        context.beginPath();
        context.roundRect(x, y, BAR_WIDTH, barHeight, BAR_WIDTH / 2);
        context.fill();
      });
    };

    frame.current = requestAnimationFrame(draw);

    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      void pending.then((off) => off());
    };
  }, [active]);

  return <canvas ref={canvasRef} className="pill__wave" aria-hidden="true" />;
}
