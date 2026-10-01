# Reservas v2 · Guía de look & feel (lo que Sonia reconoce de Cover, sin copiarlo)

Referencias visuales (capturas de la sesión real de Cover, NO se suben al repo — contienen
nombres de clientes): `/private/tmp/claude-501/-Users-luisangles/6419d700-9d1b-4f11-a007-44320627afc8/scratchpad/ref/`
- `cover-plano-comida.png` · plano de Binifadet, turno de comida (la referencia principal).
- `cover-dia-plano-completo.jpg` · pantalla Día entera: barra, lista a la izquierda, plano a la derecha.
- `cover-dia-lista.png` · pantalla Día en modo lista (Comida | Cena a dos columnas) + leyenda.
- `cover-popover-estados.jpg` · popover de acciones rápidas al pulsar una reserva.
- `cover-modal-editar-1.jpg` / `-2.jpg` · modal «Editar reserva» (dos columnas: reserva | cliente).

## 1. Principios
- **Oscuro por defecto** (sala con iPad y poca luz). Fondo `#1f2227`, paneles `#2a2e33`/`#33383e`,
  bordes `#3b4047`, texto `#e6e6e6`, gris `#a3aab3`. Acento de la casa (verde `#0F6E56` /
  `#2FA886`) para botones primarios y pestaña activa. Cover usa amarillo; nosotros NO.
- **Densidad de sala**: filas compactas (44–52 px), tipografía 13–14 px, números grandes donde
  importan (mesa, hora, pax). Nada de tarjetas blancas flotando sobre fondo oscuro.
- **La mesa es el protagonista**: en el plano se lee a 2 m de distancia: número de mesa y
  capacidad; si está ocupada, hora + nombre.
- Todo con **hover/active claros** y **teclas**: Esc cierra, Enter guarda, ←/→ cambian de día.

## 2. Pantalla Día (la que más se usa)
Disposición (ancho ≥ 1200): barra superior · fila de turnos · **lista izquierda (≈ 42 %) + plano
derecha (≈ 58 %)**. En pantallas estrechas: pestañas Lista / Plano.

### Barra superior (una sola fila)
`[Restaurante ▾] [🔍 Buscar cliente o localizador]  … [Comida ●on  👥 24/216  ▦ 10/50] [Cena ●on 👥 27/216 ▦ 9/50]  [‹] [jueves 1/10/2026] [›]  [+ Nueva reserva]`
- Por turno: interruptor de **abierto/cerrado** (cupo), **pax reservados / aforo** y **reservas /
  máximo**. Los números cambian a ámbar cuando se supera el 80 % y a rojo al 100 %.
- Fecha con nombre del día; «Hoy» como atajo.

### Fila de turnos y filtros
`[COMIDA] [CENA] [DÍA COMPLETO]  [📅 cupos] [⤓ exportar] [🖨 imprimir]  [CREAR LISTA DE ESPERA]`
y debajo los **chips de estado con contador**: `Todas · ●Confirmadas (9/22) · ●Pendientes (0/0) ·
●Lista espera (0/0) · ●Llegadas (1/2) · ⋮`. El color del chip = color del estado.

### Lista de reservas (izquierda)
Columnas: **M** (mesa, con borde izquierdo de 3 px del color del estado) · **Hora** · **Nombre**
(+ debajo en pequeño: canal «CH: Google», prescriptor, idioma) · **Pax** · **Estado** (píldora
ancha del color del estado con icono: 🔔 online, 🔁 channel manager, ✔✔ reconfirmada, 💬
comentario, 🎫 ticket, 💳 política).
- Bajo la fila, si existe: «Información cliente: …» (alergias, VIP, notas) en ámbar y
  «Información reserva: …» (comentario del cliente) en azul claro.
- Contador de visitas del cliente como badge azul junto al nombre (`6`).
- Clic en la fila → **popover de acciones rápidas** (ver §4). Doble clic → modal completo.
- Buscador local «Buscar por nombre, apellido, teléfono…» encima de la lista.

### Plano (derecha) — la pieza que más se tiene que parecer
- **Cabecera de salas como pestañas**: `TERRAZA (10/24)   VIÑEDO (0/0)` (mesas ocupadas/total) y
  a la derecha iconos: ✔ llegadas, 🔒 bloquear, ➕ nueva reserva en mesa, 🕒 cronograma, ⋮.
- Lienzo oscuro `#2a2e33` sin rejilla visible (rejilla sólo en modo edición).
- **Mesas**: formas con esquinas redondeadas (radio ≈ 12 % del lado) y una **sombra suave**
  (`0 2px 6px rgba(0,0,0,.45)`). Tamaño proporcional a la capacidad (2 pax ≈ 56 px, 4 ≈ 68,
  6-8 ≈ 84×64 rectangular, 10-12 ≈ 110×60).
  - **Libre**: relleno marrón madera `#6b3d2e` (borde `#4e2b20`), texto blanco
    `123 (7)` = número (capacidad máx).
  - **Solo web / no reservable online**: gris `#8a8f94` con la etiqueta `WEB` debajo del número.
  - **Ocupada (confirmada/pendiente, aún no en mesa)**: verde claro `#8bc34a` → texto oscuro:
    `113 (2p)` / `13:00` / `Stuart Kean` (3 líneas, nombre truncado).
  - **Sentada (en mesa)**: verde oscuro `#2e7d32` texto blanco.
  - **Llegada / postre / cuenta**: azul `#1f4e9e` (texto blanco) con icono pequeño.
  - **Seleccionada**: borde rojo `#e53935` de 3 px.
  - **Dos reservas en la misma mesa en el turno**: badge con el nº en la esquina.
  - **Bloqueada**: rayado diagonal gris + candado.
- **Objetos decorativos** (`reservas_plano_objetos`): plantas (círculo/estrella verde menta
  `#4db6ac`), paredes/barras (rectángulos `#3a3f45`), etiquetas de zona («Wine bar», «Terraza
  Patio») como píldoras ámbar translúcidas, y rectángulos oscuros para barra/cocina.
- **Modo edición** (solo Ajustes › Planos): rejilla punteada, arrastrar mesas y objetos,
  rotar (90°), redimensionar con asa, duplicar, alinear; paleta de objetos a la izquierda.
- Zoom con rueda/pinch y arrastre del lienzo; botón «ajustar».
- Al pasar el ratón por una mesa ocupada: tooltip con hora, pax, nombre, teléfono, notas.
- **Arrastrar una reserva de la lista a una mesa** la asigna; arrastrar entre mesas la cambia.

### Leyenda (pie)
Una fila de píldoras con los estados (color + icono + texto) y una segunda con los iconos de
origen (🔔 motor web, 🔁 channel manager, ✔✔ reconfirmada, 💬 comentario, 🎫 ticket, 💳 política).
Plegable.

## 3. Cronograma (timeline)
Filas = mesas agrupadas por sala; columnas = horas del turno (franjas de 15 min, hora en
cabecera). Cada reserva es una barra con el color del estado, texto `13:00 · Kean · 2p`; la
duración define el ancho. Línea vertical de «ahora». Arrastrar la barra cambia la hora;
estirar el extremo cambia la duración. Clic → popover; doble clic → modal.

## 4. Popover de acciones rápidas (clic en reserva o mesa ocupada)
Cabecera: «Reserva hecha: 29-09-2026 12:09 · Tel: +44… · Canal: Google» y botones en
rejilla, grandes (altura 36 px) para dedo:
`[EDITAR RESERVA] [LIBERAR] [DESPLAZAR]`
`[PENDIENTE] [CONFIRMADA] [✔✔ RECONFIRMADA] [CANCELADA CLIENTE]`
`[ALÉRGENO] [🍸 LLEGADA BARRA] [SENTADA] [💳 CUENTA] [NO SHOW]`
`[LLEGADA] [POSTRE] [💬 WhatsApp]`
Cada botón con el color del estado al que lleva. Se cierra con Esc o clic fuera.

## 5. Modal de reserva (nueva / editar)
Título «Nueva reserva en Bodegas Binifadet» · a la derecha «Anotado por [usuario ▾]». Dos
columnas:
- **Izquierda — la reserva**: Día · Hora (select con `(6 / 216)` ocupación por franja) · Personas
  (+ icono grupo) · Duración · Ref. · Código · Zona (todas / sala) · Mesa(s) («113 (Terraza) |
  Min:1 Max:2», multi) · Estado · Tipo de reserva (gratis / política / garantía / prepago /
  experiencia) · Prescriptor · Procedencia (solo lectura) · Etiquetas de la reserva (chips) ·
  Notas del establecimiento · Adjuntar archivo · Localizador (solo lectura).
- **Derecha — el cliente**: Empresa ▾ · tarjeta del cliente (avatar, nombre, email | teléfono,
  botones ENVIAR EMAIL / ENVIAR SMS / WhatsApp) · estadísticas en 2 filas (última visita, gasto
  total, gasto por visita, gasto por persona / visitas, no-show, canceladas, media de
  valoraciones) · Nombre · Apellidos · Idioma · Código de país ▾ · Teléfono · Email · Etiquetas
  del cliente · consentimiento comercial · pestañas «Notas del cliente | Información adicional»
  (alergias, preferencias, cumpleaños…).
- **Pie fijo**: `☐ Notificar por SMS  ☑ Notificar por Email  ☐ WhatsApp  [🖨]  [VER TRACKING DE
  NOTIFICACIONES]   [GUARDAR]  [GUARDAR Y NOTIFICAR AL CLIENTE]`.
- Autocompletar cliente por teléfono/email/nombre mientras se escribe (lista con visitas y
  etiquetas); si no existe se crea al guardar.
- En oscuro: el modal es `#2a2e33` con inputs `#1f2227`; en claro, blanco.

## 6. Mes
Rejilla de calendario; cada día muestra por turno `Comida 120/216` y `Cena 80/216` con barra de
ocupación (verde → ámbar → rojo), icono de cerrado 🔒 si el cupo está cerrado y nota del día.
Clic → Día. Arrastrar sobre varios días → cerrar/abrir cupos en bloque.

## 7. Inbox
Lista cronológica de novedades: nuevas reservas online, cancelaciones, modificaciones,
mensajes fallidos, valoraciones, solicitudes de grupo pendientes. Cada fila con icono, hora,
restaurante, texto y botones de acción (confirmar, asignar mesa, responder).

## 8. Clientes (CRM)
Buscador grande + filtros (etiquetas, VIP, lista negra, visitas ≥ n, sin visitas desde…).
Tabla: nombre, teléfono, email, visitas, no-shows, última visita, etiquetas, riesgo no-show.
Ficha lateral (drawer) con historial de reservas, notas, preferencias, fusionar duplicados.

## 9. Lista de espera
Fila por entrada: hora de llegada, nombre, pax, teléfono, espera estimada, botones «Avisar
(WhatsApp/SMS)», «Sentar en mesa…», «Descartar». Desde el plano, una mesa libre ofrece «Sentar
desde lista de espera».

## 10. Informes
KPI arriba (reservas, pax, ocupación, no-show %, cancelaciones %, nuevos vs recurrentes),
gráficas simples (por día, por hora, por canal, por prescriptor), tabla exportable CSV/XLS con
el mismo tracking de 52 columnas. Rango de fechas + tipo de fecha (reserva / anotación).

## 11. Ajustes
Pestañas internas: Restaurante · Turnos y cupos · Salas y planos (editor) · Mesas · Etiquetas ·
Prescriptores · Experiencias · Políticas y pagos · Mensajes (plantillas por canal/idioma con
vista previa) · Widget/front (colores, textos, preguntas) · Usuarios y permisos · Códigos promo.

## 12. Widget público (/reservar-mesa)
Cuatro pasos tipo Cover: 1) restaurante+pax+fecha, 2) turno/hora (con «pocas plazas»), 3) datos
(nombre, apellidos, teléfono con prefijo, email, idioma, comentario, preguntas, consentimiento),
4) confirmación (y tarjeta si la reserva lo requiere). Tema claro, limpio, de la casa; en móvil
primero. Página /reserva/<token> con confirmar / modificar / cancelar / añadir al calendario.
