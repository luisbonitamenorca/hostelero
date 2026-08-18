import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Sirve los HTML de módulo (datos/*.html) con dos garantías contra el mal
 * clásico de estas apps de una sola página: quedarse días abiertas con una
 * versión vieja corriendo (le pasaba al equipo con Ratios).
 *
 * 1. Cabecera no-store: cada carga trae la versión recién desplegada.
 * 2. VIGILANTE DE VERSIÓN inyectado antes de </body>: al volver a la pestaña
 *    (y cada 10 min) pregunta a /api/publico/version; si el despliegue ha
 *    cambiado desde que la página arrancó, pinta una banda arriba con un
 *    botón «Actualizar». Nunca recarga solo — un usuario puede estar a media
 *    subida o con el OCR en marcha; decide él con un toque.
 */
const VIGILANTE = `
<script>
(function(){
  var vInicial=null;
  function comprobar(){
    fetch('/api/publico/version',{cache:'no-store'})
      .then(function(r){return r.json();})
      .then(function(d){
        if(vInicial===null){vInicial=d.v;return;}
        if(d.v!==vInicial) avisar();
      })
      .catch(function(){});
  }
  function avisar(){
    if(document.getElementById('aviso-version-nueva'))return;
    var b=document.createElement('div');
    b.id='aviso-version-nueva';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#0F6E56;color:#fff;padding:10px 14px;font:14px system-ui,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)';
    b.textContent='🔄 Hay una versión nueva de la app — toca aquí para actualizar';
    b.onclick=function(){location.reload();};
    document.body.appendChild(b);
  }
  document.addEventListener('visibilitychange',function(){if(!document.hidden)comprobar();});
  setInterval(comprobar,10*60*1000);
  comprobar();
})();
</script>
</body>`;

export async function servirHtmlModulo(
  fichero: string,
  reemplazos: Record<string, string> = {},
) {
  let html = await readFile(path.join(process.cwd(), "datos", fichero), "utf8");
  for (const [marca, valor] of Object.entries(reemplazos)) {
    html = html.replace(marca, valor);
  }
  html = html.replace("</body>", VIGILANTE);
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Sesión y token dentro: jamás se cachea, ni compartido ni local.
      "cache-control": "private, no-store",
    },
  });
}
