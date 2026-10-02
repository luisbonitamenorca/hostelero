# Reservas v2 · Entrega (02-10-2026)

Módulo `/reservas` reconstruido a la altura de la versión más completa de CoverManager, con un aspecto
que Sonia y los jefes de sala reconozcan (tema oscuro, lista + plano, colores de estado de Cover).
Desplegado en producción (`hostelero-app.vercel.app`, commit `110a43d`).

Documentos relacionados: plan y contrato `docs/reservas-v2-plan.md` · inventario de Cover
`docs/reservas-v2-cover-inventario.md` · guía visual `docs/reservas-v2-look.md` · mensajería
`docs/reservas-v2-mensajeria.md` · pagos `docs/reservas-v2-pagos.md` · notas de la migración
`docs/reservas-v2-migracion-notas.md`.

---

## 1. Qué hay (mapa Cover → Hostelero)

| Cover | Hostelero | Notas |
|---|---|---|
| Día · Vista plano | **Día** | Lista a la izquierda, plano a la derecha, pestañas Comida / Cena / Día completo, interruptor abierto/cerrado y aforo por turno, chips de estado con contador, popover de acciones rápidas, arrastrar reserva a mesa, bloquear mesa/sala, cupos y nota del día, exportar e imprimir. |
| Día · Cronograma | **Cronograma** | Mesas × franjas de 15′, mover reserva arrastrando, estirar duración, «sin mesa», resumen por turno. |
| Mes | **Mes** | Ocupación por día y turno, cerrar/abrir y aforo en bloque arrastrando sobre varios días. |
| Inbox / Inbox actividad | **Inbox** | Online, cancelaciones, modificaciones, pagos, valoraciones, mensajes con error; confirmar/rechazar. |
| CRM · Clientes | **Clientes** | Buscador, filtros, riesgo de no-show, duplicados y fusión, ficha con historial y mensajes, exportar. |
| Lista de espera | **Lista de espera** | Alta rápida, avisar por WhatsApp/SMS/email con enlace que reserva, sentar en mesa, vista puerta. |
| Analytics · Informes | **Informes** | KPIs, gráficas, «tracking» de 52 columnas exportable (CSV para Excel), personas por turno y día. |
| Configuración | **Ajustes** | Restaurante, turnos y cupos, editor de planos, mesas, camareros, etiquetas (+automáticas), prescriptores, experiencias, códigos promo, políticas y pagos, plantillas de mensajes, widget y preguntas, permisos. |
| Motor de reservas | **/reservar-mesa/‹local›** | 4 pasos, es/en/ca/fr/de, calendario con días cerrados, zonas, experiencias, grupos grandes como solicitud, lista de espera, código promo, enlace de prescriptor `?p=`. |
| Email de gestión | **/reserva/‹token›** | Reconfirmar, modificar (con disponibilidad real), cancelar, calendario (.ics), invitar. |
| Tarjeta de garantía / ticket | **/reserva/‹token›/pago** | Redsys/CaixaBank como Visitas: garantía 0 € con tarjeta guardada (COF), prepago, cobro de no-show y devoluciones. Los datos de tarjeta nunca pasan por nuestro servidor. |
| Encuesta | **/valorar/‹token›** | Comida, atención, entorno, NPS; si es buena, invita a dejar reseña en Google. |
| Confirmaciones | **Mensajería** | Email (Resend), SMS y WhatsApp (Twilio) con plantillas por tipo, canal e idioma; recordatorio, reconfirmación, valoración, no-show; seguimiento de entregas. |

Más que Cover: riesgo de no-show por cliente, cupos por turno además de por día, combinaciones de mesas
automáticas para grupos, historial de cambios de cada reserva, y conexión directa con Ratios.

## 2. Datos de Cover y Ratios (lo mismo que con Skello)

Hasta que se apague Cover, el módulo se alimenta del informe de Cover y **Ratios ya no necesita el Excel
COVERMANAGER**: lee los comensales en vivo del módulo (vista `comensales_desde_reservas`, comprobado contra
Cover: 863 de 869 días-turno idénticos de marzo a septiembre; el resto ±4 pax).

Para actualizar (semanal o cuando quieras):

1. En Cover › Analytics › Informes › **Tracking de reservas**: rango del año, «Todas», marcar «Incluir
   otros establecimientos», «Ampliar con más datos» y «Ampliar con datos de prescriptores» → Descargar CSV
   (llega por correo).
2. **Listado de clientes**: lo saco yo desde tu sesión de Cover (Cover no lo descarga, lo envía por correo).
3. `node scripts/cargar-cover-tracking.mjs <tracking.csv> --clientes=<clientes.tsv> --dry-run` y, si el
   resumen cuadra, sin `--dry-run`. Una segunda pasada con los mismos ficheros no cambia nada.

Estado cargado (02-10): 27.941 reservas de 2026 (todas las de Cover, también canceladas y no-shows) y
78.377 fichas de cliente (77.967 personas de Cover deduplicadas por teléfono + contactos que solo
aparecen en reservas). Los walk-ins sin datos quedan sin ficha («Walk-in» en pantalla), como el
cliente genérico de Cover.

Mientras Cover siga vivo: **ninguna reserva importada de Cover recibe mensajes, cobros ni cambios de
estado automáticos desde aquí** (Cover ya lo hace); el cron solo actúa sobre reservas creadas en
Hostelero.

### Incidente del 01-10 (resuelto)

La primera versión del cargador actualizaba clientes por lotes de forma que vaciaba campos (teléfono,
email, ID de Cover) de otros clientes del mismo lote y cada pasada creaba duplicados (llegó a 90.933
fichas). Las reservas no se vieron afectadas y nadie recibió mensajes. Se reconstruyó todo desde los
informes de Cover con `scripts/sincronizar-clientes-cover.mjs` y el cargador ya no modifica fichas.

## 3. Lo que tienes que activar tú

| Qué | Para qué | Dónde |
|---|---|---|
| Claves de **Twilio** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, remitentes SMS/WhatsApp) y aprobar en Meta las **plantillas de WhatsApp** | SMS y WhatsApp | Vercel → variables; detalle en `docs/reservas-v2-mensajeria.md` §5 |
| **Resend**: registros DNS de los dominios en Infotelecom, webhook a `/api/publico/reservas/webhooks/resend` y subir a plan Pro antes de apagar Cover (el gratuito da 100 correos/día) | Email | Resend + Infotelecom |
| **CaixaBank/Redsys**: pago con tarjeta guardada (COF / pago por referencia), operaciones de 0 €, acceso REST, URL de notificación; un comercio de pruebas para probarlo | Garantía con tarjeta, prepago, cobro de no-show | Gestor de CaixaBank; detalle en `docs/reservas-v2-pagos.md` §1 |
| `MENSAJERIA_TITULAR` (razón social para el pie legal) | Pie de los correos | Vercel → variables |

Sin estas claves nada falla: los mensajes quedan como «sin proveedor» y se envían cuando estén.

## 4. Decisiones pendientes (por defecto, lo indicado entre paréntesis)

- Reservas online: ¿nacen confirmadas como en Cover o pendientes? (pendientes; se cambia por local en Ajustes).
- Cancelación tardía con garantía: ¿se cobra al momento o decide dirección? (decide dirección).
- Pago que llega tarde: ¿reactivar la reserva o devolver siempre? (se reactiva si la reserva caducó
  por no meter la tarjeta y la mesa sigue libre; si no, se devuelve solo).
- Duración por pax: 90′ para 1-2, 120′ para 3-4, 150′ para 5-8, 180′ para 9+ (editable en Ajustes).
- Permisos: hoy solo dirección edita el plano y los ajustes; los jefes de sala lo ven en solo lectura.
- Exportar clientes sin consentimiento de marketing: sin email (sí con teléfono).

## 5. Pendiente / siguiente paso

- **Copiar el plano exacto de Cover** (posiciones, formas, capacidades y mesas «bloqueada web»): necesito
  tu Chrome con la sesión de Cover conectado. Mientras, las mesas que Cover tiene y nuestro plano no
  (138-140, 209, S0, S9, S28-30, T19, 101-104 de Tirant…) están en una fila libre de su sala con la
  capacidad real observada; se recolocan arrastrando en Ajustes › Salas y planos.
- Limpiar las etiquetas de cliente heredadas de Cover (95, con variantes como «avanzado/avanzados»).
- Revisión en pantalla con Sonia (iPad, oscuro y claro) y ajustes de detalle.
- Corte con Cover (cuando lo decidas): activar el widget en las webs, apuntar los enlaces de Google
  Reserve, y desde ese día el cron gestiona avisos, no-shows y cobros.
