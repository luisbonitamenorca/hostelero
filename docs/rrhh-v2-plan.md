# RRHH v2 · Plan de la noche del 30-09-2026

Objetivo: que `/rrhh` sea **mejor que Skello** y que a Sílvia y a los jefes de centro les
resulte **familiar** (misma lógica y mismos nombres que en Skello) para que el relevo sea
suave. Todo lo de esta noche se construye sobre lo que ya hay (esquema `rrhh_*`, panel
`app/rrhh`, app empleado `app/empleado`, kiosco `app/kiosco`, handler `app/api/rrhh/fichar`).

Referencia de lo que hace Skello: el export de Skello (`~/Downloads/january_rapports/*.xlsx`,
hojas «01-01 - 31-10», «Ficha empleados», «Detalles», «Ausencias», «Resumen Contadores»,
«Saldo de vacaciones») y el centro de ayuda help.skello.io/es.

## 0. Reglas duras

1. **Migraciones solo aditivas**: tablas/columnas/funciones nuevas, seeds, `alter` de NOT NULL
   a NULL. Nada de `drop` de columnas o datos. `rrhh_fichajes` sigue append-only.
2. Toda política RLS nueva se escribe con `(select cuenta_actual())` y `(select rrhh_es_gestor())`
   (initplan, ver migración 20260929100000). Anon no ve nada.
3. `centro_id` y `cuenta_id` (default `cuenta_actual()`) en toda tabla nueva.
4. No tocar tablas de otros módulos. La tabla `rrhh` (sin prefijo) es de **Ratios** (horas
   semanales por persona que Ratios usa para el reparto de nóminas): solo se le añade la
   columna `origen` y se escribe en ella desde la función de exportación.
5. Fichero por sección. Los agentes de secciones **no editan** `tipos.ts`, `acciones.ts`,
   `rrhh.css` ni `PanelRrhh.tsx`: cada sección tiene `secciones/<sec>.tsx`,
   `secciones/<sec>.css` y `acciones/<sec>.ts` propios. Helpers compartidos nuevos van en
   `lib-rrhh.ts` (lo escribe el paso de cimientos; después es solo lectura).
6. Textos en español, tono de la casa (tú, frases cortas). Fechas dd/mm en pantalla.
7. Antes de dar por hecha una sección: `npx tsc --noEmit` en `apps/general` limpio.

## 1. Modelo de datos (migración `rrhh_v2`)

### 1.1 Catálogos

**`rrhh_puestos_cat`** (puestos de trabajo, lo que en Skello es «Puesto» del turno)
- id uuid pk, cuenta_id, nombre text NN, departamento_id uuid null → departamentos,
  color text NN (hex), activo bool default true, orden int default 100, creado_en.
- unique (cuenta_id, lower(nombre)).
- Seed: `select distinct btrim(regexp_replace(puesto,'\s+',' ','g')) from rrhh_turnos` (≈97),
  departamento resuelto casando por nombre contra `rrhh_puestos` (tabla de Ratios: puesto →
  departamento COCINA/SALA/RECEPCION/OTROS…) y contra `departamentos` por nombre; color por
  departamento (Cocina #E8590C naranja, Sala #1D9E75 verde, Recepción #185FA5 azul,
  Visitas #534AB7 morado, Tienda #BA7517 ámbar, Bodega #7B1FA2, Campo #2E7D32,
  Mantenimiento #607D8B, Administración #455A64, Dirección #1a1a1a, sin depto #888).
- Además: `update rrhh_turnos set puesto = btrim(regexp_replace(puesto,'\s+',' ','g'))` para
  que casen con el catálogo (aditivo: solo limpia espacios).
- `rrhh_turnos.puesto_id uuid null → rrhh_puestos_cat` (se rellena casando por nombre; el
  texto `puesto` se conserva para compatibilidad y para Ratios).

**`rrhh_tipos_ausencia`** (existe) se amplía:
- `categoria text NN default 'retribuida_empresa'` con check en
  ('retribuida_empresa','retribuida_terceros','no_retribuida','neutra') — igual que Skello.
- `computa_contador bool default true` (¿cuenta como horas trabajadas en el contador?).
- `color text` (hex), `codigo text` (código corto para el informe de nómina), `requiere_justificante bool default false`.
- Seed (insert si no existe por nombre, `on conflict` no hay unique → comprobar con `not exists`):
  Vacaciones (retribuida_empresa, computa_vacaciones, computa_contador, solicitable),
  Descanso semanal (neutra, no computa contador, no solicitable),
  Festivo (neutra), Descanso compensatorio (retribuida_empresa, computa_contador),
  Baja por enfermedad (retribuida_terceros, computa_contador=false, no solicitable),
  Accidente laboral (retribuida_terceros, no solicitable),
  Permiso de maternidad / Permiso de paternidad / Permiso de lactancia (retribuida_terceros),
  Permiso retribuido (retribuida_empresa), Permiso por matrimonio (retribuida_empresa),
  Permiso por hospitalización de familiar (retribuida_empresa), Fuerza mayor (retribuida_empresa),
  Formación (retribuida_empresa), Ausencia incorporación/salida (neutra, no solicitable),
  Permiso sin sueldo (no_retribuida), Ausencia injustificada (no_retribuida, no solicitable),
  Otro (neutra).
  Los 5 que ya existen se actualizan (categoría, color) sin borrarlos.
- **Mapa enum ↔ tipo**: `rrhh_ausencias.tipo` (enum vacaciones|baja|permiso|otro) se mantiene
  por compatibilidad y se deriva del tipo: Vacaciones→vacaciones; Baja/Accidente/maternidad/
  paternidad→baja; Permiso*/Formación/Descanso compensatorio/Fuerza mayor→permiso; resto→otro.

**`rrhh_ausencias`** (existe) se amplía:
- `tipo_id uuid null → rrhh_tipos_ausencia`, `medio_dia bool default false`, `horas numeric null`
  (ausencia parcial en horas), `nota text`, `motivo_rechazo text`, `resuelta_en timestamptz`,
  `centro_id uuid null` (centro al que afecta; null = todos).
- Backfill `tipo_id` desde el enum: vacaciones→Vacaciones, baja→Baja por enfermedad,
  permiso→Permiso retribuido, otro→Otro.
- Política nueva: el empleado puede **cancelar** (delete) su propia ausencia si `estado='solicitada'`.

**`rrhh_festivos`**
- id, cuenta_id, fecha date NN, nombre text NN, ambito text NN check ('nacional','autonomico','local'),
  centro_id uuid null (solo para locales), activo bool default true, creado_en.
- unique (cuenta_id, fecha, coalesce(centro_id, '00000000-0000-0000-0000-000000000000')).
- Seed 2026 nacionales + Illes Balears (calendario oficial BOIB 2026; el agente lo verifica en
  la web, NO de memoria) y locales conocidos como `activo=false` si hay duda. Municipios:
  Binifadet* + Cocina Producción = Sant Lluís; Tamarindos* = Maó (Es Grau); Estructura = Maó;
  Casa Tirant = Es Mercadal (Fornells). Si el calendario 2027 ya está publicado, cargarlo también.

### 1.2 Reglas y configuración

**`rrhh_convenios`** (existe) se amplía:
- `dias_vacaciones_anuales numeric default 30` (naturales), `dias_laborables_semana numeric default 5`,
  `nocturno_inicio time default '22:00'`, `nocturno_fin time default '06:00'`,
  `horas_extra_max_anual numeric default 80`, `complementarias_max_pct numeric default 30`,
  `jornada_anual_h numeric null` (si se informa, el contador anual compara contra ella).

**`rrhh_centros_config`** (existe) se amplía (reglas de validación de fichajes, como Skello):
- `regla_horas text NN default 'plan_tolerancia'` check ('planificado','fichado','plan_tolerancia'),
- `tolerancia_min int NN default 10`, `redondeo_min int NN default 0` (0 = sin redondeo; 5/10/15),
- `aviso_retraso_min int NN default 10`.

**`rrhh_encargados_centro`** (existe): seed por dominio de correo para perfiles con rol
`responsable_area` o `jefe_sala` de la cuenta Bonita: `@binifadet.com` → Binifadet Restaurante,
Binifadet Bodega, Binifadet Tienda, Cocina Produccion; `@tamarindosmenorca.com` → Tamarindos
Restaurante; `@elbardetamarindos.com` → Tamarindos Bar; `@casatirant.com` → Casa Tirant.
Insert solo si no existe.

### 1.3 Empleados

**`empleados`** (núcleo, existe) se amplía:
- `codigo_nomina text null` (código del trabajador en la gestoría/A3),
- `puesto_defecto_id uuid null → rrhh_puestos_cat` (se propone al crear turno),
- `fecha_nacimiento date null` (solo para aviso de menores), `nota text null`,
- `contador_inicial_h numeric default 0` y `contador_inicial_fecha date null`
  (saldo de horas con el que arranca el contador — el que traigan de Skello),
- `vacaciones_ajuste_dias numeric default 0` (ajuste manual del saldo de vacaciones del año en curso).
- Backfill `puesto_defecto_id`: el puesto más frecuente de sus turnos.

### 1.4 Planificación

**`rrhh_turnos`** (existe):
- `empleado_id` pasa a **nullable** = turno **sin asignar** (hueco a cubrir). RLS «propio»
  sigue igual (null nunca casa).
- `puesto_id` (arriba), `nota text null`, `color text null` (override), `modificado_en timestamptz default now()`.
- Trigger `rrhh_turnos_log`: tabla `rrhh_turnos_historial` (id, cuenta_id, turno_id, accion
  insert/update/delete, antes jsonb, despues jsonb, user_id, ts) — auditoría «quién cambió qué».
  RLS: lectura gestores/encargados del centro del turno.

**`rrhh_plantillas_turno`** (turnos rápidos por centro: «Mañana 09-17», «Cierre 18-02»…)
- id, cuenta_id, centro_id null (null = todos), nombre, hora_inicio, hora_fin, pausa_min,
  puesto_id null, orden, activo.
- Seed por centro: los 6 pares (hora_inicio, hora_fin, pausa) más frecuentes en `rrhh_turnos`
  de cada centro, nombre «HH:MM–HH:MM».

**`rrhh_plantillas_semana`** (Skello «modelos de semana»): id, cuenta_id, centro_id, nombre,
turnos jsonb ([{empleado_id, dow 0-6, hora_inicio, hora_fin, pausa_min, puesto_id}]), creado_por, creado_en.

**`rrhh_disponibilidades`** (el empleado marca días que no puede / prefiere)
- id, cuenta_id, empleado_id, fecha, tipo text check ('no_disponible','prefiere'), nota, creado_en.
- RLS: empleado CRUD lo suyo; gestores/encargados lectura.

**`rrhh_cambios_turno`** (intercambio entre compañeros)
- id, cuenta_id, turno_id → rrhh_turnos, solicitante_id → empleados, destinatario_id → empleados null
  (null = «lo dejo libre para quien quiera»), estado text check ('pendiente','aceptado_companero',
  'aprobado','rechazado','cancelado') default 'pendiente', nota, resuelto_por, resuelto_en, creado_en.
- RLS: empleado inserta lo suyo y ve donde es solicitante o destinatario; gestores todo.

### 1.5 Fichajes y horas

**`rrhh_horas_dia`** (el resultado de comparar planificado y fichado; Skello «validación»)
- id, cuenta_id, empleado_id, centro_id, fecha, horas_plan numeric, horas_fichadas numeric,
  horas_retenidas numeric NN, retraso_min int default 0, salida_antic_min int default 0,
  incidencias jsonb default '[]', estado text check ('propuesta','validada') default 'propuesta',
  nota text, validado_por uuid, validado_en timestamptz, creado_en, modificado_en.
- unique (empleado_id, fecha, centro_id).
- RLS: gestores todo; encargados sus centros; empleado lectura lo suyo.

**`rrhh_fichajes`**: se añade `ts_dispositivo timestamptz null` (hora que tenía la tablet
cuando fichó sin conexión; `ts` sigue siendo la hora del servidor) y `nota text null`.
El trigger `rrhh_fichajes_ts_servidor` NO cambia.

**`rrhh_contador_ajustes`** (ajustes manuales del contador de horas: pago de extras, descanso compensatorio, saldo inicial…)
- id, cuenta_id, empleado_id, fecha, horas numeric NN (+/−), tipo text check
  ('ajuste','pago','descanso','inicial'), motivo text NN, creado_por, creado_en.
- Nunca se borra: se compensa con otro apunte (como Skello, pero visible).

**`rrhh_variables_nomina`** (primas, anticipos, plus transporte, dietas… del mes)
- id, cuenta_id, empleado_id, anio int, mes int, concepto text NN, importe numeric NN,
  descripcion text, creado_por, creado_en.

### 1.6 Vistas y funciones SQL

- `rrhh_semana_iso(fecha)` → (anio, semana, lunes).
- `rrhh_horas_contrato_semana(empleado_id, lunes)` numeric: horas_semana del periodo vigente,
  prorrateadas por días del periodo dentro de la semana (alta/baja a mitad de semana).
- `rrhh_resumen_semana(centro_id null, desde, hasta)` → tabla por empleado y semana:
  horas_plan (turnos publicados), horas_retenidas (rrhh_horas_dia validadas; si no hay, plan),
  horas_contrato, horas_ausencia_contador (ausencias aprobadas con computa_contador: jornada
  completa = horas_contrato_semana / dias_laborables_semana; medio_dia = la mitad; con `horas` = ese valor),
  diferencia = retenidas + ausencias_contador − contrato.
- `rrhh_saldo_horas(empleado_id, hasta)` numeric: contador_inicial + Σ diferencia semanas desde
  contador_inicial_fecha (o 1 de enero) + Σ ajustes.
- `rrhh_saldo_vacaciones(empleado_id, anio)` → (derecho_anual, devengado_hoy, disfrutados, pendientes_aprobar, resto):
  derecho_anual = dias_vacaciones_anuales × días de contrato en el año / días del año;
  devengado_hoy = idem hasta hoy; disfrutados = días naturales de ausencias aprobadas con
  computa_vacaciones en el año (+ medio_dia = 0,5) + vacaciones_ajuste_dias.
- `rrhh_informe_nomina(anio, mes, centro_id null)` → tabla por empleado con: codigo_nomina,
  tipo_contrato, horas_semana, horas_contrato_mes (horas_semana×52/12 prorrateado por días de
  contrato del mes), dias_trabajados, horas_retenidas, horas_extra (max(0, retenidas − contrato_mes)),
  horas_nocturnas (tramo nocturno del convenio, sobre turnos publicados/validados), horas_domingo,
  horas_festivo (turnos en `rrhh_festivos` activos del centro), ausencias jsonb por tipo
  {codigo: {dias, horas}}, variables jsonb {concepto: importe}, comentario.
- `rrhh_exportar_ratios(desde, hasta)` → inserta en `rrhh` (tabla de Ratios) una fila por
  persona/semana/centro con `origen='hostelero'`: persona = upper(apellidos)||', '||upper(nombre),
  dni = '' (Ratios casa por nombre cuando no hay dni), anio, semana, fecha = lunes, centro = código
  Skello (Binifadet Restaurante→BINIFADET, Binifadet Bodega→BODEGA, Binifadet Tienda→TIENDA,
  Casa Tirant→TIRANT, Cocina Produccion→PRODUCCION, Estructura→OFICINA, Tamarindos Bar→
  TAMARINDOS_BAR, Tamarindos Restaurante→TAMARINDOS), puesto = puesto más frecuente, contrato =
  horas_semana, horas_reales = horas_retenidas. Borra antes las filas `origen='hostelero'` de
  esas semanas. `alter table rrhh add column if not exists origen text`. SECURITY DEFINER, solo gestores.
- `rrhh_hoy(centro_id)` → quién tiene turno hoy, si ha fichado (último fichaje), ausencias de hoy.
- Todas con `security invoker` salvo `rrhh_exportar_ratios`; `search_path = public, pg_temp`;
  `revoke execute from anon, public`.

## 2. Pantallas (panel `/rrhh`)

Pestañas (en este orden; nombres que Sílvia reconoce de Skello):
**Hoy · Planificación · Fichajes · Ausencias · Contadores · Informes · Empleados · Ajustes**
(Dispositivos pasa a ser una subsección de Ajustes.)

Barra común: selector de centro (recuerda el último en localStorage), navegación de semana
‹ › Hoy, y botón principal a la derecha. Estética: la de `rrhh.css` (verde Hostelero), pero la
**disposición del cuadrante imita a Skello**: filas = empleados agrupados por departamento,
columnas = días, chips de turno **de color por puesto** con horas y nombre del puesto, columna
final «Horas» (planificadas / contrato, en ámbar si pasa) y fila final «Total del día» (horas y
personas). Fila superior «Sin asignar» con los huecos.

### 2.1 Hoy (nueva)
Tarjetas: quién trabaja hoy en el centro (por turno, con estado «fichó a las…» / «no ha fichado»
/ «en pausa» / «salió»), ausentes hoy, solicitudes pendientes (ausencias, cambios de turno),
avisos (semana próxima sin publicar, fichajes sin validar de los últimos 7 días, periodos de
contrato que acaban en 15 días, contratos sin horas, empleados sin PIN). Accesos rápidos.

### 2.2 Planificación (v2)
- Todo lo de 2 + rejilla Skello. Chips por puesto con color del catálogo. Doble clic en celda =
  nuevo turno; clic en chip = editar. **Arrastrar** un chip a otra celda lo mueve (empleado/día);
  arrastrar con Alt lo duplica. Botón derecho / menú «⋯» en chip: duplicar, borrar, mover a sin asignar.
- Modal de turno: hora inicio/fin, pausa, **puesto (desplegable del catálogo)**, nota, y
  «plantillas rápidas» (botones de `rrhh_plantillas_turno`) que rellenan horas.
- Selección múltiple con Shift+clic y borrar/copiar en bloque.
- Vistas: Semana (por defecto), Día (columnas = horas 06–02, barras), Mes (mini).
- «Copiar semana anterior», «Guardar como modelo», «Aplicar modelo», «Publicar semana»
  (con resumen: N turnos, N horas, avisos). Al publicar, notificar por correo a quien tenga
  email (`lib/correo.ts`, fire-and-forget; si no hay clave no pasa nada).
- Turnos del empleado en **otros centros** de la misma semana se pintan en gris «en Tamarindos»
  (para que el aviso de descanso entre jornadas sea real entre centros).
- Ausencias aprobadas con el nombre del tipo y su color; festivos marcados en la cabecera del día.
- Avisos (no bloquean, como ahora) + los nuevos: turno en festivo, menor de edad en horario
  nocturno (si hay fecha_nacimiento), más de 6 días seguidos, descanso semanal no cumplido.
- Imprimir: hoja CSS `@media print` para colgar el cuadrante en la pared.

### 2.3 Fichajes (v2 = validación)
- Vista **semana** por centro: filas empleados, columnas días; en cada celda «plan 09:00–17:00 ·
  fichado 09:04–17:10 · 7,9 h» con colores (verde ok, ámbar retraso/salida anticipada, rojo sin
  fichar teniendo turno, gris sin turno con fichajes = «no planificado»). Debajo, total semana.
- Botón «Proponer horas» calcula `rrhh_horas_dia` en estado propuesta según la regla del centro;
  «Validar semana» marca validadas; se puede editar horas retenidas con nota antes de validar.
- Vista **día** (la actual, con chips de fichaje y corrección) se mantiene como subvista.
- Exportar registro (Inspección) sigue en Informes.

### 2.4 Ausencias (v2)
- Lista con filtros (estado, tipo, centro, mes) + **calendario mensual** por centro (filas
  empleados, columnas días, celdas coloreadas por tipo) — es lo que Sílvia mira para cuadrar.
- Nueva ausencia: tipo del catálogo, fechas, medio día/horas, nota, centro; el gestor puede
  aprobar directamente. Rechazar pide motivo. Ver saldo de vacaciones del empleado al crear.
- Solicitudes pendientes arriba con aprobar/rechazar.

### 2.5 Contadores (nueva)
- Tabla empleados × semanas del rango (por defecto el mes): contrato / realizadas / diferencia,
  saldo acumulado al final; alerta si acumula > 80 h extra en el año o > 30 % complementarias
  (a tiempo parcial). Clic en empleado abre el detalle con ajustes (`rrhh_contador_ajustes`):
  «Pagar N horas», «Convertir en descanso», «Saldo inicial», «Ajuste».
- Bloque «Vacaciones»: derecho anual, devengado a hoy, disfrutados, pendientes, resto; ajuste manual.
- Botón «Enviar a Ratios» (llama `rrhh_exportar_ratios` del rango).

### 2.6 Informes (v2)
- «Informe de nómina» mensual (Skello «Informe»): tabla por empleado con las columnas de
  `rrhh_informe_nomina`, editor de variables (primas/anticipos/plus) y comentario para la gestoría;
  **Excel** (`xlsx`, 4 hojas: Resumen, Horas por semana, Ausencias, Variables) y CSV.
- Los 3 CSV actuales (resumen, detalle diario, registro Inspección) se mantienen.
- «Plantilla activa» (fijos discontinuos): quién está en periodo activo, quién en inactividad
  y desde cuándo; próximos fines de periodo.

### 2.7 Empleados (v2)
- Alta con **modal** (nombre, apellidos, email, teléfono, centro, departamento, puesto por
  defecto, tipo de contrato, horas/semana, fecha de alta, código nómina) — nada de `prompt()`.
- Ficha: datos + código nómina + puesto por defecto + fecha nacimiento + nota; periodos de
  contrato con modal (no prompt); asignación a **varios centros** con fechas; PIN; historial
  14 días; saldo de vacaciones y saldo de horas en la cabecera; **Dar de baja** (cierra periodo
  y asignaciones) / **Reactivar** (nuevo periodo = llamamiento de fijo discontinuo).
- Lista con badges: activo / inactivo (fijo-disc.) / baja, sin PIN, sin email.

### 2.8 Ajustes (v2)
Subsecciones: Convenios y reglas (con los campos nuevos) · Centros y fichaje (reglas de
validación: regla, tolerancia, redondeo) · Puestos (catálogo con color y departamento, fusionar
dos puestos = reasigna turnos y desactiva) · Tipos de ausencia (categoría, color, computa
contador/vacaciones, solicitable) · Festivos (año, añadir/quitar, ámbito, centro) · Plantillas
de turno · Encargados por centro (usuarios responsable_area/jefe_sala ↔ centros) ·
Departamentos y contratos · Departamentos por centro · Tablets (lo de Dispositivos).

### 2.9 App del empleado `/empleado` (v2)
- Turnos con color de puesto y nombre; «Pedir cambio» de un turno (compañero o abierto);
  «Apuntarme» a huecos sin asignar de mi centro (solo turnos publicados sin empleado).
- Fichar: igual + ver mis horas de hoy y del mes contra contrato.
- Ausencias: tipos solicitables del catálogo, medio día, nota; cancelar si aún está solicitada;
  ver saldo de vacaciones.
- Horas: contador (saldo) y semanas.
- Disponibilidades: marcar días que no puedo / prefiero.

### 2.10 Kiosco `/kiosco` (v2)
- Tras fichar, mostrar «Hoy: entrada 09:02 · pausa 13:00–13:30 · llevas 5,4 h».
- **Cola sin conexión**: si el POST falla por red, guardar en localStorage con `ts_dispositivo`
  y reintentar cada 30 s; el handler acepta `ts_dispositivo` y lo guarda (el `ts` legal sigue
  siendo el del servidor). Indicador «N fichajes pendientes de enviar».
- Handler `/api/rrhh/fichar`: aceptar `ts_dispositivo`; devolver resumen del día.

## 3. Reparto de ficheros

```
apps/general/app/rrhh/
  PanelRrhh.tsx            ← solo el registro de pestañas y el layout (cimientos)
  tipos.ts, acciones.ts, rrhh.css   ← existentes, solo lectura para las secciones
  lib-rrhh.ts              ← helpers compartidos nuevos (cimientos)
  secciones/hoy.tsx + hoy.css            acciones/hoy.ts
  secciones/planificacion.tsx + .css     acciones/planificacion.ts
  secciones/fichajes.tsx + .css          acciones/fichajes.ts
  secciones/ausencias.tsx + .css         acciones/ausencias.ts
  secciones/contadores.tsx + .css        acciones/contadores.ts
  secciones/informes.tsx + .css          acciones/informes.ts
  secciones/empleados.tsx + .css         acciones/empleados.ts
  secciones/ajustes.tsx + .css           acciones/ajustes.ts
apps/general/app/empleado/  EmpleadoApp.tsx, acciones.ts, empleado.css (agente app empleado)
apps/general/app/kiosco/    KioscoApp.tsx, kiosco.css + app/api/rrhh/fichar/route.ts (agente kiosco)
apps/general/supabase/migrations/20260930220000_rrhh_v2.sql
packages/db/types.ts        ← regenerado tras aplicar la migración
```

Cada sección exporta `export default function Sec<Nombre>({ ctx, avisar }: SecProps)` con
`SecProps` de `lib-rrhh.ts`. Las secciones pueden reutilizar acciones de `acciones.ts` y helpers de
`tipos.ts`; lo nuevo va a sus propios ficheros.

## 4. Verificación

- `npx tsc --noEmit` limpio (apps/general) tras cada sección y `next build` antes del push.
- Dev server local `hostelero-general` (puerto 3010) con usuario de prueba
  `pruebas-rrhh@hostelero.test` (rol dirección, cuenta Bonita) — se borra al terminar.
- Revisión adversarial por sección (RLS/datos y UX) y pase visual final con capturas.
