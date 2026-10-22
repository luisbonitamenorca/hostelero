# Compras: manual de uso

> Manual de usuario del módulo Compras. De momento recoge las novedades del 22-10-2026; el resto del módulo
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

## Albaranes: el PDF del proveedor manda, la foto es la prueba

Desde octubre de 2026 la mayoría de proveedores mandan el albarán **por email** (PDF). Ese PDF se lee perfecto y
es el documento que vale. La **foto** del papel se sigue haciendo, pero sirve para tres cosas:

1. **Cargar los albaranes de los proveedores que todavía no mandan PDF** (como siempre).
2. **Comprobar** que lo que llegó es lo que dice el PDF: cantidades, productos que faltaban, devoluciones,
   anotaciones a boli en el papel.
3. **Detectar albaranes que no llegaron**: si un proveedor manda cuatro PDF y en el restaurante solo se hace foto
   a tres, el cuarto queda marcado «sin foto» (a lo mejor era de otro establecimiento).

No hay que hacer nada distinto: se hace la foto como siempre. El programa busca si ya tiene ese albarán por
email (mismo proveedor y mismo número) y, si lo tiene, guarda la foto junto al PDF y los compara. Da igual el
orden: si la foto llega antes que el PDF, cuando entre el PDF sustituye a la lectura de la foto.

### La columna «Cotejo» en Albaranes

| Marca | Significa | Qué hacer |
|---|---|---|
| 🟢 Foto ✓ | La foto coincide con el PDF. | Nada. |
| 🟠 Diferencias | Cantidades o importes distintos, productos que están en uno y no en otro, o anotaciones a mano. | Abrir el albarán. |
| 📧 Sin foto | Llegó el PDF por email y nadie ha fotografiado el papel. | ¿Llegó la mercancía? Si no es nuestro, borrarlo. |
| 📷 Sin PDF | Hay foto pero el proveedor no ha mandado el PDF. | Esperar; si el proveedor ya debería mandarlo, reclamárselo. |
| — | Proveedor que no va por email. | Como siempre. |

Arriba, junto a los totales, un contador resume cuántos hay de cada.

### Dentro del albarán

Al abrirlo, el visor enseña primero el PDF y después las pestañas «📷 Foto». Debajo del estado aparece el bloque
**Cotejo foto ↔ PDF** con las anotaciones a mano que la IA ha leído en el papel y una tabla con las diferencias
(qué dice el PDF y qué dice la foto). Las líneas de la tabla de productos son **las del PDF**.

Si la diferencia es solo una lectura torcida de la foto, pulsa **«✓ Dar por bueno»** y pasa a 🟢. Si de verdad
faltó mercancía o hubo devolución, corrige las líneas como siempre y pide el abono al proveedor.
