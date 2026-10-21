# Ratios · documentación técnica

> Parte trasera del módulo Ratios (Ratios Food Cost): cómo está programado y por qué. Escrito el
> 04-10-2026 a partir del código (`main`, commit `1b2490b`), la base `hostelero` (proyecto Supabase
> `jwsvkjyjwocuksdgiqnv`), el historial de git y las notas de dirección. Para el uso diario, ver el
> manual: [`docs/manual/ratios.md`](../manual/ratios.md).

Documentos previos que siguen valiendo (aquí solo se resume lo que toca a Ratios):

| Documento | Qué tiene |
|---|---|
| [`docs/rrhh-v2-entrega.md`](../rrhh-v2-entrega.md) | Cómo Personal sustituye a Skello y por qué Ratios lee las horas en vivo (vista `rrhh_desde_personal`). |
| [`docs/reservas-v2-entrega.md`](../reservas-v2-entrega.md) | Camino Cover → Reservas → Ratios (vista `comensales_desde_reservas`) y carga del informe de Cover. |
| [`docs/tecnico/pyg.md`](pyg.md) | PyG Socios / PyG Pruebas, que leen ventas y mercado interno de las tablas de Ratios. |
| [`docs/tecnico/presupuesto.md`](presupuesto.md) | Módulo Presupuesto: genera el Excel de presupuesto que se carga en Ratios. |

---

## 1. Para qué sirve y estado

Cuadro de mando de **food cost** y explotación por centro: cruza las ventas (Ágora) con las compras
(módulo Compras, en vivo) por centro, familia y subfamilia, contra el presupuesto y contra el año
anterior. Añade personal (nóminas de la gestoría + horas de Personal), comensales (Reservas), visitas
(Codetickets), inventarios y stock teórico, ecommerce (Shopify) y una carpeta de documentos. Además es
el **motor del asiento de nóminas** que se empuja a Contabilidad.

**Estado: operativo** (`modulos.madurez = 'operativo'`, área Análisis). Lo usa a diario el equipo de
administración y los responsables de área de Bonita Menorca. Contratado también por Bonita Pruebas,
Bonita Sandbox y una cuenta externa en pruebas (sin usuarios), **pero sus datos no están separados por cuenta** (ver §3.6 y §8): hoy
solo tiene sentido para Bonita Menorca.

## 2. Dónde vive

| Pieza | Ruta | Qué hace |
|---|---|---|
| Ruta | `/ratios` → `apps/general/app/ratios/route.ts` | `exigirModulo("ratios")` y sirve el HTML con URL, clave publicable, token de sesión y `cuenta_id` inyectados (`__SUPABASE_URL__`, `__SUPABASE_ANON__`, `__SB_TOKEN__`, `__CUENTA_ID__`). |
| Servidor de HTML | `apps/general/lib/html-modulo.ts` | `servirHtmlModulo()`: cabecera `no-store` y **vigilante de versión** (consulta `/api/publico/version` al volver a la pestaña y cada 10 min; si hay despliegue nuevo pinta una banda «Hay una versión nueva…», nunca recarga solo). |
| La app | `apps/general/datos/ratios.html` (~630 KB) | Una sola página: CSS + HTML + JS. Versión visible abajo a la izquierda (`APP_VERSION = '2026-09-29.1'`). Librerías por CDN: SheetJS 0.18.5 y Chart.js 4.4.1 (cdnjs). |
| Portada | `apps/general/lib/modulos.ts` (`RUTAS_MODULO.ratios`) | Activa la tarjeta y `/m/ratios`. |
| Scripts | `scripts/migrar-ratios.mjs` | Mudanza del 24-08-2026 desde el Supabase antiguo de Ratios. Histórico; no se vuelve a usar. |
| Scripts que alimentan Ratios indirectamente | `scripts/cargar-skello-informe.mjs`, `scripts/cargar-cover-tracking.mjs` | Cargan Skello en Personal y Cover en Reservas; Ratios lo lee en vivo. Ver sus documentos. |

Mapa del JS de `ratios.html` (busca por nombre de función; los números de línea cambian):

| Bloque | Funciones / constantes |
|---|---|
| Conexión | `SB_URL`, `SB_KEY`, `SB_TOKEN`, `sbFetch()`, recarga a los 50 min o al primer 401. |
| Carga inicial | `loadFromStorage()` (todo en paralelo), `sbTodas()` (paginado con `count=exact`, páginas de 8 en 8), `loadIngresosRapido()`, `loadGastosRapido()`, `loadCached()`, `marcarDatosListos()`. |
| Guardado | `saveToStorage(tabla, {nuevas, borradas, editadas})` — incremental, nunca escribe en `gastos`. |
| Carga de Excel | `handleXlFiles()` → `handleXlFile()` (detección de pestañas, `FIRMAS`, parsers, `borrarRango`, `borrarOrigen`, `insertAll`). Cargador de Skello aparte: `handleSkelloFiles()`. |
| Clasificación | `rebuildProductIndex()`, `resolveIng()`, `resolveGas()`, `importarHuerfanos()`, `updateProductoFam/Sub/Factor()`. |
| Compras | `FECHA_CORTE_COMPRAS = '2026-08-01'`, `CANAL_COMPRAS` / `canalCompras()` (nombres de centro de Compras → código de Ratios). |
| Ajustes de ventas | `AJUSTES_INGRESOS` + `aplicarAjustesIngresos()`: reubican en memoria ventas facturadas en una fecha distinta a la del servicio. |
| Personal | `nominasEfectivas()`, `nominasCosteCentro()`, `presupuestoNominasCentro()`, reparto (`saveReparto()`, `initRepartoNominas()`). |
| Asiento de nóminas | `_buildAsiento()`, `renderAsiento()`, `descargarAsientoExcel()`, `CANAL_CENTRO`, `ASIENTO_CTA`, `_lineasAsiento()`, `_enviarMes()`, `enviarAsientoContabilidad()`, `enviarAsientoTodos()`. |
| Stock | `stockAtFamilia()`, `stockAtSubfamilia()`, `ratioAjFamilia()`, `invalidateStockCache()`. |
| Estado de los datos | `pintaFrescura()`. |
| Colores | `rcol` (food cost: ≤25 % verde, ≤35 % ámbar, >35 % rojo), `rcolP` (personal: ≤30 / ≤40 / >40). |

## 3. Datos

Todas las tablas viven en `public` del proyecto `hostelero` **con su nombre original** (se mudaron tal
cual el 24-08-2026) y **sin columna `cuenta_id`**.

### 3.1 Ventas

| Objeto | Qué es | De dónde sale |
|---|---|---|
| `ingresos` | Líneas de venta del año en curso (≈68.000 filas en 2026): `fecha` (texto `YYYY-MM-DD`), `centro`, `canal`, `articulo` (ID de producto Ágora), `descripcion`, `familia`, `subfamilia`, `cantidad`, `base`, `unidades` (= cantidad × factor), `semana`, `mes`, `created_at`, `modificado_at`. | Excel **AGORA** desde «📂 Cargar Excel». Trigger `ingresos_modificado` (`ingresos_tocar_modificado`) mantiene `modificado_at`. |
| `ingresos_historico` | Ventas de 2024 y 2025 (≈110.000 filas). | Pestaña `INGRESOS AAAA` del Excel; se vacía y se recarga entera. Cambia una vez al año. |
| `productos_agora` | Catálogo de productos de venta: `id_prod`, `producto`, `familia`, `subfamilia`, `factor`. **Fuente de verdad** de la familia. | Pestaña Clasificación (manual) e «Importar al catálogo» de huérfanos. |
| `ratios_sello_ingresos()` | RPC: `{n, max_mod}` (recuento y último `modificado_at`). | Sello de la caché del navegador. |

### 3.2 Compras (conexión viva con Compras)

| Objeto | Qué es |
|---|---|
| `gastos` (**vista**) | Compras de todo el año desde el módulo Compras. Cuatro bloques `UNION ALL`: (1) cada línea de **albarán** (`compras_doc.tipo = 'albaran'`, `fecha >= 2026-01-01`, sin `estado_detalle = 'DUPLICADO'`) con su centro por `mapa_centro()` y familia/subfamilia/factor del catálogo `productos_dijit` vía `compras_producto.codigo_interno`; (2) una fila de **ajuste** por albarán cuando `|base − Σ líneas| > 0,15 €` (descuentos de pie, redondeos); (3) **salidas de Producción en negativo**: cada línea de los albaranes del proveedor interno de Producción se repite con signo menos en el centro `PRODUCCION` (proveedor `→ CENTRO`); (4) el espejo negativo de los ajustes de esos albaranes. Ids negativos (hash estable). Si un producto no está en el catálogo, cuenta como **COMIDA / VARIOS**. Las facturas no entran (duplicarían su albarán). |
| `mapa_centro(text)` | Traduce los centros de coste de Compras (BINIFADET RESTAURANTE, CASA TIRANT, COCINA PRODUCCIÓN…) a los códigos de Ratios (BINIFADET, TIRANT, PRODUCCION…). Su gemela en JS es `CANAL_COMPRAS`: si cambias una, cambia la otra. |
| `gastos_cache` (vista materializada) | Copia de `gastos`. Solo `select` para `authenticated`. |
| `ratios_cache_estado` | Fila `clave='gastos'` con `sucio` y `refrescado_at`. RLS sin políticas (solo la tocan funciones `security definer`). |
| Triggers `zz_gastos_cache_sucio` | Por **sentencia** en `compras_doc`, `compras_linea`, `compras_producto`, `compras_proveedor` y `productos_dijit`: marcan la caché sucia (`gastos_cache_marcar_sucio`). |
| `gastos_cache_asegurar()` | RPC `security definer`: si está sucia, refresca la vista materializada (con `pg_advisory_xact_lock`) y devuelve `refrescado_at`, que es el sello de la caché del navegador. |
| `productos_dijit` | Catálogo de productos de compra (`id_interno` = código `P-xxxxx` de Compras, `familia`, `subfamilia`, `factor`, `origen`). El nombre es herencia de Dijit; hoy todos son `origen = 'COMPRAS'`. |
| `compras_producto` | Solo lectura: Ratios cruza `codigo_interno → proveedor_nombre` para la columna Proveedor de la clasificación. |
| `z_gastos_dijit_jubilado`, `z_productos_dijit_jubilado` | Archivo del histórico Dijit (01-09-2026). No los lee nadie; se pueden borrar cuando dirección lo diga. Ojo: `z_productos_dijit_jubilado` no tiene RLS y `anon` la puede leer (ver [plataforma.md](plataforma.md) §0). |
| Trigger `trg_gastos_escribir` (INSTEAD OF en `gastos`) | **Muerto**: escribe en `gastos_dijit`, que ya no existe. Cualquier escritura sobre la vista fallaría. El JS no escribe nunca en `gastos`, así que no molesta, pero conviene retirarlo. |

### 3.3 Presupuesto, personal y horas

| Objeto | Qué es | De dónde sale |
|---|---|---|
| `presupuesto` | Venta presupuestada diaria por centro y familia (`fecha` texto, `centro`, `familia`, `importe`). | Excel **PRESUPUESTO INGRESOS** (lo genera el módulo Presupuesto). Se vacía entera y se recarga. |
| `presupuesto_nominas` | Coste de personal presupuestado por `canal` × `depto` × `mes`. | Excel **PRESUPUESTO NOMINAS** (módulo Presupuesto). Se vacía entera. |
| `nominas` | Export de la gestoría, una fila por trabajador y concepto: `anio`, `mes`, `canal`, `depto`, `dni`, `nombre`, `categoria`, `dias`, `horas`, `sueldo`, `total_devengado`, `liquido`, `coste_ss`, `coste_total`, `concepto` (Nómina / Finiquito / Indemnización / Paga retroactiva), `cuota_obrera`, `irpf`, `embargos`, `anticipo`, `anticipo_autonomo`, `anticipo_manutencion`, `anticipo_alojamiento`. **Datos personales sensibles.** | Excel **NOMINAS**. El parser lee por **nombre de columna** (desde el 03-09). **Se vacía entera**: el fichero tiene que traer todo el año. |
| `nominas_reparto` | Reparto fijo del coste de un trabajador entre centros (`dni`, `centro`, `porcentaje`). | Pestaña Salarios. |
| `nominas_reparto_horas` | Trabajadores (`dni`, `nombre`) cuyo coste se reparte cada mes según sus horas por centro. | Pestaña Salarios. |
| `rrhh_desde_personal` (vista, `security_invoker`) | Horas semanales por persona/centro/puesto calculadas en vivo desde Personal, con el mismo formato que `rrhh` (`dni` vacío: casa por nombre). Migración `20261001070000_rrhh_vista_ratios.sql`. | Módulo Personal. |
| `rrhh` | Horas semanales de respaldo (cargador de Skello de 8 ficheros). Ratios la usa **solo si la vista no devuelve filas o falla**. | Cargador de Skello (pestaña Cargar Excel). |
| `rrhh_excepciones`, `rrhh_puestos` | Personas a 40/40 fijo y reclasificación puesto → departamento. | «⚙ Configuración Fichajes». |

### 3.4 Comensales, visitas, inventario, ecommerce, documentos

| Objeto | Qué es | De dónde sale |
|---|---|---|
| `comensales_desde_reservas` (vista, `security_invoker`) | Comensales por día, centro y servicio (Comida/Cena) calculados desde `reservas_reservas`, con aforo del turno. Cubre desde la primera reserva de la temporada hasta hoy. Migración `20261001130000_reservas_cover_ratios.sql` (+ ajuste de «asistencia presunta» aplicado el 01-10). | Módulo Reservas. |
| `comensales` | Histórico (2025) y respaldo del Excel COVERMANAGER. Ratios usa la tabla **solo para los días anteriores** a la primera fecha de la vista. | Excel **COVERMANAGER** (borra solo los días que trae). |
| `comensales_nacionalidad_desde_reservas` (vista, `security_invoker`) | Reservas y comensales por día, centro, servicio y **país** (`WALKIN` para los walk-ins de Cover, ISO-2, o `??` si no se pudo deducir). Mismas reservas que la vista anterior (hasta hoy, sin canceladas ni no-show). La nacionalidad sale del **prefijo del teléfono** del cliente (9 cifras 6/7/8/9 = España); se corrigen los países que Cover adivina mal (VA→IT, VI→US, AF→ES). Sin datos personales. Migración `20261021120000_reservas_nacionalidad_ratios.sql`. | Módulo Reservas. |
| `visitas` | Entradas de visitas por día, evento, idioma, tipo y canal. | Excel **CODETICKETS** (borra solo los días que trae). |
| `familias`, `subfamilias` | Árbol de familias que usan todos los paneles. | Clasificación. |
| `ratios_objetivo` | Ratio objetivo por familia (para el stock teórico). | Inventarios › Ratios objetivo. |
| `productos_controlados` | Qué productos se cuentan en cada centro y quién (bloque COCINA/SALA). | Inventarios › Productos controlados. |
| `inventarios` | Conteos físicos por `fecha_cierre`, `centro`, `id_prod` con coste unitario (media de compras del año hasta la fecha). | Inventarios › Inventario mensual. |
| `ecommerce`, `ecommerce_historico` | Pedidos de Shopify (año en curso / anteriores). | CSV de pedidos de Shopify (se vacía `ecommerce` entera). |
| `doc_departamentos`, `doc_subcategorias`, `doc_documentos` + bucket `documentos` | Carpeta de documentos propia de Ratios (máx. 25 MB por fichero). | Pestaña Documentos. |

### 3.5 Funciones (RPC) que usa la página

| RPC | Para qué |
|---|---|
| `gastos_cache_asegurar()` | Refresca la caché de compras si Compras cambió y devuelve el sello. |
| `ratios_sello_ingresos()` | Sello de ventas para la caché del navegador. |
| `truncate_table(table_name)` | Vacía una tabla entera. La usa la carga de Excel para presupuesto, nóminas, presupuesto de nóminas, `rrhh`, `ecommerce` e `ingresos_historico`. Heredada del Ratios original; ver §8. |
| `fin_asiento_nominas(p_anio, p_mes, p_lineas)` | Crea el asiento de nóminas del mes en Contabilidad (ver §4.5). |

### 3.6 RLS

- Las tablas de Ratios tienen la política `ratios_sesion`: `authenticated`, `using (true)`, `with check
  (true)`. Es decir, **solo exige sesión**: no filtra por cuenta ni por módulo. `anon` no ve nada.
- La vista `gastos` y `gastos_cache` se ejecutan con permisos del propietario y **no filtran por cuenta**
  (todas las compras de `compras_*`).
- Las vistas `rrhh_desde_personal` y `comensales_desde_reservas` sí son `security_invoker` y filtran por
  `cuenta_actual()` a través de las tablas de Personal y Reservas.
- La puerta real del módulo es la ruta (`exigirModulo`), no la base.

### 3.7 Migraciones

| Fichero / registro | Qué hizo |
|---|---|
| `apps/finanzas/supabase/migrations/20260824013000_ratios_port_y_conexion_viva.sql` | Registro del port (24-08): 25 tablas copiadas, RLS `ratios_sesion`, primera vista `gastos` (Dijit + albaranes desde 01-08). El DDL se aplicó por MCP; el fichero es solo el acta. |
| Registradas en la base **sin fichero en el repo**: `20260901200033_jubilacion_dijit_gastos_solo_compras`, `20260901201455_gastos_salidas_produccion_en_negativo`, `20260902064309_carga_albaranes_internos_bodega`, `20260903112821_nominas_cuentas_gasto_y_push_asiento`, `20260903162223_nominas_asiento_confirmar_y_reemplazo_seguro` (y varias `dijit_*` del reproceso del 01-09). | Ver §6. Su SQL está en `supabase_migrations.schema_migrations.statements`. Si se pasan a fichero, **revisar antes**: la de albaranes internos de Bodega contiene un secreto temporal (ya inutilizado) que no debe ir a un repo público. |
| `apps/general/supabase/migrations/20260929100000_rls_initplan.sql` | Envuelve `cuenta_actual()`/`es_operador()` en `(select …)` en todas las políticas (rendimiento). |
| `apps/general/supabase/migrations/20260930120000_ratios_caches.sql` | `gastos_cache`, `ratios_cache_estado`, triggers de sucio, `gastos_cache_asegurar()`, `ingresos.modificado_at` + trigger, `ratios_sello_ingresos()`. |
| `apps/general/supabase/migrations/20261001070000_rrhh_vista_ratios.sql` | Vista `rrhh_desde_personal`. |
| `apps/general/supabase/migrations/20261001130000_reservas_cover_ratios.sql` | Vista `comensales_desde_reservas` (+ aforos por turno). |
| `apps/general/supabase/migrations/20261021120000_reservas_nacionalidad_ratios.sql` | Vista `comensales_nacionalidad_desde_reservas` (nacionalidad de las reservas para la pestaña Comensales). |

## 4. Flujos principales

### 4.1 Abrir la página

1. `/ratios` valida sesión, módulo contratado, rol, veto y concesión (`exigirModulo`); si no, 404.
2. El HTML arranca `loadFromStorage()`: lanza **en paralelo** todas las lecturas.
   - **Ventas**: `loadIngresosRapido()` pide el sello; si coincide con el guardado en IndexedDB
     (`ratios-cache`, clave `ingresos_v2:<cuenta_id>`) no descarga nada; si no, pide solo las filas con
     `modificado_at` reciente (10 min de margen), mezcla por id y contrasta ids vivos si hubo borrados.
     Cualquier duda → descarga completa.
   - **Compras**: `loadGastosRapido()` llama a `gastos_cache_asegurar()`; si el sello coincide con la
     copia del navegador (clave `gastos_v1`), no viaja nada; si no, lee `gastos_cache` en páginas de 10.000
     a la vez. Si la RPC no existe, cae a la vista `gastos`.
   - **Histórico**: `loadCached('ingresos_historico')` con sello `count + max(id) + max(created_at)`.
   - **Horas**: `rrhh_desde_personal`; si vacía o error → tabla `rrhh`.
   - **Comensales**: tabla `comensales` (días anteriores a la vista) + `comensales_desde_reservas`.
   - El resto, tal cual (`sbTodas`).
3. Aplica `aplicarAjustesIngresos()`, reconstruye índices y **re-resuelve la familia de cada venta y
   compra contra el catálogo** (`resolveIng` / `resolveGas`). El catálogo manda sobre lo guardado.
4. Pinta «Estado de los datos» y la pestaña Ingresos. A los 50 minutos (o al primer 401) la página se
   recarga sola para traer token nuevo.

Medidas del 30-09 en el navegador de dirección: primera apertura ≈5-6 s, aperturas siguientes ≈1 s.

### 4.2 Cargar Excel («📂 Cargar Excel»)

- Se pueden soltar varios ficheros; se procesan **en serie**. Si se sueltan antes de que acabe la carga
  inicial, quedan en cola (`datosListos`).
- Identificación de cada hoja, en este orden: (1) por **nombre de pestaña** normalizado (AGORA, DIJIT,
  COMPRAS, PRESUPUESTO INGRESOS, PRESUPUESTO, NOMINAS, PRESUPUESTO NOMINAS, CODETICKETS [año],
  COVERMANAGER [año], INGRESOS AAAA); (2) por **firma de columnas** (`FIRMAS`: exports originales de
  Ágora, App Compras, Dijit, gestoría, CoverManager, Codetickets); (3) por **nombre del fichero** si la
  pestaña se llama «Hoja1». El CSV de Shopify se detecta por sus columnas.
- Guarda de catálogo: si el catálogo de Ágora (o de compras) aún no se ha descargado, la carga se
  bloquea; si no, todo se clasificaría como VARIOS en silencio.
- Qué se sustituye en la base:

| Hoja | Política |
|---|---|
| AGORA | Borra **solo los días** que trae el fichero e inserta (lotes de 500). |
| CODETICKETS, COVERMANAGER | Borra solo los días que trae. |
| PRESUPUESTO INGRESOS, NOMINAS, PRESUPUESTO NOMINAS, SHOPIFY | `truncate_table` + inserta: **la tabla entera queda como el fichero**. |
| INGRESOS AAAA | `truncate_table('ingresos_historico')` + inserta. |
| DIJIT, COMPRAS | **Ignoradas**: las compras entran solas desde Compras. |
| Skello (8 ficheros, cargador aparte) | `truncate_table('rrhh')`. Respaldo: Ratios ya lee de Personal. |

### 4.3 Compras en vivo

Albarán validado en Compras → triggers marcan `gastos_cache` sucia → la siguiente apertura de Ratios
llama a `gastos_cache_asegurar()`, que la rehace (≈0,2 s) → el navegador detecta sello nuevo y descarga.
Cambiar la familia de un producto de compras en Clasificación (`productos_dijit`) también ensucia la
caché y reclasifica **todas** sus compras del año.

### 4.4 Food cost, ratio ajustado y stock teórico

- **Food cost** = compras / ventas de la misma familia, centro y periodo.
- **Stock teórico** (por familia o subfamilia) = último inventario físico (ancla) + compras desde
  entonces − ventas desde entonces × ratio objetivo de la familia.
- **Ratio aj.** = (compras − stock final) / ventas, **solo si hay un inventario físico** dentro del
  periodo; sin inventario se muestra el ratio bruto (restar un stock calculado con el propio ratio
  objetivo sería circular). Las subfamilias sin productos controlados usan siempre el ratio bruto.
- Producción: su neto = materia prima comprada − salidas valoradas a los centros (las salidas entran en
  negativo, §3.2). La columna «Internos» del detalle de Compras por familia las enseña.

### 4.5 Asiento de nóminas → Contabilidad

1. `_buildAsiento(mes, anio)` usa `nominasEfectivas({soloNominas:false})` (con reparto por centro y con
   finiquitos e indemnizaciones):
   - DEBE por centro: `640000000` Nómina (incluye pagas retroactivas), `640000001` Finiquito,
     `640000002` Indemnización, `642000000` SS empresa.
   - HABER (totales de empresa, sin reparto): `476.0` cuota obrera + SS empresa, `476.1` anticipo
     autónomo, `755.0` anticipo manutención, `755.1` **descuento de alojamiento** (residuo: devengado −
     deducciones declaradas; la gestoría lo resta del líquido pero no lo declara en ninguna columna),
     `465.0` líquido, `465.1` embargos, `465.2` anticipos, `4751.0` IRPF.
   - Redondeo a céntimos; la diferencia de redondeo se absorbe en la línea de DEBE mayor.
   - Si hay devengado pero faltan IRPF y cuota obrera, avisa (Excel sin re-subir) y no fuerza el cuadre.
2. «→ Enviar mes a Contabilidad» / «→ Enviar todo el año»: `_lineasAsiento()` convierte los códigos
   cortos a 9 dígitos (`ASIENTO_CTA`) y el canal a `centro_id` (`CANAL_CENTRO`, ids fijos de los centros
   contables de Bonita Menorca; OFICINA → Estructura). Se niega si no cuadra o hay cuentas sin mapear.
3. RPC `fin_asiento_nominas` (security invoker, cuenta por `perfiles` del usuario): busca **cualquier
   asiento del mes cuya descripción empiece por «Nómina»** (venga de A3 o de Ratios); si alguno tiene
   apuntes conciliados con banco, **se niega**; si no, lo borra (excepción acotada en
   `fin_asientos_proteger` vía `fin.rehacer_nomina`), crea «Nómina M/AAAA (Ratios)» con fecha fin de mes y
   **lo confirma** (`fin_confirmar_asiento`).
4. «⬇ Descargar Excel (A3)» sigue existiendo para la gestoría/A3 en paralelo hasta fin de 2026.

> Ojo: los textos de la pantalla todavía dicen que se envía «como BORRADOR» y que «los ya CONFIRMADOS
> se saltan». Eso era la primera versión (03-09 mañana). Desde la migración `20260903162223` el asiento
> entra **confirmado** y **sustituye** al del mes. A 04-10-2026 en Contabilidad hay asientos de nómina de
> Ratios confirmados de enero a agosto; septiembre está cargado en Ratios pero no enviado.

### 4.6 Reparto de nóminas

La gestoría imputa el 100 % de cada trabajador a un canal. `nominasEfectivas()` «explota» cada fila:
- **Porcentaje fijo** (`nominas_reparto`): N filas, una por centro, normalizando sobre la suma real.
- **Según horas** (`nominas_reparto_horas`): cada mes, en proporción a las horas reales por centro de
  `DB.rrhh` (que hoy sale de Personal). Casa por DNI y, si no hay, por nombre normalizado (la vista de
  Personal no trae DNI). Meses sin horas → 100 % en su canal.
- El total de la empresa nunca cambia. **Todo** consumo de nóminas por centro debe pasar por aquí.
- Por defecto excluye finiquitos e indemnizaciones (coste de personal «de explotación»); el asiento los
  incluye.

### 4.7 «Estado de los datos»

`pintaFrescura()`: último dato y última carga (`max(created_at)`) por fuente, con chip ✓ / ⚠:
Ventas y Compras contra el último día laborable (ámbar a 2 días, rojo a 5); Horas contra el lunes de la
última semana cerrada (7 / 14 días); Comensales y Visitas contra el último lunes o viernes (3 / 7). Las
compras muestran «⚡ último albarán», el resto «↑ subido».

### 4.8 Integraciones y crons

- Sin APIs externas (no usa Claude, Resend, etc.). Fuentes: export de Ágora, módulo Compras (vivo),
  Personal (vivo), Reservas (vivo), Excel de Codetickets, Excel de la gestoría, CSV de Shopify,
  Contabilidad (RPC del asiento).
- **Sin crons.** Todo se recalcula al abrir la página.

## 5. Permisos

- Módulo `ratios` (área Análisis). Se entra por la ruta con `exigirModulo("ratios")`.
- `ACCESO_POR_ROL` (`apps/general/lib/supabase/server.ts`): lo traen de serie **`direccion`** y
  **`responsable_area`**. `jefe_sala`, `administracion` y `empleado` solo con concesión en Usuarios. El
  veto por usuario manda sobre todo.
- Dentro de la página **no hay permisos por pestaña**: quien entra ve también Salarios y Asiento Nóminas
  (importes por trabajador) y puede enviar el asiento a Contabilidad. Decisión pendiente de dirección
  (ver §8). El comentario de cabecera de `ratios.html` («solo dirección») está desfasado.

## 6. Decisiones y por qué

| Fecha | Decisión | Por qué |
|---|---|---|
| 17-08-2026 | Ratios se sirve en `/ratios` con la sesión de Hostelero; se quita su contraseña propia. | Una sola puerta (módulo + rol). |
| 24-08-2026 | Port completo: 25 tablas a la casa con su nombre; las compras dejan de cargarse por Excel y llegan por la vista `gastos`. La hoja COMPRAS se ignora. | Primera integración real entre módulos; acabar con el Excel diario y con los duplicados. |
| 24-08-2026 | «Estado de los datos» enseña también cuándo se subió cada fuente. | Petición del equipo: Visitas/Comensales traen reservas futuras y la última fecha no decía nada. |
| 01-09-2026 | **Jubilación de Dijit**: `gastos` lee solo de Compras todo el año (ene-jul se reprocesó desde las fotos de los albaranes); `gastos_dijit` y su catálogo se archivan como `z_*`. | Una sola fuente de compras; Dijit desaparece. |
| 01-09-2026 | Las salidas de Producción a los centros entran como **compra negativa** en PRODUCCION. | Así Producción muestra su ratio real (materia prima − lo entregado), el grupo no cuenta dos veces la mercancía interna y no se inventan ingresos. |
| 02-09-2026 | Los albaranes internos de Bodega se cargan en Compras desde el export de Ágora (sin OCR). | Datos exactos para el mercado interno. |
| 03-09-2026 | NOMINAS se lee por nombre de columna; se recupera `anticipo_alojamiento`. | La gestoría metió una columna nueva y el parser por posición desplazó todo. |
| 03-09-2026 | El asiento separa Nómina / Finiquito / Indemnización en `640000000/1/2` (cuentas creadas ese día). | Poder presupuestar cada cosa por separado. |
| 03-09-2026 | El asiento se empuja directo a Contabilidad; esa misma tarde pasa a **confirmarse solo y sustituir** el asiento de nóminas del mes (A3 o Ratios), salvo conciliado. | Ratios es el motor del asiento (A3 era solo la copia); desde 2027 Ratios es la fuente. El Excel para A3 sigue en paralelo hasta fin de 2026. |
| 03-09-2026 | Alojamiento del personal = ingreso en 755 (neutro en PyG); OFICINA (solo existe en las horas) → Estructura. | Así cuadraba ya con la contabilidad; OFICINA no es centro contable. |
| 19-09-2026 | Visitas y comensales borran **solo los días** que trae la hoja. | Una hoja de 2026 con una fecha suelta de 2025 borró todos los comensales de 2025 (se recuperaron de un Excel antiguo). |
| 23-09-2026 | Las ventas de Ágora sustituyen solo los días del fichero; los Excel soltados antes de tiempo quedan en cola. | Un export corto dejaba el año sin ventas; los ficheros soltados pronto fallaban. |
| 29-09-2026 | Guardado incremental (fuera el `truncate` + re-subida de 66.000 filas al añadir una venta); políticas RLS envueltas en `(select …)`. | Lentitud y riesgo de dejar la tabla a medias. |
| 30-09-2026 | Carga en paralelo, `max rows` de PostgREST a 10.000, `gastos_cache` y caché de ventas en IndexedDB. | Ratios tardaba 8 s en abrir; ahora ≈1 s en aperturas repetidas. |
| 01-10-2026 | Horas en vivo desde Personal; comensales en vivo desde Reservas. Los cargadores de Skello y COVERMANAGER quedan de respaldo. | Fin de los Excel semanales de Skello y Cover. |
| 21-10-2026 | Pestaña Comensales: tabla «Reservas y comensales por nacionalidad» por centro (`renderComensalesNac`), con Walk-in aparte y **columna propia para cada país que en algún centro pase del 2 % de las reservas**; el resto va a «Resto países». La regla la aplica la pantalla (constante `NAC_UMBRAL`), la vista solo da el país. Enseña siempre todos los centros; respeta servicio, mes y fechas. | Luis quería ver en Ratios el informe de nacionalidades que se sacó a Excel. Cover no es fiable para el país (lo adivina por prefijo y se equivoca en bloque), por eso se deduce aquí. |
| — | La familia de cada venta/compra se resuelve **siempre** contra el catálogo al cargar. | Cargas hechas con el catálogo vacío dejaban todo en VARIOS. |
| — | Las ventas facturadas en otra fecha que la del servicio se reubican en memoria (`AJUSTES_INGRESOS`), sin tocar el dato crudo. | Quien carga sigue subiendo el export tal cual; la app corrige. |

## 7. Operación

| Qué | Quién / cuándo | Cómo |
|---|---|---|
| Ventas Ágora | Administración, a diario L–V | Export de Ágora «Ventas por producto y local» → «📂 Cargar Excel». |
| Nóminas | Administración, cada mes cuando llega el Excel de la gestoría | Excel NOMINAS **con todos los meses del año** → Cargar Excel. Luego Asiento Nóminas → enviar el mes. |
| Visitas | L y V | Export de Codetickets → Cargar Excel. |
| Presupuesto | Cuando dirección cambie el presupuesto | Módulo Presupuesto › «⬆ Descargar Excel completo (PyG + Ratios)» → cargar en Ratios (hojas PRESUPUESTO INGRESOS y PRESUPUESTO NOMINAS). |
| Ecommerce | Cuando se quiera actualizar | CSV de pedidos de Shopify → Cargar Excel. |
| Compras, horas, comensales | Solos | No hay que hacer nada. Si no se mueven, revisar Compras / Personal / Reservas. |
| Productos nuevos | Cuando salga el aviso «Hay N productos … que NO están en el catálogo» | Clasificación › «Importar al catálogo» y asignar familia/subfamilia/factor. |

Qué vigilar: chips ámbar/rojo de «Estado de los datos»; el aviso rojo del asiento («este mes no tiene
cargados los importes de IRPF…»); productos huérfanos; la consola del navegador (`[caché]`, `[carga]`).

Variables de entorno (solo nombres): la ruta usa `NEXT_PUBLIC_SUPABASE_URL` y
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. El script de mudanza usaba `HOSTELERO_URL`, `HOSTELERO_SERVICE_KEY` y
`RATIOS_ANON` desde `.env.local`.

**Cambio de año (antes del 1-1-2027), pendiente de diseñar:**
- Pasar las ventas de 2026 de `ingresos` a `ingresos_historico` (la app trata `ingresos` como «año en
  curso» y el histórico como años anteriores).
- Hay años escritos a mano en `ratios.html`: `YEAR_ACTUAL = 2026`, `ECO_LIVE_FROM = 2026`, filtros de
  frescura `ultimaFecha(…, 2026)`, `lunesSemanaISO(2026, …)`, valores por defecto `'rv-año'`, `'rvn-año'`,
  `'eco-año'`, botones de año 2024/2025/2026, títulos «2025 vs 2026», «Temporada 2026», `HIST_VINO`…
- La vista `gastos` filtra `fecha >= '2026-01-01'`: decidir si 2027 convive con 2026 o se corta.
- `FECHA_CORTE_COMPRAS` y los parsers de DIJIT/COMPRAS ya no hacen nada (hojas ignoradas).

## 8. Riesgos, limitaciones y pendientes

1. **Datos sin separación por cuenta ni por módulo en la base.** Las tablas de Ratios no tienen
   `cuenta_id` y su RLS solo exige sesión; `gastos`/`gastos_cache` no filtran por cuenta. La única
   barrera es la ruta. Incluye tablas sensibles (`nominas`). Hoy todos los usuarios son de las cuentas
   de Bonita, pero hay una cuenta externa con Ratios contratado. **Obligatorio** resolverlo antes de dar
   usuario a otra empresa o a empleados (app `/empleado`).
2. **`truncate_table`**: función heredada del Ratios original, con permisos pendientes de endurecer
   (aviso a dirección del 04-10-2026; detalle y arreglo en [plataforma.md](plataforma.md) §0, punto 1).
   No la uses en código nuevo; sustituirla por borrados acotados.
3. **Sin permisos por pestaña**: los responsables de área ven importes de nóminas por trabajador y
   pueden enviar (y por tanto sustituir) el asiento de nóminas en Contabilidad.
4. **Textos del asiento desfasados** (dicen «borrador»; es confirmado y sustituye). Riesgo de que
   alguien reenvíe un mes pensando que no toca nada.
5. Documentos de Ratios en el bucket `documentos`, que es **público** (URL no adivinable, pero sin
   control de acceso). Para papeles sensibles usar el módulo Documentos (`/docs`, bucket privado).
6. Cargas que vacían la tabla entera (nóminas, presupuestos, Shopify): un fichero parcial borra el resto.
7. El catálogo de compras se llama `productos_dijit` y la vista pone COMIDA/VARIOS a lo no clasificado:
   los productos nuevos de Compras sin clasificar inflan Comida › Varios.
8. Reparto por horas casa por nombre: si el nombre en Personal y en la gestoría no coinciden, ese mes
   queda al 100 % en el canal de la gestoría.
9. Recarga automática a los 50 minutos: puede cortar una carga de Excel o un inventario a medio teclear.
10. En memoria, tras subir COVERMANAGER/CODETICKETS, la app fusiona por tramo de fechas (la base por
    días sueltos); se corrige solo al recargar.
11. El trigger `trg_gastos_escribir` apunta a una tabla que ya no existe (retirarlo).
12. Migraciones del 01–03-09 aplicadas sin fichero en el repo (§3.7).
13. Años escritos a mano (§7, cambio de año).
14. Comentarios desfasados: cabecera de `ratios.html` y de `RUTAS_MODULO` (dicen que los datos siguen en
    el Supabase antiguo); la opción «Según horas de Skello» del reparto ya usa horas de Personal.
15. Código muerto: los formularios «Añadir ingreso / gasto / presupuesto día» (`m-ing`, `m-gas`,
    `m-ppto`) ya no se abren desde ninguna pantalla. Si se reactivan, ojo: `saveIng()` manda `uds` y la
    columna es `cantidad` (bug visto el 29-09), y `saveGas()` no guarda nada (escribiría en la vista).

## 9. Cómo tocarlo sin romper nada

- **Todo es un único HTML.** Edita `apps/general/datos/ratios.html`, sube `APP_VERSION` y despliega: el
  vigilante avisa a quien tenga la página abierta. No hay build ni tests; prueba en navegador de verdad
  (la lección cara: lo que pasa con `curl` no prueba la UI). En el Mac de dirección hay un banco de
  pruebas con PostgREST simulado (`.humo/`, fuera de git).
- **Nueva pestaña**: botón `tab-btn` en `.tabs-nav` + `<div id="tab-XXX" class="tab-pane">` + su
  `renderXXX()` llamado desde `showTab()`/`renderAll()`. Lee de `DB.*`, nunca vuelvas a pedir a la base.
- **Nunca escribas en `gastos`** (es una vista de Compras). Si hay que corregir una compra, se corrige en
  Compras.
- **Nóminas por centro siempre vía `nominasEfectivas()`**; familias siempre vía catálogo
  (`resolveIng`/`resolveGas`), no leas `r.familia` crudo de la base.
- Si añades columnas que la app necesite de `ingresos`, añádelas a `COLS_INGRESOS` y
  `SELECT_BY_TABLE`; si cambias la forma de lo guardado en IndexedDB, sube `CACHE_V` o cambia la clave.
- Respeta las **cargas parciales**: cada hoja sustituye solo lo suyo (y por días cuando aplica). No
  vuelvas a `truncate` + reinsertar para un cambio pequeño: usa `saveToStorage` con
  `nuevas/borradas/editadas`.
- **Inserciones por lotes a PostgREST: todas las filas con las mismas claves.** Un lote con objetos de
  claves distintas rellena con `null` lo que falta (así se vaciaron fichas de clientes con la primera
  carga de Cover).
- Si cambias `mapa_centro()`, cambia `CANAL_COMPRAS` (y al revés). Si cambian los centros contables,
  revisa `CANAL_CENTRO` y `ASIENTO_CTA`.
- Base de datos: migraciones **solo aditivas** en `apps/general/supabase/migrations/`, el nombre del
  fichero = la versión registrada al aplicarla; políticas nuevas con `(select cuenta_actual())`; en cada
  función nueva `revoke execute … from anon, public` y `set search_path`; después regenerar
  `packages/db/types.ts`. Las migraciones las revisa Luis y las aplica el chat de claude.ai con
  `apply_migration` (ver [plataforma.md](plataforma.md) §11.1), no el código.
- Para separar Ratios por cuenta (pendiente 1): añadir `cuenta_id` con default de Bonita, rellenar,
  cambiar `ratios_sesion` por `cuenta_id = (select cuenta_actual())`, y convertir `gastos` en
  `security_invoker` o filtrar por la cuenta de `compras_doc`. Probar con usuarios de dos cuentas.
