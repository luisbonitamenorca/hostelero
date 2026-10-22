# Compras: manual de usuario

> Parte delantera. Esta página recoge, de momento, el **cotejo foto ↔ PDF** de albaranes (22-10-2026).
> Parte técnica: [`docs/tecnico/compras.md`](../tecnico/compras.md) §4.11.

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

## La columna «Cotejo» en Albaranes

| Marca | Significa | Qué hacer |
|---|---|---|
| 🟢 Foto ✓ | La foto coincide con el PDF. | Nada. |
| 🟠 Diferencias | Cantidades o importes distintos, productos que están en uno y no en otro, o anotaciones a mano. | Abrir el albarán. |
| 📧 Sin foto | Llegó el PDF por email y nadie ha fotografiado el papel. | ¿Llegó la mercancía? Si no es nuestro, borrarlo. |
| 📷 Sin PDF | Hay foto pero el proveedor no ha mandado el PDF. | Esperar; si el proveedor ya debería mandarlo, reclamárselo. |
| — | Proveedor que no va por email. | Como siempre. |

Arriba, junto a los totales, un contador resume cuántos hay de cada.

## Dentro del albarán

Al abrirlo, el visor enseña primero el PDF y después las pestañas «📷 Foto». Debajo del estado aparece el bloque
**Cotejo foto ↔ PDF** con las anotaciones a mano que la IA ha leído en el papel y una tabla con las diferencias
(qué dice el PDF y qué dice la foto). Las líneas de la tabla de productos son **las del PDF**.

Si la diferencia es solo una lectura torcida de la foto, pulsa **«✓ Dar por bueno»** y pasa a 🟢. Si de verdad
faltó mercancía o hubo devolución, corrige las líneas como siempre y pide el abono al proveedor.
