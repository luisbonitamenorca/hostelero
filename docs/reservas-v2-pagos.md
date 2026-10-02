# Reservas v2 · Pagos con tarjeta (Redsys / CaixaBank)

Pieza «pagos» del módulo Reservas. Tres casos, todos sin que la tarjeta pase por nuestro servidor:

| Caso | Qué pasa | Dónde |
|---|---|---|
| **Garantía** (reserva con política de cancelación) | Operación de **0 €** en la página del banco que guarda la tarjeta como referencia (COF). No se cobra nada. Reserva → `estado_pago = garantizada`. | Página pública `/reserva/<token>/pago` |
| **Prepago / ticket** | Cobro por redirección del importe (pax × importe). Reserva → `estado_pago = pagada`. | Página pública `/reserva/<token>/pago` |
| **Cargo por no-show / cancelación tardía** | Petición REST servidor-a-servidor con la referencia guardada, por el importe de garantía → `cobrado_noshow`. **Devolución** (operación tipo 3) → `devuelto`. | Panel (dirección) y cron |

En todos los casos la reserva pasa de `tarjeta_pendiente` a `confirmada` (si el restaurante tiene
`confirmar_online_auto`) o a `pendiente`, y se marca `notificar = true` para que el cliente reciba su
confirmación por los canales del módulo de mensajería.

## 1. Lo que tiene que activar Luis en CaixaBank (comercio 369732227)

Pedir a CaixaBank (soporte de comercios / TPV Virtual) que activen en el comercio, **en test y en real**:

1. **Pago por referencia / tokenización (COF, «Credential On File»)**. Es lo que permite que el banco
   nos devuelva `Ds_Merchant_Identifier` y `Ds_Merchant_Cof_Txnid` en la primera operación y que
   podamos cobrar después con `DS_MERCHANT_IDENTIFIER` sin cliente presente.
2. **Operaciones de importe 0 €** (autorización de 0 € para tokenizar sin cargo). Sin esto, la
   operación de garantía devuelve error SIS0018/SIS0020 o similar.
3. **Operaciones MIT / pagos sin cliente presente** (`DS_MERCHANT_DIRECTPAYMENT=true`,
   `DS_MERCHANT_EXCEP_SCA=MIT`), para que el cargo por no-show no pida 3DS.
4. **Canal REST** (`/sis/rest/trataPeticionREST`) habilitado para el comercio: cargos con referencia y
   devoluciones se hacen por ahí.
5. **Devoluciones** (tipo de operación 3) permitidas desde la integración (no solo desde el portal).
6. **Comprobar que las URLs de notificación están permitidas**: Redsys llama por POST a
   `https://<host>/api/publico/reservas/pago/notificacion`. En la ficha del comercio no hace falta
   fijarlas (van en cada petición: `DS_MERCHANT_MERCHANTURL`, `URLOK`, `URLKO`), pero conviene
   activar **«Parámetros en las URLs» / «Enviar parámetros en URL OK/KO»** para que la vuelta del
   cliente también traiga la firma (así la página de resultado se pinta bien aunque la
   notificación llegue un segundo más tarde).

Lo de Visitas (`/api/publico/visitas/pago*`) sigue funcionando igual: solo usa redirección normal
y no necesita nada de lo anterior.

## 2. Variables de entorno (Vercel, nunca en el repo)

Las mismas que ya usa Visitas:

| Variable | Valor |
|---|---|
| `TPV_COMERCIO` | `Ds_Merchant_MerchantCode` (369732227 en real; el de pruebas que dé CaixaBank en test) |
| `TPV_TERMINAL` | normalmente `1` |
| `TPV_CLAVE` | clave secreta del comercio en Base64 (en test, la que da Redsys para el comercio de pruebas) |
| `TPV_URL` | test: `https://sis-t.redsys.es:25443/sis/realizarPago` · real: `https://sis.redsys.es/sis/realizarPago` |
| `TPV_URL_REST` | *(opcional)* se deriva de `TPV_URL` (`<origen>/sis/rest/trataPeticionREST`); solo si cambiara |

Además, como el resto del front público: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
El enlace que recibe el cliente (`{{enlace_pago}}`) sale de `reservas_url_base(restaurante)` →
`reservas_restaurantes.url_base` (fallback `https://hostelero-app.vercel.app`): poner ahí el dominio
real de cada restaurante cuando exista.

## 3. Ficheros

| Fichero | Qué hace |
|---|---|
| `apps/general/lib/redsys.ts` | Lo de Visitas intacto + `firmarParametros`, `formularioGarantia` (0 € + COF), `formularioCobro`, `peticionRest` (REST firmado y con verificación de firma de la respuesta), `cobrarConReferencia`, `devolverCobro`, `tarjetaDeParametros`, `urlRest`, `TPV_OP`, `TPV_IDIOMA`. |
| `apps/general/lib/pagos-reservas.ts` | Lógica de negocio con el cliente de servicio: `iniciarPagoReserva`, `aplicarResultadoTpv` (idempotente por `ds_order`; reactiva o devuelve los pagos que llegan tarde), `cobrarGarantia` (total o parcial), `devolverPago` (total o parcial), `resolverIncierto`, `cobrarNoShowsPendientes` (para el cron), lecturas (`reservaPorToken`, `pagosDeReserva`, `devolvibles`, `requiereRevision`), `modoDeReserva`, `reservaFutura`, `caducaEn`, `fmtEuros`, `ESTADO_PAGO_TXT`, `TIPO_PAGO_TXT`, `ESTADO_FILA_TXT`. |
| `apps/general/app/api/publico/reservas/pago/iniciar/route.ts` | `POST {token, idioma}` → `{url, campos, modo, importe}`: crea el intento en `reservas_pagos` y devuelve el formulario firmado. |
| `.../pago/notificacion/route.ts` | Notificación servidor-a-servidor del banco (la verdad del pago). Verifica firma, aplica, responde 200 siempre. |
| `.../pago/retorno/route.ts` | Vuelta del cliente (`URLOK`/`URLKO`, GET o POST). Si trae parámetros firmados los aplica; redirige a `/reserva/<token>/pago?resultado=ok|ko`. |
| `apps/general/app/reserva/[token]/pago/page.tsx` (+ `BotonPagar.tsx`, `pago.css`) | Página pública clara: explica importe/garantía y política, botón que lanza el POST al banco, pantallas de resultado (ok / confirmando / ko / enlace caducado / ya hecho / cancelada). Español e inglés según `reservas.idioma`. |
| `apps/general/app/reservas/acciones/pagos.ts` | Server actions del panel: `estadoPagos(reservaId)`, `cobrarNoShow(reservaId, motivo?, importe?)`, `devolver(pagoId, importe?)`, `resolverPagoIncierto(pagoId, hecho)`, `listarPagos(reservaId)`, `hayPagosInciertos(reservaIds)`, `pagosPorRevisar(restauranteId)` (Inbox), `darCobroPorRevisado(pagoId)`. Cobrar, devolver, resolver y dar por revisado solo dirección. |
| `apps/general/app/reservas/componentes/bloque-pagos.tsx` (+ `.css`) | `<BloquePagos reservaId onCambio? />`: el bloque «Pago» listo para montar en el modal de reserva (§5). Oscuro y claro con las variables de tema. |
| `apps/general/supabase/migrations/20261002150000_reservas_pagos_cerrojos.sql` | Índices únicos parciales: un cargo vivo por reserva y una devolución en curso por cobro (§7). **Pendiente de aplicar.** |

`/reserva/*` ya es ruta pública en `apps/general/middleware.ts` (sin login); no hace falta tocarlo.

## 4. Flujo completo

### 4.1 Garantía (política de cancelación)
1. Alta online con `pax ≥ tarjeta_desde_pax` (o «Solicitar tarjeta» desde el panel) → reserva
   `tarjeta_pendiente`, `estado_pago = pendiente_tarjeta`, `importe_garantia = pax × garantia_importe_pax`,
   `tarjeta_solicitada_en = now()`. Mensajería manda la plantilla `garantia` con `{{enlace_pago}}`.
2. El cliente abre `/reserva/<token>/pago`. La página lee la reserva con el token (32 hex) y, si sigue
   `tarjeta_pendiente` y la fecha no ha pasado, muestra: ficha, importe de garantía (total y por
   persona), la política («solo si no te presentas o cancelas con menos de N h se cargarán X €»),
   los minutos que quedan (`tarjeta_caduca_min`) y el botón **Registrar tarjeta**.
3. El botón hace `POST /api/publico/reservas/pago/iniciar` → si a la retención le quedan menos de
   15 min se alarga hasta 15 (para que la mesa no caduque con el cliente en la página del banco;
   solo en los 3 primeros intentos: llamar a la ruta cada 14 min no retiene la mesa para siempre),
   se marca `cancelado` cualquier intento `iniciado` anterior, se inserta `reservas_pagos` (tipo `garantia`, importe 0, `ds_order` nuevo) y se devuelve
   el formulario con `DS_MERCHANT_AMOUNT=0`, `DS_MERCHANT_IDENTIFIER=REQUIRED`,
   `DS_MERCHANT_COF_INI=S`, `DS_MERCHANT_COF_TYPE=C`. El navegador lo envía al banco.
4. El cliente mete la tarjeta en la página de CaixaBank.
5. El banco llama a `/notificacion` (POST firmado). `aplicarResultadoTpv`: solo si el pago está
   `iniciado` (idempotente; carrera entre notificación y retorno resuelta con
   `update … where estado = 'iniciado'`). Autorizada (`Ds_Response` 0–99) → pago `autorizado` con
   `identificador_cof`, `cof_txnid`, `tarjeta_mascara`, `tarjeta_caducidad`, `respuesta`; reserva
   `estado_pago = garantizada`, `estado = confirmada|pendiente`, `notificar = true`. Denegada → pago
   `fallido`, la reserva sigue `tarjeta_pendiente` y el cliente puede reintentar hasta que el cron
   la caduque (`reservas_caducar_tarjeta_pendiente`).
6. El banco devuelve al cliente a `/retorno?token=…&r=ok|ko` → redirección a la página, que pinta
   «Tarjeta registrada» (o «Confirmando con el banco…» con recarga automática cada 4 s mientras la
   notificación no haya llegado —unos 40 s como mucho, luego «Todavía no tenemos la respuesta del
   banco» con «Comprobar de nuevo»—, o «No se ha completado» con botón de reintento).

### 4.1 bis · Pagos que llegan tarde o repetidos
`aplicarResultadoTpv` acepta también los intentos `cancelado` (sustituidos por otro intento, pero
que el cliente pudo completar en otra pestaña). Si el resultado autorizado llega cuando la reserva:
- sigue `tarjeta_pendiente` → flujo normal;
- ya está garantizada/pagada por otro intento → prepago **devuelto solo** (REST tipo 3) / garantía
  anulada (0 €, no hay nada que devolver). La comprobación se repite con la reserva releída si
  otro intento gana el update condicional mientras tanto (dos pestañas a la vez);
- la ha movido el restaurante a mano a un estado vivo → solo se apunta `estado_pago`, con update
  condicional (`estado_pago` aún sin resolver); si otro pago ya la resolvió, este se devuelve;
- **la caducó el cron** (cancelada por `sistema`, `pendiente_tarjeta`), es futura y **sus mesas
  siguen libres** (`reservas_mesa_ocupada`) → se **reactiva** (confirmada o pendiente) y se pide la
  confirmación con `reservas_programar_mensajes(id, 'confirmada'|'alta')`;
- en cualquier otro caso (cancelada por cliente/restaurante, no-show, pasada, mesa ya dada) →
  prepago devuelto solo / garantía anulada. La página pública dice «te hemos devuelto X €».
- **si la devolución automática no sale** (el banco la rechaza, no contesta o no hay TPV): el
  cobro queda `cobrado` con `respuesta._devolver_a_mano = true`, la reserva pasa a
  `estado_pago = pagada` (si no tenía otro) y sale en `pagosPorRevisar` / en el bloque de pagos
  con «Devolver». La página pública le dice al cliente que el restaurante lo revisará y devolverá.

### 4.2 Prepago / ticket
Idéntico, pero el pago es tipo `prepago` con `importe = importe_prepago`, el formulario es un cobro
normal (`formularioCobro`) y al autorizar: pago `cobrado`, reserva `estado_pago = pagada`.

### 4.3 Cargo por no-show / cancelación tardía
- **Panel** (modal de reserva, solo dirección): `cobrarNoShow(reservaId, "no_show" | "cancelacion_tardia", importe?)`.
  Requisitos: reserva en `no_show`, o `cancelada` **por el cliente** (`cancelada_por = 'cliente'`)
  **dentro de las N horas previas** (`cancelada_en ≥ inicio − politica_cancelacion_horas`, mismo
  criterio que `reservas_gestion_cancelar`): es la política que se le enseñó al registrar la tarjeta.
  Cancelada por el restaurante/sistema → `cancelada_no_cliente`; cancelada a tiempo →
  `cancelacion_en_plazo` («El cliente canceló dentro de plazo: no procede cargo»). El motivo que se
  apunta sale del estado (no_show → `no_show`, cancelada → `cancelacion_tardia`), no del parámetro.
  Hay que marcar antes el no-show: así no se cobra por error una reserva viva. Además
  `estado_pago ∈ {garantizada, fallido}`, `importe_garantia > 0`, pago de
  garantía `autorizado` con `identificador_cof`, ningún `cargo_noshow` `cobrado` ni en curso.
  Importe: el que se indique (cargo parcial, p. ej. si vino parte del grupo) o `importe_garantia`;
  nunca más. Crea `cargo_noshow` (`iniciado`, `pago_origen_id` = la garantía), lanza REST con
  `DS_MERCHANT_IDENTIFIER`, `DS_MERCHANT_DIRECTPAYMENT=true`, `DS_MERCHANT_EXCEP_SCA=MIT`, `COF_INI=N`,
  `COF_TXNID`, verifica la firma de la respuesta y deja el pago `cobrado` (reserva `cobrado_noshow`)
  o `fallido` (reserva `fallido`; se puede reintentar).
- **Doble clic / dos personas / persona + cron**: el índice único `reservas_pagos_un_cargo_vivo`
  (un `cargo_noshow` `iniciado|cobrado` con `ds_order` por reserva) hace fallar el segundo INSERT
  (23505 → `en_curso`). La comprobación posterior por orden de creación queda como segunda defensa.
  Nunca salen dos cargos.
- **El banco no contesta** (tiempo agotado, 5xx, respuesta ilegible o con firma mala): no sabemos
  si ha cobrado. El cargo se queda `iniciado` con `respuesta._incierto = true`, bloquea reintentos y
  el panel lo marca «Sin respuesta del banco». Dirección lo busca en el portal del TPV y lo resuelve
  con `resolverPagoIncierto(pagoId, hecho)`. Lo mismo para devoluciones.
- **Cron: reintento y tiempo** (para el integrador, `app/api/cron/reservas-mensajes/route.ts`, que
  no es de esta pieza). `reservas_noshow_automatico()` solo devuelve la reserva en la pasada en que
  pasa a `no_show`; si el cron muere a mitad (maxDuration 60 s, hasta 25 s por cargo REST) los que
  faltan se quedaban sin cobrar y sin rastro. Sustituir en `procesarCobrosNoShow` la llamada por:
  ```ts
  import { cobrarNoShowsPendientes, noShowsPorCobrar } from "@/lib/pagos-reservas";
  // Las recién marcadas Y las que quedaron sin cobrar en pasadas anteriores (3 días, sin Cover,
  // con tarjeta, cobro automático activo y sin cargos denegados antes).
  const filas = await noShowsPorCobrar(sb, 3);
  const r = await cobrarNoShowsPendientes(sb, cfg, filas, { hasta: t0 + 35_000 });
  out.cobrados = r.cobrados; out.fallidos = r.fallidos;
  if (r.errores.length || r.inciertos || r.sin_tiempo)
    console.error("[cron reservas-mensajes] cobros no-show", { errores: r.errores, inciertos: r.inciertos_ids, sin_tiempo: r.sin_tiempo });
  ```
  (`hasta` deja margen para el envío de mensajes del paso 6; lo que no da tiempo lo recoge la
  pasada siguiente). Un cargo denegado no se reintenta solo (no se insiste con la misma tarjeta):
  queda en `pagosPorRevisar` para que dirección decida.
- **Cron** (`/api/cron/reservas-mensajes`, agente «mensajes»/«cron»): hoy deja una anotación
  (`cargo_noshow` `iniciado` sin `ds_order`, `respuesta.pendiente_de_cobro`). El integrador debe
  sustituir el cuerpo de su `cobrarNoShow(sb, f)` por:
  ```ts
  import { configTpv } from "@/lib/redsys";
  import { cobrarGarantia } from "@/lib/pagos-reservas";
  const cfg = configTpv();
  if (!cfg) return "anotado"; // (deja la anotación actual)
  const res = await cobrarGarantia(sb, cfg, { reservaId: f.reserva_id, motivo: "no_show" });
  return res.ok ? "cobrado" : res.error === "ya_cobrado" ? "ya_anotado" : "anotado";
  ```
  o llamar en bloque a `cobrarNoShowsPendientes(sb, configTpv(), filas)`. `cobrarGarantia` anula
  sola las anotaciones del cron cuando cobra de verdad, y las reservas de Cover no tienen garantía
  en `reservas_pagos`, así que dan `sin_tarjeta` (no se cobran).
- **Cancelación tardía por el enlace público** (agente «widget»/«publico»): `reservas_gestion_cancelar`
  devuelve `cargo_aplicable` y `reserva_id`; si es `true`, llamar a
  `cobrarGarantia(sb, cfg, { reservaId, motivo: "cancelacion_tardia" })`. Decisión pendiente de Luis:
  ¿cobrar automáticamente al cancelar tarde o dejarlo a dirección desde el panel? (Cover lo cobra
  automáticamente si la política está activa; aquí está preparado pero no conectado.)

### 4.4 Devolución
`devolver(pagoId, importe?)` (solo dirección) sobre un pago `cobrado` de tipo `prepago` o
`cargo_noshow`: operación tipo 3 por REST con el `ds_order` original. Sin importe = todo lo que
quede por devolver; con importe = devolución parcial (se pueden encadenar varias hasta el total).
Crea fila `devolucion` (`pago_origen_id`). Cuando lo devuelto llega al total, el cobro original
pasa a `devuelto`; la reserva pasa a `estado_pago = devuelto` **solo si no le queda ningún otro
cobro vigente** (si queda un prepago cobrado —p. ej. se devolvió el duplicado de dos pestañas— sigue
`pagada`; si queda un cargo, `cobrado_noshow`). Con devoluciones parciales la reserva sigue
`pagada`/`cobrado_noshow`. Solo puede haber una devolución en curso por cobro (índice único
`reservas_pagos_una_devolucion_viva`; la segunda → `en_curso`), y tras insertarla se comprueba que
devuelto + en curso no pase del cobro.

### 4.5 Cobros que hay que revisar
No hay devolución automática de un prepago cuando la reserva se cancela (ni de un cargo de no-show
si luego se revierte el no-show porque el cliente llegó tarde). Para que nadie se quede con dinero
del cliente sin saberlo, `cobrosPorRevisar(sb, restauranteId)` lista los cobros con importe aún
devolvible que:
- tienen `_devolver_a_mano` (falló la devolución automática de un cobro tardío o duplicado);
- son prepagos de una reserva `cancelada`;
- son cargos de garantía de una reserva que ya no está en `no_show` ni `cancelada`.
Salen en el bloque de pagos (fila marcada con aviso y botones «Devolver» / «No devolver») y en
`pagosPorRevisar` (Inbox). «No devolver» (`darCobroPorRevisado`) lo marca `_revisado` y deja de salir.
La página pública, con la reserva cancelada y un prepago sin devolver, dice «Tu pago de X € está
registrado; el restaurante te contactará para la devolución según sus condiciones».

## 5. Panel: lo que el modal puede usar (`app/reservas/acciones/pagos.ts`)

```ts
estadoPagos(reservaId): R<EstadoPagos>
  // { estado, estado_pago, estado_pago_txt, tipo, importe_garantia, importe_prepago,
  //   tarjeta: {mascara, caducidad} | null,
  //   pagos: FilaPago[]   // Pago + tipo_txt, estado_txt, revisar (incierto), devolvible (€)
  //   puede_cobrar, motivo_no_cobrar (texto para el tooltip), cobro_max,
  //   devolvible_id, devolvible_max, hay_revision, es_direccion, enlace_pago }
cobrarNoShow(reservaId, motivo = "no_show", importe?)   // R<Pago>; solo dirección
devolver(pagoId, importe?)                               // R<Pago>; solo dirección
resolverPagoIncierto(pagoId, hecho: boolean)             // R<Pago>; solo dirección
listarPagos(reservaId)                                   // Pago[]
hayPagosInciertos(reservaIds)                            // ids de reservas con algo que resolver (listas)
pagosPorRevisar(restauranteId)                           // R<{inciertos, cobros, noshows, total, es_direccion}> (Inbox)
darCobroPorRevisado(pagoId)                              // R<Pago>; solo dirección («No devolver»)
```
`EstadoPagos` trae además `motivo_cargo` (con qué motivo se cobraría, o null) y `hay_por_devolver`;
cada `FilaPago` trae `aviso` (frase si probablemente hay que devolverlo). Si el cargo en curso no
tiene respuesta del banco, `motivo_no_cobrar` es el texto de «incierto» (mirar el portal), no
«espera unos segundos».

**Componente listo**: `componentes/bloque-pagos.tsx` → `<BloquePagos reservaId={reserva.id} onCambio={recargar} />`.
El integrador solo tiene que montarlo en `modal-reserva.tsx` (al editar una reserva existente) y
pintar `pagosPorRevisar(restauranteId)` como apartado «Pagos» del Inbox (cada fila con nombre, fecha,
hora, importe y el motivo; clic → `rsv:abrir-reserva` con el id).
`R<T> = { ok: boolean; error?: string; data?: T }`; `error` ya viene como frase para enseñar.
`enlace_pago` viene relleno cuando la reserva está `tarjeta_pendiente`: sirve para «Copiar enlace»
o para mandarlo por WhatsApp desde el popover.

Sugerencia de UI para el modal (bloque «Pago»): chip con `estado_pago_txt`, tarjeta `•••• 1234 ·
12/28`, historial compacto (fecha · `tipo_txt` · importe · `estado_txt`), y para dirección:
**Cobrar garantía** (con importe editable hasta `cobro_max`; deshabilitado con `motivo_no_cobrar`
como tooltip), **Devolver** en cada fila con `devolvible > 0`, y en filas con `revisar` dos botones
«Sí se cobró» / «No se cobró». Confirmación antes de cobrar o devolver (es dinero).

## 6. Cómo probar en el entorno de pruebas de Redsys

1. En Vercel (entorno Preview o un proyecto aparte) poner las `TPV_*` del **comercio de pruebas**
   (`TPV_URL = https://sis-t.redsys.es:25443/sis/realizarPago`). El comercio de test lo da CaixaBank
   junto con su clave; el comercio de test genérico que Redsys publica en su documentación sirve
   para redirección pero **no suele tener COF, 0 € ni REST activados**: para probar garantía y cargo
   hace falta el comercio de pruebas propio con esas opciones activadas. Las claves, solo en Vercel.
2. Tarjetas de prueba de Redsys (entorno test): `4548 8120 4940 0004`, caducidad cualquier fecha
   futura (p. ej. 12/34), CVV `123`, código CIP/3DS `123456`. Para forzar denegación, en el
   entorno de pruebas se usa otra tarjeta de las listadas en la documentación de Redsys (p. ej.
   `4548 8130 0000 0000` según la lista vigente; comprobar en el portal de pruebas).
3. Crear en el restaurante de pruebas `tarjeta_desde_pax = 1` y `garantia_importe_pax = 10` (o
   `prepago_importe_pax = 15`) y hacer una reserva desde `/reservar-mesa`: nace `tarjeta_pendiente`.
4. Abrir `/reserva/<token>/pago` (el token está en `reservas_reservas.token` o en el email de
   `reservas_mensajes`), pulsar el botón y completar en la página del banco.
5. Comprobar en `reservas_pagos`: fila `garantia` → `autorizado` con `identificador_cof` y máscara;
   `reservas_reservas.estado_pago = garantizada`, `estado = confirmada|pendiente`,
   historial en `reservas_reservas_historial`.
6. Desde el panel (usuario con rol dirección) en el modal de esa reserva: **Cobrar garantía** →
   fila `cargo_noshow` `cobrado`, reserva `cobrado_noshow`. **Devolver** → fila `devolucion`
   `devuelto`, cobro original `devuelto`, reserva `devuelto`.
7. Notificación en local: Redsys no puede llamar a `localhost`; usar un túnel (ngrok/cloudflared) o
   probar en Preview de Vercel. La vuelta del cliente (`/retorno`) con «parámetros en las URLs»
   activado aplica el resultado igual que la notificación, así que en local se ve el flujo completo
   aunque la notificación no llegue.

## 7. Seguridad e idempotencia

- Importes siempre desde la base (`importe_garantia` / `importe_prepago`); el navegador solo manda el token.
- Firma HMAC_SHA256_V1 con clave derivada por pedido; la notificación y la vuelta del cliente se
  verifican en tiempo constante; la respuesta REST también (`firma_invalida` si no casa).
- `ds_order` único (índice parcial) y transición `iniciado → …` con `where estado = 'iniciado'`:
  reintentos del banco y carreras no duplican nada. Un nuevo intento cancela los `iniciado` previos.
- Cerrojos en la base (migración `20261002150000_reservas_pagos_cerrojos.sql`, **pendiente de
  aplicar**): `reservas_pagos_un_cargo_vivo` (reserva_id) y `reservas_pagos_una_devolucion_viva`
  (pago_origen_id). Ordenar por `creado_en` no basta: es el `now()` del inicio de cada transacción,
  no el orden de confirmación. Hasta que se aplique, el código mantiene la comprobación anterior.
- `reservas_pagos` solo lo escribe el servidor (RLS: `authenticated` únicamente lee). Las server
  actions comprueban sesión + módulo + rol + visibilidad de la reserva bajo RLS y SOLO entonces usan
  el cliente de servicio desde el servidor; nada de eso llega al navegador.
- En `respuesta` (jsonb) se guarda lo que devuelve Redsys: número enmascarado, marca, país; nunca
  el PAN completo (el banco no lo manda).
- El token de gestión (32 hex) es la única credencial pública: quien tenga el enlace puede
  registrar la tarjeta de SU reserva, nada más (no puede cobrar ni ver otras).

## 8. Dudas y supuestos (para Luis)

- **COF_TYPE**: se usa `C` (credencial guardada, cargos no programados) tanto en la inicial como en
  el cargo, como pide el plan. Redsys también tiene el tipo `N` («no-show») para la MIT: si
  CaixaBank lo exige al activar MIT, es cambiar una constante en `cobrarConReferencia`.
- **Cobro automático al cancelar tarde** por el enlace público: preparado (`cobrarGarantia` con
  motivo `cancelacion_tardia`), no conectado. Cover lo cobra automáticamente si la política está
  activa. Decidir.
- **`notificar = true`** al completar tarjeta/pago: lo pongo para que al cliente le llegue la
  confirmación aunque el restaurante hubiera creado la reserva sin notificar (si pidió tarjeta
  desde el panel ya le había escrito). Si no se quiere, quitar la línea en `aplicarResultadoTpv`.
- **Retención real de importe** («garantía de retención» de Cover: preautorización que se confirma
  después) no está hecha: solo tokenización 0 € + cargo posterior. Es lo que pide el plan.
- **Cargo solo con la reserva en no-show o cancelada tardía por el cliente**: Cover deja cobrar
  desde la ficha; aquí se exige marcar antes el no-show para que nadie cobre por error una reserva
  viva, y una cancelación solo se cobra si fue del cliente y dentro del plazo de la política (lo
  que se le enseñó). Si el cliente llama para cancelar, Sonia tiene que cancelar con «Cancelada por
  el cliente» (popover) para que el cargo proceda. Si necesita cobrar una reserva «a revisar», basta
  con añadir `a_revisar` a `ESTADOS_COBRABLES` (y a `motivoCobrable`).
- **¿Devolución automática del prepago al cancelar en plazo?** Hoy NO: el prepago se queda
  cobrado, la reserva sigue `pagada` y sale en «Pagos por revisar» para que dirección lo devuelva
  (o lo deje, «No devolver»). Al cliente se le dice que el restaurante le contactará. Decidir si al
  cancelar el cliente en plazo se devuelve solo (sería llamar a `devolverPago` desde la cancelación
  pública) y qué pasa con una cancelación tardía con prepago (¿se queda entero, una parte?).
- **Cargo denegado**: el cron no lo reintenta (las marcas penalizan insistir con una tarjeta
  denegada); queda en «Pagos por revisar» y dirección lo vuelve a intentar desde el modal.
- **Pagos que llegan tarde**: reactivo la reserva si la mesa sigue libre (lo que haría la sala) y,
  si no, devuelvo solo el prepago. Alternativa: dejarlo siempre a dirección. Decidir.
- **Retención mínima de 15 min** al pulsar «ir al banco» (se mueve `tarjeta_solicitada_en`): evita
  cobrar a alguien cuya mesa caduca mientras teclea la tarjeta. Queda en el historial de la reserva.
- «Cobro a cuenta / pago externo» (Facturación de Cover): fuera de alcance.
- La página pública está en ES/EN (idioma de la reserva); si hace falta CA/FR se añaden al
  diccionario `TXT` de `page.tsx` y `BotonPagar.tsx`.
