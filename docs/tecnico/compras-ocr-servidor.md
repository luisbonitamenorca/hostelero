# Compras: OCR de la bandeja de correo en el servidor

Fecha: 22-10-2026. Rama `compras-ocr-servidor`. Complementa a [compras.md](compras.md) §4.1-4.3.

## 1. Problema

La ingesta IMAP (`pages/api/compras/ingesta-correo.js`) descubre los correos de `facturas@` en menos de 30 min y
deja los adjuntos en `compras_correo_adjunto` con estado `PENDIENTE`. Pero el OCR (la llamada al modelo, la creación
de `compras_doc`, el descarte de logos, los duplicados…) lo hacía **solo el navegador**: `procesarCola()` en
`datos/compras.html`, al abrir la pantalla de Compras o con el botón «Buscar facturas en el correo».

Medido el 22-10-2026: si nadie tiene Compras abierta (tardes, fines de semana) los adjuntos esperan **12-39 h**
hasta la mañana siguiente. Lucía lo percibía como «no es automático, aparece al día siguiente».

## 2. Solución

El mismo pipeline, en Node, ejecutado por un cron:

| Pieza | Dónde |
|---|---|
| Módulo con el pipeline | `apps/general/lib/compras/ocr-servidor.js` (`procesarColaServidor()`) |
| Endpoint | `apps/general/pages/api/compras/procesar-cola.js` (`maxDuration: 300`) |
| Cron de Vercel | `apps/general/vercel.json`: `5,35 * * * *` (5 min después de cada pasada de la ingesta, que va a `*/30`) |
| GitHub Actions | `.github/workflows/ingesta-correo.yml`: segundo paso, detrás de la ingesta, cada 15 min |
| Middleware | `apps/general/middleware.ts`: la ruta está exenta del guard de login, como `ingesta-correo` |
| Dependencias nuevas | `pdf-lib` (partir PDF con varias facturas), `pdfjs-dist` (texto del PDF para el ALB.-POST-FAC. de Coca-Cola). `sharp` ya lo instala Next (fotos). `pdfjs-dist` va en `serverExternalPackages` de `next.config.mjs`. |

Guarda de autenticación: la misma que la ingesta. `Authorization: Bearer <CRON_SECRET>` (lo manda solo el cron de
Vercel y el workflow), la service key (pruebas a mano) o el token de sesión de un usuario de la plataforma.

A mano:

```bash
curl -H "Authorization: Bearer <CRON_SECRET o service key>" "https://hostelero-app.vercel.app/api/compras/procesar-cola"
```

Admite `?presupuesto=<segundos>` para pasadas cortas de prueba (nunca por encima del tope interno).

## 3. Qué hace exactamente una pasada

1. **Rescate**: los `PROCESANDO` con `claimed_at` de más de 15 min (o sin él) vuelven a `PENDIENTE`. Mismo criterio
   que el navegador en modo automático.
2. **Lotes** de hasta 20 adjuntos `PENDIENTE` (máximo 10 lotes), por `created_at`. Por cada uno:
   - **Reclamo atómico** `PATCH …?id=eq.X&estado=eq.PENDIENTE → PROCESANDO, claimed_at`. Es el mismo PATCH que hace
     el navegador: si el navegador lo cogió un instante antes, la respuesta viene vacía y se pasa al siguiente. Un
     adjunto nunca se procesa dos veces.
   - Descarga del bucket (URL pública; si falla, por la API de storage con la service key), recorte de basura delante
     de `%PDF-`, compresión de fotos (2.000 px, JPEG 0,82), base64 o **vía URL** si pasa de 3 MB o ya falló por tamaño
     (mismo criterio que el navegador).
   - Lee el prefijo `FORZAR FACTURA` / `FORZAR ALBARÁN` del campo `error` (reencolado a mano desde Buzón) y
     `correo_id` nulo (subida desde el móvil), igual que el navegador.
3. **`procesarUno`**: transcripción paso a paso de la del navegador (ver [compras.md](compras.md) §4.3). Mismo orden:
   partición de PDF con varias facturas → ALB.-POST-FAC. → prompt (`construirPromptOCR`, modo `auto` con el paso 0
   anti-ruido) → llamada a `claude-sonnet-4-6` con `max_tokens 16384` → reintento exigiendo JSON → descarte de
   `tipo:"otro"` → autocorrección del cuadro de IVA → NIF/nombre propio → escalada a `claude-opus-5` si no cuadra →
   abonos → albarán por correo descartado (salvo móvil, post-factura, forzado o proveedor con «Envía albaranes por
   email») → fichero al bucket → proveedor (CIF, nombre, alias; alta sin autorizar con guard de CIF) → departamento
   → fusión de folios → duplicado por `hash_doc` (cierra el adjunto enlazado al existente) → cuadre y estado →
   renting por contratos → `INSERT compras_doc` (mismos campos, `raw` íntegro, `origen:'correo'`) → líneas o reparto
   de IVA. Los textos con los que se cierra el adjunto (`ya registrado…`, `página N unida…`, `PDF con N documentos…`)
   son los mismos, así que Buzón los enseña igual.
4. Los trozos de un PDF dividido entran en la cola justo detrás, en la misma pasada.
5. **Errores**: los transitorios (saldo, cuota, 429, timeout, red, 5xx, 413, JSON truncado o roto) devuelven el
   adjunto a `PENDIENTE` con `error: 'reintentable: …'`; el resto lo dejan en `ERROR`. Un 429 con tiempo de sobra
   espera 60 s y reintenta una vez. Un 23503 sobre `compras_proveedor` recarga el maestro y reintenta una vez.
6. Al final, si se guardó algo: `regenerar_reparto_iva`, `aplicar_reparto_cups` y `recalcular_estado_facturas`,
   como hace el navegador al terminar la cola.
7. Devuelve un resumen JSON: `reclamados`, `guardados`, `fusionados`, `duplicados`, `descartados`, `divididos`,
   `reintentables`, `errores`, `corte_por_tiempo`, `pendientes_ahora`, `documentos[]` (uno por adjunto con su
   resultado) y `avisos[]` (lo que el navegador enseñaba como toast: proveedor nuevo, reparto que no cuadra…).

### Tiempo

La función admite 300 s. No se **empieza** ningún documento nuevo pasados 120 s (`PRESUPUESTO_MS` en el endpoint);
cada llamada al modelo tiene un tope de 150 s. Un documento puede necesitar hasta tres llamadas (partición, OCR,
escalada), de ahí el margen. Si al llegar a la escalada no quedan 150 s, el adjunto vuelve a `PENDIENTE` con un
`reintentable: timeout…` en vez de guardarse con la primera lectura: la siguiente pasada lo coge el primero y la
calidad es la misma que en el navegador. Lo reclamado y no empezado cuando se acaba el tiempo vuelve a `PENDIENTE`
en el acto, sin esperar los 15 min del rescate.

En una pasada normal (2-6 adjuntos por media hora) sobra tiempo. En un cierre de mes con 40-50 facturas, cada pasada
hace las que le dan tiempo y el resto esperan a la siguiente (30 min con el cron de Vercel, 15 con Actions) o al
navegador, que sigue funcionando igual.

### Cuenta (multi-tenant)

El navegador veía solo su cuenta por la RLS. Aquí se escribe con la service key, así que:
- los maestros (reglas, proveedores, centros, tipos de IVA, contratos, terminales) se cargan **por cuenta** del
  adjunto (`cuenta_id=eq.`), una vez por pasada;
- la búsqueda de duplicados filtra por `cuenta_id`;
- cada `INSERT` (`compras_doc`, `compras_linea`, `compras_proveedor`, `compras_doc_reparto`, filas hijas de
  `compras_correo_adjunto`) lleva `cuenta_id` explícito (hoy coincide con el `default` de las tablas).
- `buscar_cuenta_a3` se llama con la firma de 2 argumentos, como el navegador (sin filtro de cuenta; el maestro de
  A3 es hoy de una sola cuenta).

## 4. Qué NO cambia

- El navegador sigue procesando igual: al abrir Compras y con el botón. Reclama con el mismo PATCH, así que si el
  cron y el navegador coinciden se reparten los adjuntos sin pisarse.
- Reencolar desde Buzón (volver a `PENDIENTE`, con o sin `FORZAR …`) lo coge indistintamente el cron o el navegador.
- La ingesta IMAP no se toca: sigue con `maxDuration 60` y sus dos fases. El OCR va en una función aparte porque
  con 60 s no cabe.
- El proxy `/api/compras/anthropic` sigue para el navegador. El servidor llama a la API directamente con la misma
  `ANTHROPIC_API_KEY` y registra el consumo en `ia_consumo` con `p_nota: 'servidor'`.

## 5. Mantenimiento: dos copias de las reglas

Las funciones de negocio están **copiadas literalmente** de `compras.html` (el módulo indica de qué líneas, bloques
A-G): normalizadores de NIF y nombre propio, centros y alias, `firmaDup`, `cifValido`, `normName`, `matchProveedor`,
`extraerJson`/`parseJson`, `cuadreFactura`, `lecturaEvaluable`, `construirPromptOCR` (el prompt entero),
`codIvaDePct`, `autocorregirDesglose`, `repartoPorContratos`, `guardarRepartoContratos`, `guardarRepartoIva`,
`fusionarPaginaAlbaran`, `guardarLineasDoc`, `cuadreAlbaranes`. Los únicos cambios: reciben `ctx` (maestros de la
cuenta) en vez de globales de la página, y los INSERT llevan `cuenta_id`.

**Si se cambia una regla o el prompt en `compras.html`, hay que cambiarla también en `ocr-servidor.js`**, y al revés.
Es deuda asumida a propósito (cambios directos, sin refactor del HTML). La forma limpia a futuro es que el navegador
importe estas funciones del mismo módulo (o que deje de hacer OCR y solo enseñe la cola).

## 6. Prueba contra producción (22-10-2026)

Ver el apartado «Prueba» al final: se reencoló de forma controlada un adjunto real y se comparó el `compras_doc`
creado por el servidor con el que había creado el navegador esa misma mañana.

## 7. Operación

| Qué | Cómo |
|---|---|
| Ver si va al día | Buzón de Compras (adjuntos `PENDIENTE` con más de 30 min = algo falla) o `pendientes_ahora` en la respuesta del endpoint. |
| Logs | Vercel → hostelero-app → Logs, función `/api/compras/procesar-cola`. Cada adjunto con error sale como `OCR servidor, adjunto <id>: <motivo>`. |
| Lanzar a mano | el `curl` de §2, o «Run workflow» en Actions (hace ingesta + OCR). |
| Pararlo | quitar la entrada de `vercel.json` y el paso del workflow. El navegador sigue procesando. |
| Un adjunto en `ERROR` | igual que antes: reencolar desde Buzón (vuelve a `PENDIENTE`). |

## 8. Pendientes y riesgos

- Si Vercel corta la función a mitad de un documento (300 s), el adjunto queda `PROCESANDO` hasta el rescate (15 min)
  y se reprocesa; si el `compras_doc` ya se había insertado, el duplicado por `hash_doc` lo detecta y enlaza. Puede
  quedar un fichero huérfano en el bucket.
- `pdfjs-dist` en Node avisa si no hay `canvas`; solo se usa para texto, no hace falta.
- Dos copias de las reglas (§5).
- La escalada a Opus y la partición consumen tiempo; con 40-50 facturas de golpe una pasada no acaba la cola
  (lo hace la siguiente).
