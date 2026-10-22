# Catálogo común de proveedores: manual

> Parte delantera: cómo se usa. Creado el 22-10-2026. Parte técnica: [`docs/tecnico/maestros.md`](../tecnico/maestros.md).

## Qué es

Jano guarda un **catálogo común** de proveedores y de sus productos: el código con el que el proveedor factura,
la descripción, el formato (caja de 6 botellas de 75 cl, bolsa de 1 kg…) y su tarifa oficial. Es el mismo para
todos los restaurantes que usan Jano, porque un proveedor vende lo mismo a todos; lo que cambia es el precio que
paga cada uno, y eso sigue siendo de cada restaurante.

## Qué gano con él

- Cuando llega un albarán, el programa reconoce el producto por su código y ya sabe qué formato tiene: se
  equivoca menos y Recetas puede calcular el coste por kilo o por litro.
- Si doy de alta un proveedor que otro restaurante de Jano ya tenía, su catálogo ya está cargado.
- Más adelante, Atenea podrá comparar lo que pago con la tarifa oficial del proveedor.

## Cómo entra un catálogo

1. Pide al proveedor su **listado de productos**: código, descripción, formato o envase, unidades por caja y,
   si puede, precio y EAN. Vale un PDF de tarifa, un Excel o incluso un correo.
2. Pásaselo a quien mantiene Jano (hoy, Luis desde Code). Se convierte y se carga con dos órdenes; la carga
   enseña cuántos productos son nuevos, cuántos cambian de precio y cuántos ya estaban.
3. Al terminar, los productos de Compras de tu restaurante quedan **enlazados** al catálogo y se completan solos
   con el formato, el EAN y el precio de catálogo (en Compras › Productos y en Pedidos).

Repetir una carga no duplica nada: si el proveedor manda una tarifa nueva, solo cambian los precios.

## Qué se revisa

De cada catálogo sale un Excel de revisión (en Descargas) con el formato tal como viene y lo que el programa ha
deducido (unidades por caja, contenido). Esa deducción es orientativa hasta que alguien la marca como revisada.

## Cargados hasta ahora (22-10-2026)

Agustín Torrella (555 artículos, 17 marcas), Menorca Fruit (1.119) y Biona / Kombucha MUN (1).
