# PyG (PyG Socios, PyG Pruebas y mercado interno) · documentación técnica

> Parte trasera de los dos cuadros de mando de cuenta de resultados: **PyG Socios** (`/pyg`, datos de
> A3 en un Excel) y **PyG Pruebas** (`/pyg-pruebas`, datos de la Contabilidad de Hostelero), más el
> **mercado interno** que comparten. Escrito el 04-10-2026 a partir del código (`main`, commit
> `1b2490b`), la base `hostelero` (proyecto Supabase `jwsvkjyjwocuksdgiqnv`), el historial de git y las
> notas de dirección. Manual de uso: [`docs/manual/pyg.md`](../manual/pyg.md).

Relacionados: [`docs/tecnico/ratios.md`](ratios.md) (de donde salen ventas y mercado interno) y
[`docs/tecnico/presupuesto.md`](presupuesto.md) (presupuesto de PyG Pruebas).

---

## 1. Para qué sirve y estado

Cuenta de resultados mensual por centro (canal) y consolidada, con presupuesto, balance, tesorería,
pool bancario y ratios (EBITDA, % compras, % personal), pensada para los socios.

| App | Fuente | Estado |
|---|---|---|
| **PyG Socios** | Excel `datos.xlsx` con el Sumas y Saldos de A3 (más hojas auxiliares) + ventas y mercado interno en vivo desde Ratios. | **Operativo** (`modulos.madurez = 'operativo'`). Es el que se enseña hoy. |
| **PyG Pruebas** | Contabilidad de Hostelero (`fin_informe_mensual`), presupuesto del módulo Presupuesto, detalle de proveedor de Compras, tesorería de bancos y cartera. | **Beta**, «en sombra» desde el 15-09-2026. Si cuadra, **sustituye a PyG Socios a fin de 2026**. |

Las dos comparten la misma interfaz (PyG Pruebas se generó una vez copiando `pyg.html`; **no hay
generador**: se editan por separado).

## 2. Dónde vive

| Pieza | Ruta | Qué hace |
|---|---|---|
| Ruta PyG Socios | `/pyg` → `apps/general/app/pyg/route.ts` | `exigirModulo("pyg")` y sirve `datos/pyg.html` con URL, clave publicable, token y `cuenta_id` inyectados. |
| Ruta PyG Pruebas | `/pyg-pruebas` → `apps/general/app/pyg-pruebas/route.ts` | `exigirModulo("pyg_pruebas")` y sirve `datos/pyg-pruebas.html`. |
| HTML | `apps/general/datos/pyg.html` (~150 KB), `apps/general/datos/pyg-pruebas.html` (~170 KB) | Una página cada una. SheetJS 0.18.5 y Chart.js 4.4.1 por jsDelivr. |
| Servidor de HTML | `apps/general/lib/html-modulo.ts` | `no-store` + vigilante de versión (ver técnico de Ratios). |
| Portada | `apps/general/lib/modulos.ts` | `RUTAS_MODULO.pyg` y `RUTAS_MODULO.pyg_pruebas`. |
| Excel de A3 | Storage, bucket privado **`pyg`**, fichero **`datos.xlsx`** | Lo lee PyG Socios (y PyG Pruebas para Comparar y Pool; Presupuesto para su carga inicial). |

Mapa del JS (busca por nombre):

| Bloque | `pyg.html` | `pyg-pruebas.html` |
|---|---|---|
| Arranque | `autoLoad()` → `downloadFromSupabase()` → `processWorkbook()` → `parseWorkbook()` | `autoLoad()` (lee la base), `cargarA3()`, `cargarTesoreria()` |
| Subida | `openAdmin()`, `setAdminFiles()`, `classifySheet()`, `doUpload()`, `uploadToSupabase()` | (no se usa: no hay botón de subida) |
| Parsers | `parseSumasYSaldos()`, `parseSumasYSaldosBalance()`, `parsePorProveedor()`, `parsePresupuesto()`, `parsePDC()`, `parsePool()`, `parseTesoreria()`, `numA3()`, `CC_MAP` / `centroToCanal()` | los mismos, solo para el Excel de A3 |
| En vivo desde Ratios | `refreshVentasRatios()` / `fetchVentasRatios()`, `refreshMercadoInterno()` / `fetchMercadoInternoLive()` | solo `refreshMercadoInterno()` |
| Simulación | `tarifaMI`, `MI_T25_RATIO`, `factorMI()`, `setTarifaMI()` | igual |
| Pintado | `refresh()`, `aggregate()`, `buildMetrics()`, `buildPYGTable()`, `buildGroupedRows()`, `buildCentrosRows()`, `buildProveedoresRows()`, `buildNegocioTable()`, `buildRatios()`, `buildEvolucionCharts()`, `buildBalance()`, `buildTesoreria()`, `buildPool()` | igual + `buildComparar()`, `saldoFinalDia()` |
| Conciliación | `saldoPorCuenta()`, `conciliarProveedor()`, `renderConcilBanner()` | igual (con datos de Contabilidad) |
| Exportar | `exportExcel()` (hojas «PyG cuenta-centro» y «Detalle proveedor»), `exportPresupuesto()` | igual |

## 3. Datos

### 3.1 PyG Socios: `datos.xlsx` (bucket `pyg`)

Hojas que entiende (nombre canónico; al subir se reconocen **por su contenido**, `classifySheet()`):

| Hoja | Contenido | Se actualiza desde «Actualizar datos» |
|---|---|---|
| `SUMAS Y SALDOS` | Sumas y Saldos de A3: `EJERCICIO`, `CANAL`, `CUENTA`, descripción y una columna por mes (ENERO…DICIEMBRE). Cuentas 6/7 → PyG (las 7 con signo invertido); cuentas 1-5 → Balance. **Obligatoria.** | Sí |
| `POR PROVEEDOR` | Listado de facturas de A3 por proveedor (`CUENTA`, `NOMBRE PROVEEDOR`, `CENTRO_COSTE_1`, `BASE…`, `FECHA CONTABLE` o `FECHA`). Detalle nivel 3 (cuenta → centro → proveedor). | Sí |
| `NOMINAS` | Se reconoce y se guarda, pero el PyG no la usa. | Sí |
| `TESORERIA` | Cobros y pagos previstos (`TIPO`, `CONCEPTO`, `VENCIMIENTO`, `IMPORTE`) y saldos. | Sí |
| `POOL BANCARIO` | Préstamos: capital pendiente y cuotas por año. | Sí |
| `PRESUPUESTO` | Presupuesto mensual por `CUENTA` × `CANAL`. | **No (protegida)** |
| `PLAN DE CUENTAS` | Cuenta → grupo (`ID GRUPO CUENTAS`, descripción del grupo) y `TIPO CUENTA` (`MERCADO INTERNO` marca las 4 cuentas internas). | **No (protegida)** |
| `MERCADO INTERNO` | Respaldo del mercado interno por si falla la consulta en vivo. | **No (protegida)** |

`CC_MAP` traduce el centro de coste numérico de A3 a canal: 1 ESTRUCTURA, 2 BODEGA, 3 PRODUCCION,
4 BINIFADET, 5 TIENDA, 6 TAMARINDOS, 7 TAMARINDOS BAR, 8 TIRANT. Lo que no tiene centro va a
ESTRUCTURA.

Storage: bucket `pyg` privado; políticas `pyg_sesion_select` y `pyg_sesion_write` para
`authenticated` (sin filtro de cuenta).

### 3.2 Lo que PyG Socios lee en vivo de la base

| Consulta | Para qué |
|---|---|
| `ingresos?select=centro,familia,base,mes` (tabla de Ratios) | **Ventas 700**: sustituye las 700* del A3 (menos las internas) por las ventas de Ágora con su centro correcto, por familia: COMIDA 700000200, VINO 700000100, BEBIDAS 700000300, ALCOHOLES 700000400, VINO EXT 700000500, VISITAS 700000600, VARIOS/ENVIOS 700000700. Las demás 7xx (708, 740, 755, 778…) siguen siendo las del A3. |
| `gastos?proveedor=ilike.*intern*` (vista de Ratios) | **Mercado interno** (§4.3). |

Si cualquiera de las dos falla, se queda lo del Excel (silencioso).

### 3.3 PyG Pruebas: lo que lee

| Consulta | Para qué |
|---|---|
| RPC `fin_informe_mensual(p_anio)` (año en curso) | Apuntes de Contabilidad por cuenta, fecha y `centro_id`: cuentas 6/7 → PyG (6 = debe − haber; 7 = haber − debe), cuentas 1-5 → Balance (la apertura va el 1 de enero). Sin centro → ESTRUCTURA. |
| `centros` | `centro_id` → canal por nombre (`CENTRO_CANAL_NOMBRE`: BINIFADET RESTAURANTE → BINIFADET, CASA TIRANT → TIRANT, COCINA PRODUCCION → PRODUCCION…). |
| `pre_cuentas` | Grupos de cuentas y qué cuentas son de mercado interno (en vez de la hoja PLAN DE CUENTAS). |
| `v_pre_pyg_mensual` (año en curso) | Presupuesto: versión **vigente** del módulo Presupuesto. |
| `compras_doc` (facturas en estado OK del año) + `compras_a3_lineas` | Detalle por proveedor (nivel 3), por **fecha de factura**. |
| `ingresos` (Ratios, año en curso) | **Ventas 700 en vivo** desde el 08-11-2026, igual que PyG Socios: sustituyen a las 700 de Contabilidad (que se asientan a mano desde el listado de Ágora y se quedan atrás) y traen el desglose por familia (vino, comida, bebidas, alcoholes, visitas…). El resto de 7xx (708, 740, 755, 778…) sigue de Contabilidad. Si la consulta falla, se mantienen las 700 de Contabilidad. |
| `gastos` (`ilike *intern*`) | Mercado interno en vivo, igual que PyG Socios. |
| `fin_bancos_cuentas`, `fin_banco_movimientos` | Saldo de cada banco: último día del extracto; el saldo final se resuelve por la cadena saldo − importe (`saldoFinalDia()`) porque el orden dentro del día del N43 no es fiable. |
| `fin_vencimientos` (pendientes) + `compras_doc` / `fin_asientos` | Cobros y pagos pendientes agrupados por proveedor/cliente y mes; lo no liquidado y ya pasado sale como «VENCIDO». |
| `datos.xlsx` (bucket `pyg`) | Solo para la pestaña **Comparar con PyG Socios** (Sumas y Saldos de A3) y para **Pool bancario** (Contabilidad no tiene cuadro de préstamos). |

### 3.4 Cuentas del mercado interno

En `pre_cuentas` y en la hoja PLAN DE CUENTAS con tipo `MERCADO INTERNO` (grupos 6001 / 7001):
`600000101` compras internas vino, `600000201` compras internas comida, `700000101` ventas internas
vino, `700000201` ventas internas comida.

### 3.5 Migraciones

No hay tablas propias de PyG. Lo que usan viene de: el port del 24-08 (Storage `pyg`), Contabilidad
(`apps/finanzas/supabase/migrations/20260817195013_fin_f5c_informe_mensual.sql` y siguientes),
Presupuesto (`apps/general/supabase/migrations/20260915040825_presupuesto_v1.sql`) y Ratios. Los
módulos `pyg` y `pyg_pruebas` están en `modulos` (área Análisis) y contratados solo por Bonita Menorca.

## 4. Flujos principales

### 4.1 Abrir PyG Socios

1. `/pyg` valida acceso y sirve el HTML.
2. `autoLoad()` descarga `datos.xlsx` con `?v=<hora>` y `no-store` (el CDN de Storage cacheaba ~1 h).
3. `parseWorkbook()` monta `D = {pyg, pre, pdc, canales, balanceRows, pool, tes, prov, provIndex,
   saldoCuenta}`. Si falta `SUMAS Y SALDOS`, pantalla «El fichero no es válido».
4. Pinta y, en segundo plano y **en serie**, `refreshVentasRatios()` y luego `refreshMercadoInterno()`
   (en serie para no pisarse sobre `D.pyg`).
5. Recarga sola a los 50 min o al primer 401.

### 4.2 Actualizar datos (solo PyG Socios)

«Actualizar datos» → se pueden subir **varios Excel a la vez** (Sumas + proveedores juntos) →
`classifySheet()` reconoce cada hoja por sus cabeceras → se descarga el `datos.xlsx` actual y se
**funden** solo las hojas reconocidas y no protegidas → se sube el libro fundido (`x-upsert`) → aviso de
**conciliación 2/6** → recarga la vista.

- PRESUPUESTO, PLAN DE CUENTAS y MERCADO INTERNO están **blindadas** (14-09): una carga de datos no
  puede revertirlas. Hoy no hay forma de actualizarlas desde la pantalla (ver §8).
- Si el listado de proveedores no trae «Fecha contable», avisa y reparte por «Fecha».
- Los importes de A3 con coma decimal como texto se leen con `numA3()` (16-09; antes se perdían los
  céntimos).

### 4.3 Mercado interno

- **Qué es**: ventas internas de **Producción** (comida) y **Bodega** (vino) a los demás centros, y las
  compras internas de cada centro. No existen en la contabilidad oficial (se eliminan al consolidar):
  es una capa de gestión para que el PyG por centro sea realista.
- **De dónde sale**: vista `gastos` de Ratios, filas cuyo proveedor contiene «intern» —
  `BODEGA (INTERNO)` (vino) y `PRODUCCION (INTERNA)` (comida)—, que son los albaranes internos
  registrados en Compras. Cada compra interna de un centro genera **en espejo** una venta interna de
  Bodega o Producción: cuadran al 100 % por construcción.
- **Cómo**: `fetchMercadoInternoLive()` agrega por centro y mes y sustituye en `D.pyg` las 4 cuentas
  internas. Sin cron: se mueve cuando se mueve Compras/Ratios.
- **Consolidado**: en el canal **TODOS** se excluyen las cuentas internas (`aggregate(…, excl)` con
  `isInterno()`), para no inflar ingresos ni gastos; el resultado del grupo no cambia. Por centro sí se
  ven.
- **Simulación de tarifa interna de vino** (selector «Tarifa interna vino»): `tarifaMI` 0 = real 2026,
  0,5 = «Propuesta (½ rebaja)», 1 = «Tarifa 2025». Multiplica las compras internas de vino de cada centro
  por `factorMI(canal, mes)`, sacado de `MI_T25_RATIO` (ventas internas a tarifa 2025 ÷ reales, calculado
  con los albaranes internos de Ágora abr–sep 2026; meses sin dato → media del canal). Es un traspaso de
  margen Bodega ↔ centros: en TODOS no cambia nada.
- No confundir con Ratios: allí las salidas de Producción entran como compra **negativa** en PRODUCCION
  (proveedor «→ CENTRO»); esas filas no contienen «intern» y el PyG no las cuenta.

### 4.4 Ratios del PyG

`buildRatios()` al pie de Resumen, PyG completo y Evolución (y por centro en la vista Por negocio):
**EBITDA** (resultado + amortizaciones + financieros) en € y %, **ratio de compras** = cuentas 600 + 602
÷ ingresos, **ratio de personal** = 640 + 642 ÷ ingresos; mes a mes, acumulado hasta «Mes hasta» y fila
de presupuesto. Denominador = ingresos 7xx del canal (internos incluidos; en TODOS ya excluidos).
Estructura no lleva ratio de compras ni de personal (no vende), sí su EBITDA.

### 4.5 Conciliación 2/6

Compara, por cuenta de los grupos 2 y 6, el saldo del Sumas y Saldos con la suma de bases del detalle
por proveedor. Banda verde si cuadran todas; ámbar con la lista de descuadres (clic para ver). En 2x
suelen ser altas de inmovilizado por asiento; en 6x, apuntes sin factura. Es informativa: nunca bloquea.

### 4.6 PyG Pruebas

1. `autoLoad()` lee en paralelo informe, centros, `pre_cuentas`, presupuesto, facturas y líneas A3.
2. Monta el mismo `D` que PyG Socios (sin `pool` ni `tes` al principio) y pinta.
3. En segundo plano: mercado interno, `cargarA3()` (Comparar + Pool) y `cargarTesoreria()`.
4. **Comparar con PyG Socios**: por grupo y mes, Contabilidad vs A3 hasta «Mes hasta»; tabla de
   **cuentas que A3 tiene y Contabilidad no** («huecos»: lo que Contabilidad tiene que empezar a asentar
   por sí misma) y al revés.

### 4.7 Integraciones y crons

Sin APIs externas ni crons. Fuentes: A3 (Excel subido a mano), Ratios (Ágora + Compras), Contabilidad,
Presupuesto.

## 5. Permisos

- Módulos `pyg` y `pyg_pruebas` (área Análisis). Puerta: `exigirModulo` en cada ruta.
- `ACCESO_POR_ROL`: **ningún rol salvo `direccion`** los trae de serie. Cualquier otra persona necesita
  concesión expresa en Usuarios.
- En la base no hay más control que la sesión: el bucket `pyg` y las tablas de Ratios aceptan a cualquier
  usuario autenticado (ver técnico de Ratios §8).

## 6. Decisiones y por qué

| Fecha | Decisión | Por qué |
|---|---|---|
| 17-08-2026 | La app de un fichero `pyg-socios` se integra como módulo `pyg`; se quitan su pantalla de contraseña y su clave de administración. | Una sola puerta de acceso (Hostelero). |
| 24-08-2026 | `datos.xlsx` se muda al bucket privado `pyg` de Hostelero. | Port completo; la app vieja queda obsoleta. |
| 10-09-2026 | Botones para descargar PyG y presupuesto en Excel. | Trabajo fuera de la app. |
| 11-09-2026 | La subida **funde por conceptos** en vez de reemplazar el libro entero. | Una recarga de Sumas machacaba el presupuesto. |
| 14-09-2026 | PRESUPUESTO y PLAN DE CUENTAS blindados en la subida. | Que una carga de datos no pueda revertirlos. |
| 14-09-2026 | Aviso de conciliación 2/6. | Detectar facturas que faltan en el listado de proveedores. |
| 14-09-2026 | **Mercado interno** (hoja) y el mismo día **en vivo** desde Ratios. | Que Producción y Bodega no salgan en pérdidas y los centros carguen el coste del producto interno. |
| 14-09-2026 | **Ventas 700 en vivo desde Ratios.** | A3 tenía mal el centro de algunas ventas (cruce Tamarindos/Bar de abr–jun); Ágora lo tiene bien y conserva el desglose por familia. |
| 15-09-2026 | Nace **PyG Pruebas**, solo con datos de Contabilidad (+ Presupuesto y Compras), para compararlo cada mes con PyG Socios y **sustituirlo a fin de año**. | Dejar de depender de A3. A 15-09 los ingresos de enero-agosto cuadraban al euro con A3; los gastos tenían huecos conocidos (alquileres sin factura, amortizaciones, gestoría, seguros, comisiones y tributos). |
| 15-09-2026 | Bloque de ratios (EBITDA, % compras, % personal) en las dos apps; Estructura sin ratios de compras/personal. | Lectura rápida para socios. |
| 08-11-2026 | **PyG Pruebas: ventas 700 en vivo desde Ratios** (como ya hacía PyG Socios y como llegan las nóminas). El Balance sigue calculando el resultado con la foto de Contabilidad (`D.pygContab`) para cuadrar con las cuentas 1-5. | Las ventas de Contabilidad se cargan a mano desde Ágora y estaban paradas en el 12-10; Ratios las tiene al día. |
| 16-09-2026 | Selector de tarifa interna de vino. **Decisión de dirección: la tarifa interna 2026 no se cambia** (queda poca temporada); el selector se queda como herramienta de análisis. | En 2026 la tarifa interna bajó ~40 % y hundió la explotación de Bodega. |
| 16-09-2026 | El listado de proveedores se reparte por **Fecha contable**; varios Excel a la vez; descarga sin caché del CDN; coma decimal. | Cuadrar con Sumas y Saldos; comodidad; se veía el Excel anterior; céntimos perdidos. |
| 16-09-2026 | **Nunca** reconstruir `datos.xlsx` con openpyxl (u otra librería que pierda valores calculados) y subirlo. | Las hojas TESORERIA y POOL BANCARIO tienen fórmulas; openpyxl pierde los valores cacheados y el PyG las ve vacías. La carga buena es por el botón «Actualizar datos». |
| Plan 2027 | Mercado interno leído del **TPV nuevo** (albaranes internos de Bodega y Producción dentro de Hostelero) con precio por producto parametrizable, no del precio fijado en el albarán. | Poder recalcular la tarifa interna a posteriori sin implicar a nadie. |

## 7. Operación

- **PyG Socios**: cada mes, administración exporta de A3 el Sumas y Saldos y el listado de facturas
  por proveedor (con «Fecha contable») y los sube juntos con «Actualizar datos». Revisar la banda de
  conciliación.
- **PyG Pruebas**: no se carga nada; se alimenta de Contabilidad, Compras y Presupuesto. Revisar cada mes
  la pestaña Comparar.
- **Presupuesto de PyG Socios**: está en la hoja protegida PRESUPUESTO; cambiarlo hoy exige que alguien
  técnico reescriba esa hoja respetando la regla de openpyxl (procedimiento **por confirmar**). PyG
  Pruebas ya lee el presupuesto vigente del módulo Presupuesto.
- Qué vigilar: banda de conciliación ámbar; que la etiqueta inferior de estado diga «Actualizado …» (o
  «Contabilidad …» en Pruebas) y no «Sin datos»/«Error»; en la consola, fallos de `refreshVentasRatios`
  o `refreshMercadoInterno` (son silenciosos en pantalla).
- Variables de entorno (solo nombres): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## 8. Riesgos, limitaciones y pendientes

1. **Cambio de año**: `pyg.html` tiene «2026» escrito (etiqueta de periodo, «PyG Socios · 2026», botones
   de tarifa). `fetchVentasRatios()` y `fetchMercadoInternoLive()` agrupan **solo por mes, sin año**:
   hoy funciona porque `ingresos` y `gastos` solo tienen 2026, pero en 2027 mezclarían años si no se
   filtra. `parseSumasYSaldos()` tampoco filtra por `EJERCICIO`: un Sumas con dos ejercicios se sumaría.
   PyG Pruebas usa el año del reloj (`ANIO = new Date().getFullYear()`): el 1 de enero mostrará un año
   vacío.
2. La hoja PRESUPUESTO de PyG Socios no se puede actualizar desde la pantalla (§7).
3. Los dos HTML se mantienen **a mano por separado**: cada arreglo de interfaz hay que hacerlo dos veces.
4. Bucket `pyg`: sus políticas solo exigen sesión (sin filtro por cuenta ni por módulo). Arreglar antes de abrir PyG a otra empresa.
5. Lecturas en vivo paginadas de 1.000 en 1.000 y en serie (`fetchVentasRatios` baja ~68.000 ventas cada
   vez): lento. Mejor una vista agregada por centro/familia/mes.
6. Los fallos de las lecturas en vivo son silenciosos: si fallan, se ven las 700 del A3 sin aviso.
7. `MI_T25_RATIO` es una tabla fija (abr–sep 2026). Si cambia la tarifa en Ágora, recalcularla o
   retirar el selector.
8. PyG Pruebas: con la clave de servicio en local, `fin_informe_mensual` incluye la cuenta Sandbox (en
   producción el token del usuario lo filtra). Ventas 700 de Contabilidad sin desglose por familia
   (todo en 700000000): decidir si se desglosa con Ratios. Pendiente un botón para asentar en
   Contabilidad los huecos mensuales (amortizaciones, alquileres sin factura, seguros, IBI).
9. Comentarios de cabecera desfasados: los dos HTML dicen que los datos están «en el Storage del
   proyecto Ratios» y el de Pruebas dice que se sirve en `/pyg`.

## 9. Cómo tocarlo sin romper nada

- Cambio de interfaz: hazlo en `pyg.html` **y** en `pyg-pruebas.html`, salvo que sea propio de una.
- No toques la subida para que escriba hojas protegidas sin que dirección lo decida; y no generes
  `datos.xlsx` con librerías que pierdan valores de fórmulas.
- Mercado interno: la regla es «proveedor contiene intern». Si se da de alta otro proveedor interno o se
  renombra uno en Compras, revisa `fetchMercadoInternoLive()` (distingue vino por «BODEGA» y comida por
  «PRODUCC») y la vista `v_gastos_real_mes` del Presupuesto (`'%(INTERN%'`).
- Nuevas cuentas de venta por familia: `VENTA_FAM_CUENTA` y `VENTA_CUENTA_DESC` en `pyg.html`, y
  `pre_familias` en la base.
- Si cambian los centros: `CC_MAP` (A3), `CENTRO_CANAL_NOMBRE` (Pruebas) y `normalizeCanal()`.
- Para la sustitución de fin de año: el plan es que `/pyg` pase a servir lo de Pruebas (o que la tarjeta
  de PyG Socios apunte a Pruebas). Antes, cerrar los huecos de la pestaña Comparar y resolver §8.1.
- Base de datos: las reglas generales (migraciones aditivas, `(select cuenta_actual())`, revocar
  `execute` a `anon`/`public`, regenerar `packages/db/types.ts`) están en el técnico de Ratios §9.
