# Ratios · manual de uso

> Para el equipo de Bonita Menorca. Explica cómo usar Ratios paso a paso. Si eres quien programa
> Hostelero, la parte técnica está en `docs/tecnico/ratios.md`.

## 1. Qué es y para quién

Ratios es el cuadro de mando del **food cost** y de la explotación de cada centro. Junta en una sola
pantalla:

- lo que se vende (las ventas de Ágora),
- lo que se compra (llega solo desde el módulo Compras),
- el presupuesto y el año anterior,
- el coste de personal (nóminas) y las horas trabajadas (llegan solas desde Personal),
- los comensales (llegan solos desde Reservas) y las visitas a la bodega,
- los inventarios, la tienda online y una carpeta de documentos.

**Quién lo ve:** dirección y los responsables de área. Otras personas solo si dirección se lo activa
en Usuarios.

> Ojo: dentro de Ratios todo el mundo que entra ve también las pestañas de **Salarios** y **Asiento
> Nóminas**, con importes por trabajador. Trátalo como información confidencial.

## 2. Cómo entrar

1. Entra en Hostelero con tu usuario.
2. En la portada, en el bloque **Análisis**, pulsa la tarjeta **Ratios**.
3. Mientras arriba, a la izquierda de las fechas, ponga **«Cargando datos...»**, Ratios está
   descargando (la primera vez del día puede tardar unos segundos; las siguientes, casi nada). Cuando
   termina sale un momento **«✓ N registros»** y el aviso desaparece.

Mejor en ordenador: hay muchas tablas anchas. En el móvil se ve, pero el menú se coloca arriba.

Para volver a la portada: **«← Inicio»**, abajo en el menú de la izquierda.

## 3. Lo que ves siempre

- **Menú de la izquierda**: las pestañas (Ingresos, Compras por familia, Por subfamilia, 🔍 Control
  producto, 📊 Ventas, 🍷 Vino, 🛒 Compras, 💶 Salarios, 🧾 Asiento Nóminas, 👥 Fichajes, 🎫 Visitas,
  🍽️ Comensales, 🏷️ Clasificación, 📦 Inventarios, 🛍️ Ecommerce, 📁 Documentos). Arriba, la semana
  actual («Semana 40 · …»).
- **Barra de arriba**: **Desde** y **Hasta** (fechas), el desplegable de centro (**Todos los centros**,
  Binifadet, Bodega, Tamarindos, Tamarindos Bar, Tirant, Tienda) y el botón verde **«📂 Cargar Excel»**.
  Las fechas y el centro filtran casi todas las pestañas.
- **«Estado de los datos»**: una línea por fuente (📋 Ventas, 🛒 Compras, 👥 Horas, 🍽️ Comensales,
  🎫 Visitas) con la fecha del último dato y cuándo se subió. Ver el punto 5.

## 4. Cómo hago…

### …para ver cómo va la venta frente al presupuesto

1. Pestaña **Ingresos**.
2. Elige **Mes**, **Semana** o **Día** (botones a la derecha del gráfico).
3. La tabla compara **Ingresos 26** con **Presupuesto** y con **Ingresos 25** (desviación en euros y en %).
   Debajo del total salen los centros.
4. Para llevártelo a Excel: **«⬇ Descargar Excel de ingresos»**.

### …para ver el food cost de la semana

1. Pestaña **Compras por familia**.
2. Arriba, elige el centro (Todos, Binifadet, Bodega, Tamarindos, Tamarindos Bar, Tirant, Tienda,
   Producción).
3. Elige **Familia** y la **Vista**: Mensual, Semanal o Diaria.
4. Columnas: Ingresos, Presupuesto, Compras, **Food cost** (compras ÷ ventas), **FC acumulado** y
   **Stock teórico €**. En Producción sale además **Internos**: lo que Producción ha entregado a los
   centros (resta de sus compras).

Para bajar a detalle: **Por subfamilia** (gráficos y tabla con **Food cost %**, **Ratio aj.** y
**Stock €**).

### …para revisar un producto concreto

1. Pestaña **🔍 Control producto**.
2. Elige centro, **Familia** y **Subfamilia**.
3. Verás mes a mes ventas, compras, cantidades, stock teórico y precios medios (PMV de venta, PMC de
   compra). Las **celdas ámbar** son posibles anomalías: un precio que se aleja más de un 20 % de la
   media del año o un stock que se dispara.

### …para ver ventas, vino y compras de un vistazo

- **📊 Ventas**: por centro, año y familia; top 20 de artículos.
- **🍷 Vino**: botellas por referencia y por canal, y comparativas con el año anterior.
- **🛒 Compras**: top 20 de proveedores y de productos. **«⬇ Descargar Excel compras»** baja las
  compras con los filtros que tengas puestos.

### …para subir datos con un Excel

1. Pulsa **«📂 Cargar Excel»** (arriba a la derecha).
2. Arrastra el fichero a la zona de carga o haz clic para buscarlo. Puedes soltar varios a la vez.
   Si Ratios aún está cargando, el fichero espera y se procesa solo: no lo vuelvas a subir.
3. No hace falta renombrar nada: Ratios reconoce los exports tal y como salen de Ágora, la gestoría,
   Codetickets o Shopify.
4. Mira el resultado en cada línea (✓ cargado, ⚠ problema) y el mensaje de abajo.

Qué fichero va y qué cambia:

| Fichero | Qué hace |
|---|---|
| Ventas de Ágora | Sustituye **solo los días** que trae el fichero. |
| Codetickets (visitas) / Covermanager (comensales) | Sustituye solo los días que trae. |
| Nóminas de la gestoría | **Sustituye todas las nóminas.** El fichero tiene que traer **todos los meses del año**, no solo el último. |
| Presupuesto ingresos / Presupuesto nóminas | Sustituye el presupuesto entero. Se descargan del módulo Presupuesto. |
| Shopify (pedidos) | Sustituye los pedidos del año. |
| Dijit / Compras | No hace falta: las compras entran solas. Si lo subes, se ignora. |

Las **horas** ya no se suben: Ratios las lee de Personal. El cargador de Skello de 8 ficheros queda solo
de respaldo.

### …para repartir el coste de un trabajador entre varios centros

1. Pestaña **💶 Salarios**, bloque **«⚙ Reparto de nóminas por trabajador»**.
2. En **Trabajador**, elige la persona.
3. Elige el **Modo**:
   - **Porcentaje fijo**: escribe el % de cada centro (el total debe dar 100 %).
   - **Según horas de Skello**: el coste se reparte cada mes según las horas que haya hecho en cada
     centro (las horas salen hoy de Personal, aunque el botón diga Skello).
4. **Guardar** (o **Cancelar**). El coste total de la empresa no cambia: solo cómo se reparte.

En la tabla **Detalle mensual** de Salarios ves salarios real y presupuesto, el **ratio de personal**
(salarios ÷ ventas) e ingresos.

### …para enviar el asiento de nóminas a Contabilidad

1. Sube primero el Excel de nóminas del mes (ver arriba).
2. Pestaña **🧾 Asiento Nóminas**. Elige **Mes** y **Año**.
3. Revisa la tabla y la línea de abajo: **Comprobación (Debe − Haber)** tiene que decir **✓ cuadra**.
4. Pulsa **«→ Enviar mes a Contabilidad»** y confirma.
   - **Importante:** el aviso dice que se envía «como borrador», pero hoy el asiento entra en
     Contabilidad **ya confirmado** y **sustituye** al asiento de nóminas que hubiera ese mes. Si ese
     asiento ya está conciliado con el banco, el sistema no te deja. Si tienes dudas, pregunta a
     dirección antes de enviar.
5. **«→ Enviar todo el año»** hace lo mismo con todos los meses que tengan nóminas.
6. **«⬇ Descargar Excel (A3)»** baja el mismo asiento en Excel para la gestoría (se mantiene hasta fin
   de 2026).

### …para revisar las horas

1. Pestaña **👥 Fichajes**. Filtra por centro y departamento y elige **Abrir por** Centro o
   Departamento.
2. La tabla compara horas **Teóricas** (contrato) con **Reales**, y la columna **Extra**.
3. En **«⚙ Configuración Fichajes»** puedes marcar a quien va a 40/40 fijo (jefes sin control de horas)
   y cambiar a qué departamento va cada puesto.

### …para ver comensales y visitas

- **🍽️ Comensales**: por centro, servicio (Ambos, Comida, Cena), vista (diaria, semanal…) y mes, con la
  comparación con el año anterior. Llegan solos desde Reservas.
  Al final de la pestaña está la tabla **«Reservas y comensales por nacionalidad»**: una fila por
  centro y una columna por nacionalidad (Walk-in, España, Reino Unido, Francia, Italia… y «Resto
  países»). Cada fila suma el 100 %. Un país tiene columna propia cuando en algún centro pasa del 2 %
  de las reservas; los demás se agrupan en «Resto países» (debajo de la tabla se indica cuáles son).
  Con los botones «% sobre» eliges si el porcentaje es sobre reservas o sobre comensales; pasando el
  ratón por una celda ves la cifra. Walk-in son las entradas sin reserva: no tienen ficha de cliente,
  así que no se les puede poner país. La nacionalidad se deduce del prefijo del teléfono del cliente.
  Esta tabla enseña siempre los cuatro centros (el botón de centro no le afecta); sí le afectan
  servicio, mes y el rango de fechas.
- **🎫 Visitas**: visitas a la bodega por día, semana o mes, por idioma y por canal. Se actualizan
  subiendo el Excel de Codetickets.

### …para clasificar productos (familias y subfamilias)

1. Pestaña **🏷️ Clasificación**.
2. **Familias / Subfamilias**: **«+ Nueva familia»**; selecciona una familia y **«+ Nueva
   subfamilia»**. Solo se puede borrar una familia si no tiene subfamilias ni productos.
3. **Productos Ágora** (lo que se vende) y **Productos Compras** (lo que se compra): en cada fila elige
   familia y subfamilia en los desplegables y ajusta el **Factor** (para pasar a unidades comparables,
   normalmente kg). Se guarda al cambiar.
4. Si aparece **«⚠ Hay N productos … que NO están en el catálogo»**, pulsa **«Importar al catálogo»** y
   clasifícalos. Usa el filtro **Sin clasificar** para encontrarlos.
5. **«⬇ Descargar Excel»** baja todo el catálogo.

Un producto de compras sin clasificar cuenta como **Comida › Varios**: clasifícalo para que el food
cost salga bien.

### …para hacer el inventario del mes

1. Pestaña **📦 Inventarios** › **Productos controlados**: marca qué productos se cuentan en cada centro
   y si los cuenta Cocina o Sala. Tienes **«✓ Marcar todos los filtrados»**, **«✗ Desmarcar todos los
   filtrados»** y **«📋 Copiar configuración de otro centro»**.
2. **«⬇ Plantilla inventario»** baja un Excel con una hoja por centro y bloque para contar en papel.
3. **Inventario mensual**: elige centro, **Fecha cierre** y bloque (🍴 Cocina / 🍷 Sala), escribe las
   unidades contadas (en unidades sueltas, no en cajas; lo que dejes vacío cuenta como 0) y pulsa
   **«💾 Guardar inventario»**. El valor se calcula con el precio medio de compra del año.
4. **📊 Resumen**: qué inventarios están hechos (verde) o pendientes (gris), evolución del stock y
   **Stock teórico vs real** por familia.
5. **Ratios objetivo**: el % objetivo de cada familia (botón **Editar**). Sirve para calcular el stock
   teórico entre inventarios.

### …para guardar un documento

1. Pestaña **📁 Documentos** › **«＋ Subir documento»**.
2. Nombre, departamento, subcategoría, centro (opcional) y archivo (máximo 25 MB) › **Subir**.
3. **«⚙ Gestionar carpetas»** para crear o renombrar carpetas.

No subas aquí papeles confidenciales (contratos, nóminas, DNI): usa el módulo **Documentos** de la
portada.

## 5. Qué significa cada color o aviso

| Lo que ves | Qué significa |
|---|---|
| Food cost en **verde / ámbar / rojo** | Hasta 25 % / de 25 a 35 % / más de 35 %. |
| Ratio de personal en **verde / ámbar / rojo** | Hasta 30 % / de 30 a 40 % / más de 40 %. |
| «Estado de los datos» **✓ verde** | La fuente está al día. |
| **⚠ ámbar** | Va con algunos días de retraso (ventas y compras: 2 días laborables; comensales y visitas: algo más de lo normal; horas: una semana). |
| **⚠ rojo** | Va muy atrasada: avisa a quien la carga. |
| **○ gris** «sin datos» | No hay nada cargado de esa fuente. |
| «⚡ último albarán …» | Hora del último albarán que entró en Compras. |
| «↑ subido …» | Día y hora en que se subió el último fichero. |
| Celdas **ámbar** en Control producto | Posible error o anomalía de precio o stock. |
| Aviso rojo en Asiento Nóminas («este mes no tiene cargados los importes de IRPF…») | El Excel de nóminas de ese mes está incompleto: vuelve a subirlo. |
| «Comprobación … ✗ no cuadra» | No envíes el asiento: avisa a dirección. |
| Banda verde arriba «Hay una versión nueva de la app» | Toca la banda para actualizar cuando no estés a mitad de algo. |

## 6. Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| Al subir un Excel sale «El catálogo … aún no se ha cargado» | La carga inicial no terminó bien. Recarga la página, espera a que desaparezca «Cargando datos...» y vuelve a subirlo. |
| «Este archivo no contiene ninguna pestaña reconocida» | No es un export que Ratios conozca. Comprueba que es el fichero correcto. |
| Las compras de hoy no salen | Las compras salen de los albaranes validados en Compras. Mira allí si el albarán está entrado. |
| Las horas o los comensales no se mueven | Vienen de Personal y de Reservas: revisa que allí estén al día. |
| Mucho gasto en «Comida › Varios» | Hay productos de compras sin clasificar: Clasificación › Productos Compras › Sin clasificar. |
| La página se recarga sola | Lo hace cada 50 minutos para renovar tu sesión. Guarda el inventario antes de dejarla un rato. |
| He subido unas nóminas y han desaparecido los meses anteriores | El fichero de nóminas sustituye todo: vuelve a subir uno con el año completo. |
| Números raros justo después de subir comensales o visitas | Recarga la página. |

## 7. A quién avisar

- Datos que no cuadran, asiento de nóminas o algo que no sabes si tocar: **dirección**.
- Ventas, nóminas, visitas o tienda online sin actualizar: a quien se encarga de subir ese fichero en
  administración.
- Compras, horas o comensales que no llegan: al responsable de Compras, Personal o Reservas de tu centro.
- Si la pantalla falla (no carga, errores): avisa a dirección, que lo pasará a quien programa Hostelero.
