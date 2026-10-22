# Compras: manual de uso

> Manual de usuario del módulo Compras. De momento recoge solo la novedad del 22-10-2026; el resto del módulo
> está descrito, desde el punto de vista técnico, en [tecnico/compras.md](../tecnico/compras.md).

## Facturas que llegan por correo a facturas@

Desde el 22-10-2026 las facturas que llegan al buzón de facturas@ **se leen solas, también por la tarde y los
fines de semana**, sin que nadie tenga abierta la pantalla de Compras:

- Cada 15-30 minutos el servidor revisa el buzón, descarga los adjuntos **y los procesa con el OCR**: la factura
  aparece en la pestaña Facturas (o en Albaranes, si el proveedor tiene marcado «Envía albaranes por email») en
  menos de media hora desde que entra el correo.
- Lo que antes pasaba al abrir Compras («procesando N documentos del correo…») sigue existiendo: si hay algo
  pendiente, el navegador lo coge igual. Lo normal es que ya no quede nada por hacer.
- Buzón enseña lo mismo que antes: cada adjunto con su estado (procesado, descartado con el motivo, error). Un
  adjunto en error se reencola igual que siempre (vuelve a «pendiente» y lo coge la siguiente pasada o el
  navegador).
- Si un adjunto lleva más de media hora en «pendiente» sin que nadie lo haya tocado, algo falla en el servidor:
  avisar.

Lo que **no** cambia: las fotos de albaranes subidas desde el móvil, la revisión, los repartos, la exportación a
A3 y la pestaña Buzón funcionan exactamente igual.
