# Reservas v2 · Plan (01-10-2026)

Objetivo: que `/reservas` (panel de sala) y `/reservar-mesa` (widget público) igualen o superen la
**mejor versión de CoverManager** y que a Sonia y al resto de jefes de sala les resulte **familiar**
(misma lógica, mismos nombres, misma disposición: lista + plano, cronograma, mes, estados de color).
Se construye sobre lo que hay: esquema `reservas_*` (26.339 reservas, 17.607 clientes, 4
restaurantes, 8 salas, 112 mesas, 8 turnos), panel `app/reservas`, widget `app/reservar-mesa`,
handlers `app/api/publico/reservas/*`, pago Redsys de Visitas (`lib/redsys.ts`), correo Resend
(`lib/correo.ts`).

Referencias: sesión de Cover de Luis (vista Día con lista+plano, Mes con ocupación por turno,
modal Nueva reserva con todos sus campos, widget de 4 pasos), `docs/reservas-v2-cover-inventario.md`
(investigación de planes y funcionalidades) y `docs/migracion-reservas.md` (lo que ya está).

## 0. Reglas duras

1. Migraciones **solo aditivas**; `cuenta_id` (default `cuenta_actual()`) en toda tabla nueva; RLS
   con `(select cuenta_actual())`; anon a cero (lo público va por route handlers con service key).
2. Fichero por sección (`secciones/<sec>.tsx` + `.css`, `acciones/<sec>.ts`); los agentes no tocan
   `tipos.ts`, `acciones.ts`, `reservas.css`, `PanelReservas.tsx` ni `lib-reservas.ts` (cimientos).
3. El pago **nunca** pasa por nuestro servidor con datos de tarjeta: Redsys por redirección
   (prepago) y **pago por referencia / COF** (garantía). Importes siempre desde la base.
4. Mensajería: email por Resend (remitente por restaurante), SMS y WhatsApp por Twilio (SMS y
   WhatsApp Business API) con variables de entorno; sin claves, el envío queda «pendiente de
   proveedor» y nada se rompe. Plantillas editables; todo envío queda registrado.
5. Español, tono de la casa, fechas dd/mm, sin `prompt()/alert()`. Tema del panel: **oscuro por
   defecto** (como Cover, es lo que la sala tiene en el iPad por la noche) con toggle claro; el
   plano se dibuja sobre suelo oscuro con mesas color madera y objetos decorativos.
6. `npx tsc --noEmit` limpio por sección; `next build` antes del push.

## 1. Modelo de datos (migración `reservas_v2`)

### 1.1 Restaurante y configuración
`reservas_restaurantes` +: `direccion`, `mensaje_widget` (texto que ve el cliente al reservar,
p. ej. «podrán disfrutar de su mesa durante 2 horas»), `idiomas text[] default '{es,en}'`,
`color_marca text`, `logo_url`, `url_condiciones`, `telefono_whatsapp`, `prefijo_localizador`,
`politica_cancelacion_horas int default 24`, `tarjeta_desde_pax int null` (garantía obligatoria a
partir de N comensales; null = nunca), `garantia_importe_pax numeric null` (importe por persona que
se cobra si no-show), `prepago_importe_pax numeric null`, `recordatorio_horas int default 24`,
`reconfirmacion_horas int default 48`, `liberar_tras_min int default 20` (minutos sin llegar antes
de marcar «a revisar»), `valoracion_horas int default 2` (encuesta tras la visita), `envio_email
bool default true`, `envio_sms bool default false`, `envio_whatsapp bool default false`,
`duracion_por_pax jsonb` ({"1-2":90,"3-4":120,"5-8":150,"9+":180}), `max_pax_online int default
8`, `grupos_telefono text` (mensaje para grupos grandes), `zona_horaria text default 'Europe/Madrid'`.

`reservas_salas` +: `reservable_online bool default true`, `color text`, `prioridad int default 100`,
`ancho int default 100`, `alto int default 70` (tamaño del lienzo), `fondo text default 'oscuro'`.

`reservas_mesas` +: `ancho numeric`, `alto numeric`, `rotacion int default 0`, `prioridad int
default 100` (orden de asignación automática), `unible bool default true`, `tipo text default 'mesa'`
check in ('mesa','barra','alta'), `color text null`, `etiqueta text null` (número visible).

**`reservas_plano_objetos`** (decoración del plano: plantas, paredes, barra, textos, puertas,
escaleras): id, cuenta_id, sala_id, tipo check ('planta','pared','barra','texto','puerta','columna',
'ventana','escalera','cocina'), pos_x, pos_y, ancho, alto, rotacion, texto, color.

**`reservas_cupos`** (por día y turno: aforo online, cerrado, nota — lo que Cover enseña en Mes):
id, cuenta_id, restaurante_id, fecha, turno_id, cerrado bool default false, max_pax_online int null,
max_pax_total int null, nota. unique (restaurante_id, fecha, turno_id). (Los `reservas_cierres`
actuales siguen valiendo; la UI nueva escribe en cupos.)

**`reservas_bloqueos`** (bloquear mesas o salas en una franja): id, cuenta_id, restaurante_id,
fecha, hora_inicio, hora_fin, mesa_id null, sala_id null, motivo.

**`reservas_notas_dia`**: id, cuenta_id, restaurante_id, fecha, texto, creado_por, creado_en.

### 1.2 Catálogos
**`reservas_etiquetas`**: id, cuenta_id, ambito check ('reserva','cliente','alergeno'), nombre,
color, orden, activa. Seed: reserva (Cumpleaños, Celebración, Aniversario, Boda, Bautizo, Comunión,
Empresa, Silla de ruedas, Carrito de bebé, Trona, Menú concertado, Evento, Grupo, Invitación,
Prueba de menú, Huésped, Turista, Local, Llegada impuntual, Cliente contactado); cliente (VIP,
Super VIP, Habitual, Socio, Equipo, Prescriptor, Proveedor, Problemático, Lista negra, No paga, Sin
tarjeta, No-show previo); alérgenos (los 14 de la UE: Gluten, Crustáceos, Huevos, Pescado,
Cacahuetes, Soja, Lácteos, Frutos secos, Apio, Mostaza, Sésamo, Sulfitos, Altramuz, Moluscos).

**`reservas_prescriptores`** (hoteles/empresas que recomiendan): id, cuenta_id, nombre, tipo
check ('hotel','agencia','empresa','canal','otro'), telefono, email, comision_pct, activo.
Seed con la lista de Cover de Bonita (≈80: ARTIEM Audax, Hotel Torralbenc, Meliá Cala Galdana…;
el agente la tiene en el plan de investigación; si no, los 20 más habituales).

**`reservas_experiencias`** (menús/experiencias reservables, Cover Experiences): id, cuenta_id,
restaurante_id, nombre, descripcion, precio_pax numeric, requiere_prepago bool, pax_min, pax_max,
turnos uuid[] null, dias_semana int[] null, fecha_desde, fecha_hasta, activa, orden, imagen_url.

### 1.3 Clientes (CRM de sala)
`reservas_clientes` +: `apellidos`, `idioma text default 'es'`, `pais text default 'ES'`,
`etiquetas uuid[] default '{}'`, `alergenos uuid[] default '{}'`, `consentimiento_marketing bool
default false`, `consentimiento_en timestamptz`, `fecha_nacimiento date`, `empresa text`,
`prescriptor_id uuid`, `lista_negra bool default false`, `telefono_norm text` (índice; relleno con
reservas_norm_tel), `email_norm text`, `actualizado_en`.
Vista **`reservas_clientes_stats`**: cliente_id, visitas (terminada/sentada), no_shows,
canceladas, ultima_visita, primera_visita, pax_medio, restaurantes (array), proxima_reserva.
Función **`reservas_fusionar_clientes(origen, destino)`** (security invoker, gestores) que
reapunta reservas y borra el origen.

### 1.4 Reservas
`reservas_reservas` +: `zona_id uuid null` (sala preferida), `tipo text default 'gratis'` check
('gratis','politica_cancelacion','garantia','prepago','experiencia'), `estado_pago text default
'no_requerido'` check ('no_requerido','pendiente_tarjeta','garantizada','pagada','cobrado_noshow',
'devuelto','fallido'), `importe_garantia numeric`, `importe_prepago numeric`, `experiencia_id uuid`,
`idioma text default 'es'`, `pais text`, `etiquetas uuid[] default '{}'`, `prescriptor_id uuid`,
`empresa text`, `anotado_por uuid` (perfil), `referencia text`, `alergias text`,
`consentimiento_marketing bool`, `token text unique` (enlace público de gestión: 32 hex), `llegada_en
timestamptz`, `sentada_en`, `salida_en`, `recordatorio_enviado_en`, `reconfirmada_en`,
`cancelada_por text null check in ('cliente','restaurante','sistema')`, `motivo_cancelacion text`,
`adjuntos jsonb default '[]'`, `valoracion int`, `valoracion_comentario text`, `valoracion_en`.
Backfill `token` = encode(gen_random_bytes(16),'hex') para todas.
**Estados** (texto, catálogo en código y en una check constraint ampliada): `pendiente`,
`confirmada`, `reconfirmada`, `llegada`, `sentada`, `postre`, `cuenta`, `terminada` (= liberada),
`no_show`, `cancelada`, `a_revisar`, `tarjeta_pendiente`, `lista_espera`. Se mantienen los 6 actuales.
Trigger de historial **`reservas_reservas_historial`** (quién cambió qué: user_id, accion, antes,
despues, ts) y trigger que sella `llegada_en/sentada_en/salida_en` al cambiar de estado.

### 1.5 Mensajería
**`reservas_plantillas`**: id, cuenta_id, restaurante_id null (null = por defecto de la cuenta),
canal check ('email','sms','whatsapp'), tipo check ('confirmacion','recordatorio','reconfirmacion',
'cancelacion','modificacion','lista_espera','valoracion','pago','garantia','noshow'), idioma,
asunto, cuerpo (placeholders {{nombre}}, {{restaurante}}, {{fecha}}, {{hora}}, {{pax}},
{{localizador}}, {{enlace}}, {{enlace_cancelar}}, {{enlace_confirmar}}, {{direccion}},
{{telefono}}, {{mensaje}}), activa. Seed: las 10×3 canales en es y en.
**`reservas_mensajes`** (todo envío): id, cuenta_id, restaurante_id, reserva_id, cliente_id, canal,
tipo, destinatario, asunto, cuerpo, estado check ('pendiente','enviado','entregado','error',
'sin_proveedor','cancelado'), proveedor, proveedor_id, error, programado_para timestamptz,
enviado_en, creado_en. Índices por estado+programado_para y reserva_id.
Función **`reservas_programar_mensajes(reserva_id)`** (security definer): según el restaurante y
el estado, encola confirmación (ahora), recordatorio (fecha−recordatorio_horas), reconfirmación
(fecha−reconfirmacion_horas, solo si tipo con política/garantía o pax ≥ 6), valoración
(fin+valoracion_horas); cancela los pendientes si la reserva se cancela. Se llama desde triggers
de insert/update de estado.
La tabla antigua `reservas_emails_salientes` se deja (lectura) y deja de alimentarse: el trigger
`reservas_encolar_email` pasa a escribir en `reservas_mensajes`.

### 1.6 Pagos (garantía y prepago)
**`reservas_pagos`**: id, cuenta_id, restaurante_id, reserva_id, tipo check ('garantia','prepago',
'cargo_noshow','devolucion'), importe numeric, moneda default 'EUR', estado check ('iniciado',
'autorizado','cobrado','devuelto','fallido','cancelado'), ds_order text unique, autorizacion text,
identificador_cof text (referencia de tarjeta de Redsys para cobros posteriores), tarjeta_mascara,
respuesta jsonb, creado_en, actualizado_en. RLS: gestores lectura; escribe el servidor.
Flujo: garantía = operación de **0 €** con `DS_MERCHANT_IDENTIFIER=REQUIRED` y
`DS_MERCHANT_COF_INI=S / COF_TYPE=C` (guarda la referencia; el cliente no paga); cargo por no-show
= REST `trataPeticionREST` con `DS_MERCHANT_IDENTIFIER=<ref>`, `DS_MERCHANT_DIRECTPAYMENT=true`,
`COF_INI=N`, `COF_TXNID`; prepago = redirección normal (como Visitas); devolución = transacción
tipo 3 por REST. Estas tres capacidades (COF/pago por referencia, importe 0 y REST) las tiene que
activar CaixaBank en el comercio 369732227: se documenta en la entrega.

### 1.7 Funciones
- `reservas_disponibilidad(slug, fecha, pax, zona_id null, experiencia_id null)` v2: respeta cupos
  (cerrado/max online), bloqueos, duración por pax, zonas reservables, antelación y devuelve por
  turno las horas con `plazas` y si exige tarjeta/prepago (`tipo`, `importe`).
- `reservas_crear_online(...)` v2 con los campos nuevos (apellidos, idioma, país, zona, etiquetas,
  alergias, experiencia, consentimiento, prescriptor por slug de campaña) → devuelve localizador,
  token y `requiere_pago` ('garantia'|'prepago'|null) + importe.
- `reservas_gestion(token)` (consultar) / `reservas_gestion_cancelar(token, motivo)` /
  `reservas_gestion_confirmar(token)` / `reservas_gestion_modificar(token, fecha, hora, pax)`.
- `reservas_estadisticas(restaurante_id null, desde, hasta)` → json: reservas y pax por día y turno,
  ocupación %, no-show %, cancelaciones (y dentro de X horas), canales, origen, antelación media,
  pax medio, top prescriptores, nuevos vs recurrentes, valoración media.
- `reservas_tracking(restaurante_id, desde, hasta)` → tabla plana para exportar (como el
  «Tracking de reservas» de Cover: todas las columnas).
- `reservas_mejor_mesa` v2: prioridad de mesa, uniones (dos mesas unibles contiguas si no cabe en
  una), zona preferida.

### 1.8 Cron
`/api/cron/reservas-mensajes` cada 10 min: envía `reservas_mensajes` pendientes con
`programado_para <= now()`; marca `a_revisar` las reservas confirmadas que lleven
`liberar_tras_min` sin llegada; `no_show` automático al cierre del turno si sigue sin llegada (y
cargo de garantía si procede, solo si el restaurante tiene `cobro_noshow_automatico`); encola
valoraciones. Añadir a `vercel.json`.

## 2. Pantallas

### 2.1 Panel `/reservas` (tema oscuro por defecto, selector de restaurante arriba, buscador global
«cliente o localizador», botón amarillo/verde «Nueva reserva»)
Pestañas: **Día · Cronograma · Mes · Inbox · Clientes · Lista de espera · Informes · Ajustes**.

- **Día**: cabecera con cada turno (ON/OFF del día = cupo cerrado, «pax/aforo» y «mesas/total»),
  fecha con ‹ › y calendario; izquierda la **lista** (filtros por estado con contadores:
  Todas · Re/Confirmadas · Pendientes · L. espera · Canceladas; buscador; filas con hora, nombre,
  pax, mesa, chip de estado con color, iconos de notas/alergias/tarjeta/garantía; clic abre la
  ficha); derecha el **plano** (pestañas por sala, mesas de madera sobre suelo oscuro con número y
  «(cap)», reserva actual dentro (hora, nombre, pax), colores por estado, objetos decorativos,
  zoom/pan, modo «Editar plano»: arrastrar, redimensionar, rotar, añadir mesa/objeto, unir mesas;
  clic en mesa libre = walk-in o asignar; arrastrar una reserva de la lista a una mesa). Barra
  inferior con leyenda de estados (como Cover). Notas del día. Lista de espera del día.
- **Cronograma**: mesas × horas (Gantt) con barras de reserva arrastrables (cambiar hora/mesa),
  huecos visibles, línea de ahora.
- **Mes**: por día y turno ocupación % con pax/aforo y mesas/total, cerrado, clic abre el día,
  botón para cerrar/abrir turno y fijar aforo online del día (reservas_cupos).
- **Inbox**: pendientes de confirmación, tarjeta no introducida, pagos, valoraciones recibidas,
  mensajes con error, solicitudes de lista de espera; acciones rápidas.
- **Clientes**: lista con filtros (etiquetas, alérgenos, VIP, no-shows, sin visitas desde…,
  consentimiento) y buscador; ficha (datos, idioma, etiquetas, alérgenos, notas, consentimiento,
  prescriptor/empresa, historial de reservas con estado, no-shows, visitas, última, próxima,
  valoraciones, mensajes enviados; fusionar duplicados; «Nueva reserva para este cliente»);
  exportar CSV (filtro) y «Enviar a CRM» (ya existe la tabla maestra CRM: respetar la regla de
  consentimiento).
- **Lista de espera**: por día, con «avisar» (mensaje con enlace que reserva la hora libre) y
  «sentar».
- **Informes**: tarjetas como Cover (Tracking de reservas CSV/XLS con «ampliar datos», pax por
  turno y día, canceladas dentro de X horas, no-shows, valoraciones, reservas por usuario,
  canales/prescriptores) + cuadro de mando con gráficos simples (ocupación por semana, no-show %,
  antelación, canales) usando `reservas_estadisticas`.
- **Ajustes**: Restaurante (datos, textos del widget, idiomas, logo/color), Turnos y aforos
  (turnos, duración por pax, max online, excepciones por fecha), Salas y plano (editor), Mesas,
  Etiquetas, Alérgenos, Prescriptores, Experiencias, Políticas y pagos (tarjeta desde N pax,
  importes, cancelación, estado del TPV), Mensajes (canales activos, plantillas por tipo/idioma,
  vista previa, envío de prueba), Usuarios de sala (anotado por), Front (código de inserción del
  widget, enlace por restaurante, QR).

### 2.2 Modal de reserva (como el de Cover)
Día · Hora (con ocupación por franja «13:00 (11/216)») · Personas · Duración · Zona · Mesa(s) ·
Estado · Tipo (gratis / política / garantía / prepago / experiencia) · Prescriptor · Empresa ·
Referencia · Etiquetas de la reserva · Notas internas · Adjuntar archivo || Cliente: buscador por
teléfono/nombre/email, nombre, apellidos, idioma, prefijo+teléfono, email, etiquetas, alérgenos,
consentimiento, notas del cliente · «Notificar por email/SMS/WhatsApp» · Reservar / Reservar y
notificar. Historial de cambios y mensajes enviados en la ficha de la reserva.

### 2.3 Widget público `/reservar-mesa` (y `/reservar-mesa/<slug>` por restaurante; embebible)
Cuatro pasos como Cover pero con nuestra marca (claro, color del restaurante): 1 **Encontrar**
(personas, tira de días con disponible/completo/cerrado y calendario, horas por turno con
«pocas plazas», lista de espera si no hay hueco, grupos grandes → teléfono); 2 **Información**
(nombre, apellidos, email, prefijo+teléfono, comentario, alergias sí/no + cuáles, consentimientos
RGPD y marketing); 3 **Adicional** (zona preferida si el restaurante lo permite, experiencia/menú,
ocasión, idioma); 4 **Confirmación** (localizador, resumen, añadir al calendario .ics, enlace de
gestión, mapa/dirección). Si el restaurante exige tarjeta: paso **Garantía** (texto de política,
botón que redirige al banco; vuelta a `/reservar-mesa/garantia-ok|ko`); si exige prepago: paso de
pago. Página pública **`/reserva/<token>`**: ver, reconfirmar, cancelar (con política), modificar
hora/pax si hay hueco, descargar .ics. Multi-idioma es/en/ca/fr/de con diccionario.
Textos legales: responsable BONITA MENORCA S.L.

### 2.4 Mensajes
Confirmación (al crear), recordatorio (24 h, con botones Confirmar / Cancelar), reconfirmación
(48 h, para política/garantía/grupos), cancelación, modificación, lista de espera (hueco libre),
valoración (2 h después: 1–5 estrellas + comentario, página pública `/valorar/<token>`),
garantía/prepago (enlace para meter la tarjeta si no lo hizo). Email (Resend, remitente
reservas@<dominio del restaurante>), SMS y WhatsApp (Twilio; WhatsApp exige plantillas aprobadas:
las plantillas del seed son las que se registrarían). `lib/mensajeria.ts` con `enviar(mensaje)`.

## 3. Reparto de ficheros
```
apps/general/app/reservas/
  PanelReservas.tsx        ← registro de pestañas + tema (cimientos)
  lib-reservas.ts          ← Ctx, SecProps, catálogo de estados/colores, helpers (cimientos)
  tipos.ts, acciones.ts, reservas.css  ← existentes; solo lectura
  secciones/{dia,cronograma,mes,inbox,clientes,espera,informes,ajustes}.tsx + .css
  acciones/{dia,cronograma,mes,inbox,clientes,espera,informes,ajustes,reserva}.ts
  componentes/{plano.tsx, modal-reserva.tsx}   ← compartidos por Día/Cronograma/Mes (agente «plano» y «modal»)
apps/general/app/reservar-mesa/*               ← widget (agente «widget»)
apps/general/app/reserva/[token]/*             ← gestión pública (agente «widget»)
apps/general/app/valorar/[token]/*             ← valoración (agente «mensajes»)
apps/general/app/api/publico/reservas/*        ← handlers (agente «widget» y «pagos»)
apps/general/app/api/cron/reservas-mensajes/route.ts  (agente «mensajes»)
apps/general/lib/mensajeria.ts, lib/redsys.ts (ampliar: REST y COF)  (agentes «mensajes» y «pagos»)
apps/general/supabase/migrations/20261001120000_reservas_v2.sql
packages/db/types.ts ← regenerado tras aplicar
```

## 4. Datos
Antes del corte, re-importar de Cover el histórico fresco (export «Tracking de reservas» con
«ampliar con más datos» + «Listado de clientes»): script `scripts/cargar-cover-tracking.mjs`
idempotente (localizador de Cover como referencia).

## 5. Añadidos tras la investigación (docs/reservas-v2-cover-inventario.md)

- **Tipos de reserva** (5, como Cover): gratis · política de cancelación (token de tarjeta; cargo
  X €/pax si no-show o cancelación con menos de N h; «variable»: solo a partir de X pax) · prepago
  (ticket X €/pax que se descuenta de la cuenta) · garantía de retención (retener importe) ·
  **pendiente de confirmación** (grupos grandes: solicitud que el restaurante acepta a mano).
- **Estados** con los códigos de Cover (para la importación y los informes): −5 tarjeta no
  introducida, −4 a revisar, −3 no show, −2 cancelada cliente, −1 cancelada restaurante,
  0 pendiente, 1 confirmada, 2 reconfirmada, 3 sentada, 4 llegada, 5 liberada, 6 cuenta
  solicitada, 7 postre, 8 llegada barra, 9 a limpiar. **Sentar/llegar parcial** (cuántas personas
  han llegado): `reservas_reservas.pax_llegados int`.
- **Combinación de mesas** habituales: tabla `reservas_mesas_combinaciones` (restaurante_id,
  nombre, mesas uuid[], pax_min, pax_max, activa) que usa la asignación automática.
- **Camareros**: `reservas_camareros` (restaurante_id, nombre, color, activo) y
  `reservas_reservas.camarero_id`; asignación por mesa en el día (`reservas_mesas_camarero_dia`).
- **Preguntas personalizadas del widget**: `reservas_preguntas` (restaurante_id, texto, tipo
  si_no|texto|desplegable|multiple, opciones text[], obligatoria, orden, activa) y respuestas en
  `reservas_reservas.respuestas jsonb`.
- **Códigos promocionales** `reservas_codigos` (codigo, descripcion, descuento_pct|importe,
  experiencia_id null, validez, usos_max, usos) y `reservas_reservas.codigo_promo`.
- **Invitar a los acompañantes** desde la confirmación (emails + mensaje) → `reservas_mensajes`
  tipo 'invitacion'.
- **Autotags** (automatizaciones de etiquetas): `reservas_autotags` (condicion no_show|cancelar|
  asistir, operador >= , n, periodo_dias, etiqueta_id); las aplica el cron.
- **Puntuación de riesgo de no-show** por cliente (histórico de no-shows y cancelaciones tardías,
  antelación, canal) → columna calculada en la vista de stats y chip «riesgo» en la lista.
- **Encuesta post-visita** con 4 bloques (Comida, Atención, Entorno, Global 1–5) + NPS + comentario;
  publicación opcional en Google (enlace a reseña) si la nota ≥ 4.
- **Usuarios y permisos de sala**: reutiliza perfiles del esqueleto; `reservas_permisos_perfil`
  (perfil_id, puede_cobrar, puede_mover, puede_cambiar_estado, puede_editar_plano, restaurantes
  uuid[]).
- **Cross-selling**: si no hay hueco, el widget ofrece los otros restaurantes del grupo con hueco
  (ya existe la idea en el front actual; mantener).
- **Importación**: `reservas_reservas.cover_id text` (id de Cover) para la re-importación
  idempotente desde el «Tracking de reservas».
