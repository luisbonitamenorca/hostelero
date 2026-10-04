# Pedidos a proveedores · plan y contrato (04-10-2026)

Petición de Luis: que cocineros y camareros hagan los pedidos **por voz en lenguaje natural**
(castellano y menorquín, «una caixa de pa blanc»), Hostelero los traduzca a líneas de pedido reales,
el empleado revise y envíe. Además del pedido clásico por catálogo. Y cerrar el círculo con los
proveedores: **catálogo completo con sus códigos** y **albaranes por email**, para cotejar
**pedido ↔ albarán ↔ factura** sin esfuerzo (foto solo a los albaranes con incidencias o boli).

Referencia: lo que Victor (Club IA) contó del gestor de Distribuciones Catchot.

## 0. Lo que ya existe (no tocar sin necesidad)

- Compras (`apps/general/datos/compras.html`, OCR de facturas/albaranes): `compras_proveedor` (265),
  `compras_producto` (2.166; ref_proveedor, codigo_interno, nombre, proveedor_id, ultimo_precio),
  `compras_doc` (tipo albarán/factura, proveedor_id, fecha, factura_id = albarán→factura,
  albaranes_detectados), `compras_linea` (18.608; doc_id, producto_id, producto, cantidad,
  precio_unit), `compras_doc_reparto.centro_coste` (int) → `compras_centro_coste` → centro.
- Ingesta de correo de Compras (`pages/api/compras/ingesta-correo.js`, IMAP; claves de Infotelecom
  pendientes): por ahí entrarán los albaranes en PDF que manden los proveedores.
- `ANTHROPIC_API_KEY` ya está en Vercel (la usa Compras). `RESEND_API_KEY` para email.
- Módulos y permisos: tablas `modulos`, `modulos_contratados`, `modulos_concedidos`,
  `modulos_vetados`; `ACCESO_POR_ROL` en `lib/supabase/server.ts`; `exigirModulo("…")`.
- Empleados (rol `empleado`) van a `/empleado`; solo entran a módulos con concesión expresa.

## 1. Datos (migración `20261004120000_pedidos.sql`, solo aditiva)

Todas las tablas nuevas: `cuenta_id uuid not null default cuenta_actual() references cuentas`,
RLS `cuenta_id = (select cuenta_actual()) or (select es_operador())`, nada para anon, revocar
truncate/references/trigger de authenticated, funciones con `set search_path = public, pg_temp`.

### 1.1 Proveedor (columnas nuevas en `compras_proveedor`)
`pedido_canal` (email | whatsapp | telefono | portal, def. email), `pedido_email`, `pedido_whatsapp`,
`pedido_telefono`, `pedido_minimo numeric`, `pedido_dias_reparto int[]` (ISO 1-7),
`pedido_hora_corte time`, `pedido_notas`, `albaranes_por_email boolean def false`,
`catalogo_actualizado_en timestamptz`, `pedible boolean def true`.

### 1.2 Producto (columnas nuevas en `compras_producto`)
`unidad` (caja, kg, unidad, litro, paquete, docena, saco, garrafa, botella, bandeja…),
`formato` (texto: «caja 20 u», «saco 25 kg»), `unidades_formato numeric`, `precio_catalogo numeric`,
`categoria`, `codigo_barras`, `alias text[]`, `activo boolean def true`, `pedible boolean def true`,
`origen` (factura | catalogo | manual, def. factura), `catalogo_en timestamptz`.
Índice único parcial `(cuenta_id, proveedor_id, lower(ref_proveedor)) where ref_proveedor is not null`
**solo si no hay duplicados** (si los hay, índice normal y lo deja anotado).

### 1.3 Pedidos
- `compras_pedido`: id, cuenta_id, `numero` (texto «P-2026-0001», único por cuenta, lo pone un
  trigger con contador por cuenta y año), `centro_id` → centros, `proveedor_id` → compras_proveedor,
  `estado` (borrador | enviado | confirmado | recibido_parcial | recibido | cancelado),
  `fecha_entrega date`, `notas`, `origen` (voz | texto | catalogo | mixto), `transcripcion text`,
  `interpretacion jsonb` (salida de la IA, para auditoría y aprendizaje), `idioma`,
  `creado_por uuid`, `enviado_por uuid`, `enviado_en`, `canal_envio`, `total_estimado numeric`,
  `albaran_doc_id uuid → compras_doc`, `factura_doc_id uuid → compras_doc`,
  `cotejo_estado` (pendiente | ok | diferencias | sin_documentos, def. pendiente),
  `cotejo_detalle jsonb`, `cotejado_en`, `creado_en`, `actualizado_en` (+ trigger de sello).
- `compras_pedido_linea`: id, cuenta_id, `pedido_id` (on delete cascade), `producto_id` null →
  compras_producto, `texto_original`, `descripcion` (lo que se pide si no hay producto),
  `cantidad numeric > 0`, `unidad`, `precio_estimado`, `confianza numeric` (0-1, de la IA),
  `nota`, `orden`, `cantidad_albaran`, `precio_albaran`, `cantidad_factura`, `precio_factura`,
  `estado_cotejo` (ok | falta | sobra | cantidad | precio | sustituido | sin_dato).
- `compras_pedido_alias` (aprendizaje): id, cuenta_id, `centro_id` null, `proveedor_id` null,
  `frase` (como la dijo el empleado), `frase_norm` (minúsculas, sin acentos ni signos),
  `producto_id` → compras_producto, `unidad`, `idioma`, `usos int def 1`, `creado_por`,
  `creado_en`, `ultimo_uso`; único `(cuenta_id, frase_norm, producto_id)`.
- `compras_catalogo_import`: id, cuenta_id, proveedor_id, archivo, filas, creados, actualizados,
  errores, detalle jsonb, creado_por, creado_en.

### 1.4 Funciones (security invoker salvo que se justifique)
- `pedidos_catalogo_centro(p_centro uuid, p_proveedor uuid default null, p_dias int default 365)`
  → productos pedibles con frecuencia de compra en ese centro (vía reparto de la factura; si un
  documento no tiene reparto, cuenta para todos los centros del proveedor), última cantidad,
  último precio, unidad/formato; ordenados por frecuencia. Es el contexto que se da a la IA y la
  lista «favoritos» del pedido por catálogo.
- `pedidos_sugerir_documentos(p_pedido uuid)` → albaranes/facturas del mismo proveedor entre
  fecha_entrega − 3 y + 10 días, no vinculados a otro pedido, con puntuación por coincidencia de
  productos.
- `pedidos_cotejar(p_pedido uuid)` → compara líneas del pedido con las del albarán y la factura
  vinculados (por producto_id; si falta, por ref/nombre normalizado), rellena los campos de cotejo
  de cada línea (+ líneas «sobra» en el detalle) y `cotejo_estado`/`cotejo_detalle`.
- Seeds: módulo `pedidos` («Pedidos», Operaciones, beta) en `modulos` y contratado para Bonita
  (082c5366-d9ae-49b9-a8b8-8caad73985bd).

## 2. IA de interpretación (`apps/general/lib/pedidos-ia.ts`)

- SDK oficial `@anthropic-ai/sdk` (se añade a apps/general) + `zod`; `client.messages.parse` con
  `output_config.format = zodOutputFormat(Esquema)`; modelo **`claude-opus-5-5`**, `effort: "low"`
  (tarea de extracción; se sube si la calidad no llega), refusals: comprobar `stop_reason`, y
  activar los fallbacks del servidor (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`)
  si el SDK instalado lo admite con parse; si no, documentarlo.
- Claude no recibe audio: la voz se pasa a texto en el navegador (Web Speech API, `es-ES` o
  `ca-ES` a elección del usuario, recordado) y se envía el texto; siempre hay alternativa escrita.
- Contexto: catálogo del centro (top ~400 de `pedidos_catalogo_centro`, compacto: id corto,
  proveedor, nombre, ref, unidad, formato, última cantidad) + alias aprendidos de la cuenta/centro
  + proveedores con sus días de reparto. Bloque estable → `cache_control` (caché de prompt).
- Glosario menorquín/catalán→castellano en el sistema (caixa, pa, llet, ous, dotzena, quilo,
  garrafa, pebre, ceba, tomàtiga, formatge, sobrassada, mitja, un parell…), unidades y
  cantidades en palabras («mitja caixa», «un parell de quilos»), fechas relativas («per demà»).
- Salida: líneas `{ producto_id | null, alternativas: id[] (máx. 3), texto_original, cantidad,
  unidad, proveedor_id | null, confianza 0-1, nota }`, `fecha_entrega` si la dice, `notas`,
  `dudas` (preguntas cortas para el empleado). Nunca inventa productos: si no está, `producto_id`
  null y descripción literal.
- Aprendizaje: cuando el empleado cambia el producto o la unidad de una línea interpretada, se
  guarda/actualiza `compras_pedido_alias` (frase → producto, unidad) y la próxima vez va en el
  contexto con prioridad.

## 3. Pantallas

- **`/pedidos`** (móvil primero; tema de la casa, claro): selector de centro (recordado);
  **Nuevo pedido**: botón grande de micrófono (dictado continuo con texto en vivo, castellano /
  menorquín), o escribir; «Interpretar» → **revisión** agrupada por proveedor: cada línea con
  producto, cantidad (±), unidad, chip de confianza, alternativas, buscador para cambiarlo,
  borrar; «Sin identificar» arriba; fecha de entrega por proveedor (por defecto el siguiente día
  de reparto respetando la hora de corte), aviso de pedido mínimo, notas. **Enviar** por proveedor
  según su canal: email (Resend, HTML con tabla de líneas, códigos del proveedor, centro y fecha
  de entrega, y la petición fija «envíen el albarán en PDF a …» al pie), WhatsApp (abre wa.me con
  el texto ya escrito; el empleado lo manda desde su móvil) o teléfono (marca como enviado).
  **Por catálogo**: elegir proveedor → favoritos del centro primero, buscador, +/−; mismo borrador.
  **Pedidos**: lista por estado; ficha con **cotejo** pedido / albarán / factura (tabla con
  diferencias resaltadas), vincular documento sugerido, marcar recibido.
  **Ajustes** (dirección/responsable): datos de pedido de cada proveedor (canal, email,
  WhatsApp, mínimo, días de reparto, hora de corte, «envía albaranes por email»), **importar
  catálogo** (CSV/XLSX del proveedor: detección de columnas código/nombre/formato/unidad/precio con
  confirmación, upsert por `ref_proveedor`), alias aprendidos (ver/borrar), y botón «Pedir catálogo
  y albaranes por email» que prepara el correo estándar al proveedor (lo envía quien pulsa).
- **`/empleado`**: acceso «Pedidos» si el empleado tiene concesión del módulo.
- **Portada**: módulo `pedidos` como ficha normal (RUTAS_MODULO).
- Permisos: `pedidos` en `ACCESO_POR_ROL` de responsable_area y jefe_sala (dirección ve todo);
  empleados por concesión. Enviar, ajustes e importación: dirección/responsable; el empleado crea
  borradores y los envía si su centro lo permite (de entrada: puede enviar).

## 4. Reglas

Repo público: ninguna clave en código. Server actions con `exigirModulo("pedidos")`; nada de
service key en el cliente. Textos en español claro. Sin dependencias nuevas salvo
`@anthropic-ai/sdk` y `zod`. Todo idempotente donde aplique. PII: nada a ficheros ni logs.
