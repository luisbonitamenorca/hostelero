# PyG Socios y PyG Pruebas · manual de uso

> Para dirección y para quien prepara los datos contables. Explica cómo usar las dos pantallas de cuenta
> de resultados. La parte técnica está en `docs/tecnico/pyg.md`.

## 1. Qué es y para quién

Son dos cuadros de mando con la **cuenta de resultados** de Bonita Menorca, mes a mes, por centro y en
total, con el presupuesto, el balance, la tesorería y los préstamos.

| Pantalla | De dónde salen los números | Para qué |
|---|---|---|
| **PyG Socios** | Del Excel de A3 (Sumas y Saldos y listado de facturas por proveedor) que se sube cada mes. Las ventas y el mercado interno se cogen en directo de Ratios. | Es el que se enseña a los socios hoy. |
| **PyG Pruebas** | De la Contabilidad de Hostelero, el módulo Presupuesto y Compras. Las ventas y el mercado interno se cogen en directo de Ratios (como en PyG Socios), así que están siempre al día. No hay que subir nada. | Funciona «en sombra» para compararlo con PyG Socios. Si cuadra, a final de 2026 sustituirá a PyG Socios. |

**Quién los ve:** solo dirección (o quien dirección autorice en Usuarios).

**Mercado interno**: Producción vende comida y Bodega vende vino a los demás centros. Esas ventas y
compras «internas» no existen para Hacienda, pero se enseñan para que cada centro cargue el coste real
de lo que consume y Producción y Bodega no salgan en pérdidas. En la vista **TODOS** se quitan, para no
inflar el total.

## 2. Cómo entrar

1. Entra en Hostelero.
2. En la portada, bloque **Análisis**, pulsa **PyG Socios** o **PyG Pruebas**.
3. Espera a que desaparezca «Cargando datos…». Abajo a la izquierda verás el estado: «Actualizado …»
   (Socios) o «Contabilidad …» (Pruebas) con la fecha y la hora.

Mejor en ordenador. Para volver: **«← Inicio»** en el menú de la izquierda.

## 3. Cómo hago…

### …para ver el resultado hasta un mes

1. Arriba, en **Mes hasta**, elige el mes (por ejemplo Agosto). Todo se acumula de enero a ese mes.
2. Pestaña **📊 Resumen**: tarjetas de **Ingresos**, **Gastos**, **EBITDA**, **Resultado** y **Margen
   neto**, el gráfico «Ingresos vs Gastos mensual» y el bloque **Ratios** (EBITDA, % de compras y % de
   personal sobre ventas).

### …para ver un centro concreto

En la barra de herramientas, **Canal**: pulsa el centro (BINIFADET, BODEGA, TAMARINDOS…) o **TODOS**
para el total del grupo.

### …para ver la cuenta de resultados completa

1. Pestaña **📋 PyG completo**.
2. Elige:
   - **Vista PyG**: **Mensual** (una columna por mes) o **Por negocio** (una columna por centro, con
     totales).
   - **Modo**: **Real** o **Vs Presupuesto** (añade presupuesto y desviaciones).
   - **Detalle**: **Por grupo** o **Por cuenta**.
3. Haz clic en un grupo para abrir sus cuentas; en una cuenta para ver los centros; en un centro para ver
   los proveedores.

### …para ver la evolución del año

Pestaña **📈 Evolución mensual**: resultado de cada mes y acumulado, real frente a presupuesto.

### …para ver el balance

Pestaña **⚖️ Balance**: activo, y patrimonio neto y pasivo a fin del mes elegido en **Mes hasta**. El
resultado del año aparece dentro del patrimonio neto.

### …para ver la tesorería y los préstamos

- **💶 Tesorería**: cobros y pagos previstos y saldos en bancos.
  - En PyG Socios salen de la hoja de tesorería del Excel.
  - En PyG Pruebas salen de los extractos de los bancos y de los vencimientos pendientes de
    Contabilidad; lo que ya ha pasado de fecha sin pagarse sale como **VENCIDO**.
- **🏦 Pool bancario**: capital pendiente y cuotas de cada préstamo, año a año (en las dos pantallas sale
  del Excel de A3).

### …para simular otra tarifa interna del vino

En **Tarifa interna vino** elige **Real 2026**, **Propuesta (½ rebaja)** o **Tarifa 2025**. Cambia cuánto
paga cada centro a Bodega por el vino. Es solo una simulación: en TODOS el resultado no cambia, solo se
pasa margen entre Bodega y los centros. Dirección decidió el 16-09-2026 no cambiar la tarifa de 2026.

### …para descargar a Excel

- **«↓ Descargar PyG»**: el PyG por cuenta y centro, y el detalle por proveedor.
- **«↓ Descargar presupuesto»**: el presupuesto por cuenta, centro y mes.

### …para actualizar los datos de A3 (solo PyG Socios)

1. Exporta de A3 el **Sumas y Saldos** y el **listado de facturas por proveedor** (que traiga la columna
   «Fecha contable»).
2. En PyG Socios pulsa **«Actualizar datos»** (abajo a la izquierda).
3. Arrastra los ficheros (puedes subir los dos a la vez) y pulsa **Subir**.
4. Lee el mensaje: dice qué se ha actualizado, qué se ha ignorado y si cuadra la conciliación.

Solo se actualiza lo que traen los ficheros; lo demás se queda como estaba. El **presupuesto** y el
**plan de cuentas** no se pueden cambiar desde aquí (están protegidos a propósito).

### …para comparar PyG Pruebas con PyG Socios

En PyG Pruebas, pestaña **🔍 Comparar con PyG Socios**:
- la tabla compara Contabilidad (Hostelero) con A3 por grupo y mes;
- **«Cuentas que A3 tiene y Contabilidad no (huecos)»** es la lista de lo que Contabilidad todavía tiene
  que empezar a registrar por su cuenta;
- **«Cuentas que Contabilidad tiene y A3 no»**, al revés.

PyG Pruebas no tiene botón de subir datos: si cambias algo en Contabilidad, pulsa **«↻ Recargar»**.

## 4. Qué significa cada color o aviso

| Lo que ves | Qué significa |
|---|---|
| Banda verde «✓ Conciliación 2/6 correcta» | El detalle por proveedor cuadra con el Sumas y Saldos. |
| Banda ámbar «⚠️ Conciliación 2/6: … descuadres» | Hay cuentas en las que el listado de facturas no suma lo mismo que el Sumas. Haz clic para ver cuáles. Suele ser un listado al que le falta un tramo de fechas, o apuntes que no son facturas. |
| Diferencias en verde / rojo | A favor / en contra (según sea ingreso o gasto). |
| Meses en gris claro en los ratios | Meses posteriores a «Mes hasta». |
| Punto verde abajo a la izquierda | Datos cargados. Rojo: «Sin datos» o «Error». |
| Pantalla «No hay datos disponibles» o «El fichero no es válido» | En PyG Socios no hay Excel en el servidor o le falta la hoja de Sumas y Saldos. |
| «No se pudo leer Contabilidad» | PyG Pruebas no ha podido leer la base: recarga y, si sigue, avisa. |
| Banda verde arriba «Hay una versión nueva de la app» | Tócala para actualizar. |

## 5. Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| Acabo de subir el Excel y veo lo de antes | Espera unos segundos y recarga la página. |
| El mensaje dice «ignorado (protegido)» | Has subido presupuesto o plan de cuentas: desde aquí no se cambian. Habla con dirección. |
| «Solo reconozco pestañas protegidas…» | El fichero no trae Sumas y Saldos ni proveedores. Revisa que sea el export correcto. |
| Aviso de que el listado de proveedores no trae «Fecha contable» | Vuelve a exportarlo de A3 con esa columna; si no, los gastos se reparten por fecha de factura y no cuadrarán con el Sumas. |
| Las ventas no coinciden con A3 | Normal: PyG Socios toma las ventas de Ágora (vía Ratios), que tienen bien el centro. |
| Los números de PyG Pruebas y PyG Socios no coinciden | Es justo lo que se está probando: mira la pestaña Comparar y los «huecos». |
| La página se recarga sola | Lo hace cada 50 minutos para renovar la sesión. |

## 6. A quién avisar

- Cualquier duda sobre cifras, presupuesto o conciliación: **dirección**.
- Excel de A3 que no se deja subir o datos de A3 que faltan: a quien lleva la contabilidad en
  administración.
- Si la pantalla no carga o da errores: dirección, que lo pasará a quien programa Hostelero.
