# Reservas v2 · Notas de la migración `20261001120000_reservas_v2.sql` (01-10-2026)

Fichero: `apps/general/supabase/migrations/20261001120000_reservas_v2.sql` (≈3.470 líneas, 366
sentencias, 45 funciones: 30 plpgsql + 15 SQL). Contrato: `docs/reservas-v2-plan.md` §1 y §5.
Sintaxis verificada con el parser de PostgreSQL (libpg_query / pglast 8.3) tanto del SQL como de
los 30 cuerpos plpgsql; **no se ha aplicado nada a la base** (la aplica el orquestador).

Revisada por tres revisores (40 observaciones: 6 bloqueantes, 17 importantes, 17 menores) y
corregida; el detalle está en §3.

## 1. Lo que se ha inspeccionado antes de escribir (y re-verificado tras la revisión)

- Columnas, checks, índices y políticas actuales de las 10 tablas `reservas_*`. Política única por
  tabla: `(cuenta_id = (select cuenta_actual())) or (select es_operador())` para `authenticated`,
  `for all`. Se mantiene en todas las tablas nuevas (excepciones abajo).
- Nombres reales de los checks que se amplían: `reservas_reservas_estado_check` (6 estados) y
  `reservas_reservas_origen_check` (4 orígenes); `reservas_lista_espera_estado_check` admite
  esperando / avisado / convertida / descartada (los que usan las funciones nuevas).
- Triggers de `reservas_reservas`: `trg_rsv_reservas_touch` (before update), `trg_rsv_sync_mesa`
  (after insert/update of mesa_id), `trg_rsv_email_ins` / `trg_rsv_email_upd` (after insert /
  after update of estado → `reservas_encolar_email`).
- Cuerpos de `reservas_disponibilidad`, `reservas_crear_online`, `reservas_mejor_mesa`,
  `reservas_mesas_libres`, `reservas_sin_mesa_solapadas`, `reservas_consultar`, `reservas_cancelar`,
  `reservas_apuntar_lista_espera`, `reservas_norm_tel`, `reservas_encolar_email` (legado).
- Datos reales: 26.339 reservas (sentada 10.369 · terminada 8.595 · cancelada 5.325 · no_show
  1.075 · confirmada 966 · pendiente 9), todas con `duracion_min = 120`; 908 reservas confirmadas o
  pendientes pasadas sin cerrar (473 en El Bar de Tamarindos, que no marca llegadas); ninguna
  mesa reservable online con `cap_max >= 8` (máximo 7) pero 8 pares unibles en Binifadet, 9 en
  Tamarindos y 1 en Casa Tirant; en 90 días Cover tomó 271 reservas online de 8 pax; canales
  `moduloweb`, `Google`, `software`, `walk in`, `app-movil`, `OpenTable`, `avselling`,
  `waitinglist`, `INSTAGRAM` (y 11.732 nulos); 112 mesas (pos_x ≤ 94,8, pos_y ≤ 61,3 → lienzo
  100×70 encaja); 8 turnos Comida/Cena con intervalo 15, duración 120, max 8 pax online y hora_fin
  22:30 en 7 de 8; 4 restaurantes sin teléfono ni dirección.
- `check_function_bodies = on`: una función `language sql` o una vista se valida al crearse →
  toda columna que citan se añade antes (`url_base` antes de `reservas_url_base`;
  `cancelada_en` y `valoracion` antes de la vista `reservas_clientes_stats`).
- `ALTER DEFAULT PRIVILEGES` del proyecto (owner `postgres` y `supabase_admin`, esquema public):
  EXECUTE para anon, authenticated y service_role en toda función nueva; INSERT…TRIGGER en toda
  tabla nueva. Por eso toda función que no deba llamar el panel lleva
  `revoke … from anon, public, authenticated` y todas las tablas `reservas_*` (viejas y nuevas)
  `revoke truncate, references, trigger … from authenticated` y `revoke all … from anon`.
- `gen_random_bytes` vive en el esquema `extensions` (pgcrypto): se usa cualificado
  (`extensions.gen_random_bytes`), porque las funciones llevan `search_path = public, pg_temp`.
  `pg_trgm` está en `public`. `cuenta_actual()`, `es_operador()` y `rrhh_es_gestor()` existen
  (`rrhh_es_gestor` ya incluye `es_operador` y restringe a rol direccion/administracion).
  `postgres` tiene bypassrls (los triggers security definer escriben historial y mensajes).

## 2. Decisiones

### Compatibilidad
- **Funciones v1 intactas en firma y salida**: `reservas_disponibilidad(slug, fecha, pax)` sigue
  devolviendo `{turnos:[{turno_id, turno, horas:['13:00',…], grupo_grande?}]}` como wrapper de la
  v2 (respeta cupos, bloqueos y duración por pax; los turnos cerrados o completos no aparecen,
  como en la v1 antigua). `reservas_crear_online(8 args)` llama a la v2 y devuelve el mismo json
  (+ `token`, `requiere_pago`, `importe`). `reservas_mejor_mesa`, `reservas_mesas_libres` y
  `reservas_sin_mesa_solapadas` conservan firma (ahora con prioridad, bloqueos y estados
  ampliados). `reservas_apuntar_lista_espera` igual. `reservas_cancelar` (localizador + teléfono)
  se recrea: admite `reconfirmada` y sella `cancelada_por = 'cliente'`. `reservas_consultar` no
  se toca.
- Las versiones nuevas llevan sufijo **`_v2`** (`reservas_disponibilidad_v2`,
  `reservas_crear_online_v2`, `reservas_mejor_mesa_v2`, `reservas_mesas_libres_v2`,
  `reservas_apuntar_lista_espera_v2`) en vez de sobrecargas: PostgREST da error de ambigüedad
  (PGRST203) cuando dos sobrecargas pueden satisfacer la misma llamada con defaults.
- Las seis funciones v1 recreadas y todas las públicas v2 llevan `revoke … from anon, public,
  authenticated`: solo las llama el servidor con la service key (en la base conservaban EXECUTE
  para authenticated por los default privileges; ahora quedan a cero).
- Estados que **ocupan mesa** (`reservas_estados_activos()`): pendiente, confirmada, reconfirmada,
  llegada, sentada, postre, cuenta, a_revisar, **tarjeta_pendiente** (retiene la mesa mientras el
  cliente mete la tarjeta; caduca a los `tarjeta_caduca_min` = 30 min por cron, contados desde
  `tarjeta_solicitada_en`). Estados de **visita** (`reservas_estados_visita()`): llegada, sentada,
  postre, cuenta, terminada.
- Mapa de códigos de Cover en comentario y en `reservas_estado_desde_cover(int)` (−5 →
  tarjeta_pendiente, −4 → a_revisar, −3 → no_show, −2/−1 → cancelada, 0 → pendiente, 1 →
  confirmada, 2 → reconfirmada, 3 → sentada, 4/8 → llegada, 5/9 → terminada, 6 → cuenta, 7 → postre).
- Check de `origen` ampliado con `importado` y `api` (re-importación de Cover y API).

### Zona horaria y solapes
- El código antiguo hacía `(fecha + hora)::timestamptz` con la zona de sesión (UTC en Supabase):
  2 h de desvío en la antelación mínima. Las funciones nuevas usan `reservas_ts(fecha, hora,
  zona_horaria)` (`at time zone 'Europe/Madrid'`). Los wrappers v1 heredan la corrección.
- Los solapes (`reservas_mesa_ocupada`, `reservas_sin_mesa_solapadas`) se comparan en timestamp
  (`fecha + hora`), no en `time + interval`: 22:30 + 150 min daba 01:00 y la mesa parecía libre.
- El bucle de horas de `reservas_disponibilidad_v2` sale si la hora da la vuelta a medianoche
  (un turno hasta 23:45 colgaba la función).

### Reservas online
- `confirmar_online_auto` (default **false**): la reserva online nace `pendiente` como hasta
  ahora; si Sonia quiere el comportamiento de Cover (nace confirmada), se activa por restaurante.
- Grupos grandes (> `least(turno.max_pax_online, restaurante.max_pax_online)`): error
  `GRUPO_GRANDE` con el teléfono, salvo `p_solicitud = true` → reserva `pendiente` **sin mesa**
  («Pendiente de confirmación» de Cover, nota interna automática). La solicitud nace **sin
  tarjeta ni prepago** (Cover tampoco combina garantía con pendiente de confirmación): la pedirá
  el restaurante al aceptar («Solicitar tarjeta» → `tarjeta_pendiente`).
- Cliente en `lista_negra` → `SIN_DISPONIBILIDAD` (no se revela).
- Tipo/importe: experiencia con prepago > `prepago_importe_pax` del restaurante > garantía si
  `pax >= tarjeta_desde_pax` **y `garantia_importe_pax > 0`** (sin importe no se pide tarjeta de
  0 €). Si requiere pago nace `tarjeta_pendiente` / `estado_pago = pendiente_tarjeta` con
  `tarjeta_solicitada_en = now()`; el servidor completa Redsys y pasa a `pendiente|confirmada` +
  `garantizada|pagada`.
- Disponibilidad: por hora, plazas = mesas individuales libres que caben − reservas sin mesa que
  solapan; si da 0 pero `reservas_mejor_mesa_v2` encuentra combinación o unión de dos mesas,
  1 plaza (grupos de 7-8 en Bonita solo caben por unión).
- **`reservas_cupo_motivo(restaurante, fecha, turno, pax, online, hora, excluir)`**: helper
  común a `disponibilidad_v2`, `crear_online_v2` y `gestion_modificar`: cupo del turno o, si no
  lo hay, del día (`turno_id null`), `max_pax_online`, `max_pax_total` (cupo o turno) y
  `max_reservas_intervalo`. Devuelve null o `cupo_online` | `cupo_total` | `intervalo`.
- Endpoint público con límites: nombre/apellidos ≤ 120, notas ≤ 2000, alergias ≤ 1000, email
  ≤ 254, respuestas ≤ 8 KB (`DATOS_INVALIDOS`); etiquetas solo las de reserva, activas y de la
  cuenta del restaurante (el widget no puede colar uuids de otra cuenta).
- Códigos promocionales: validan restaurante, fechas, usos y experiencia; descuentan sobre el
  importe y suman `usos` **después del insert** (una llamada rechazada no gasta usos).
- Prescriptor por `?p=<slug>` o nombre (`reservas_prescriptores.slug` generado con `reservas_slug`).
- Localizador: `prefijo_localizador || 6 hex` (prefijo null hoy → igual que antes).
- Combinaciones de mesas: `reservas_mejor_mesa_v2` prueba 1) una mesa (zona preferida primero,
  prioridad de mesa y de sala, la más ajustada), 2) `reservas_mesas_combinaciones` activas,
  3) unión ad hoc de dos mesas `unible` de la misma sala a ≤ 15 unidades de distancia. Las mesas
  extra se insertan en `reservas_reserva_mesas`; la principal la sincroniza el trigger existente.
- Bloqueos: con `mesa_id` bloquean solo esa mesa; `sala_id` sin mesa, toda la sala; ambos nulos,
  todo el restaurante.

### Gestión pública por token
- Token = 32 hex (`reservas_token_valido`); las cinco funciones `reservas_gestion*` y
  `p_lista_espera_token` lo validan antes de consultar.
- `reservas_gestion_confirmar`: una reserva `pendiente` (sin aceptar por el restaurante) **no**
  pasa a `reconfirmada`; se sella `reconfirmada_en` (el cliente dice que viene) y el restaurante
  sigue teniendo que aceptar. `puede_confirmar` lo refleja.
- `reservas_gestion_modificar` recalcula de verdad: turno, grupo grande, antelación, **regla de
  tarjeta** (`REQUIERE_TARJETA` si con los nuevos pax haría falta garantía y no la tiene), cupos
  e intervalo (excluyendo la propia reserva) y mesa(s).
- `reservas_gestion_valorar`: una sola vez (`YA_VALORADA`); comentario ≤ 2000, detalle ≤ 2 KB.

### Mensajería
- `reservas_encolar_email()` conserva el nombre y los dos triggers (`trg_rsv_email_ins`,
  `trg_rsv_email_upd`, este ahora `of estado, fecha, hora, pax`) pero solo llama a
  `reservas_programar_mensajes(reserva_id, evento)` **dentro de begin/exception**: un error de
  mensajería se registra como warning y nunca tumba la reserva. **No vuelve a escribir en
  `reservas_emails_salientes`.**
- `reservas_reservas.notificar` (default **false**): el panel solo avisa con «Reservar y
  notificar» / «Validar y notificar»; `crear_online_v2` inserta `notificar = true`. Cancelada,
  no_show y tarjeta_pendiente («Solicitar tarjeta») avisan siempre. Walk-ins nunca. Las dos
  comprobaciones del UPDATE (fecha/hora/pax y estado) son independientes: mover y cancelar en el
  mismo update manda la cancelación.
- Importación: origen `importado` sin sesión (script con service key) no encola nada ni en
  insert ni en update; además cancelación y no-show solo se avisan de reservas con fecha futura
  (cancelación) o de los últimos 2 días (no-show). Una reserva futura importada de Cover que se
  cancele desde el panel sí avisa.
- Eventos de `reservas_programar_mensajes`: `alta` (insert, o tarjeta_pendiente → pendiente tras
  meter la tarjeta) → `confirmacion` («hemos recibido tu reserva») o `confirmada` si nace
  confirmada; `confirmada` (pendiente/tarjeta_pendiente → confirmada desde el panel) → cancela la
  `confirmacion` pendiente y encola **`confirmada`** («tu reserva está confirmada», tipo nuevo);
  `modificacion` → aviso + reprogramar recordatorio/reconfirmación/valoración; null → otro cambio
  de estado: solo reprograma. Un cambio de estado de una reserva heredada nunca dispara la
  confirmación.
- Programación: recordatorio (`−recordatorio_horas`, si queda > 15 min), reconfirmación
  (`−reconfirmacion_horas`, solo tipo ≠ gratis o pax ≥ 6), **valoración solo cuando el cliente
  ha venido** (estado de visita; el trigger la encola al pasar a llegada/sentada) o, en locales
  con `noshow_automatico = false` (no marcan llegadas), con asistencia presunta
  (confirmada/reconfirmada). Al salir de `tarjeta_pendiente` se cancela el aviso de
  garantía/pago pendiente. Cancelación/no-show cancelan los pendientes; no-show manda «te hemos
  echado de menos» solo si `envio_noshow` (default false); una cancelación por el sistema
  (tarjeta no introducida) no manda «confirmamos la cancelación».
- Un solo mensaje `pendiente` por (reserva, canal, tipo) salvo `manual` e `invitacion` (índice
  único parcial + `on conflict do nothing`).
- Canales: email si `envio_email`; WhatsApp si `envio_whatsapp`; SMS solo si `envio_sms` **y no
  hay WhatsApp** (Cover usa WhatsApp con SMS de respaldo: el cron debe reintentar por SMS si
  WhatsApp devuelve error).
- Plantilla: la del restaurante gana a la de la cuenta; idioma del cliente/reserva con fallback
  `es`. Placeholders: `{{nombre}}` (primer nombre), `{{nombre_completo}}`, `{{restaurante}}`,
  `{{fecha}}`, `{{hora}}`, `{{pax}}`, `{{localizador}}`, `{{enlace}}`, `{{enlace_cancelar}}`,
  `{{enlace_confirmar}}`, `{{enlace_pago}}`, `{{enlace_valorar}}`, `{{direccion}}`,
  `{{telefono}}`, `{{mensaje}}`, `{{importe}}`, `{{horas_politica}}`.
- Enlaces: `reservas_url_base(restaurante)` = `url_base` del restaurante o
  `https://hostelero-app.vercel.app` (lo que usaba el trigger antiguo). Rutas: `/reserva/<token>`,
  `/reserva/<token>?accion=cancelar|confirmar`, `/reserva/<token>/pago`, `/valorar/<token>`,
  lista de espera → `/reservar-mesa/<slug>?fecha=&hora=&pax=&espera=<token>`.
- Seed: **72 plantillas** = 12 tipos (los 10 del plan + `invitacion` + `confirmada`) × 3 canales
  × es/en. SMS y WhatsApp comparten el texto corto. `reservas_mensajes.tipo` admite además `manual`.
- Estados de mensaje: pendiente, enviado, entregado, **abierto** (tracking de Resend), error,
  sin_proveedor, cancelado.
- `reservas_mensaje_encolar` es interna (security definer, sin EXECUTE para authenticated) y
  además comprueba la cuenta si hay sesión: nadie puede hacer que el sistema mande la ficha de
  una reserva ajena (con su token de gestión) a un email arbitrario.
- Política de `reservas_mensajes`: para escribir, la reserva / el cliente / la lista de espera
  referenciados tienen que ser de la misma cuenta que el mensaje.

### Pagos
- `reservas_pagos`: lectura para `authenticated`, escritura solo del servidor (revoke
  insert/update/delete). Columnas Redsys: `ds_order` (único), `autorizacion`,
  `identificador_cof`, `cof_txnid`, `tarjeta_mascara`, `tarjeta_caducidad`, `respuesta` jsonb,
  `pago_origen_id` (devolución → cobro original).
- Las funciones de cron **solo marcan**: `reservas_noshow_automatico()` devuelve
  `(reserva_id, cuenta_id, restaurante_id, tipo, estado_pago, importe, cobrar)` y el servidor
  decide el cargo (`cobrar` = `cobro_noshow_automatico` del restaurante y garantía activa).
  `reservas_gestion_cancelar` devuelve `tardia` y `cargo_aplicable` por el mismo motivo.

### Cron
- `noshow_automatico` por restaurante (default true; **false en El Bar de Tamarindos** por seed:
  473 confirmadas pasadas sin cerrar en jul-sep y 6 visitas marcadas): sin él, `marcar_a_revisar`
  y `noshow_automatico` no tocan sus reservas.
- Una solicitud de grupo grande que el restaurante nunca contestó (pendiente, online, sin mesa)
  no pasa a no_show.
- `caducar_tarjeta_pendiente` cuenta desde `coalesce(tarjeta_solicitada_en, creado_en)`.
- El cron, antes de enviar una `valoracion`, debe comprobar que la reserva sigue en un estado de
  visita (o confirmada/reconfirmada en locales sin no-show automático).

### Triggers nuevos en `reservas_reservas`
- `trg_rsv_reservas_sellar` (before update): sella `llegada_en`, `sentada_en` (+ `pax_llegados`
  = pax si vacío), `salida_en`, `reconfirmada_en`, `tarjeta_solicitada_en`, `cancelada_en` +
  `cancelada_por` (`restaurante` con sesión, `sistema` sin sesión; `cliente` lo ponen las
  funciones de gestión) y `valoracion_en`.
- `trg_rsv_reservas_log` (after insert/update/delete) → `reservas_reservas_historial` con
  `campos` cambiados (ignora `actualizado_en`). Se crean **después** del backfill del token,
  y el backfill desactiva temporalmente `trg_rsv_reservas_touch` para no tocar `actualizado_en`.

### Clientes
- `telefono_norm` / `email_norm` con backfill (8 teléfonos no normalizados en la base) y trigger
  `trg_rsv_clientes_tocar` que los mantiene y sella `consentimiento_en`. Índice trigram sobre
  nombre + apellidos para el buscador.
- Vista `reservas_clientes_stats` (`security_invoker`): visitas, **visitas_presuntas** (pasadas
  en pendiente/confirmada/reconfirmada: locales que no marcan llegadas), no_shows, no_shows_12m,
  canceladas, canceladas_tardias (solo con `cancelada_en` informado), ultima/primera visita,
  pax_medio, restaurantes[], proxima_reserva, valoracion_media, `riesgo_no_show` = min(1,
  (no_shows_12m + 0,5·antiguos + 0,5·tardías) / (visitas + presuntas + no_shows + tardías + 1)).
- `reservas_fusionar_clientes(origen, destino)`: security invoker **y solo gestores**
  (`rrhh_es_gestor()`: dirección/administración u operador, `SIN_PERMISO` si no); reapunta
  reservas, mensajes y lista de espera, funde campos y borra el origen.

### Informes
- `reservas_estadisticas`: `no_show_pct` y `ocupacion_pct` cuentan la asistencia presunta
  (viva y pasada) como visita, nunca como no-show (como Cover con «Confirmadas»); `sin_cerrar`
  se devuelve aparte. Mismo criterio en por_dia y por_semana.

### Permisos (`reservas_permisos_perfil`)
- Lectura: toda la cuenta. Escritura: `rrhh_es_gestor()` (dirección/administración) u operador,
  y el perfil tiene que ser de la misma cuenta (with check). Es la única tabla nueva que no sigue
  el patrón «todo el personal escribe».

### Seeds (cuenta Bonita, idempotentes, cuenta_id explícito)
- `duracion_por_pax = {"1-2":90,"3-4":120,"5-8":150,"9+":180}` en los 4 restaurantes (⚠ cambia
  la disponibilidad: las mesas de 2 rotan cada 90 min en vez de 120).
- `mensaje_widget = «Podréis disfrutar de la mesa durante 2 horas. ¡Gracias!»`; dirección y
  teléfono copiados de `centros` de la misma cuenta si el restaurante no los tenía.
- `noshow_automatico = false` en `bar-tamarindos`.
- Mesas: `ancho/alto` 7×7 (cuadrada/redonda) y 10×6 (rectangular) en unidades del lienzo.
- 46 etiquetas (20 reserva / 12 cliente / 14 alérgenos UE), 23 prescriptores (20 hoteles + canales
  google/INSTAGRAM/FACEBOOK), 72 plantillas.

## 3. Revisión (01-10-2026): qué se ha corregido y qué no

Aplicadas (40 observaciones; las repetidas por varios revisores se cuentan una vez):

| Severidad | Qué | Dónde en el fichero |
|---|---|---|
| bloqueante | `url_base` antes de `reservas_url_base` (sql, check_function_bodies) | sección 0 |
| bloqueante | `cancelada_en` y `valoracion` antes de la vista `reservas_clientes_stats` | 1.3 |
| bloqueante | default privileges: `revoke … from authenticated` en `reservas_mensaje_encolar` (+ cinturón de cuenta) y en todas las funciones públicas v1/v2 (`disponibilidad`, `crear_online`, `gestion*`, `apuntar_lista_espera`, `cancelar`) | 0, 1.5, 1.7 |
| bloqueante | disponibilidad cuenta combinaciones/uniones (grupos de 7-8) | `reservas_disponibilidad_v2` |
| bloqueante | evento `alta`/`confirmada` en el trigger; tipo y 6 plantillas `confirmada`; la modificación ya no reencola «hemos recibido» | 1.5 |
| importante | solapes en timestamp (medianoche) en `mesa_ocupada` y `sin_mesa_solapadas` | 1.7 |
| importante | pendiente → confirmada manda «tu reserva está confirmada» | 1.5 |
| importante | begin/exception en el trigger; `on conflict do nothing` en el insert de mensajes | 1.5 |
| importante | cancelación/no-show solo de reservas vivas; la importación no encola | 1.5 |
| importante | `reservas_token_valido` en las 5 funciones por token y en `p_lista_espera_token` | 0, 1.7 |
| importante | etiquetas filtradas por cuenta/ámbito y límites de tamaño en `crear_online_v2`, `gestion_valorar`, `apuntar_lista_espera_v2` | 1.7 |
| importante | `fusionar_clientes` solo gestores (`rrhh_es_gestor`, que ya incluye operador) | 1.3 |
| importante | `YA_VALORADA` | `reservas_gestion_valorar` |
| importante | valoración solo tras visita real (+ asistencia presunta en locales sin no-show automático) | 1.5 |
| importante | `noshow_automatico` por restaurante, false en bar-tamarindos | 1.1, 1.8 |
| importante | asistencia presunta en `no_show_pct`, `ocupacion_pct`, `sin_cerrar`, vista stats | 1.3, 1.7 |
| importante | `gestion_modificar` comprueba tarjeta, cupos e intervalo (helper `reservas_cupo_motivo`, usado también en disponibilidad y alta) | 1.7 |
| importante | solicitud de grupo grande sin garantía/prepago | `reservas_crear_online_v2` |
| importante | `tarjeta_solicitada_en` (sellado, alta online, caducidad) | 1.4, 1.8 |
| importante | `gestion_confirmar` no salta la aceptación del restaurante | 1.7 |
| importante | uso del código promocional después del insert | `reservas_crear_online_v2` |
| importante | se cancela el aviso garantía/pago al salir de `tarjeta_pendiente` | 1.5 |
| importante | `notificar` default false; online inserta true | 1.4, 1.7 |
| menor | fecha/hora/pax y estado se evalúan por separado en el UPDATE | 1.5 |
| menor | `permisos_perfil`: el perfil tiene que ser de la cuenta | 5.x |
| menor | `reservas_mensajes`: reserva/cliente/lista de espera de la misma cuenta | 1.5 |
| menor | seed de `centros` filtrado por cuenta | 1.1 |
| menor | anon a cero en las 10 tablas viejas; truncate/references/trigger fuera de authenticated en todas | 1.1 y cada tabla |
| menor | revokes en las 6 funciones v1 recreadas | 1.7 |
| menor | bucle de horas sale si da la vuelta a medianoche | `reservas_disponibilidad_v2` |
| menor | bloqueo con mesa_id y sala_id no bloquea la sala | `reservas_mesa_ocupada` |
| menor | wrapper v1 omite turnos cerrados (y completos) | `reservas_disponibilidad` |
| menor | SMS solo sin WhatsApp | `reservas_mensaje_encolar` |
| menor | `reservas_cancelar` legado: reconfirmada + `cancelada_por = 'cliente'` | 1.7 |
| menor | cupo de día (`turno_id null`) | `reservas_cupo_motivo` |
| menor | tarjeta solo si `garantia_importe_pax > 0` | disponibilidad y alta |
| menor | cancelación por el sistema no manda «confirmamos la cancelación»; la solicitud sin contestar no es no-show | 1.5, 1.8 |

Variantes respecto a lo propuesto (con motivo):

- **Importación en el trigger**: en vez de «`if new.origen = 'importado' then return new`» a
  secas, se corta solo cuando además **no hay sesión** (`auth.uid() is null` = script con service
  key). Una reserva futura importada de Cover (las habrá tras la re-importación del corte) que
  Sonia cancele o acepte desde el panel sí avisa al cliente. Por lo mismo, el paso 1 de
  `programar_mensajes` ya no excluye `importado`: basta la guarda de fecha futura (cancelación)
  / últimos 2 días (no-show) más el corte del trigger.
- **Código promocional**: el uso se consume tras el insert pero **también en reservas sin
  importe**: `usos_max` cuenta canjes (el código queda en `codigo_promo` y sirve para campañas),
  no solo descuentos. Si se quiere lo contrario, añadir `and v_importe is not null`.
- **`reservas_pagos`**: la observación sobre `reserva_id` de otra cuenta no aplica: authenticated
  no tiene insert/update/delete (solo escribe el servidor).
- **`fusionar_clientes`**: se usa `rrhh_es_gestor()` solo (ya incluye `es_operador()`, comprobado
  en la base).
- **Valoración** (añadido): en locales con `noshow_automatico = false` nadie marca llegadas, así
  que la valoración se encola con asistencia presunta (confirmada/reconfirmada); si no, esos
  locales nunca pedirían valoración.
- **«Solicitar tarjeta»** (añadido en esta pasada): el paso a `tarjeta_pendiente` desde el panel
  avisa aunque `notificar = false` (como cancelada/no_show): pedir la tarjeta sin decírselo al
  cliente no sirve de nada. Solo para reservas futuras.

Descartadas: ninguna. Las 40 observaciones se han verificado contra el fichero y la base
(nombres de constraints, columnas, ACLs, `check_function_bodies`, default privileges) y eran
correctas.

## 4. Dudas para Luis / el orquestador

1. **`confirmar_online_auto`**: ¿las reservas online deben nacer confirmadas (como en Cover) o
   pendientes (como ahora)? Default false por compatibilidad.
2. **Duración por pax** cambia la rotación de las mesas pequeñas (90 min). Si no se quiere aún,
   poner `duracion_por_pax = null` y la duración vuelve a la del turno (120).
3. **URL pública**: `url_base` es por restaurante y hoy vale null → enlaces a
   `hostelero-app.vercel.app`. Cuando haya dominio por restaurante (reservas.binifadet.com…)
   basta rellenar la columna.
4. **Importación de Cover**: el script debe insertar con `origen = 'importado'`, `cover_id`,
   `cancelada_en` (si Cover lo da) y correr con la service key (sin sesión): así no encola nada.
   Para las reservas futuras importadas conviene llamar a `reservas_programar_mensajes(id, null)`
   al final para que tengan recordatorio.
5. **Walk-ins** sin cliente no reciben nada; con cliente y email reciben la valoración al marcar
   llegada/sentada. ¿Se quiere?
6. **`tarjeta_pendiente` ocupa mesa** 30 min (`tarjeta_caduca_min`). Cover no la ocupa; lo hemos
   hecho así para que dos clientes no reserven la misma mesa mientras uno paga.
7. **Permisos**: solo dirección/administración (`rrhh_es_gestor`) puede escribir
   `reservas_permisos_perfil` y fusionar clientes. ¿Vale ese criterio o se quiere un rol de «jefe
   de sala» propio?
8. **Tamarindos**: ninguna mesa online llega a 8 pax ni con uniones; revisar en Ajustes qué mesas
   marcar `reservable_online` / `unible` para que el widget acepte grupos de 7-8.
9. **`reservas_tracking`** incluye `riesgo_no_show` por subconsulta a la vista: en exportaciones
   de todo el histórico puede tardar unos segundos. Si molesta, se quita la columna.
10. El trigger `trg_rsv_reservas_log` generará ~1 fila por cambio; con 26k reservas vivas y el
   sondeo de 60 s del panel no debería crecer rápido, pero conviene vigilar el tamaño.

## 5. Pendiente fuera de la migración
- `packages/db/types.ts`: regenerar tras aplicar.
- Route handlers nuevos (`/api/publico/reservas/*` para v2, gestión por token, pago, valorar),
  `/api/cron/reservas-mensajes` (envía `reservas_mensajes` pendientes —con fallback a SMS si
  WhatsApp falla y comprobando el estado de la reserva antes de una `valoracion`— y llama a
  `reservas_marcar_a_revisar`, `reservas_noshow_automatico`, `reservas_caducar_tarjeta_pendiente`,
  `reservas_aplicar_autotags`) y su entrada en `vercel.json` (cada 10 min).
- El panel: «Reservar y notificar» / «Validar y notificar» ponen `notificar = true` en el mismo
  update que el cambio.
- Activación en CaixaBank (comercio 369732227) de COF / pago por referencia, importe 0 y REST.
- Plantillas de WhatsApp: las del seed son las que se registrarían en Meta.
