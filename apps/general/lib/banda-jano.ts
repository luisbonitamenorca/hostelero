/**
 * Banda de cabecera de Jano para los HTML heredados (datos/*.html): el mismo
 * orden y aspecto que app/cabecera-modulo.tsx — logo (enlaza a Inicio),
 * módulo, cuenta; a la derecha correo, «← Inicio» y «Salir» (ruta /salir,
 * porque desde un HTML estático no se puede llamar a una acción de servidor).
 * La inyecta lib/html-modulo.ts justo después de <body>. Mide 48px y va
 * pegada arriba: los módulos con barra lateral o cabecera sticky se
 * desplazan esos 48px en su propio CSS.
 */
export type CabeceraHtml = {
  modulo: string;
  cuenta: string;
  correo?: string | null;
};

const ESTILO = `
<style id="jano-banda-estilo">
.jano-banda{position:sticky;top:0;z-index:1000;height:48px;box-sizing:border-box;background:#2F3A45;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:15px;line-height:1.3}
.jano-banda *{box-sizing:border-box}
.jano-banda-izq{display:flex;align-items:center;gap:12px;min-width:0}
.jano-banda-logo{display:inline-flex;align-items:baseline;color:#fff;text-decoration:none;font-weight:800;font-size:20px;letter-spacing:-.04em;line-height:1}
.jano-banda-logo svg{width:12.4px;height:12.4px;position:relative;top:.7px;margin-left:.4px;flex:none}
.jano-banda-modulo{font-weight:700;font-size:15px;padding-left:12px;border-left:1px solid rgba(255,255,255,.25);white-space:nowrap}
.jano-banda-cuenta{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}
.jano-banda-der{display:flex;align-items:center;gap:12px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px}
.jano-banda-correo{opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px}
.jano-banda-boton{font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid #DEDFE1;background:#fff;color:#242D36;text-decoration:none;white-space:nowrap;cursor:pointer;line-height:1.4}
.jano-banda-boton:hover{background:#F3F4F0}
@media (max-width:640px){.jano-banda{padding:0 12px;gap:8px}.jano-banda-correo{display:none}.jano-banda-cuenta{display:none}}
@media (prefers-color-scheme:dark){.jano-banda-boton{background:#F3F4F0}}
</style>`;

const ICONO = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><path id="jb-anillo" fill-rule="evenodd" d="M50 4 A46 46 0 0 1 94 31 V69 A46 46 0 0 1 50 96 A46 46 0 0 1 6 69 V31 A46 46 0 0 1 50 4 Z M50 25 A25 25 0 1 0 50 75 A25 25 0 1 0 50 25 Z"/><clipPath id="jb-izq"><rect x="-10" y="-20" width="56" height="140"/></clipPath><clipPath id="jb-der"><rect x="54" y="-20" width="56" height="140"/></clipPath></defs><g fill="currentColor"><use href="#jb-anillo" clip-path="url(#jb-izq)" transform="translate(0 -2.5)"/><use href="#jb-anillo" clip-path="url(#jb-der)" transform="translate(0 2.5)"/></g><circle cx="50" cy="50" r="10" fill="#8FAE8B"/></svg>`;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function bandaJano({ modulo, cuenta, correo }: CabeceraHtml) {
  return (
    ESTILO +
    `<header class="jano-banda">` +
    `<div class="jano-banda-izq">` +
    `<a class="jano-banda-logo" href="/" title="Inicio" aria-label="Jano · Inicio"><span>jan</span>${ICONO}</a>` +
    `<span class="jano-banda-modulo">${esc(modulo)}</span>` +
    `<span class="jano-banda-cuenta">${esc(cuenta)}</span>` +
    `</div>` +
    `<div class="jano-banda-der">` +
    (correo ? `<span class="jano-banda-correo">${esc(correo)}</span>` : "") +
    `<a class="jano-banda-boton" href="/">← Inicio</a>` +
    `<a class="jano-banda-boton" href="/salir">Salir</a>` +
    `</div>` +
    `</header>`
  );
}
