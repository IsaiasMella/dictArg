/**
 * Avisa cuando la Content Security Policy bloquea algo.
 *
 * La CSP se aplicó cerrando la política todo lo posible: `default-src 'self'`, con
 * excepciones sólo para las dos fuentes de Google. Eso es lo correcto, y también es
 * lo que hace que un recurso nuevo —una fuente, un ícono, una llamada a un servicio—
 * falle **en silencio**: el navegador no rompe la página, simplemente no carga la
 * cosa y escribe una línea en una consola que en una app de escritorio nadie tiene
 * abierta.
 *
 * Este listener convierte eso en un mensaje que se ve: en vez de mirar la consola
 * una vez y dar
 * la CSP por buena para siempre, la app avisa cada vez que la política bloquea algo,
 * incluida la vez que alguien agregue un recurso sin acordarse de la política.
 *
 * Se llama antes de montar React, para no perderse los bloqueos del arranque.
 */
export function reportCspViolations(): void {
  document.addEventListener("securitypolicyviolation", (event) => {
    console.error(
      "[dictarg] la CSP bloqueó un recurso.\n" +
        `  recurso:   ${event.blockedURI}\n` +
        `  directiva: ${event.effectiveDirective}\n` +
        `  política:  ${event.originalPolicy}\n` +
        "  Si el recurso es legítimo, agregalo a `security.csp` en tauri.conf.json\n" +
        "  (y a `devCsp`). Si no lo reconocés, no lo agregues: averiguá quién lo pide.",
    );
  });
}
