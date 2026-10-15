# Compras: documentación técnica

> Parte trasera del módulo Compras: cómo está programado y por qué.
> Revisado el 04-10-2026 contra el código de `main` (último commit de Compras: `4570b2c`, 30-09-2026),
> el esquema real de Supabase (proyecto `jwsvkjyjwocuksdgiqnv`), el historial de git y las notas de dirección.
> Manual de usuario: [`docs/manual/compras.md`](../manual/compras.md).

---

## 1. Para qué sirve y en qué estado está

Compras convierte en datos los papeles de proveedor (**albaranes** y **facturas**). Lee cada documento con IA
(Claude), lo casa con el maestro de proveedores y productos, lo reparte por centro de coste y deja las facturas
listas para el Excel de importación de **A3**. Al recibir número de A3, cada factura entra sola en
**Contabilidad** (asiento, vencimiento y cruce con el banco). Las líneas de albarán alimentan en vivo el coste de
**Ratios**, de **Presupuesto** y el mercado interno del **PyG**.

**Estado: operativo** (`modulos.madurez = 'operativo'`, área Finanzas). Datos a 04-10-2026: unos 6.900
documentos (4.400 albaranes y 2.500 facturas), 18.100 líneas, 2.170 productos, 260 proveedores y 2.340 facturas
numeradas en A3. Lo usan a diario administración (contabilidad) y la persona responsable de compras.

Origen: era una app suelta (repo `compras-bonita`, con su propio Supabase). Se portó entera a Hostelero el
**24-08-2026** (datos, ficheros y esquema) y la ingesta de correo el **25-08-2026**. La app vieja quedó como
redirección, sin cron.

---

## 2. Dónde vive

| Pieza | Ruta | Qué es |
|---|---|---|
| Pantalla | `apps/general/datos/compras.html` | App de una sola página (unas 6.500 líneas: HTML, CSS y JS). Toda la lógica de usuario y el OCR están aquí. Versión interna **v80** (sale en la consola del navegador). |
| Ruta que la sirve | `apps/general/app/compras/route.ts` | `exigirModulo("compras")` y luego `servirHtmlModulo()`, que inyecta URL de Supabase, clave publicable, **token de sesión** y `cuenta_id` en los marcadores `__SUPABASE_URL__`, `__SUPABASE_ANON__`, `__SB_TOKEN__` y `__CUENTA_ID__`. |
| Inyector común | `apps/general/lib/html-modulo.ts` | Lee el HTML del disco, sustituye marcadores, añade el **vigilante de versión** (banda «Hay una versión nueva…») y sirve con `cache-control: private, no-store`. |
| Empaquetado | `apps/general/next.config.mjs` | `outputFileTracingIncludes["/compras"]` para que Vercel suba `datos/compras.html` con la función. Si renombras el HTML, cámbialo aquí. |
| Proxy de IA | `apps/general/pages/api/compras/anthropic.js` | `POST /api/compras/anthropic`. Reenvía el cuerpo tal cual a la API de Anthropic con `ANTHROPIC_API_KEY` y devuelve las cabeceras de cuota (`anthropic-ratelimit-*`). `bodyParser` hasta 4 MB y `maxDuration: 300`. |
| Ingesta de correo | `apps/general/pages/api/compras/ingesta-correo.js` | IMAP: inventaría el buzón y sube los adjuntos a la bandeja. Ver §4.2. |
| Carga móvil pública | `apps/general/app/subir-facturas/page.tsx` | `/subir-facturas`: página sin login para subir fotos o PDF desde el móvil. Deja el fichero en la misma bandeja que el correo. |
| Lista pública del middleware | `apps/general/middleware.ts` | `/subir-facturas` y `/api/compras/ingesta-correo` pasan sin sesión. `/api/compras/anthropic` **sí** exige sesión (el middleware redirige a `/login`). |
| Cron de Vercel | `apps/general/vercel.json` | `/api/compras/ingesta-correo` a las 05:00 UTC (red de seguridad). |
| Cron frecuente | `.github/workflows/ingesta-correo.yml` | GitHub Actions cada 15 min. Llama a la ingesta con `Authorization: Bearer $CRON_SECRET`. |
| Puerta de módulo | `apps/general/lib/modulos.ts` | `RUTAS_MODULO.compras = "/compras"` (tarjeta de la portada y `/m/compras`). |
| Permisos | `apps/general/lib/supabase/server.ts` | `ACCESO_POR_ROL` y `exigirModulo()`. Ver §5. |
| Migraciones | `apps/finanzas/supabase/migrations/*compras*`, `*a3*`, `*concil_confirmada*` y `apps/general/supabase/migrations/2026092810*`, `20260928120000*`, `20260930140000*` | Ver §3.7 (no están todas en el repo). |
| Scripts | `scripts/migrar-compras-*.mjs`, `scripts/delta-compras-correo.mjs`, `scripts/rescatar-facturas-enlaces.mjs` | Port (ya hecho, histórico) y rescate de facturas por enlace. Ver §4.10. |

Lo que **no** es Compras aunque lleve el prefijo: `compras_pedido*`, `compras_catalogo_import` y las columnas
`pedido_*`, `pedible`, `catalogo_*` y `albaranes_por_email` de `compras_proveedor` y `compras_producto` son del
módulo **Pedidos** (beta desde el 04-10-2026: `apps/general/app/pedidos`, técnico en [pedidos.md](pedidos.md)).
Única excepción en Compras (v81): `compras.html` lee `albaranes_por_email` para dejar pasar los albaranes de
correo de esos proveedores. Desde el 14-10-2026 también se edita en Compras › Proveedores (columna «Albaranes
por email»): Sí = el proveedor va por albaranes y se cargan los que lleguen por correo; No = se descartan aunque
lleguen. Ese día se marcaron con Sí los 50 proveedores con albaranes subidos esta temporada (fotos en Jano o en
Dijit), salvo BODEGA (INTERNO) y PRODUCCION (INTERNA).

---

## 3. Datos

Todas las tablas llevan `cuenta_id uuid not null default <Bonita>`. El default se puso en el port para no tocar
el HTML, que **nunca envía `cuenta_id`**. Ver el riesgo de multiempresa en §8.

### 3.1 Tablas

| Tabla | Filas aprox. | Para qué | Columnas clave |
|---|---|---|---|
| `compras_doc` | 6.900 | Un documento: albarán o factura. | `tipo` (`albaran`/`factura`), `fecha` (fecha del documento), `fecha_contable` (solo facturas), `proveedor_id`, `proveedor` (nombre, lo pone un trigger desde la ficha), `num_documento`, `canal` (centro, texto canónico), `base`, `iva`, `total`, `descuento`, `retencion*`, `estado` (`OK`/`REVISAR`), `estado_detalle` (`CORRECTO`/`REVISAR`/`NO_CUADRA`/`DUPLICADO`), `hash_doc` (huella de duplicado), `imagen_url` + `imagenes` (jsonb, un folio por página), `pagina`/`paginas`/`paginas_vistas` (albaranes multipágina), `albaranes_detectados` (jsonb, solo facturas), `reparto_sugerido`, `codigo_terminal`, `codigo_cups`, `regimen_iva` (fuerza CNAC/CCEE/SUJPAS por factura), `a3_numdoc`, `a3_exportado_at`, `origen` (`manual`/`correo`/`dijit`/`agora`/`a3`), `raw` (respuesta íntegra del OCR). |
| `compras_linea` | 18.100 | Líneas de producto. **Solo albaranes.** | `doc_id` (cascade), `id_producto` (referencia del proveedor), `producto`, `cantidad`, `precio_unit`, `importe`, `canal` (centro de la línea: manda sobre el del documento en el coste), `producto_id` (lo rellena un trigger). |
| `compras_producto` | 2.170 | Catálogo: una ficha por referencia y proveedor. | `codigo_interno` (`P-00001…`, de `compras_next_codigo()` y la secuencia `compras_producto_seq`), `ref_proveedor`, `nombre`, `proveedor_id`, `ultimo_precio`, `alias`. |
| `compras_proveedor` | 260 | Maestro de proveedores. | `nombre` (en mayúsculas por trigger), `nif`, `nif_norm`/`nombre_norm` (trigger), `alias`, `departamento` (centro habitual), `cuenta_contable` (cuenta de gasto por defecto), `cuenta_proveedor` (400…/410…), `codigo_a3`, `retencion_modelo` (111/115) y `retencion_pct`, `regimen_iva` (null = automático por el NIF), `tipo_iva_autorep`, `pautas` (para el OCR de albaranes), `pauta_factura`, `muestra_url`/`muestra_factura_url`, `critico`, `autorizado` (false = proveedor nuevo detectado por el OCR). |
| `compras_doc_reparto` | 2.600 | Reparto de una factura por centro, IVA y cuenta. Cada fila es una línea del fichero A3. | `doc_id`, `orden`, `base`, `cuota`, `tipo_iva` (código A3: ORD21, RED10…), `centro_coste` (1-8), `cuenta_gasto`, `manual` (true = puesto a mano: el automático no lo pisa). |
| `compras_correo` | 1.200 | Inventario del buzón IMAP: un mensaje por fila. | `message_id` (único), `remitente`, `asunto`, `fecha_correo`, `carpeta`, `uid`, `estado` (`DESCUBIERTO`/`PROCESANDO`/`PROCESADO`/`ERROR`), `intentos`, `error`, `enlaces`. |
| `compras_correo_adjunto` | 2.400 | **La bandeja**: cada fichero que espera OCR, venga del correo (`correo_id`) o del móvil (`correo_id` nulo). | `url`, `storage_path`, `estado` (`PENDIENTE`/`PROCESANDO`/`PROCESADO`/`DESCARTADO`/`ERROR`), `claimed_at`, `doc_id` (documento generado), `error` (motivo, o la marca `FORZAR FACTURA`/`FORZAR ALBARAN`). |
| `compras_centro_coste` | 8 | Centros de coste con su código de A3. | `codigo` 1 ESTRUCTURA, 2 BINIFADET BODEGA, 3 COCINA PRODUCCION, 4 BINIFADET RESTAURANTE, 5 BINIFADET TIENDA, 6 TAMARINDOS RESTAURANTE, 7 TAMARINDOS BAR, 8 CASA TIRANT. La misma numeración que usa A3 y `fin_apuntes`. |
| `compras_tipo_iva` | 33 | Códigos de IVA de A3. | `codigo`, `pct`, `habitual`. |
| `compras_cuenta_a3` | 650 | Maestro de proveedores exportado de A3. Sirve de **ayuda de búsqueda** al dar de alta (`buscar_cuenta_a3`), no como lista blanca. | `cuenta`, `codigo`, `nif_norm`, `nombre_norm`, `contrapartida`. |
| `compras_contrato_centro` | 12 | Rentings: nº de contrato → centro y cuentas. | `contrato` (solo dígitos), `centro_coste`, `cuenta_alquiler` (621000100), `cuenta_seguro` (625000000). |
| `compras_terminal` | 8 | Datáfonos: código de comercio → centro (facturas de comisiones). | `codigo`, `canal`. |
| `compras_cups` | 7 | Luz: CUPS → centro y porcentaje por meses. | `cups`, `meses`, `canal`, `pct`. |
| `compras_regla` | 7 activas | Reglas en lenguaje natural que se inyectan en el prompt del OCR (pestaña Reglas). | `texto`, `activa`. |
| `compras_concil_confirmada` | 34 | Cruces albarán↔factura dados por buenos a mano. Mandan sobre el cálculo automático. | `factura_id`, `num_albaran`, `albaran_id`. **No tiene `cuenta_id`.** |
| `compras_dup_descartada` | pocas | Parejas de productos que alguien dijo que NO son duplicados (no se vuelven a proponer). | `a`, `b`. |
| `compras_asiento_rehecho` | 240 | Registro de asientos rehechos o duplicados borrados desde Compras. | `doc_id`, `accion`, `asiento_anulado`/`asiento_contra`/`asiento_nuevo`, `motivo`, `hecho_por`. |
| `ia_consumo` | compartida | Contador de gasto de IA de todos los módulos. Compras escribe con `ia_registrar(...)` en cada llamada al OCR. | |

### 3.2 Vistas

| Vista | Para qué |
|---|---|
| `compras_a3_cabecera` | Cabecera contable de cada factura: código de proveedor, cuenta, retención, si `desglose_cuadra` y si `importes_cuadran`. |
| `compras_a3_lineas` | Líneas contables: el reparto explícito si existe; si no, una línea con la cuenta y el centro por defecto. **Es una vista: no se edita.** Lo que se corrige es `compras_doc_reparto` o el documento. |
| `compras_a3_export_preview` | Cabecera + líneas + **bloqueos** (array de motivos que impiden numerar). Es la base del Excel. Bloqueos posibles: sin código proveedor A3, sin nº factura, sin fecha, sin cuenta de gasto, sin centro de coste, sin base imponible, tipo de IVA indeterminado, intracomunitaria/ISP con IVA en el documento, retención sin modelo 111/115, retención sin porcentaje, retención parcial que no casa con ninguna línea, desglose de IVA que no cuadra, base + IVA − retención que no da el total, reparto descuadrado. |
| `compras_doc_reparto_cuadre` | Si la suma del reparto cuadra con la base. |
| `compras_factura_centros` | Cuántos centros tiene una factura (el listado enseña «varios · N»). |
| `compras_conciliacion_correo` | Un correo por fila con su diagnóstico (pestaña Buzón): `ok`, `pendiente de leer`, `adjuntos en cola`, `sin documento generado`, `descartado (no era factura)`, `correo sin adjuntos`, `adjuntos rechazados por tipo`, `correo con error de lectura`, `adjuntos con error`, `adjuntos perdidos al subir`. |
| `compras_cuadre` | Total de albaranes frente a total facturado, por proveedor y mes, con `por_centro` (pestaña Cuadre). |
| `compras_albaran_paginas` | Albaranes con folios repartidos en varios documentos. |
| `compras_producto_duplicados`, `compras_proveedor_duplicados` | Propuestas de fusión. Marcan `bloqueada` la pareja de productos que aparece junta en un mismo albarán. |
| `gastos` (de Ratios) | Une el histórico congelado con **las líneas de albarán de Compras en vivo** desde el 01-01-2026 (sin duplicados), más una fila de ajuste por albarán cuando la base y la suma de líneas difieren en más de 0,15 €. Lleva un trigger INSTEAD OF (`gastos_escribir`) que ignora las inserciones de origen COMPRAS. Ratios lee la caché `gastos_cache` (vista materializada que se refresca con `gastos_cache_asegurar()` solo si Compras cambió). |

### 3.3 Funciones (RPC) que llama la pantalla

| Función | Qué hace |
|---|---|
| `exportar_a3_anual(p_confirmar)` | Con `true`: numera con `compras_a3_numdoc_seq` las facturas en `OK`, sin bloqueos y que no vienen del import de A3 (`hash_doc` que empieza por `a3-import-`), y les pone `a3_exportado_at`. Siempre devuelve **todas** las numeradas del año en curso (por fecha contable), ordenadas por número. La secuencia va por **2813** a 04-10-2026. |
| `recalcular_estado_facturas()` | Recalcula `estado_detalle` y `estado` de **todas** las facturas: `DUPLICADO` no se toca; sin total → `REVISAR`; importes o desglose que no cuadran → `NO_CUADRA`; sin centro (`canal`) → `estado = REVISAR`. Devuelve las que cambiaron. |
| `regenerar_reparto_iva(p_doc)` | Crea el reparto por tipo de IVA de las facturas con más de una fila de IVA que cuadra con la base y aún no tienen reparto. |
| `aplicar_reparto_cups(p_doc)` | Centro según el CUPS de las facturas de luz. |
| `compras_asiento_rehacer(p_doc, p_motivo, p_por)` | Contra-asiento y asiento nuevo para una factura ya contabilizada. Se llama al cambiar la cuenta de gasto o la fecha contable desde el listado. |
| `fusionar_producto`, `fusionar_productos_por_clave`, `borrar_producto` | Catálogo. |
| `fusionar_proveedor(p_vive, p_muere, …)` | Mueve documentos y productos y conserva código A3, cuenta, NIF, categoría y pautas de la ficha que desaparece. Su nombre pasa a alias. |
| `buscar_cuenta_a3(p_nif, p_nombre)` | Propone código y cuenta de A3 al crear un proveedor. |
| `ia_registrar(...)` | Apunta tokens y coste en `ia_consumo`. |

Funciones que **no** llama la pantalla, pero que existen (motor contable y mantenimiento): `compras_generar_asiento`,
`compras_generar_asiento_como(p_doc, p_por)` (contabilizar desde servidor firmando como un usuario), `compras_construir_asiento`,
`compras_autoconciliar`, `compras_borrar_duplicado`, `compras_regimen_iva`, `fusionar_paginas_sueltas`,
`fusionar_productos_duplicados`, `exportar_a3` (versión antigua por rango, ya no la usa la pantalla),
`canal_canonico`, `cod_iva_de_pct`, `cif_valido`, `clave_producto`, `mapa_centro`.

### 3.4 Triggers relevantes (sobre `compras_doc` salvo que se diga otra cosa)

| Trigger | Cuándo | Efecto |
|---|---|---|
| `compras_doc_0_fecha_contable` | BEFORE INSERT/UPDATE de `fecha`, `fecha_contable`, `tipo` | Solo facturas. Calcula `fecha_contable` con `compras_fecha_contable_defecto(fecha, registro)`: la fecha de factura, salvo que se registre con su trimestre ya cerrado (después del 20-abr, 20-jul, 20-oct o 30-ene). Entonces va a la fecha de registro. Si cambias la fecha de factura y la contable era la de por defecto, se recalcula. Una puesta a mano no se toca. |
| `compras_doc_1_cartera` | AFTER UPDATE de `a3_numdoc`, `estado`, WHEN `a3_numdoc` no nulo y `estado = 'OK'` | Crea el vencimiento de pago en `fin_vencimientos` (fecha + días de pago del proveedor, 30 por defecto). |
| `compras_doc_2_asiento` | Igual que el anterior (se dispara después por el nombre) | `compras_generar_asiento` (gasto por centro + IVA por tipo + retención + proveedor) y `compras_autoconciliar` (cruce con el extracto si hay un candidato único). Los errores salen como `warning`: no bloquean el guardado. |
| `compras_doc_candado_a3_del` / `_upd` | BEFORE DELETE / BEFORE UPDATE de `estado_detalle` | Un documento con `a3_numdoc` no se puede borrar ni marcar `DUPLICADO`. |
| `trg_compras_doc_proteger_exportado` | BEFORE DELETE | El mismo candado, con otro mensaje (redundante, histórico). |
| `trg_doc_nombre_proveedor` | BEFORE INSERT/UPDATE de `proveedor_id` | `proveedor` = nombre de la ficha. Lo leído por el OCR queda en `raw`. |
| `trg_doc_reenlaza_lineas` | AFTER UPDATE de `proveedor_id` | Reenlaza las líneas al catálogo del proveedor nuevo. |
| `trg_proveedor_irpf_desde_doc` | AFTER INSERT/UPDATE de retención | Aprende el % de IRPF del proveedor. |
| `zz_gastos_cache_sucio` | AFTER cada sentencia en `compras_doc`, `compras_linea`, `compras_producto`, `compras_proveedor` | Marca sucia la caché de Ratios. |
| `trg_linea_enlaza_producto` (`compras_linea`) | BEFORE INSERT/UPDATE | Enlaza la línea con su producto: por referencia del proveedor o, si no la hay, por nombre normalizado dentro del mismo proveedor. Si no existe, lo crea y actualiza el último precio. |
| `trg_linea_nombre_producto`, `trg_producto_nombre_proveedor`, `trg_propagar_nombre_*`, `trg_sync_norm_*` | | Mantienen nombres y claves normalizadas. **Las claves `*_norm` las calcula Postgres, nunca el navegador.** |

### 3.5 Ficheros (Storage)

Bucket **`documentos`**, **público**: las URL son `/storage/v1/object/public/documentos/<nombre>`. Hay unos 10.800
objetos (1,7 GB en el port). Los nombres son `<ms>_<6 aleatorios>.<ext>` (subidas de la app), `correo_…`
(ingesta) y `movil_…` (móvil). Políticas: `documentos_sesion` (authenticated, todo) y `documentos_movil_anon`
(anon, solo INSERT de `movil_%`). Unos 200 documentos (sobre todo el import de A3) no tienen imagen.

### 3.6 RLS y permisos de tabla

- Patrón de la casa en las 13 tablas originales y en `compras_contrato_centro`: cuatro políticas por tabla
  (`select`/`insert`/`update`/`delete`) para `authenticated` con `(cuenta_id = (select cuenta_actual())) or (select es_operador())`.
  Desde el 30-09-2026 van envueltas en `(select …)` (migración `20260929100000_rls_initplan.sql`): antes Postgres
  las evaluaba fila a fila, y eso causaba la lentitud de Compras, Contabilidad y Ratios.
- `compras_correo_adjunto` además deja a `anon` insertar con `correo_id is null and estado = 'PENDIENTE'` y leer
  `correo_id is null` (para la página del móvil). **Ojo:** siguen vivas también las políticas del port
  `compras_correo_adjunto_anon_insert` (check `true`) y `compras_correo_adjunto_anon_select` (using `true`), y `anon`
  tiene `SELECT, INSERT` sobre la tabla. Las políticas se suman con OR, así que la configuración deja leer **toda**
  la bandeja (con las URL públicas de las facturas) a quien tenga la clave publicable. Ver §8.
- `compras_concil_confirmada`: política `authenticated todo` con `true` (sin filtro por cuenta).
- Las vistas `compras_*` pertenecen a `postgres` (que salta la RLS) y no tienen `security_invoker`. Varias tienen
  `GRANT` completo a `anon` (`compras_a3_cabecera`, `compras_a3_export_preview`, `compras_cuadre`,
  `compras_conciliacion_correo`, `compras_*_duplicados`…). Ver §8.

### 3.7 Migraciones

El esquema base **no** está en una migración del repo. Lo trajo `scripts/migrar-compras-esquema.mjs` (20-08-2026),
que leyó el DDL del Supabase viejo, añadió `cuenta_id` y RLS y lo aplicó. En `schema_migrations` hay migraciones
aplicadas **que no están en el repo** (por ejemplo `modulo_compras`, `compras_port_preparacion_y_ejecutor`,
`compras_dup_descartada`, `jubilacion_dijit_gastos_solo_compras`, `exportar_a3_cabregiva*`,
`exportar_a3_sin_reimportar_lo_de_lucia`, `exportar_a3_blindar_import_lucia`, `ia_consumo_registro_unificado`,
`compras_cuadre_proveedor_mes`). Para conocer la definición real, consulta la base
(`pg_get_functiondef`, `pg_get_viewdef`).

En el repo (ordenadas):

| Migración | Qué hizo |
|---|---|
| `finanzas/20260823214500_compras_fusionar_paginas_fotos` | `fusionar_paginas_sueltas` mueve también fotos y adjuntos. |
| `finanzas/20260824013000_ratios_port_y_conexion_viva` | Vista `gastos`: Compras → Ratios en vivo. |
| `finanzas/20260826191604_compras_doc_exportado_inmutable` | Candado de borrado de facturas exportadas. |
| `finanzas/20260827102645` y `…102707` | Factura OK → vencimiento en cartera. |
| `finanzas/20260828090519_compras_a3_entrega_unica` | El Excel solo da número a lo nunca entregado; REVISAR no numera. |
| `finanzas/20260828123307_compras_next_codigo_a_prueba_de_huecos` | Códigos `P-xxxxx` sin huecos. |
| `finanzas/20260828124818`, `…130209`, `…130321`, `…131540`, `…141559` | Motor contable: asiento y autocruce **al numerar en A3** (no al pasar a OK), con la cartera antes que el asiento. |
| `finanzas/20260828131641_exportar_a3_fichero_completo` y `20260901120000_exportar_a3_anual_…` | Fichero anual completo. |
| `finanzas/20260831113507_compras_candado_documentos_con_numero_a3` | Candado de borrado y de DUPLICADO. |
| `finanzas/20260901160000_concil_confirmada_a_mano` | `compras_concil_confirmada`. |
| `finanzas/20260920163855` y `…164852` | `compras_asiento_rehacer`, `compras_borrar_duplicado`, `compras_generar_asiento_como`. |
| `finanzas/20260921112427_compras_regimen_iva_ccee_sujpas` | Régimen de IVA CNAC/CCEE/SUJPAS y autorrepercusión. |
| `general/20260928100000_compras_contrato_centro` | Rentings por contrato. |
| `general/20260928120000_compras_fecha_contable` | Fecha contable. |
| `general/20260929100000_rls_initplan` | Políticas envueltas en `(select …)` (todos los módulos). |
| `general/20260930140000_compras_arreglos_lucia` | **NO APLICADA a 04-10-2026.** `regenerar_reparto_iva` ignora filas de IVA con base 0 y `recalcular_estado_facturas` acepta facturas **repartidas** sin `canal`. Pendiente de que el chat la aplique. |

---

## 4. Flujos

### 4.1 Tres puertas de entrada y una sola cola

1. **Pantalla Compras → pestaña Subir.** La persona suelta PDF o fotos. Las fotos se comprimen en el navegador
   (lado mayor 2.000 px, JPEG al 0,82). Se elige el tipo: `Detectar`, `Factura` o `Albarán`.
2. **Móvil → `/subir-facturas`** (pública). Sube a `documentos/movil_*` y crea una fila `PENDIENTE` en
   `compras_correo_adjunto` con `correo_id` nulo y el nombre `[móvil · quien] fichero`. La página consulta el
   estado cada 5 s mientras siga abierta.
3. **Correo → ingesta IMAP** (servidor, §4.2). Crea filas `PENDIENTE` en la misma bandeja, con `correo_id`.

Las puertas 2 y 3 **no hacen OCR**. El OCR corre **en el navegador de quien tenga abierta la pantalla de
Compras**: al arrancar (3 s después de la carga inicial) y con el botón «📧 Buscar facturas en el correo», la
pantalla reclama hasta 20 adjuntos `PENDIENTE` por lote (máximo 10 lotes). El reclamo es optimista:
`PATCH … estado=eq.PENDIENTE → PROCESANDO, claimed_at`. Si nadie abre Compras, la bandeja espera.

Rescate de reclamados: al cerrar la pestaña se sueltan con `fetch keepalive`. Además, al sincronizar se devuelven
a `PENDIENTE` los `PROCESANDO` con `claimed_at` de más de 15 min (90 s si lo pide una persona con el botón).

### 4.2 Ingesta de correo (servidor)

`pages/api/compras/ingesta-correo.js` (v3). Exige `Authorization: Bearer <CRON_SECRET>` o la service key. **No
modifica el buzón**: no marca leídos, no mueve, no borra.

- **Fase 1, DESCUBRIR** (barata): recorre todas las carpetas menos las excluidas (enviados, borradores, papelera,
  spam, archivo…; se puede cambiar con `INGESTA_CARPETAS_EXCLUIR`). Lee solo los sobres de los últimos 60 días y
  hace upsert en `compras_correo` con `on_conflict=message_id` e `ignore-duplicates`. El inventario queda en la
  base y nada caduca sin verse.
- **Fase 2, PROCESAR** (cara): reencola los `ERROR` con menos de 3 intentos y los `PROCESANDO` abandonados (más
  de 1 h). Coge los `DESCUBIERTO` más antiguos (tope de 200) agrupados por carpeta y procesa mientras quede
  tiempo (60 s − 15 s de margen). Por cada correo:
  - adjuntos PDF o imagen → bucket `documentos/correo_*` → fila `PENDIENTE`;
  - **ZIP** → lector mínimo propio (`inflateRawSync`) y lo de dentro entra como adjunto (caso Coca-Cola CCEP);
  - **sin adjuntos** → sigue hasta 5 enlaces del cuerpo (primero los `.pdf` o `ver_factura`, nunca imágenes) y
    guarda los que responden un PDF (plataforma NuestraFactura). Los enlaces quedan en `compras_correo.enlaces`;
  - PDF con basura delante de `%PDF-` → se recorta (Holded y otros);
  - adjuntos de otro tipo → fila `DESCARTADO` con el motivo (nada desaparece en silencio);
  - si el UID ya no vale, se busca por Message-ID y, al final de la pasada, en el resto de carpetas (imapflow solo
    admite un bloqueo a la vez);
  - el correo pasa a `PROCESADO` solo si todo fue bien. Si no, queda en `ERROR` con `intentos + 1`.
- Devuelve un resumen JSON con `pendientes_ahora`, que dice si se va al día.

Disparadores: GitHub Actions cada 15 min (`.github/workflows/ingesta-correo.yml`) y Vercel a las 05:00 UTC. Hay
dos porque, cuando se montó (25-08), el plan Hobby de Vercel solo permitía un cron diario. Hoy el cron de
Reservas cada 5 min despliega bien, así que el plan actual está **por confirmar** (ver
[plataforma.md](plataforma.md) §10). La pantalla también hace `POST` a la ingesta al
arrancar, pero **sin cabecera de autorización**, así que recibe 401 y no hace nada (§8). Lo útil de esa
llamada del navegador es lo que viene después: procesar la bandeja.

### 4.3 Procesado de un documento (`procesarUno` en `compras.html`)

1. **¿PDF con varias facturas?** (`dividirPdfSiVarias`). Si el PDF tiene más de una página, se pregunta al modelo
   por los rangos de páginas. Si hay varios documentos y los rangos cubren todo sin huecos, se parte con
   **pdf-lib** y cada trozo entra en la cola. Si venía del correo, cada trozo tiene su fila de adjunto y la
   original queda `DESCARTADO` con la nota «dividido en N».
2. **¿Albarán post-factura de Coca-Cola?** Se lee el texto del PDF con pdf.js. Si aparece `ALB.-POST-FAC.`, se
   fuerza el tipo albarán y se guarda el nº de «Sustituye al doc.nº».
3. **Prompt** (`construirPromptOCR`): los centros válidos, las reglas de `compras_regla`, las pautas por proveedor,
   los alias, el departamento habitual y las instrucciones finas (cuadro de IVA con varias filas, cantidad que
   multiplicada por el precio da el importe, NIF propio, CUPS, terminal, marcadores de centro dentro de la
   factura, contratos de renting, abonos, IRPF). Los documentos del correo van siempre en modo `auto` y con un
   «paso 0» que descarta lo que no es factura ni albarán (`{"tipo":"otro"}`).
4. **Llamada** a `/api/compras/anthropic`: modelo `claude-sonnet-4-6`, `max_tokens 16384`. Si el base64 pasa de
   unos 3 MB, se manda la **URL pública** del bucket en vez del contenido, para no chocar con el límite de cuerpo
   de Vercel (413). Si el modelo contesta en prosa, se reintenta una vez exigiendo solo JSON.
5. **Escalada**: si la lectura no cuadra (`lecturaEvaluable`: total ausente, importes descuadrados, líneas que no
   suman o fecha de un año anterior con más de 60 días), se hace una segunda pasada con `claude-opus-5` y un aviso
   del problema. Se queda la segunda solo si esa sí cuadra.
6. **Abonos**: si es abono (`es_abono`, o el título lo dice), base, IVA, total y desglose se ponen en negativo.
7. **Filtro de correo**: un albarán que llega por correo **se descarta** salvo que sea del móvil, post-factura de
   Coca-Cola o reencolado a mano.
8. **Fichero** al bucket. **Proveedor**: se casa por CIF, luego por nombre y luego por alias (`matchProveedor`).
   Si no casa, se crea con `autorizado=false` (aviso en Proveedores), con la cuenta de A3 propuesta. No se guarda
   un CIF español que no pase el dígito de control. El NIF y el nombre de la propia empresa nunca pueden ser el
   proveedor (los sufijos `-01` Bodega y `-02` Producción sí: son proveedores internos).
9. **Centro**: el código de terminal manda; luego el centro leído y, si no, el departamento del proveedor.
10. **Albaranes multipágina**: si ya existe un albarán del mismo proveedor y número, el folio se **fusiona** (sus
    líneas y su foto se añaden a ese documento; los totales solo se completan donde faltaban). Si esa página ya
    estaba, es una copia y no se guarda.
11. **Duplicados**: huella `firmaDup(nº, fecha, total)`. Si ya existe, la carga manual **se rechaza** (no se
    inserta) y el adjunto de correo se cierra enlazado al existente.
12. **Estado**: factura sin total → `REVISAR`; importes que no cuadran (`cuadreFactura`) → `NO_CUADRA`; albarán
    sin líneas → `REVISAR`; líneas que no cuadran con la base o el total (`cuadreAlbaranes`) → `NO_CUADRA`.
    `estado = 'OK'` solo si el detalle es `CORRECTO` **y** hay centro.
13. **Inserción** en `compras_doc` (con `raw` íntegro). Albaranes: líneas en `compras_linea` (un POST por
    documento; el enlace con el catálogo lo hace el trigger). Facturas: reparto por **contratos** de renting si
    procede; si no, reparto por **tipos de IVA** cuando hay más de uno y cuadra.
14. Al acabar la cola: `aplicarReglasAutomaticas()` (`regenerar_reparto_iva`, `aplicar_reparto_cups` y
    `recalcular_estado_facturas`) y recarga de listados.

Ritmo: 4 s entre documentos por defecto (se puede cambiar con `localStorage.gapOCR`). Se adapta con las cabeceras
de cuota que reenvía el proxy y usa un Web Worker como reloj para que Chrome no frene las esperas en pestañas
ocultas. Ante un 429 espera 60 s y reintenta una vez. Los fallos **transitorios** (saldo, cuota, red, 5xx, 413,
JSON truncado) devuelven el adjunto a `PENDIENTE`; los demás lo dejan en `ERROR`.

### 4.4 Revisión

El modal (`revisar` → `renderDetalle`) enseña a la izquierda las fotos o el PDF (convertido a imagen con pdf.js,
con zoom, giro y arrastre) y a la derecha el detalle editable.

- **Albarán**: líneas editables, base y descuento. «Guardar cambios» (`guardarRevision`) es **el visto bueno**:
  recalcula el estado (`CORRECTO` si las líneas cuadran con la base con un margen de 0,15 €) y pasa a `OK` si hay
  centro.
- **Factura**: base, IVA, retención y total en inputs (`inputImpCab`); cada cambio guarda los cuatro a la vez
  (`saveImportesCab`, luego `regenerar_reparto_iva` y `recalcular_estado_facturas`) y solo redibuja el panel si
  el foco ya no está en esas casillas (15-10-2026: antes cada celda redibujaba todo y se perdía lo tecleado en la
  siguiente). El detalle por líneas (`lineasImp`) vive en memoria hasta «Aplicar a la factura»; sobrevive a
  `revisar()` del mismo documento y `closeModal` avisa si se cierra sin aplicar, lista de albaranes incluidos y **reparto por centro de coste** (`compras_doc_reparto`
  con `manual=true`). Sus botones son «↔ Repartir entre varios centros», «✨ Proponer reparto automático» y
  «Guardar reparto». En facturas, «Guardar cambios» guarda la lista de albaranes; el estado lo recalcula
  `recalcular_estado_facturas`.
- En los dos: cabecera `cabeceraDocModal` con el nº (contenteditable, `saveDatoDoc`) y las fechas como
  `<input type="date">` (`saveFechaModal`): fecha del documento en ambos y, en facturas, también la contable.
  El PATCH devuelve la fila, así que si cambia la fecha factura y la contable era la de por defecto se ve el
  recálculo del trigger `compras_doc_0_fecha_contable`; si la factura ya tiene `a3_numdoc` y cambia la
  contable, se llama a `compras_asiento_rehacer` como desde el listado. Si la fecha viene vacía (documento a
  mano) el selector enseña hoy; `nuevoDocManual` ya la graba con la fecha de hoy. Desplegables de centro y
  proveedor (cambiar el proveedor reenlaza las líneas), «↻ Reprocesar» (relee todos los folios con Opus; si la relectura viene sin líneas, conserva las
  anteriores) y «🗑 Borrar documento» (bloqueado si tiene nº de A3; pide doble confirmación si ya salió en un
  Excel).

### 4.5 Facturas: reparto, renting, luz, datáfonos, IVA, IRPF y fechas

- **Renting** (desde el 28-09-2026): el OCR devuelve `contratos[{contrato, alquiler, seguro}]`. Con
  `compras_contrato_centro` se reparte el alquiler a 621000100 y el seguro a 625000000, cada uno en el centro de su
  contrato. Si un contrato no está dado de alta, o no cuadra con la base, o hay varios tipos de IVA: no se reparte
  y sale un aviso. Desde el 30-09, si el OCR lee el nº de contrato como nº de albarán (Grenke), también vale.
- **Luz**: `codigo_cups` → `compras_cups` → centro (`aplicar_reparto_cups`).
- **Datáfono**: `codigo_terminal` → `compras_terminal` → centro.
- **Varios centros en la misma factura**: el OCR devuelve `reparto_centros` (marcadores tipo «RTE TAMARINDOS»). La
  pantalla lo ofrece como propuesta.
- **Régimen de IVA** (desde el 21-09-2026): `compras_proveedor.regimen_iva` (null = automático por el prefijo
  del NIF: UE → CCEE, otro país → SUJPAS, España → CNAC; GB no es CCEE desde el Brexit) o
  `compras_doc.regimen_iva` para forzar una factura. En el fichero: `CABREGIVA` y `LINTIPIVA = ORD21` aunque la
  factura no lleve IVA. El asiento autorrepercute en 472/477000800 (CCEE) o 472/477000500 (SUJPAS).
- **IRPF**: `retencion`, `retencion_pct` y `retencion_base`, y el modelo (111 o 115) en la ficha del proveedor. En el
  fichero, `CABTIPOIRPF = 1` tanto para el 111 como para el 115 (indicación de la técnica de A3, 03-09-2026).
- **Cuenta de gasto** editable desde el listado de Facturas (desde el 22-09): crea o corrige el reparto y, si la
  factura ya está numerada, llama a `compras_asiento_rehacer`.
- **Fechas** (desde el 28-09): fecha de factura y fecha contable editables en el listado; el registro
  (`created_at`) es informativo. Si cambia la contable de una factura numerada, se rehace el asiento, y hay que
  cambiarla también en A3.

### 4.6 Exportación a A3 y paso a Contabilidad

Pestaña «Exportar A3», botón «Generar Excel para A3 (año completo)» (`exportarA3`):

1. Previsualiza lo **pendiente de numerar** con sus bloqueos (`compras_a3_export_preview?cabnumdoc=is.null`) y
   añade «pendiente de revisar» a las que están en `REVISAR`.
2. Llama a `exportar_a3_anual` paginando de 1.000 en 1.000 (PostgREST corta también las RPC). Solo la primera
   página confirma, es decir, numera.
3. Antes de descargar, avisa si hay numeradas sin código de proveedor o sin cuenta (ficha vaciada después de
   numerar, caso del 15-09).
4. Genera `FACTURASCOMPRA_<año>_completo.xls` en **BIFF8** (.xls de Excel 97, que es lo que acepta A3), con la hoja
   `FACTURASCOMPRA` y las columnas en este orden exacto: `cabFecha, cabnumdoc, cabfechacontable, CABREFERENCIA,
   cabcodpro, cabregiva, CABTIPOIRPF, CABPORIRPF, linunidades, lincodart, lindesclin, linprcmoneda, lintipiva,
   linctacon, lincentrocoste`. Las dos fechas llevan la **fecha contable** como fecha de Excel con formato; 
   `linunidades=1` y `lincodart=0` son fijos.
5. Administración selecciona en el Excel lo que carga en A3.

Al recibir `a3_numdoc` (y estar en `OK`), los triggers crean **vencimiento**, **asiento** y **autocruce** con el
extracto bancario (§3.4). Desde ese momento la factura es intocable en lo básico: no se borra ni se marca
duplicada, y los asientos confirmados no se editan (se corrigen con contra-asiento + asiento nuevo). Contabilidad
(`apps/finanzas`) lee `compras_doc` en Facturas recibidas, Proveedores, Cartera, Remesas e Impuestos (fichero de
los modelos 111/115). La conexión con el banco se explica en
[`docs/bancos-conexion-automatica.md`](../bancos-conexion-automatica.md).

### 4.7 Conciliación y Cuadre

- **Conciliación** (pestaña del mismo nombre): cada albarán que aparece dentro de una factura de **mercancía**
  (proveedores con cuenta 600000000) se busca entre los albaranes cargados. «✓ Sí» = cruza por número. «≈ Revisar»
  = el número no coincide del todo pero se parece (dos caracteres de diferencia como mucho) y cuadran al menos 3 de
  4 datos (proveedor, importe ±0,02, fecha ±7 días, centro). «⚠️ Falta» = no está. «✔ dar por bueno» guarda en
  `compras_concil_confirmada`. Se calcula al abrir la pestaña, no antes.
- **Cuadre** (vista `compras_cuadre`): total de albaranes frente a total facturado por proveedor y mes. Tolerancia
  del 2 % o 5 €. Si cuadra, no hace falta mirar la factura con lupa. Los internos (Bodega, Producción) no facturan:
  su columna Facturas es 0 a propósito.

### 4.8 Catálogo y proveedores

- Productos: código interno `P-xxxxx`. Detector de duplicados por parecido de nombre (respeta la regla de
  **nunca fusionar dos productos que aparecen juntos en un mismo albarán**) y por clave normalizada. «descartar»
  guarda la pareja en `compras_dup_descartada`. Fusión manual y selección múltiple. Solo se pueden borrar los
  productos sin uso.
- Proveedores: todo editable en la celda. Proveedores nuevos sin autorizar: «✓ Autorizar como nuevo», «fusionar
  con… / unir» o «✕ Rechazar» (solo si no tienen documentos). Hay un detector de fichas duplicadas con validación
  del CIF y comparación visual por IA. «⬇ Importar lista» carga una lista semilla que va **incrustada en el
  HTML** (`PROV_SEED`).

### 4.9 Integraciones

| Con | Cómo |
|---|---|
| Claude (Anthropic) | Proxy `/api/compras/anthropic` con `ANTHROPIC_API_KEY` (la misma que usan los Agentes). Coste en `ia_consumo` con precios fijos en el código (Sonnet 3/15 y Opus 5/25 $ por millón de tokens). |
| IMAP (buzón de facturas) | `imapflow` + `mailparser`. Credenciales en `IMAP_*`. |
| A3 | Solo fichero: Compras genera el .xls y administración lo importa. No hay API. |
| Contabilidad | Triggers al numerar (asiento, cartera, autocruce) y RPC de rehacer. |
| Ratios | Vista `gastos` y caché `gastos_cache`. Ratios también lee `compras_producto`. |
| Presupuesto | `v_gastos_real_mes` agrega la vista `gastos`. |
| PyG (mercado interno) | `gastos?proveedor=ilike.*intern*`: los proveedores internos `BODEGA (INTERNO)` y `PRODUCCION (INTERNA)` generan en espejo las ventas internas de Bodega y Producción. Se excluyen en el consolidado (TODOS). |
| Agentes | Panel «Actividad y consumo de IA» (lee `ia_consumo_v`). |
| Pedidos | Comparte maestros de proveedor y producto; los albaranes por correo de proveedores con `albaranes_por_email` entran en Compras (v81, 04-10-2026). Ver [pedidos.md](pedidos.md). |

### 4.10 Crons y scripts

| Qué | Cómo se ejecuta |
|---|---|
| Ingesta frecuente | GitHub Actions `Ingesta de correo`, cada 15 min, o a mano desde Actions con «Run workflow». Necesita el secreto `CRON_SECRET` del repo con el mismo valor que en Vercel. |
| Ingesta diaria | Cron de Vercel, 05:00 UTC. |
| Ingesta a mano | `curl -H "Authorization: Bearer <service key o CRON_SECRET>" https://hostelero-app.vercel.app/api/compras/ingesta-correo` |
| `scripts/rescatar-facturas-enlaces.mjs [--dry]` | Rescate (15-09) de correos ya procesados que tenían enlace de descarga y no tenían fichero. Se puede relanzar. Lee `HOSTELERO_URL` y `HOSTELERO_SERVICE_KEY` de `.env.local`. |
| `scripts/migrar-compras-esquema.mjs`, `migrar-compras-datos.mjs`, `migrar-compras-storage.mjs`, `delta-compras-correo.mjs` | **Históricos** del port (20 al 25-08). No se vuelven a ejecutar: apuntan al Supabase viejo. |

---

## 5. Permisos

- Módulo: `compras` (tabla `modulos`, área Finanzas). Tiene que estar en `modulos_contratados` y activo.
- Por rol (`ACCESO_POR_ROL`, en `apps/general/lib/supabase/server.ts`, con copia en finanzas): **dirección**
  (todos los módulos), **responsable_area** y **administracion**. `jefe_sala` y `empleado` no lo tienen de
  serie.
- Por usuario: `modulos_concedidos` suma y `modulos_vetados` resta (el veto manda). Se gestiona en `/usuarios`.
- Las comprobaciones están en `exigirModulo("compras")` (ruta `/compras`), en la portada y en `/m/compras`. **Dentro
  de la pantalla no hay permisos finos**: quien entra puede hacer todo (borrar, fusionar, generar el Excel de A3,
  crear reglas). La RLS solo separa por cuenta.
- El proxy de IA solo pide sesión iniciada (middleware), no el módulo Compras.
- `/subir-facturas` es pública a propósito: no enseña datos, solo deja ficheros.

---

## 6. Decisiones y por qué

| Fecha | Decisión | Por qué |
|---|---|---|
| Heredado | El OCR corre en el navegador, no en el servidor. | La app nació así (HTML suelto con proxy). Evita funciones largas en Vercel Hobby, pero obliga a tener Compras abierta para vaciar la bandeja. |
| Heredado (v2 de la ingesta) | DESCUBRIR y PROCESAR separados; `PROCESADO` solo al final; los rechazados quedan `DESCARTADO` con el motivo. | En la v1 lo que fallaba no dejaba rastro y se perdían facturas en silencio. |
| Heredado | La ingesta no toca el buzón. | Es un buzón compartido: borrar o mover es una decisión humana. |
| Heredado | Insert por lotes con **las mismas claves en todas las filas** (`error: null` explícito). | PostgREST responde PGRST102 «All object keys must match» y se pierde el correo entero. |
| Heredado | `maxDuration` de la ingesta como número literal (60). | Vercel lo lee del código sin ejecutarlo; una variable rompe la compilación. |
| 18-08-2026 | Página móvil pública `/subir-facturas`. | La persona de compras no tenía usuario; la página no enseña datos. |
| 18-08-2026 | Los adjuntos del móvil pueden ser albaranes; por correo solo entran facturas. | Al buzón llegan albaranes que no son compras propias y ensucian el coste. |
| 19-08-2026 | El nombre y el NIF de la propia empresa nunca son el proveedor. | El OCR tomaba al destinatario por emisor. |
| 23-08-2026 | Escalada a Opus solo cuando la lectura no cuadra; el reproceso manual va directo a Opus. | El modelo caro solo paga el 5-10 % difícil. |
| 23-08-2026 | Nunca fusionar dos productos que aparecen juntos en un mismo albarán. | Regla de dirección: si van juntos, son productos distintos. |
| 24-08-2026 | Port completo a Hostelero, `cuenta_id` con default Bonita, token de sesión inyectado. | Una sola base y una sola sesión. El default evitó reescribir el HTML. |
| 24-08-2026 | Compras → Ratios en vivo con la vista `gastos`; la hoja COMPRAS del Excel de Ratios se ignora. | Una sola verdad del coste; el Excel ya no puede duplicar. Frontera: Dijit hasta el 31-07, Compras desde el 01-08 (luego el histórico de Dijit se reprocesó dentro de Compras). |
| 24-08-2026 | El cambio de centro desde el listado arrastra las líneas. | El coste se calcula por el centro de la **línea**. |
| 25-08-2026 | Ingesta cada 15 min por GitHub Actions. | Vercel Hobby solo da un cron diario y en cierre de mes entran 40-50 facturas. |
| 28-08-2026 | La factura pasa a Contabilidad **al recibir nº de A3**, no al validarse. | Decisión de dirección: lo contabilizado tiene que coincidir con lo entregado a A3. |
| 31-08-2026 | Candado: un documento con nº de A3 no se borra ni se marca duplicado; en un grupo de duplicados sobrevive la copia numerada. | Se perdieron números de A3 por borrados (14 huecos permanentes en la serie). |
| 01-09-2026 | Un solo botón de A3 y fichero del **año completo**; numerar sin mirar fechas. | El filtro por fechas dejaba huérfanas facturas viejas y volvía a ofrecer otras ya exportadas. |
| 01-09-2026 | Si el reproceso devuelve una lectura sin líneas, se conservan las que había. | Un fallo dejó 112 albaranes sin líneas. |
| 01-09-2026 | Conciliación solo de mercancía (600000000) y cruces «probables» que se pueden dar por buenos. | El objetivo es que no se escape ningún albarán del coste, no cuadrar al céntimo. |
| 02-09-2026 | La secuencia de Compras numera **desde 2000**. La serie por debajo de 2000 es de administración (apuntes manuales en A3), y el import de A3 (`hash a3-import-*`) nunca se exporta. | Regla de dirección tras una contaminación del fichero con números de la serie manual. |
| 03-09-2026 | Pestaña Cuadre por proveedor y mes. | Más barato que reprocesar todas las facturas para sacar sus albaranes. |
| 04-09 / 29-09-2026 | `sbAll` pagina con `Content-Range`, en paralelo, sin caché. | Supabase corta a 1.000 filas sin avisar (Productos se quedaba en 1.000 de 2.140). Hoy `db_max_rows` está en 10.000, pero el código no depende de eso. |
| 10-09-2026 | No se crea un proveedor con un CIF español inválido. | Un mismo proveedor llegó a tener 12 fichas por lecturas malas del CIF. |
| 15-09-2026 | Ingesta v3: ZIP, enlaces PDF y rescate de mensajes movidos. Partir los PDF con varias facturas. | Coca-Cola manda ZIP; NuestraFactura manda enlace; algunos mandan un PDF con todas las facturas del periodo. |
| 15-09-2026 | Guardarraíl al generar el Excel si una numerada se quedó sin código o sin cuenta. | El bloqueo solo actúa al numerar; una ficha se vació después. |
| 16-09-2026 | Las dos fechas del fichero A3 iguales (la de factura; desde el 28-09, la contable). | Antes la primera llevaba el día de generación, y eso desfasaba un mes el listado por proveedor de A3. |
| 21-09-2026 | Régimen de IVA CNAC/CCEE/SUJPAS con autorrepercusión. | Indicación de la técnica de A3 y de administración. |
| 22-09-2026 | Cuenta de gasto editable desde el listado; asiento rehecho si ya está numerada. | Petición de administración. |
| 24-09-2026 | Abonos en negativo aunque el documento los imprima en positivo. | Sumaban como gasto. |
| 25-09-2026 | Coca-Cola: ya no se fotografían albaranes; entra el PDF `ALB.-POST-FAC.` por correo como albarán y marca duplicado el original. | Las fotos solo tenían la página 1 (sin totales) y el post-factura incluye la devolución de envases, que es lo que se factura. |
| 28-09-2026 | Rentings por contrato; el **seguro siempre separado** a 625000000. | Así lo contabiliza administración en A3. Criterio confirmado por dirección. |
| 28-09-2026 | Fecha contable con regla de trimestre cerrado. | Una factura que llega tarde no puede reabrir un 303 ya presentado. |
| 29/30-09-2026 | Rendimiento: RLS envuelta, filtros con espera, tablas de 200 en 200, conciliación perezosa. | Quejas de lentitud. La causa raíz era la RLS fila a fila. |
| 30-09-2026 | «Pendiente de revisar» en vez de «Lista» para facturas sin bloqueos pero en REVISAR; filtro «Ya numeradas con bloqueos»; recorte de PDF con basura; el detector de duplicados tiene en cuenta el proveedor. | Notas de administración (bloque A). |

---

## 7. Operación

**Rutina diaria (equipo):** abrir Compras una vez al día como mínimo para vaciar la bandeja. Revisar
«Proveedores» (nuevos sin autorizar), los documentos en Revisar o No cuadra y la pestaña Buzón.

**Generar el fichero de A3:** pestaña Exportar A3 → resolver bloqueos → botón. El fichero numera y, con eso,
contabiliza.

**Qué vigilar:**

- Buzón: el KPI «pendientes de leer» (en rojo si pasa de 30), «con error» y «adjuntos rechazados». A 04-10-2026 hay
  30 correos en `ERROR` (lectura IMAP) y unos 50 adjuntos esperando (`PENDIENTE` + `PROCESANDO`).
- GitHub Actions: que el flujo «Ingesta de correo» no esté en rojo. Si falla con 401, el secreto `CRON_SECRET` no
  coincide con el de Vercel.
- Saldo de la API de Anthropic: un saldo agotado deja los adjuntos en `PENDIENTE` con «reintentable: credit
  balance».
- Contador de IA en Agentes (coste mensual de Compras).

**Consultas útiles (solo lectura):**

```sql
-- ¿va al día la bandeja?
select estado, count(*) from compras_correo_adjunto group by 1;
select estado, count(*) from compras_correo group by 1;
-- facturas que no recibirán número en el próximo Excel, y por qué
select doc_id, proveedor_nombre, bloqueos from compras_a3_export_preview
 where cabnumdoc is null and cardinality(bloqueos) > 0;
```

**Reencolar:** desde la pantalla, Buzón → «Reencolar con error» (todos los adjuntos en `ERROR`) o, en el detalle
de un correo, «cargar como factura» o «cargar como albarán». Por SQL, poner `estado='PENDIENTE', claimed_at=null`.
Un correo entero se vuelve a leer poniéndolo en `estado='DESCUBIERTO'`.

**Contrato de renting nuevo:** una fila en `compras_contrato_centro` (`contrato` solo con dígitos). **Datáfono
nuevo:** `compras_terminal`. **Punto de luz nuevo:** `compras_cups`.

**Contabilizar o rehacer desde el servidor:** `compras_generar_asiento_como(p_doc, p_por)` y
`compras_asiento_rehacer(...)` exigen un usuario (lo pide `fin_confirmar_asiento`). Para firmar por SQL se fija
`request.jwt.claims` con el `sub` de un perfil de la cuenta (`set_config(..., true)` dentro de la transacción).

**Variables de entorno** (solo nombres):

- Vercel `hostelero-app`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASS`,
  `INGESTA_CARPETAS_EXCLUIR` (opcional), `CRON_SECRET`.
- GitHub Actions (secreto del repo): `CRON_SECRET`.
- Scripts locales (`.env.local`, fuera de git): `HOSTELERO_URL`, `HOSTELERO_SERVICE_KEY` y `ORIGEN_ANON` (solo
  para el delta histórico).

---

## 8. Riesgos, limitaciones conocidas y pendientes

**Seguridad (por confirmar con una prueba; lo dice la configuración, no lo he probado):**

1. **La bandeja `compras_correo_adjunto` se puede leer entera con la clave publicable.** Las políticas anon del
   port (`…_anon_select using true` y `…_anon_insert check true`) siguen vivas junto a las estrechas. Como el
   bucket `documentos` es público, eso expone las URL de todas las facturas recibidas. La clave publicable está
   en la página pública `/subir-facturas`. Arreglo propuesto: migración que haga `drop` de las dos políticas
   anchas (las estrechas `adjunto_movil_*` ya cubren el móvil).
2. **Las vistas `compras_*` con permisos para `anon` y sin `security_invoker`** saltan la RLS (son de `postgres`):
   `compras_a3_cabecera`, `compras_a3_export_preview`, `compras_cuadre`, `compras_conciliacion_correo` (remitente y
   asunto de los correos), `compras_proveedor_duplicados`… Arreglo propuesto: `revoke all … from anon` en esas
   vistas y valorar `security_invoker = on`. Ojo: con `security_invoker`, la RLS de las tablas pasa a aplicarse y
   hay que probar que la pantalla sigue viendo lo mismo.
3. **Funciones ejecutables por `anon`**: `compras_generar_asiento` e `ia_registrar` (las dos SECURITY DEFINER),
   `exportar_a3_anual`, `fusionar_*`, `borrar_producto`… Las que son INVOKER fallan por la RLS, pero conviene
   revocar: la invariante del 05-08 («EXECUTE revocado a anon en todas las funciones») se perdió en el port.
4. **Bucket `documentos` público.** Quien tenga una URL ve la factura. Las URL no son adivinables, pero ver el
   punto 1.
5. `compras_concil_confirmada` no tiene `cuenta_id` y su política es `true`.
6. El HTML lleva incrustada una lista semilla de proveedores (`PROV_SEED`) con NIF, algunos de personas
   físicas, y el repo es **público**. Los scripts del port llevan una clave publicable del Supabase viejo
   (pendiente de borrar ese proyecto).

**Funcionales y de diseño:**

- **Sin Compras abierta no hay OCR.** Los adjuntos del correo y del móvil esperan en `PENDIENTE`. Moverlo a un
  proceso de servidor sería la mejora estructural (Vercel Pro o una cola).
- **Cambiar el centro, el proveedor o los importes de una factura ya numerada no rehace el asiento.** Solo lo
  rehacen el cambio de cuenta y el de fecha contable desde el listado. Hay que rehacerlo a mano
  (`compras_asiento_rehacer`) y avisar a administración para A3. Por confirmar si se quiere automático.
- En facturas, el aviso «Pendiente de revisar» dice «ábrela y pulsa Guardar cambios», pero en el modal de factura
  ese botón solo guarda la lista de albaranes y no recalcula el estado. El estado cambia con
  «♻︎ Recalcular estados», al tocar un importe o tras la siguiente tanda de OCR. Por confirmar y corregir el texto.
- `recalcular_estado_facturas` exige `canal` aunque la factura esté repartida (la arregla la migración
  `20260930140000`, sin aplicar).
- La pantalla se recarga sola a los 50 minutos para renovar el token, **aunque esté procesando**. Lo reclamado se
  suelta al cerrarse la página y vuelve a la cola, pero la tanda se corta. Mejora posible: aplazar la recarga
  mientras `_sincronizando` o la cola tengan trabajo.
- La llamada del navegador a `/api/compras/ingesta-correo` siempre recibe 401 (falta la autorización). No rompe
  nada, pero el texto «Al abrir la app se revisa el buzón sola» induce a error: el buzón lo revisa el cron.
- **Monoempresa de hecho:** inserciones sin `cuenta_id` (default Bonita), y en el código van fijos el NIF propio,
  los 8 centros, la lista de cuentas de gasto (`CUENTAS`) y el nombre de la empresa en el prompt. La vista `gastos`
  y su caché no filtran por cuenta. Hay que resolverlo antes del segundo cliente.
- **Sin permisos finos** dentro de la pantalla (§5).
- Textos desactualizados: el comentario de `app/compras/route.ts` dice que la ingesta sigue en el Vercel viejo (se
  portó el 25-08); `lib/modulos.ts` habla de una «pasarela /api/compras/* a su Vercel» que ya no existe; la ayuda
  de la pestaña Exportar A3 dice que la primera columna lleva la fecha de hoy (hoy lleva la fecha contable).
- `anthropic.js` declara `maxDuration: 300` y la ingesta 60 por estar en plan Hobby. Por confirmar el límite real
  del plan.
- `compras.html` es un fichero de 6.500 líneas sin pruebas automáticas. La lógica de cuadre está duplicada entre
  JS y Postgres (`cod_iva_de_pct`, `canal_canonico`, `firmaDup`): si cambias una, cambia la otra.
- Precios de IA fijos en el código.

**Pendientes de negocio (de las notas de administración del 30-09):**

- Aplicar la migración `20260930140000_compras_arreglos_lucia.sql`.
- Bloque D: botón «Anular con abono»; correos de Outlook con `winmail.dat` (14 casos, hoy rechazados por tipo); un
  punto de suministro de Repsol sin centro.
- Suministros (Repsol, Alisbe, agua, Energema, Gas Menorca): falta la lista dirección/contrato → centro que
  preparará administración, para un «punto de suministro» como el CUPS.
- Agua: EXE o NOSUJETO; cabecera del Excel `linctacon` o `linctaconl`: pendientes de hablar con A3.
- Proveedores sin alta en A3 (Anthropic) y régimen de IVA de Wix.

---

## 9. Cómo tocarlo sin romper nada

1. **El HTML se sirve tal cual.** Edita `apps/general/datos/compras.html`. No quites los marcadores
   `__SUPABASE_URL__`, `__SUPABASE_ANON__`, `__SB_TOKEN__` y `__CUENTA_ID__`, ni el `</body>` (ahí se inyecta el
   vigilante de versión). Sube la versión del `console.log` de `sincronizarCorreo` y describe el cambio.
2. **Pestaña nueva:** botón en `nav.tabs-nav` (`data-v="x"` y `onclick="tab('x')"`), `<section id="v-x"
   class="view">` y, si carga datos, una rama en `tab()`. Para listas largas usa `sbAll()` (nunca un `sb()` suelto
   sin paginar), `tramoPintado` / `filaVerMas` para pintar de 200 en 200, y `enDiferido` en los buscadores.
3. **Pantalla Next.js nueva** dentro de Compras: crea `app/compras/<x>/page.tsx` con `exigirModulo("compras")`.
   No cambies `RUTAS_MODULO`.
4. **Migraciones solo aditivas** (`create … if not exists`, `create or replace`, columnas nuevas nullable). Las
   escribes en `apps/general/supabase/migrations/`, las revisa dirección y las **aplica el chat** con
   `apply_migration`. Después renombra el fichero a la versión registrada en `schema_migrations` y regenera
   `packages/db/types.ts`.
5. **Toda política nueva** con `(select cuenta_actual())` y `(select es_operador())`, nunca sin envolver. Tabla
   nueva: RLS desde el primer día, `cuenta_id` con default de la cuenta, y `revoke all … from anon` si no la usa el
   móvil. Función nueva: `revoke execute … from anon, public` y `set search_path = public, pg_temp`.
6. **Insert por lotes en PostgREST: las mismas claves en todas las filas.** Si una fila no tiene un campo, mándalo
   con `null`.
7. **Paginación con `order` estable** (`order=id` o equivalente) en cualquier script que recorra tablas grandes: sin
   orden estable se repiten o se saltan filas (costó 7 facturas borradas y recreadas el 20-09).
8. **No toques documentos con `a3_numdoc`** salvo con las funciones de rehacer. No borres asientos confirmados (los
   protege `fin_apuntes_proteger`): se corrigen con contra-asiento.
9. **No escribas `nombre_norm` ni `nif_norm`** desde el navegador ni desde scripts: los calcula Postgres.
10. **Si cambias el JSON del OCR**, revisa `procesarUno`, `reprocesarDoc` y `lecturaEvaluable` a la vez, y las
    vistas que leen `raw` (`compras_a3_cabecera` usa `raw->'desglose_iva'`).
11. **Si cambias el formato del fichero A3**, compara antes con la plantilla de A3: las columnas de IRPF y
    `cabregiva` van en posiciones fijas y, si se desplazan, A3 importa mal **sin dar error**.
12. **Ingesta:** `maxDuration` siempre como número literal y en línea con `SEGUNDOS_MAX`. Nada que marque, mueva o
    borre mensajes del buzón.
13. **No toques** las tablas y columnas de Pedidos (`compras_pedido*`, `compras_catalogo_import`, `pedido_*`,
    `pedible`, `catalogo_*`) desde Compras.
14. **Prueba en el navegador de verdad**, con sesión real. El banco de pruebas local (`.humo/`, simulador de
    PostgREST, fuera de git) sirve para la interfaz, pero no sustituye una carga real de un PDF.
