# RRHH v2 · Entrega de la noche del 30-09 → 01-10-2026

Resumen para Luis (y para Sílvia cuando toque): qué hay nuevo en **Personal** (`/rrhh`), qué
hace que Skello no hace, qué queda por decidir y cómo se hace el relevo.

## 1. Qué hay (y dónde está cada cosa de Skello)

Pestañas en este orden: **Hoy · Planificación · Fichajes · Ausencias · Contadores · Informes ·
Empleados · Ajustes**. El selector de centro y la semana se recuerdan entre pestañas.

| Skello | Hostelero | Qué añade |
|---|---|---|
| Inicio | **Hoy** | Quién trabaja hoy con su estado de fichaje (dentro / en pausa / salió / no ha fichado / retraso), ausentes, solicitudes pendientes (ausencias y cambios de turno con aprobar/rechazar), avisos (semana sin publicar, fichajes sin validar, contratos que acaban, gente sin PIN). Cada aviso lleva a su pestaña. |
| Planificación | **Planificación** | Rejilla semanal con chips de color por puesto, columna Horas (plan/contrato), fila Total por día, fila «Sin asignar» (huecos), arrastrar y soltar (Alt = duplicar), selección múltiple, menú ⋯ por chip, plantillas rápidas de turno, modelos de semana (guardar/aplicar), copiar semana anterior, turnos en otros centros en gris, festivos en cabecera, avisos de convenio (descanso, jornada, días seguidos, festivo, menores de noche), vista Día, impresión, publicar con resumen + correo a los empleados (si hay clave de Resend). Historial de cambios de cada turno en la base. |
| Fichaje / Validación | **Fichajes** | Vista Semana planificado vs fichado por celda (verde/ámbar/rojo/gris), «Proponer horas» según la regla del centro (planificado / fichado / plan con tolerancia, redondeo), edición de horas retenidas con nota, «Validar semana» / «Reabrir». Vista Día con corrección de fichajes (append-only, como antes). |
| Ausencias | **Ausencias** | Catálogo completo (18 tipos con categoría, color, si computa contador/vacaciones, si la pide el empleado), medio día / horas, nota, rechazo con motivo, **calendario mensual** por centro, saldo de vacaciones al crear, CSV con el formato de Skello. |
| Contador de horas · Saldo de vacaciones | **Contadores** | Empleados × semanas ISO (contrato / realizadas / ±), total y saldo acumulado, alertas 80 h extra/año y 30 % complementarias, ajustes inmutables (pago, descanso, saldo inicial), saldo de vacaciones (derecho, devengado, disfrutado, pendiente, resto), Ratios lee estas horas en vivo (vista `rrhh_desde_personal`, ver §5). |
| Informe (nóminas) | **Informes** | Informe de nómina mensual por empleado (contrato mes, retenidas, extra, nocturnas, domingos, festivos, ausencias por tipo, variables: primas/anticipos/plus, comentario para la gestoría) en **Excel** (4 hojas) y CSV; «Horas y registro» (resumen, detalle diario, registro completo para Inspección); «Plantilla» (fijos discontinuos: activos / inactivos / baja, próximos fines de periodo). |
| Empleados | **Empleados** | Alta con modal completo, ficha con estado y saldos, código nómina, puesto por defecto, fecha de nacimiento, nota, centros con fechas, periodos de contrato, **Dar de baja** / **Reactivar (llamamiento)**, PIN, historial. Filtros activos / inactivos / baja. |
| Ajustes | **Ajustes** | Convenios (vacaciones, días laborables, tramo nocturno, topes), reglas de validación por centro, **Puestos** (color, departamento, fusionar), tipos de ausencia, **Festivos** 2026-2027 (BOIB), plantillas de turno, **Encargados por centro**, departamentos, contratos, tablets. |
| App del empleado | **/empleado** | Turnos con color de puesto, pedir cambio de turno (compañero o abierto), apuntarse a huecos, fichar con geolocalización + resumen de horas, ausencias del catálogo con medio día y saldo de vacaciones, contador de horas, disponibilidades («no puedo» / «prefiero»). |
| Tablet | **/kiosco** | Igual que antes + resumen del día tras fichar («llevas 5,4 h · turno 10–18»), «Ver mis horas», cola sin conexión con reintento, protección contra fichajes duplicados. |

Lo que Skello **no** tiene y aquí sí: fijos discontinuos de verdad (periodos, llamamientos, informe de
plantilla), tope legal de horas extra y complementarias, huecos sin asignar a los que el equipo se
apunta, turnos de otros centros en el cuadrante, historial de cambios por turno, kiosco sin conexión,
conexión directa con Ratios, y todo en una sola cuota (nada de módulos a 20 €).

## 2. Base de datos

Migraciones (todas **aplicadas** esta noche, solo aditivas):
`20260930220000_rrhh_v2.sql` (modelo completo), `20261001030000_rrhh_v2_e_rls_encargados.sql`
(permisos de los jefes de centro, políticas rápidas) y `20261001040000_rrhh_v2_f_resumen_rapido.sql`
(contador en un paso: de 9,5 s a 44 ms). Decisiones y fuentes en `docs/rrhh-v2-migracion-notas.md`.

Datos sembrados: 91 puestos (desde los turnos de Skello, con departamento y color), 18 tipos de
ausencia (los de Skello), 57 festivos (BOIB 2026 + generales 2027), 48 plantillas de turno, 22
encargados (Rafa, Marcos, Sonia, Xisco → Binifadet/Bodega/Tienda/Producción; Marta, Vanesa →
Tamarindos; Charo, Lena → Tamarindos Bar; Mabel, Matías → Casa Tirant).

## 3. Lo que hay que decidir / revisar (Luis + Sílvia)

1. **Festivos de Casa Tirant**: se han activado los de Fornells (17-ene, 16-jul) y se ha dejado el
   11-nov de Es Mercadal desactivado. Ajustes › Festivos.
2. **Regla de validación de fichajes** por centro (Ajustes › Centros y fichaje): por defecto
   «plan con tolerancia 10 min, sin redondeo». Con esa regla, un «no fichó» retiene 0 h (como Skello)
   y hay que editarlo a mano; si Sílvia prefiere que retenga el plan, cambiar a «planificado».
3. **Tipos de ausencia**: maternidad/paternidad se han dejado solicitables desde la app; Festivo
   computa en el contador (así lo tenía Bonita en Skello). Revisar en Ajustes › Tipos de ausencia.
4. **Encargados por centro**: la rejilla de Ajustes está sembrada por dominio de correo; repasar.
5. **Vacaciones**: derecho anual = 30 días naturales prorrateados por días de contrato en el año
   (Ajustes › Convenios). Skello prorrateaba distinto (mes a mes con turno); los saldos iniciales
   se corrigen con el ajuste manual en Contadores › Saldo de vacaciones.

## 4. Relevo Skello → Hostelero (checklist)

1. Exportar de Skello el último «Resumen Contadores» y «Saldo de vacaciones» y cargar por empleado
   **saldo inicial de horas** (`contador_inicial_h` + `contador_inicial_fecha` = domingo de cierre,
   ficha del empleado) y **ajuste de vacaciones** (Contadores). Sin esto el saldo de horas sale muy
   negativo porque cuenta desde enero con los turnos cargados.
2. Cargar los turnos de octubre en adelante (la base tiene turnos hasta el 20-09; la semana del
   14-09 de Binifadet Restaurante está en borrador).
3. Dar PIN a los empleados (41 sin PIN solo en Binifadet Restaurante) y configurar las tablets
   (Ajustes › Tablets: el código se muestra una vez; el kiosco lo pide con 5 toques en la cabecera).
4. Activar el fichaje móvil a quien proceda (ficha del empleado) y poner lat/lng de los centros que
   faltan (Binifadet Bodega y Tienda).
5. `RRHH_PIN_PEPPER` ya está en Vercel (mismo valor que el legado). `RESEND_API_KEY` opcional para
   el correo de publicación.
6. Pedir a Sílvia que compare un mes de «Informe de nómina» con el Excel de Skello.

## 5. Limitaciones conocidas

- Vista Mes del cuadrante no hecha (Semana y Día sí). Arrastrar varios chips a la vez no (uno a uno).
- Ratios (01-10): ya no hay «Enviar a Ratios». Ratios lee las horas EN VIVO desde la vista `rrhh_desde_personal`
  (migración `20261001070000_rrhh_vista_ratios.sql`): mismo formato que la tabla `rrhh`, calculado al vuelo con la
  regla de `rrhh_exportar_ratios` (validadas o, si no, planificadas; puesto más frecuente; contrato; fila «(AUSENCIA)»
  en el centro principal), `dni=''` (casa por nombre), security_invoker, ~0,45 s para todo el año. Si la vista viene
  vacía o falla, Ratios cae a la tabla `rrhh` (cargador de Skello) como respaldo; `rrhh_exportar_ratios` sigue en la base sin botón.
- El registro horario sigue siendo append-only: las correcciones son inserts con motivo.
- Hoy/Fichajes usan Europe/Madrid explícitamente (Vercel va en UTC).

## 6. Despliegue

Los cuatro commits de la noche están en `main` **en local** (build de producción comprobado:
`next build` sin errores). El clasificador de permisos de Code bloqueó el `git push`, así que lo
lanza Luis por la mañana; Vercel despliega `hostelero-app` solo en ~3 min:

    git push origin main

Las migraciones ya están aplicadas en la base, así que al desplegar todo queda vivo a la vez.

## 7. Datos de prueba de esta noche

Se crearon y **se han borrado** al terminar: usuario `pruebas-rrhh@hostelero.test`, empleado
«Prueba Kiosco Hostelero», tablet «TABLET PRUEBA», un fichaje, dos turnos y las propuestas de horas
de la semana 37 en Binifadet Restaurante. Dev server local: config `hostelero-general` (puerto 3010),
`apps/general/.env.local` (gitignored; pepper de desarrollo, no el real).
