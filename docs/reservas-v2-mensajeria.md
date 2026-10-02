# Reservas v2 · Mensajería (email / SMS / WhatsApp)

Motor que envía las filas de `reservas_mensajes` (las encolan los triggers y RPC de la base:
`reservas_programar_mensajes`, `reservas_mensaje_encolar`, `reservas_lista_espera_avisar`).
Fecha: 01-10-2026 (revisado 02-10-2026: reclamo con plazo, envío al momento, respuestas de clientes, cupo de Resend). Pieza «mensajeria» del plan `docs/reservas-v2-plan.md` §1.5, §1.8 y §2.4.

## 1. Ficheros

| Fichero | Qué hace |
|---|---|
| `apps/general/lib/mensajeria-plantillas.ts` | Parte pura: variables de la reserva (idénticas a las del SQL), `renderizar`, HTML de marca del email, texto plano, `.ics`, enlace a Google Calendar, botones por tipo, textos es/en/ca/fr/de. |
| `apps/general/lib/mensajeria.ts` | Motor: `enviarPendientes(limite)` (cron, service role), `enviarMensajesPorId(sb, ids)` (panel, cliente de sesión), `enviarAhoraDe(sb, { reservaId \| listaEsperaId })` (envío al momento tras crear/confirmar/avisar), envío por Resend / Twilio, reintentos, respaldo SMS, `aplicarEventoProveedor` (webhooks), `reenviarRespuestaEntrante` (respuestas de clientes por SMS/WhatsApp → email del restaurante). |
| `apps/general/app/api/cron/reservas-mensajes/route.ts` | Cron cada 5 min: a_revisar, no-show (+cobro), tarjeta caducada, autotags, recordatorios de mañana, envío. |
| `apps/general/app/api/publico/reservas/webhooks/resend/route.ts` | Eventos de Resend (entregado / abierto / rebotado) → estado del mensaje. |
| `apps/general/app/api/publico/reservas/webhooks/twilio/route.ts` | Status callback de Twilio (SMS y WhatsApp) → estado del mensaje; mensajes entrantes del cliente → email al restaurante. |
| `apps/general/app/reservas/acciones/mensajes.ts` | Acciones del panel: `trackingReserva`, `plantillasPara`, `previsualizar`, `enviarManual`, `reenviar`, `cancelarMensaje`. |
| `apps/general/vercel.json` | Cron `*/5 * * * *` → `/api/cron/reservas-mensajes`. |

## 2. Variables de entorno (Vercel → proyecto `general`)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `CRON_SECRET` | sí (prod) | Vercel la manda como `Authorization: Bearer` al cron. Sin ella, en producción el cron contesta 503 y **no hace nada** (cobra garantías y envía mensajes: no puede quedar abierto). |
| `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` | sí | Cron y webhooks (ya existen). |
| `MENSAJERIA_URL_PUBLICA` | recomendada | URL pública de la app (`https://hostelero-app.vercel.app` o el dominio final). Se usa para el StatusCallback de Twilio y para verificar su firma. |
| `RESEND_API_KEY` | para email | Clave de Resend (ya existe para Visitas). Sin ella los emails quedan `sin_proveedor`. |
| `RESEND_REMITENTE` | no | Remitente general de respaldo (`Nombre <reservas@dominio>`). Por defecto `Bodegas Binifadet <reservas@binifadet.com>`. |
| `RESEND_DOMINIOS` | no | Dominios verificados en Resend, separados por coma. Por defecto `binifadet.com,tamarindosmenorca.com,casatirant.com`. |
| `RESEND_DOMINIOS_SLUG` | no | Mapa `slug=dominio` para firmar como cada restaurante. Por defecto `binifadet=binifadet.com,tamarindos=tamarindosmenorca.com,bar-tamarindos=tamarindosmenorca.com,casa-tirant=casatirant.com`. También vale `email_reservas` del restaurante si su dominio está verificado. |
| `RESEND_BUZON` | no | Parte local del remitente (`reservas` → `reservas@dominio`). |
| `RESEND_WEBHOOK_SECRET` | sí (prod) | Secreto `whsec_…` del webhook de Resend. Con él se exige la firma Svix; sin él, en producción el webhook contesta 503 y no aplica ningún evento. |
| `MENSAJERIA_RESPONDER_A` | sí mientras los locales no tengan email | Dirección a la que llegan las respuestas de los clientes (`reply_to` del email y reenvío de las respuestas por SMS/WhatsApp) cuando el restaurante no tiene `email_reservas` ni `email`. Variante por restaurante: `MENSAJERIA_RESPONDER_A_<SLUG>` (`MENSAJERIA_RESPONDER_A_CASA_TIRANT`). Sin ninguna, las respuestas se pierden en el buzón que solo envía y el seguimiento de la reserva lo avisa. |
| `MENSAJERIA_TITULAR` | no | Responsable del tratamiento en el pie legal (p. ej. `BONITA MENORCA S.L.`). Por defecto el nombre del restaurante. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | para SMS/WA | Credenciales de Twilio. El auth token también verifica la firma del webhook. |
| `TWILIO_SMS_FROM` | para SMS | Número E.164 (`+34…`), Messaging Service (`MG…`) o remitente alfanumérico (`Binifadet`, máx. 11 caracteres). Sin él, los SMS quedan `sin_proveedor`. |
| `TWILIO_SMS_FROM_<SLUG>` | no | Remitente SMS de un restaurante concreto (slug en mayúsculas, guiones → `_`): `TWILIO_SMS_FROM_BINIFADET=Binifadet`, `TWILIO_SMS_FROM_CASA_TIRANT=CasaTirant`. Si no está, se usa `TWILIO_SMS_FROM`. |
| `TWILIO_WHATSAPP_FROM` | para WA | Número de WhatsApp Business (`+34…`, se le antepone `whatsapp:`) o Messaging Service `MG…`. |
| `TWILIO_WHATSAPP_FROM_<SLUG>` | no | Número de WhatsApp propio de un restaurante (tiene que estar registrado como *sender* en Twilio). |
| `TWILIO_WA_CONTENT_<TIPO>` | para WA | ContentSid (`HX…`) de la plantilla aprobada de cada tipo: `TWILIO_WA_CONTENT_CONFIRMACION`, `_CONFIRMADA`, `_RECORDATORIO`, `_RECONFIRMACION`, `_CANCELACION`, `_MODIFICACION`, `_LISTA_ESPERA`, `_VALORACION`, `_PAGO`, `_GARANTIA`, `_NOSHOW`, `_INVITACION`. Sin la de un tipo, ese WhatsApp sale **por SMS** si el local tiene SMS; si no, queda `sin_proveedor` con el texto «Falta la plantilla de WhatsApp aprobada para …». |
| `TWILIO_WA_CONTENT_<TIPO>_<IDIOMA>` | no | Plantilla en otro idioma (`TWILIO_WA_CONTENT_RECORDATORIO_EN`). Se elige por el idioma de la reserva/cliente; si no hay, la del tipo. |
| `TWILIO_WA_VARS_<TIPO>` / `TWILIO_WA_VARS` | no | Orden de las variables `{{1}}, {{2}}…` de la plantilla aprobada. Por defecto `nombre,restaurante,fecha,hora,pax,localizador,enlace`. Disponibles: `nombre`, `nombre_completo`, `restaurante`, `fecha`, `hora`, `pax`, `localizador`, `enlace`, `enlace_cancelar`, `enlace_confirmar`, `enlace_pago`, `enlace_valorar`, `direccion`, `telefono`, `importe`, `horas_politica`. Una variable vacía se manda como «-» (Meta rechaza las vacías). |
| `RESEND_MS_ENTRE_ENVIOS` | no | Pausa entre emails (ms). Por defecto 550 (Resend admite 2 por segundo). |
| `TPV_COMERCIO`, `TPV_TERMINAL`, `TPV_CLAVE`, `TPV_URL` | para cobrar no-shows | Las del TPV (ver `docs/reservas-v2-pagos.md`). Sin ellas el cron no cobra nada. |

Sin ninguna clave nada se rompe: las filas quedan en `sin_proveedor` y el cron las recoge en cuanto
el canal tiene proveedor (no cuentan como intento).

## 3. Cómo funciona el envío

1. El cron (o «Enviar ahora» desde el panel) coge filas `pendiente` con `programado_para <= now()`
   e `intentos < 3`, más las `sin_proveedor` de canales que ya tienen claves (en WhatsApp, solo de
   los tipos que ya tienen plantilla aprobada).
2. **Reclama** cada fila con un plazo de bloqueo: en una sola actualización condicionada
   (`intentos` igual al leído, estado `pendiente`/`sin_proveedor`, `programado_para <= now()`)
   sube `intentos`, adelanta `programado_para` 10 minutos y pone `error = 'Enviándose ahora'`.
   Mientras dura el plazo ninguna otra lectura la encuentra: ni un segundo disparo del cron (Vercel
   a veces lo lanza dos veces) ni «Enviar ahora» / reenviar desde el panel (que además se niegan
   con «Ese mensaje está saliendo ahora mismo»). Toda salida reescribe estado, error y
   `programado_para`; si el proceso muere a medias, la fila vuelve a salir al vencer el plazo.
   Si no se pueden leer las reservas o los restaurantes (error pasajero de la base), no se reclama
   nada y la pasada termina con el error: nunca se cancela un aviso por una lectura fallida.
3. Comprueba que sigue teniendo sentido (si no, la pasa a `cancelado` con el motivo en `error`):
   - reserva cancelada / no-show / lista de espera → fuera los avisos de reserva viva;
   - confirmación, confirmada, modificación, recordatorio, reconfirmación, pago, garantía o
     cancelación **con la hora de la reserva ya pasada**; `reconfirmacion` si ya reconfirmó;
   - `pago` / `garantia` si ya no está `tarjeta_pendiente`; `noshow` si ya no está en no-show;
   - `valoracion` solo con visita real (llegada/sentada/postre/cuenta/terminada; en locales con
     `noshow_automatico = false`, confirmada/reconfirmada) y sin valoración previa;
   - **caducidad**: cualquier aviso que lleve más de 3 días sin salir (p. ej. `sin_proveedor` desde
     hace una semana) y el aviso de mesa libre de la lista de espera a las 3 h o si la lista ya no
     está `esperando`/`avisado`. Mejor no mandarlo que mandarlo tarde;
   - **reserva con `cover_id`**: confirmación, confirmada, recordatorio, reconfirmación, valoración
     y no-show **encolados por el sistema** se cancelan (los manda Cover). Cancelación,
     modificación, pago, garantía, lista de espera, invitación y todo lo que alguien manda a mano
     desde el panel (`creado_por` con valor) sí salen.
4. Envía por canal:
   - **Email (Resend)**: remitente del restaurante si su dominio está verificado; si Resend contesta
     que el dominio no está verificado, se reintenta en el acto con el remitente general (con el
     nombre del restaurante). `reply_to` = `email_reservas` o `email` del restaurante, o `MENSAJERIA_RESPONDER_A` si no tiene (sale también en el pie legal); HTML de marca
     (cabecera con logo/nombre y `color_marca`, cuerpo de la plantilla, botones según el tipo, pie
     con dirección y aviso legal) + versión texto; en confirmación/confirmada/modificación adjunta
     `reserva.ics` y botón «Añadir al calendario» (Google Calendar). Pausa de 550 ms entre emails.
   - **SMS (Twilio)**: cuerpo de la plantilla tal cual, remitente del restaurante si hay
     `TWILIO_SMS_FROM_<SLUG>`.
   - **WhatsApp (Twilio)**: plantilla aprobada (ContentSid por tipo e idioma) con variables;
     `manual` va como texto libre (solo llega dentro de la ventana de 24 h de Meta).
5. Resultado: `enviado` (+ `proveedor`, `proveedor_id`, `enviado_en`), `sin_proveedor`, o error:
   reintento en 5 / 15 / 45 min y a la tercera `error`. Errores definitivos (destinatario
   inválido, 4xx del proveedor) no se reintentan. Un 429 por ir rápido (`rate_limit_exceeded`) no
   gasta intento: se reprograma a 1 minuto. Un 429 por **cupo agotado** (`daily_quota_exceeded` /
   `monthly_quota_exceeded`) reprograma el email a la medianoche UTC siguiente (o al día 1 del mes
   siguiente) con «Cupo diario de Resend agotado: sale mañana», corta el resto de emails de esa
   pasada y deja un `console.error` en los logs de Vercel.
6. **Respaldo por SMS (como Cover)**: un WhatsApp que no puede salir — sin plantilla aprobada, sin
   remitente de WhatsApp, rechazado por Twilio/Meta o que el webhook da por `failed`/`undelivered` —
   se manda por SMS si el restaurante tiene `envio_sms` y hay remitente SMS. El texto es el de la
   **plantilla SMS del mismo tipo** (más corta), renderizada con los datos de la reserva; si no
   existe, el del WhatsApp (la fila SMS lleva `asunto = 'Respaldo de WhatsApp'` como marca). El
   WhatsApp queda `cancelado` (o `error`) con «Se intenta por SMS.»; cuando el SMS termina, ese texto
   pasa a «Enviado por SMS en su lugar.» o «Tampoco salió por SMS: <motivo>» (también si el webhook
   de Twilio da el SMS por no entregado). No duplica: si ya hay un SMS de ese aviso (la lista de espera encola los dos), no hace nada.
7. Al enviar un `recordatorio` se sella `reservas_reservas.recordatorio_enviado_en`.
8. **Envío al momento** (`enviarAhoraDe`): la confirmación de una reserva nueva o el «hay mesa
   libre» de la lista de espera no esperan al cron. Lee lo pendiente de esa reserva / lista de
   espera que ya toca y lo envía con un plazo de 15 s; nunca lanza (si falla, el cron lo manda en
   ≤ 5 min). Tiene que llamarlo quien crea o avisa (ver §7, «Pendiente del integrador»).

Los webhooks suben el estado a `entregado` / `abierto` (`read` en WhatsApp) o lo pasan a `error`
(rebote, spam, `failed`/`undelivered`). Nunca «bajan» un estado; una queja de spam sobre un email
ya leído solo se anota en `error`.

## 4. Cron `/api/cron/reservas-mensajes` (cada 5 min)

Orden: `reservas_marcar_a_revisar` → `reservas_noshow_automatico` → cobro de no-shows →
`reservas_caducar_tarjeta_pendiente` → `reservas_aplicar_autotags` → recordatorios que falten →
`enviarPendientes(limite)` (`?limite=` hasta 200, 40 por defecto; deja de empezar envíos a los
50 s para no pasarse del `maxDuration` de 60 s: lo que quede sale en la siguiente pasada).

**Cobro de no-show**: solo filas con `cobrar = true` (cobro automático activo en el restaurante,
reserva `garantizada`, importe > 0) y **sin `cover_id`** (las de Cover solo quedan marcadas como
no-show). Se cobra con `cobrarNoShowsPendientes` de `lib/pagos-reservas.ts` (cargo con la
tarjeta guardada vía Redsys; no cobra dos veces). Sin TPV configurado no se cobra: la respuesta lo
dice (`cobros.sin_tpv`), se deja aviso en el log y la reserva sigue `garantizada` para cobrarla
desde el panel.

**Recordatorios que falten** (red de seguridad): reservas vivas de hoy a pasado mañana, con
`notificar`, sin `cover_id`, con destinatario para algún canal activo, cuyo recordatorio aún está a
tiempo (más de 15 min por delante) y que no tienen **ningún** recordatorio en `reservas_mensajes`
(ni pendiente, ni enviado, ni cancelado: si alguien lo canceló a mano, no se resucita). Se les pasa
`reservas_programar_mensajes(id)`.

Los cobros **inciertos** (Redsys no contestó: puede que se haya cobrado o no) y los **fallidos**
salen en `cobros.inciertos`, `cobros.fallidos` y `cobros.errores` («<reserva_id>: <código>»), van al
log con `console.error` y hacen que el cron conteste 207: hay que revisarlos a mano en Redsys.

La red de recordatorios solo mira locales con una plantilla `recordatorio` activa para alguno de
sus canales activos: sin plantilla el RPC no encola nada y no se le llama cada 5 minutos en vano.

Respuesta JSON con el resumen de cada paso; 207 si algún paso falló (los demás siguen). En
`envio_incidencias` el texto de error del proveedor va con teléfonos y emails tachados. Probar a
mano: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/reservas-mensajes`.

## 5. Qué activar en cada proveedor

### Resend
1. Dominios verificados (SPF/DKIM/DMARC los pone Infotelecom): `binifadet.com`,
   `tamarindosmenorca.com`, `casatirant.com`. Si se añade otro, sumarlo a `RESEND_DOMINIOS` y al
   mapa `RESEND_DOMINIOS_SLUG` (o rellenar `email_reservas` del restaurante con ese dominio).
2. Webhooks → Add endpoint: `https://<app>/api/publico/reservas/webhooks/resend`, eventos
   `email.sent`, `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`,
   `email.complained`. Copiar el *signing secret* a `RESEND_WEBHOOK_SECRET`.
3. Para que «abierto» funcione hay que activar *open/click tracking* en el dominio (Resend →
   Domains → dominio → Tracking).

### Twilio (SMS)
1. Comprar un número con SMS o crear un Messaging Service (recomendado: permite remitente
   alfanumérico «Binifadet» en España para SMS salientes sin respuesta).
2. Ponerlo en `TWILIO_SMS_FROM` (`+34…` o `MG…`). Si se usa Messaging Service, en su
   configuración se puede fijar también el status callback; si no, lo mandamos nosotros en cada envío.
3. Geo-permissions: habilitar los países de destino (España y los habituales de los clientes).
4. En el Messaging Service activar **Smart Encoding**: cambia los caracteres que no caben en GSM-7
   (á, í, ó, ú, comillas tipográficas…) por sus equivalentes. Sin él, un SMS con una sola «á» pasa a
   70 caracteres por mensaje y se cobra doble o triple. La vista previa del panel avisa cuando un
   SMS ocupa más de un mensaje.
5. Remitente alfanumérico por restaurante: `TWILIO_SMS_FROM_<SLUG>` (en España no hace falta
   registro previo; los clientes no pueden contestar a un alfanumérico).
6. **Respuestas de los clientes**: si el remitente es un número (no alfanumérico), en el número o
   en el Messaging Service → *Integration* → «Incoming messages» → webhook
   `https://<app>/api/publico/reservas/webhooks/twilio` (POST). Lo que conteste el cliente se reenvía
   por email a la dirección de respuesta del restaurante (`email_reservas` / `email` /
   `MENSAJERIA_RESPONDER_A`), con su reserva y su teléfono.

### WhatsApp Business (Twilio + Meta)
1. Twilio → Messaging → Senders → WhatsApp senders: registrar el número del restaurante (o uno por
   cuenta) con la cuenta de WhatsApp Business de Meta (Meta Business Manager verificado;
   la verificación de negocio la hace Meta y tarda días). Mientras tanto se puede probar con el
   sandbox de Twilio (`whatsapp:+14155238886`) uniéndose con el código que da Twilio.
2. Ponerlo en `TWILIO_WHATSAPP_FROM`.
3. **Plantillas**: Twilio → Content Template Builder → crear una plantilla por tipo con el texto de
   la plantilla corta del seed (`reservas_plantillas`, canal `whatsapp`) sustituyendo los
   placeholders por `{{1}}, {{2}}…` en el orden `nombre, restaurante, fecha, hora, pax, localizador,
   enlace` (o el que se fije en `TWILIO_WA_VARS_<TIPO>`). Categoría *Utility* (son transaccionales;
   Meta las aprueba en minutos u horas). Enviar a aprobación de WhatsApp; cuando aparezca
   *Approved*, copiar su ContentSid (`HX…`) a `TWILIO_WA_CONTENT_<TIPO>`.
   Un idioma distinto es otra plantilla (otro ContentSid): ponerla en
   `TWILIO_WA_CONTENT_<TIPO>_<IDIOMA>` (`_EN`, `_CA`, `_FR`, `_DE`); si no existe, sale la del tipo.
   Mientras una plantilla no esté aprobada, ese aviso sale por SMS si el local tiene SMS activo.
4. Texto libre (`manual`) solo llega si el cliente ha escrito en las últimas 24 h; fuera de esa
   ventana Twilio devuelve el error 63016 y el mensaje queda en `error` (con respaldo por SMS si
   está activo).
5. **Respuestas de los clientes**: en el WhatsApp sender (Twilio → Senders → WhatsApp senders →
   el número → *Webhook URL for incoming messages*) y, si se usa, en el Messaging Service, poner
   `https://<app>/api/publico/reservas/webhooks/twilio` (POST). Sin esto, lo que el cliente
   contesta al recordatorio («llegamos a las 21:30», «cancelo») no lo ve nadie. Con esto se
   reenvía por email al restaurante, y desde ese momento hay 24 h para contestarle con texto libre.
6. En el panel, Ajustes → Mensajes: activar `envio_whatsapp` en el restaurante. Con WhatsApp activo,
   el SQL deja de encolar SMS (solo como respaldo si WhatsApp falla).

## 6. Panel (acciones)

- `trackingReserva(reservaId)` → mensajes de la reserva (recientes primero), proveedores
  configurados por canal, `recordatorio_enviado_en`, `reconfirmada_en`, `notificar`, `esCover`,
  `responder_a` (dirección a la que llegan las respuestas del cliente) y `aviso` (texto si el
  restaurante no tiene email de respuesta).
- `plantillasPara(restauranteId)` → plantillas aplicables (las del restaurante pisan a las de la cuenta).
- `previsualizar(plantillaId, reservaId)` → asunto, cuerpo y (email) HTML completo + destinatario +
  `nota` (WhatsApp: «se envía la plantilla aprobada» o «no hay plantilla: saldrá por SMS»; SMS:
  «ocupa N mensajes»).
- `enviarManual(reservaId, canal, { tipo?, texto?, asunto?, destinatario?, ahora? })` → encola y
  envía ahora (con la sesión, bajo RLS). Con `tipo`, si ya había uno de ese tipo pendiente (p. ej.
  el recordatorio programado) se manda ese **con el destinatario, asunto y texto recién compuestos**
  (si el cron lo está enviando en ese instante, devuelve «Ese mensaje está saliendo ahora mismo»); `texto` con `tipo` entra como `{{mensaje}}` de la plantilla. Lo manda una persona:
  la regla de Cover no lo frena.
- `reenviar(mensajeId)` → copia nueva y envío inmediato (si estaba pendiente o sin proveedor, se
  intenta ese mismo ahora).
- `cancelarMensaje(mensajeId)` → pendiente → cancelado.
- Todas validan que los ids sean uuid («Identificador no válido»); `plantillasPara` filtra además
  por la cuenta del restaurante.

Etiquetas para la interfaz: `TIPO_TXT` y `ESTADO_MSG_TXT` en `lib/mensajeria-plantillas.ts`.

## 7. Supuestos y dudas

- El enlace de gestión (`{{enlace}}` → `/reserva/<token>`) y la página `/valorar/<token>` las hace
  otro agente; aquí solo se enlazan.
- `email_reservas` está vacío en los cuatro restaurantes: el remitente se decide por slug (mapa por
  defecto). Si se cambia el slug de un restaurante, actualizar `RESEND_DOMINIOS_SLUG`. **Antes de
  apagar Cover hay que rellenar `email_reservas` de los cuatro locales** (o, mientras tanto,
  `MENSAJERIA_RESPONDER_A`): si no, las respuestas de los clientes van a un buzón que nadie lee.
- **Pendiente del integrador** (ficheros de otros agentes):
  - `acciones/espera.ts avisar()`: tras el RPC, `await enviarAhoraDe(sb, { listaEsperaId })`.
  - Guardado del modal (crear / confirmar): `await enviarAhoraDe(sb, { reservaId })`.
  - `api/publico/reservas/crear`: `after(() => enviarAhoraDe(crearClienteServicio()!, { reservaId }))`
    con `after` de `next/server`, para no retrasar la respuesta al cliente.
  - El composer del modal debería llamar a `acciones/mensajes.enviarManual` (envía al momento,
    rellena las `{{variables}}`, aplica la regla de Cover) en vez de `acciones/reserva.enviarMensajeManual`
    (solo encola), y quitar ese duplicado.
  - Inbox: no hay tabla para respuestas entrantes ni para cobros inciertos; hoy las respuestas
    llegan por email y los cobros inciertos/fallidos al log del cron (los `fallido` ya salen en el
    Inbox por `estado_pago`). Para verlos en el Inbox hace falta una tabla nueva.
- Los textos de los botones y del pie legal van en es/en/ca/fr/de; las plantillas del seed solo
  existen en es/en (el SQL cae a `es`).
- `MENSAJERIA_URL_PUBLICA` sin definir = sin StatusCallback de Twilio (los SMS se quedan en
  `enviado`, sin `entregado`).
- **Resend en plan Free**: 100 emails al día y 3.000 al mes. Con confirmación + recordatorio +
  valoración de las reservas de los cuatro locales en temporada se pasa de largo: hay que subir a
  Pro antes de apagar Cover. Si se supera, los emails se reprograman a cuando Resend reponga el
  cupo (medianoche UTC o día 1) y el seguimiento dice «Cupo diario de Resend agotado: sale mañana».
- Mientras Cover siga vivo, una reserva importada de Cover que se cancela o se modifica **desde
  nuestro panel** sí avisa al cliente desde aquí (Cover no se entera de ese cambio).
