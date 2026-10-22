# Maestros comunes de proveedor y producto: documentación técnica

> Parte trasera: cómo está programado y por qué. Creado el 22-10-2026.
> Manual de usuario: [`docs/manual/maestros.md`](../manual/maestros.md). Compras: [`compras.md`](compras.md).

---

## 1. Para qué sirve

Un proveedor y su catálogo son los mismos para cualquier restaurante que le compre: el código de artículo, la
descripción, el formato («6u × 0,75 l», «caja de 9») y la tarifa oficial no dependen del cliente. Hasta ahora
cada cuenta de Jano se montaba su `compras_producto` a golpe de OCR de albaranes (2.200 productos en Bonita, sin
formato, sin unidad, sin EAN). Con el maestro común:

- el OCR puede casar cada línea de albarán con un artículo **conocido** (referencia, EAN o nombre) y heredar
  formato, unidades por caja y EAN;
- Recetas tiene de dónde sacar el **factor de formato** (contenido por unidad) en vez de deducirlo del nombre;
- cuando una cuenta nueva da de alta un proveedor que otra ya trajo, el catálogo ya está (lo que hacía Yurest);
- más adelante, cruzando `mae_precio_tarifa` con lo que paga cada cuenta (`compras_linea`), Atenea podrá decir
  si se compra mejor o peor que la referencia.

Decisión de Luis (19-10 y 22-10-2026): los catálogos oficiales de los proveedores sustituyen a la heurística de
formatos de Recetas (`scripts/recetas-ingredientes/factores.py`, en pausa).

## 2. Datos

Migración `apps/general/supabase/migrations/20261022120000_maestros_catalogo_y_cotejo_foto.sql` (bloque A).
**Sin `cuenta_id`**: las tablas `mae_*` son de toda la plataforma.

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `mae_proveedor` | Una ficha por NIF. | `nif`, `nif_norm` (generada con `norm_nif`), `nombre`, `nombre_norm`, `email_albaranes`, `codigos_son_ean` (Biona factura por EAN), `verificado`, `creado_por_cuenta`. Único por `nif_norm`; si no hay NIF, por `nombre_norm`. |
| `mae_producto` | Un artículo por proveedor y referencia. | `ref_proveedor` (código con el que factura) y `ref_norm` (generada con `mae_ref_norm`: mayúsculas, sin signos, sin ceros a la izquierda), `ref_fabricante` (tarifas de distribuidor: el código del fabricante), `ean`, `nombre`, `nombre_norm` (`clave_producto`), `marca`, `categoria`, `formato` (texto tal cual), `unidad_venta` (`kg`/`ud`/`l`: en qué va el precio), `unidades_caja`, `contenido` + `contenido_unidad` (de UNA unidad), `formato_fiable` (false hasta que alguien lo revise), `precio_tarifa` + `precio_tarifa_desde`, `fuente` (`catalogo`/`albaran`/`manual`/`email`), `carga_id`. Único por (`proveedor_id`, `ref_norm`). |
| `mae_precio_tarifa` | Histórico de tarifas oficiales. | `producto_id`, `precio`, `desde`, `carga_id`. Único por (producto, desde). |
| `mae_carga` | Registro de cada carga. | `proveedor_id`, `cuenta_id` (quién lo aportó), `archivo`, `fuente`, `vigente_desde`, `filas`/`nuevos`/`actualizados`/`sin_cambios`, `detalle` (cambios de precio). |
| `mae_catalogo` (vista) | Catálogo con el nombre del proveedor, para consultas. | `security_invoker`. |

Punteros desde las tablas de cada cuenta: `compras_proveedor.mae_proveedor_id` y `compras_producto.mae_producto_id`.

**RLS**: `select` para cualquier usuario autenticado (cualquier cuenta); `insert/update/delete` solo con
`es_operador()`. Los scripts escriben con la service key (salta la RLS). `anon` no ve nada.

### 2.1 Funciones y triggers

- `mae_ref_norm(text)`: normaliza referencias («045900» = «45900» = « 45.900 »).
- `mae_vincular_cuenta(p_cuenta)`: enlaza los `compras_proveedor` de la cuenta por NIF, los `compras_producto`
  por referencia o EAN dentro del proveedor enlazado, y **completa** (nunca pisa) `formato`, `unidad`
  (`kg`/`litro`/`unidad`, el vocabulario de Pedidos), `unidades_formato`, `codigo_barras`, `categoria` y
  `precio_catalogo`. Devuelve cuántos enlazó. Idempotente; la lanza el script al final de cada carga.
- Trigger `trg_producto_enlaza_maestro` (BEFORE INSERT en `compras_producto`): cuando el OCR da de alta un
  producto nuevo (lo hace `enlazar_producto_linea` desde la línea de albarán), busca en el maestro del proveedor
  por referencia, EAN o nombre normalizado y, si casa, pone `mae_producto_id` y hereda formato/EAN/precio.

## 3. Scripts (`scripts/maestros/`)

| Script | Qué hace |
|---|---|
| `catalogo-a-json.mjs` | Convierte el listado del proveedor al JSON normalizado. **PDF de tarifa**: `pdftotext -layout` y lectura por columnas a partir de la cabecera de cada bloque (PRODUCTE / Producto / Referencia / NOM COMERCIAL): las celdas de la izquierda son los códigos, la más cercana a la cabecera es la descripción, el resto es el formato y la última el precio. Entiende marcas y vigencias («EN VIGOR dd/mm/aaaa»), categorías (líneas solas en mayúsculas), descripciones partidas en dos líneas, tarifas a dos columnas (Santa Rosalía) y el orden invertido FÁBRICA/ATSA de Coll-Verd. **Excel/CSV**: columnas por nombre (`--col-ref`, `--col-nombre`, `--col-precio`, `--col-ean`, `--col-formato`…) o adivinadas. De `formato` deduce `unidad_venta`, `unidades_caja` y `contenido` (heurística: `formato_fiable=false`). `--excel` deja un Excel de revisión. |
| `cargar-maestro.mjs` | Carga el JSON en `mae_*`: crea el proveedor si no existe (por NIF), inserta los artículos nuevos, en los existentes **solo completa huecos** y actualiza la tarifa (con histórico), registra la carga y llama a `mae_vincular_cuenta` para la cuenta (`--cuenta`, Bonita por defecto). `--solo-ver` no escribe. Idempotente. |
| `datos/*.json` | Catálogos que llegaron sin fichero (p. ej. Biona por correo: un producto). |

Uso típico:

```bash
node scripts/maestros/catalogo-a-json.mjs --proveedor "AGUSTÍN TORRELLA, S.A." --nif A58592627 --excel --salida ~/Downloads/maestro-atsa.json ~/Downloads/PAG*.pdf
node scripts/maestros/cargar-maestro.mjs ~/Downloads/maestro-atsa.json --solo-ver
node scripts/maestros/cargar-maestro.mjs ~/Downloads/maestro-atsa.json
```

## 4. Primeras cargas (22-10-2026)

| Proveedor | Origen | Artículos | Notas |
|---|---|---|---|
| Agustín Torrella, S.A. (ATSA, Barcelona) | 14 páginas PDF de su tarifa (Montesierra, Martín Martín, Cadeso, Los Cameros, Negrini, Coll-Verd, Obach, Santa Rosalía, Suquipa, Wagyu japonés, Arotz, Santa Teresa, Schara, La Milanesa, Discarlux, Empuria Gel, Nimu) | 555 | `ref_proveedor` = código ATSA, `ref_fabricante` = código del fabricante, `marca` = bloque de la tarifa. Vigencias distintas por bloque. 8 sin precio (s/e, s/mercado). Bonita tiene 15 productos de este proveedor por albarán. |
| Menorca Fruit | Excel (Código, Descripción, PVP) | 1.119 | Sin formato: el contenido solo sale cuando el nombre lo dice («500GR»). 139 productos de Bonita por albarán, con la misma numeración. |
| Biona S.L. (MUN) | Texto de un correo | 1 | Su código es el EAN (`codigos_son_ean`). Bonita ya tenía el producto con el EAN como referencia. |

Los JSON y Excel de revisión quedaron en `~/Downloads/maestro-*-2026-10-22.*`.

## 5. Decisiones y límites

- **Nunca se pisa lo que una cuenta ya tenía** en `compras_producto` (nombre, alias, precios). El maestro solo
  completa huecos. El nombre del OCR se conserva: es el que aparece en los albaranes de esa cuenta.
- **Precios que paga cada cuenta**: no van al maestro. Siguen en `compras_linea` / `compras_producto.ultimo_precio`.
  El maestro guarda la **tarifa oficial** del proveedor. La comparativa es un paso posterior.
- **Formato**: `formato` es texto tal cual; `unidades_caja`/`contenido` son deducidos y `formato_fiable=false`
  hasta revisión. Recetas debería leer `contenido`+`contenido_unidad` como factor cuando `formato_fiable` o,
  mientras tanto, como propuesta.
- **Varios clientes, mismo proveedor, distinta referencia**: no contemplado (el proveedor factura con el mismo
  código a todos). Si un proveedor usa códigos por cliente, se trata como `fuente='albaran'` por cuenta.
- **Quién mantiene el maestro**: hoy, scripts con la service key desde Code. Pantalla de operador: pendiente.
- **Pendiente**: pantalla «Maestro» para el operador (ver, corregir formato, marcar `formato_fiable`); que
  Pedidos importe desde el maestro en vez de pedir el Excel a cada cuenta; que Recetas use `contenido`;
  comparativa de precios por cuenta; `packages/db/types.ts` sin regenerar.
