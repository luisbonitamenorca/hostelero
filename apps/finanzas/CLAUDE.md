# CLAUDE.md — Hostelero · Finanzas

## Qué es esto
Módulo financiero de la plataforma Hostelero (multi-tenant sobre Supabase). Primer usuario: Bonita Menorca, SL (grupo hostelero, Menorca). Cubre facturación con Verifactu, contabilidad PGC, bancos, impuestos AEAT y remesas SEPA. Primero uso interno, después producto comercial. El alcance completo está en docs/erp-hostelero-alcance-y-arquitectura-v0.1.md — leerlo antes de tocar nada.

## Dónde vive esto
Es `apps/finanzas` del monorepo `luisbonitamenorca/hostelero`, junto a `apps/general` (hostelero-app) y `apps/consola`. Comparte `packages/db` (tipos generados de Supabase) y `packages/ui` (tokens). Se movió aquí el 16-08-2026: antes era un repo suelto, lo que duplicaba cliente de Supabase y tokens y obligaba a un segundo login.

## Cómo se sirve (multizona) — leer antes de tocar rutas
La app tiene `basePath: "/finanzas"` y se sirve **bajo el dominio de hostelero-app** por un rewrite de `apps/general/next.config.mjs`. El motivo es la sesión: las cookies son por dominio, así que con dos dominios habría que entrar dos veces. Consecuencias:

- La dirección buena es `hostelero-app.vercel.app/finanzas`. En su dominio propio la app ya solo responde bajo el prefijo: `hostelero-finanzas.vercel.app/finanzas/login`.
- El guard de `apps/general` **excluye** `/finanzas` a propósito: el módulo trae el suyo y comparte cookies. Si no se excluyera, cada fichero estático suyo dispararía una llamada a Supabase.
- `serverActions.allowedOrigins` incluye el dominio de hostelero-app. Sin eso, Next rechaza todas las acciones de servidor tras el proxy, porque el Host que llega no es el suyo.
- **El prefijo NO se aplica solo en todas partes**: `Link` y `router.push` lo añaden; `NextResponse.redirect` del middleware también; el `redirect()` de next/navigation en acciones de servidor y guards **no**. Para eso está `lib/rutas.ts` con `ruta()`. Verificado en local: sin ello, un login fallido acababa en la portada de hostelero-app.

## Estado actual (verificado 16-08-2026)
- Migración F0 APLICADA en producción (copia exacta en supabase/migrations/): 14 tablas fin_* con RLS, facturas expedidas inmutables por trigger, registros Verifactu de solo inserción.
- Datos sembrados y cuadrados: plan de cuentas migrado desde A3 (635 = 635), ejercicio 2026 con 12 periodos, series F-2026 y R-2026, fin_config con la serie F por defecto.
- Emisor completo en `sociedades`: Bonita Menorca, SL · B01996826 · C/ Ses Barraques s/n, 07710 Sant Lluís.
- Módulos registrados en la plataforma: área Finanzas (facturacion, contabilidad, bancos, impuestos, remesas); facturacion y contabilidad contratados para la cuenta Bonita.
- Tareas 1 a 4 de la fase 1 hechas: despliegue, clientes, series y borrador de factura. Ninguna probada aún por Luis contra la base con su sesión (regla 10 pendiente).
- Patrón de auth y datos: el de la casa. Cookies con @supabase/ssr, guard en middleware.ts, `exigirFacturacion()` (sesión + módulo contratado + rol) en lib/supabase/server.ts, y escrituras por acciones de servidor en app/acciones.ts. Nada de claves en el código: NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.
- Solo hay cliente de navegador en /recuperar y /nueva-clave, porque el token de recuperación llega en la URL.
- lib/nif.ts: NIF/NIE/CIF por dígito de control e IBAN por mod-97. `normalizarNif` replica norm_nif() de la base (lookahead incluido: quita el prefijo ES si le siguen AL MENOS 9 caracteres).
- lib/importes.ts: ÚNICO sitio donde se redondea. Half-up por línea a 2 decimales con corrección del error binario. Acepta coma decimal.
- pruebas/ con 24 casos (npm test, sin dependencias: borrado de tipos nativo de Node).
- Next.js: ^15.4.8 como suelo, la primera parcheada de esa rama frente a CVE-2025-66478 (RCE en RSC, CVSS 10.0). Vercel rechaza el despliegue de versiones afectadas.
- Migraciones aplicadas: F0 (14-08), F1a, F1b (permisos de expedir/anular cerrados a anon) y F1c (tipo_rectificativa S/I + restricción que impide una rectificativa incompleta). La única SIN aplicar es la F0b.
- Rectificativas: botón Rectificar en el detalle de una expedida. Crea el borrador con causa R1–R5 y forma S (sustitución, copia las líneas) o I (diferencias, sin líneas). La original nunca se toca.
- Compras: pantallas de solo lectura de proveedores y facturas recibidas sobre compras_proveedor y compras_doc. El maestro vive en el módulo de compras; aquí no se da de alta nada. Falta lo financiero: vencimiento, estado de pago y conciliación.
- Cartera (F2a, SIN aplicar): fin_vencimientos (cobros y pagos en una sola tabla) y fin_proveedor_condiciones. El vencimiento de venta lo crea un disparador al expedir, desde fin_clientes.dias_vencimiento; al anular la factura se anula. El de compra se crea a mano desde Facturas recibidas. Cobrar y pagar se marca a mano hasta que llegue la conciliación bancaria (F2).
- FALLO CONOCIDO de la F0: un borrador CON líneas no se puede borrar. El `on delete cascade` dispara el trigger de las líneas cuando la cabecera ya no existe, y lo interpreta como factura expedida. La app lo esquiva borrando las líneas antes; la corrección está propuesta en supabase/migrations/20260816130000_fin_f0b_borrado_de_borradores.sql, SIN aplicar.

## Migraciones: cómo se nombran y se aplican
Las escribe Claude Code en `supabase/migrations/`, las revisa Luis y las aplica el chat de claude.ai con `apply_migration`. Esa herramienta registra la migración con SU propia marca de tiempo, no con la del nombre del archivo, así que **después de aplicar hay que renombrar el archivo a la versión registrada** (se consulta en `supabase_migrations.schema_migrations`). Si no, un `supabase db push` la vería como pendiente e intentaría reaplicarla. También hay que cambiar la cabecera de PROPUESTA a APLICADA.

Y una migración aplicada NO se edita: los arreglos van en una migración nueva.

## Conexiones e IDs
- Supabase project ref: jwsvkjyjwocuksdgiqnv. La URL y la clave publicable van por variables de entorno, como en el resto del monorepo.
- cuenta_id (Bonita Menorca): 082c5366-d9ae-49b9-a8b8-8caad73985bd
- sociedad_id (Bonita Menorca, SL): 798cf9dc-0146-4a24-94e8-fdb04f93ab70
- Sesión de pruebas: el usuario de Luis en Supabase Auth (luis@bonitamenorca.com).
- Vercel: equipo "Luis' projects" (team_BxyfAxd3xJiWq25fs2KDK8os). Proyecto hostelero-finanzas, con Root Directory `apps/finanzas`. La cuenta conectada por MCP NO puede crear proyectos (403): los crea Luis desde el panel.
- Los proyectos hostelero-app y hostelero-consola son la plataforma viva. Se puede AÑADIR al monorepo, nunca modificar apps/general ni apps/consola sin pedirlo. packages/db y packages/ui se comparten: tocarlos obliga a comprobar que las tres apps siguen compilando.

## Reglas de la casa (innegociables)
1. Importes SIEMPRE en numeric; jamás float. El redondeo se aplica en un único sitio del código.
2. Ninguna migración se aplica sin que Luis vea el SQL antes. Las migraciones viven en supabase/migrations/ con timestamp en el nombre.
3. Prohibido ALTER o UPDATE sobre tablas que no sean fin_* (pertenecen a módulos vivos: reservas, compras, RRHH…). Referenciarlas por FK, sí.
4. RLS en toda tabla nueva con el patrón de la casa: (cuenta_id = cuenta_actual()) or es_operador().
5. Núcleo fiscal append-only: facturas expedidas, registros y eventos Verifactu no se editan ni se borran jamás. Los errores se corrigen con anulación o rectificativa (R1–R5).
6. UI 100% en español. Fechas dd/mm/aaaa (toLocaleDateString "es-ES"); importes con Intl.NumberFormat "es-ES" EUR.
7. Toda pantalla con sus estados: cargando, vacío y error. Sin excepciones.
8. Estética: la paleta y las tipografías de la plataforma (packages/ui/tokens.ts, replicadas como variables CSS en app/globals.css igual que en apps/general): verde #0F6E56, papel #F0F2F1, tinta #1B2420, IBM Plex Sans/Mono. Escritorio primero con responsive hasta móvil, foco visible.
9. Commits pequeños y descriptivos, en español. Nada de secretos en el repo: ni certificados, ni service_role, ni claves privadas.
10. Verificar en cada paso: tras cada pantalla, probarla contra la base real con la sesión de Luis antes de pasar a la siguiente.

## Fase 1 — tareas en orden
1. ~~Repo y despliegue~~ HECHA (16-08-2026). URL arriba.
2. ~~Clientes~~ HECHA (16-08-2026), pendiente de que Luis cree un cliente real desde la UI para cerrar el criterio.
3. ~~Series~~ HECHA (16-08-2026). Listado, alta y activar/desactivar.
4. ~~Factura borrador~~ HECHA (16-08-2026). Cabecera + líneas dinámicas con totales en vivo; guardar, reeditar y borrar.
5. Migración F1a ESCRITA y probada, SIN APLICAR: supabase/migrations/20260816150000_fin_f1a_expedir_y_anular.sql. Falta el OK de Luis y aplicarla desde el chat de claude.ai. Probada creando las funciones dentro de una transacción con rollback: los tres vectores oficiales de la AEAT coinciden, el ejemplo de «URL encoding» del QR también, y el ciclo completo (dos expediciones encadenadas + una anulación) deja la cadena correcta. ImporteTotal con retención RESUELTO con fuente (aclaraciones de desarrolladores de la AEAT, 04-12-2025, apartado 20): el IRPF no entra en el registro; ImporteTotal = base + cuota de IVA, y el total a pagar va aparte en fin_facturas.total.
6. Detalle y expedición ESCRITA, sin poder probarse hasta que se aplique la F1a: botón Expedir en el editor (con confirmación que avisa de que es irreversible) y vista de detalle con número, líneas congeladas, desglose, huella, huella anterior, orden en la cadena, estado de la remisión y QR (nivel M, con «QR tributario:» encima y la leyenda de factura verificable debajo, como manda el artículo 21). Anulación con motivo. Criterio pendiente: expedir una factura DE PRUEBA y comprobar su registro. OJO: acciones.ts tiene un único punto sin tipar para las dos funciones de la F1a, porque los tipos se generan desde la base y allí todavía no existen; al aplicar la migración, regenerar packages/db/types.ts y quitarlo.
7. PDF HECHO en su parte de generación (16-08-2026): route handler /facturas/[id]/pdf, en runtime nodejs, con los datos congelados, el QR recuperado del registro (no recalculado) y la leyenda reglamentaria. Con retención imprime los dos importes. lib/factura-pdf.ts es función pura y tiene pruebas propias. PENDIENTE: archivar en Storage (bucket facturas), que necesita crear el bucket — decisión de plataforma, no de fin_*. Nota: el PDF se regenera idéntico siempre porque sale de datos inmutables, así que Storage es comodidad (enlace estable, envío al cliente), no el mecanismo de conservación. OJO: cuando haya retención, el PDF debe mostrar los DOS importes etiquetados y distinguidos — «Total factura» (el del QR, sin IRPF) y «Total a pagar» —; lo recomienda la propia AEAT porque es lo que el cliente verá al cotejar el QR.

## Documentos oficiales de la AEAT ya leídos (no volver a improvisar)
- Huella/hash de los registros, v0.1.2 (27-08-2024): campos y orden del alta y de la anulación, separadores, formatos, UTF-8, SHA-256 hex en mayúsculas. Sus tres vectores de ejemplo están al final de la migración F1a como comprobación.
- Código QR de la factura, v0.5.0: URL de cotejo (pruebas y producción), los cuatro parámetros, «URL encoding», tamaño 30-40 mm, nivel M, texto «QR tributario:» encima y la frase «Factura verificable en la sede electrónica de la AEAT» debajo.
- Aclaraciones a dudas de los desarrolladores (04-12-2025): apartado 20, concepto de Importe Total y tratamiento del IRPF.

## Especificación de fin_expedir_factura(p_factura_id uuid)
Transacción única, SECURITY DEFINER, set search_path = public:
1. Cargar la factura FOR UPDATE. Validar: estado = borrador; al menos una línea; cliente_id obligatorio salvo tipo F2; la sociedad tiene cif.
2. Bloquear la serie (SELECT … FOR UPDATE en fin_series); tomar numero := siguiente_numero e incrementarlo.
3. Recalcular en servidor base, cuotas y total desde las líneas (redondeo por línea, half-up a 2 decimales — provisional hasta contrastar con la especificación oficial) y regenerar fin_factura_impuestos (borrar + insertar mientras aún es borrador). Los totales del cliente son orientativos: manda el servidor.
4. numero_completo := codigo_serie || '-' || ejercicio || '-' || lpad(numero::text, 6, '0'). fecha_expedicion := now().
5. Serializar la cadena por sociedad: pg_advisory_xact_lock(hashtext('fin_vf_' || sociedad_id::text)); leer el último registro (orden, huella) de fin_verifactu_registros de esa sociedad.
6. Construir el payload del registro de alta y su huella SHA-256 ESTRICTAMENTE según la especificación oficial (ver Verifactu, abajo). Insertar fin_verifactu_registros (orden = último + 1, huella_anterior = huella del último o null) y fin_verifactu_envios en estado pendiente.
7. Actualizar la factura: numero, numero_completo, fecha_expedicion, totales, estado = expedida, expedida_por = auth.uid().
8. Registrar el evento en fin_verifactu_eventos y devolver jsonb con numero_completo, huella y contenido del QR.
fin_anular_factura(p_factura_id, p_motivo): análogo, con registro tipo anulacion y estado = anulada. Nunca DELETE.

## Verifactu — reglas duras
- Normativa: RD 1007/2023 y Orden HAC/1177/2024. Modo elegido: VERI*FACTU (remisión a la AEAT).
- La cadena de la huella y el QR ya NO son una incógnita: están implementados en la F1a siguiendo los documentos oficiales (huella v0.1.2 de 27-08-2024 y QR v0.5.0), y contrastados con sus ejemplos. Resumen: campos concatenados como `nombre=valor&...` sin `&` final, valores recortados, importes con punto decimal, fechas DD-MM-AAAA, fecha-hora ISO 8601 con huso, UTF-8, SHA-256 en hexadecimal y MAYÚSCULAS. Campo ausente = solo `nombre=`. Cualquier cambio ahí se revalida contra los tres vectores del documento.
- PROHIBIDO expedir facturas reales este fin de semana. Solo pruebas con cliente "PRUEBAS — NO FISCAL". La validación contra el entorno de pruebas de la AEAT va la semana siguiente; hasta que una factura de prueba pase ese entorno, nada de producción real.
- La remisión (Edge Function con certificado) NO se implementa aún. El certificado lo subirá Luis a los secretos de Supabase; jamás al repo ni a un chat.

## Reparto de trabajo
- Claude Code (este repo): la app, el repo, el despliegue, y el SQL de F1a como archivo para revisión.
- Claude en claude.ai (chat con MCP): aplica migraciones tras el OK de Luis, verifica datos en producción, lleva normativa y decisiones de alcance.
- Luis: revisa migraciones, prueba pantallas, custodia el certificado.

## Trampas conocidas para más adelante
- **Cargar el histórico de Ágora NO se puede hacer con un INSERT normal.** El disparador `fin_facturas_nacer_borrador` (F2b) rechaza cualquier factura que no nazca en borrador y sin número, que es justo lo que impide colar facturas expedidas sin registro Verifactu. Si algún día se cargan las facturas históricas, hay que desactivar ese disparador DENTRO de la propia migración de carga y volver a activarlo al terminar. Que sea incómodo es intencionado. Y antes de eso, decidir si esas facturas deben entrar como `fin_facturas` (las emitió Ágora, otro SIF) o como ventas externas en agregado, que es lo que se recomendó el 16-08-2026.
- **Los plazos de pago de los proveedores no existen en ninguna parte.** `fin_proveedor_condiciones` está creada pero vacía: hasta que se rellene, los vencimientos de compra salen a 30 días por defecto.
- **El desglose por tipo de IVA no está en `compras_doc`**, que guarda un único importe. Hará falta para el libro de IVA soportado y para el 303.

## No hacer nunca
- Tocar los proyectos Vercel hostelero-app / hostelero-consola, ni escribir en tablas ajenas a fin_*.
- Editar o borrar filas de fin_verifactu_* o facturas expedidas "para arreglar" algo.
- Poner service_role, certificados o contraseñas en el código o en el repo.
