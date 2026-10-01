# RRHH v2 · Notas de la migración `20260930220000_rrhh_v2.sql`

Fichero: `apps/general/supabase/migrations/20260930220000_rrhh_v2.sql` (sección 1 del plan, 1.1 a 1.6).
Escrita el 01-10-2026 inspeccionando la base real (proyecto `jwsvkjyjwocuksdgiqnv`). **No aplicada**:
la aplica el orquestador. Solo aditiva e idempotente (segunda ejecución = no-op).

## Qué había en la base (lo que condiciona el diseño)

- `rrhh_turnos`: 13.773 turnos, todos con `puesto` texto (97 grafías distintas, 91 únicas sin
  mayúsculas: «Jefe/a de cocina» vs «Jefe/a de Cocina»…). `empleado_id` era NOT NULL.
- `rrhh_tipos_ausencia`: 5 tipos (Vacaciones, Baja por enfermedad, Permiso retribuido, Permiso sin
  sueldo, Otro). `rrhh_ausencias`: 200 filas, enum `tipo` con los 4 valores.
- `rrhh_puestos` (Ratios): puesto → departamento COCINA/SALA/RECEPCION/OTROS. `rrhh` (Ratios):
  3.096 filas, `id` identity, sin `cuenta_id`, política `ratios_sesion` (true).
- `rrhh_fichajes`: 0 filas, triggers `trg_rrhh_fichajes_ts` y `trg_rrhh_fichajes_no_update`.
- Convenios: «Hostelería Baleares» (por defecto, asignado a los 8 centros), «Bodega», «Campo».
- Departamentos de Bonita: Administración, Bodega, Campo, Cocina, Dirección, Mantenimiento,
  Recepción, Sala, Tienda, Visitas.
- No existe la extensión `unaccent` (sí `pgcrypto`, `pg_trgm`).
- Perfiles de Bonita con rol responsable_area: 4 @binifadet.com, 2 @tamarindosmenorca.com,
  2 @elbardetamarindos.com, 2 @casatirant.com. No hay ningún `jefe_sala`.

## Decisiones

### Helpers (sección 0)
- `rrhh_sin_acentos(text)`: lower + translate (no hay unaccent). Se usa en seeds y en el mapa
  tipo→enum.
- `rrhh_horas_turno(inicio, fin, pausa_min)`: (fin − inicio, +24 h si fin <= inicio) − pausa/60,
  con tope en 0 (como `horasNetas` en tipos.ts). Un turno con fin = inicio cuenta 24 h (tal como
  pide el plan).
- `rrhh_convenio_centro(centro_id, cuenta_id default null)` devuelve la fila de `rrhh_convenios`
  que aplica (config del centro → por defecto de la cuenta). Si no hay ninguna devuelve nulos y las
  funciones hacen `coalesce` con 22:00 / 06:00 / 5 días / 30 días.
- `rrhh_mis_centros()` (security definer): centro principal + asignaciones vigentes del empleado
  con sesión. Lo usan las políticas nuevas de turnos para no depender de la RLS de
  empleados/asignaciones.

### 1.1 Catálogos
- **Puestos**: 91 filas. Si dos grafías solo difieren en mayúsculas gana la más frecuente
  (`unique (cuenta_id, lower(nombre))`). Departamento, en este orden: (1) «visitad» → Visitas
  (Ratios lo tiene en RECEPCION pero aquí existe Visitas); (2) `rrhh_puestos` de Ratios para
  COCINA/SALA/RECEPCION (OTROS no resuelve); (3) palabras clave del nombre. Resultado: todo
  resuelto salvo «Presencia» y «correturnos» (quedan sin departamento, color gris). «Responsable»
  cae en Sala porque así lo tiene Ratios (y es el puesto de la responsable de Tamarindos Bar);
  «Jefe/a Manager» → Dirección.
- `rrhh_turnos.puesto` se normaliza solo en espacios; `puesto_id` queda resuelto en el 100 % de
  los turnos con puesto.
- **Tipos de ausencia**: 18 (los 13 nuevos del plan + los 5 que ya existían). Los 5 existentes
  se actualizan una sola vez (categoría, color, código, computa_contador) con la condición
  `color is null`, así una segunda ejecución no pisa cambios hechos desde Ajustes. Códigos cortos
  para el informe de nómina: VAC, DS, FES, DC, IT, AT, MAT, PAT, LAC, PR, MATR, HOSP, FM, FORM,
  PSS, AI, INC, OTR. `computa_contador` sigue lo que Bonita tiene en Skello (hoja «Detalles»,
  columna «Ausencias incluidas en el contador», 8 ficheros de enero): **sí** Vacaciones, Baja por
  enfermedad (527 días, jornada/7), Accidente laboral (81), Festivo (89, jornada/5), Paternidad
  (28), Maternidad (igualada a paternidad), Lactancia, Formación, Matrimonio, Permiso retribuido,
  Hospitalización, Fuerza mayor; **no** Descanso compensatorio (29 días en «NO incluidas»),
  Descanso semanal, Permiso sin sueldo, Ausencia injustificada, Incorporación/salida, Otro.
  Maternidad/paternidad: solicitables por el empleado.
- **Enum `rrhh_ausencias.tipo`**: trigger `trg_rrhh_ausencias_derivar_tipo` (before insert/update
  of tipo_id): si llega `tipo_id`, `tipo` se deriva con `rrhh_enum_tipo_ausencia`. La app puede
  mandar solo `tipo_id`. El mismo trigger rechaza un `tipo_id` de otra cuenta y, si quien escribe
  no es gestor (solicitud del empleado), un tipo inactivo o no solicitable (Baja, Ausencia
  injustificada, Descanso semanal…). Backfill de `tipo_id` desde el enum: 200/200 ausencias casan.
- Política nueva `rrhh_ausencias_propio_cancelar` (delete propio si `estado='solicitada'`, con
  filtro de cuenta).
- **Festivos**: tabla con `comentario` (no estaba en el plan; sirve para documentar los
  inactivos). 57 filas (ver «Fuentes»). Locales con `centro_id` y `ambito='local'`.

### 1.2 Reglas
- Columnas nuevas en convenios y centros_config con los defaults del plan; `redondeo_min`
  limitado a 0/5/10/15.
- Política `rrhh_centros_config_lectura` (select por cuenta, como convenios y tipos): sin ella,
  `rrhh_convenio_centro` (invoker) no veía `convenio_id` desde la sesión de un empleado y
  `rrhh_saldo_horas` / `rrhh_saldo_vacaciones` caían siempre al convenio por defecto.
- Helpers definer para políticas: `rrhh_gestiona_empleado(uuid)` (gestor, o encargado del centro
  principal o de una asignación vigente del empleado) y `rrhh_empleado_misma_cuenta(uuid)`.
  Hacen falta porque `empleados` solo tiene RLS para direccion/administracion/jefe_sala y para el
  propio: un encargado (responsable_area) no puede leer empleados, y un subselect sobre
  `empleados` dentro de una política le daría siempre false.
- Encargados: 22 pares (user, centro) por dominio de correo. `cocina@…` también entra (es
  responsable_area), así los jefes de cocina ven su centro.

### 1.3 Empleados
- Columnas del plan. `puesto_defecto_id` rellenado para 151 empleados (el puesto más frecuente
  de sus turnos).

### 1.4 Planificación
- `rrhh_turnos.empleado_id` nullable (hueco a cubrir). Columnas `nota`, `color`, `modificado_en`
  (trigger before update). Índice parcial para huecos.
- **Políticas nuevas en rrhh_turnos** (no previstas en 1.4 pero necesarias para 2.9 «Apuntarme»):
  `rrhh_turnos_huecos_lectura` (select de turnos publicados sin asignar de mis centros) y
  `rrhh_turnos_hueco_apuntarse` (update de un hueco poniéndome a mí; el `with check` fija también
  cuenta y centro ∈ mis centros). Como una política no puede fijar el resto de columnas, el
  trigger `trg_rrhh_turnos_guard_apuntarse` (before update, solo cuando `old.empleado_id is null`)
  rechaza cualquier cambio que no sea `empleado_id = yo` si quien actualiza no gestiona el centro.
  Las políticas existentes no se tocan.
- **Historial**: `rrhh_turnos_historial` guarda también `centro_id` (para la política de lectura
  por centro aunque el turno se haya borrado). El trigger es security definer (escribe aunque el
  usuario no tenga insert en la tabla). Los triggers se crean DESPUÉS de los backfills para no
  generar 14.000 filas de historial.
- Plantillas de turno: 48 (6 por centro), nombre «HH:MM–HH:MM · N min». Solo se siembran en
  centros sin plantillas.
- Plantillas de semana, disponibilidades (unique empleado+fecha) y cambios de turno con las RLS
  del plan. Disponibilidades: lectura de gestión vía `rrhh_gestiona_empleado`. Cambios de turno:
  todas las políticas «propio» llevan `cuenta_id = cuenta_actual()`; el empleado solo abre
  cambios sobre un turno **suyo y publicado** y con destinatario de su cuenta; solicitante o
  destinatario pueden actualizar a pendiente/aceptado_companero/rechazado/cancelado y el trigger
  `trg_rrhh_cambios_turno_guard` vigila las transiciones para quien no gestiona el turno: no se
  cambia turno_id/solicitante_id/cuenta_id/creado_en, solo peticiones pendientes o aceptadas por el
  compañero, el solicitante solo cancela y el destinatario solo acepta o rechaza (sin reasignarse);
  al rechazar/cancelar se sella `resuelto_por`/`resuelto_en`. Gestores y encargados del centro
  del turno pasan sin restricción.

### 1.5 Horas
- `rrhh_horas_dia` unique (empleado, fecha, centro). `rrhh_contador_ajustes` **inmutable**: solo
  select e insert para authenticated (revoke explícito de update/delete; el default ACL de
  `public` da arwdDxtm a authenticated en toda tabla nueva, así que un grant parcial no restringe
  nada) y trigger que impide el delete. Lo mismo en `rrhh_turnos_historial` (revoke
  insert/update/delete: solo escribe el trigger definer). `rrhh_variables_nomina` según plan.
- **Tabla extra `rrhh_nomina_comentarios`** (empleado, año, mes → comentario): el plan pide que
  `rrhh_informe_nomina` devuelva `comentario` para la gestoría y hacía falta dónde guardarlo.
- `rrhh.origen` (tabla de Ratios) + índice (origen, fecha).

### 1.6 Funciones (todas security invoker salvo `rrhh_exportar_ratios`)
- **Periodos sin solapes** (`rrhh_periodos_efectivos(empleado)`): cada periodo se cierra en la
  víspera del siguiente por fecha_alta. En la base hay 5 empleados con varios periodos abiertos a
  la vez (Jaramillo Pacheco tiene 3); sumándolos tal cual, la semana del 07-09-2026 daba 44 h de
  contrato en vez de 40 (verificado con un select equivalente: ahora 40,00). Lo usan
  `rrhh_horas_contrato_semana`, `rrhh_saldo_vacaciones` e `rrhh_informe_nomina`.
- Firmas: `rrhh_resumen_semana(centro_id, desde, hasta [, empleado_id])` — el centro va primero
  como en el plan y por tanto no puede tener default: se pasa `null`. El 4º parámetro opcional lo
  usa `rrhh_saldo_horas` para no calcular toda la plantilla. `rrhh_informe_nomina(anio, mes,
  centro_id default null)`.
- **Resumen semana**: semanas ISO completas que tocan el rango; solo empleados de la cuenta
  activa (`e.cuenta_id = cuenta_actual()`, no se fía solo de la RLS: un operador ve todas las
  cuentas y la función se llama también desde `rrhh_exportar_ratios`, que es definer). El
  contador es de la persona: suma turnos de todos los centros (`horas_plan_centro` da solo los
  del centro filtrado). Horas retenidas por **(día, centro)**: si hay `rrhh_horas_dia` validada
  para (empleado, fecha, centro) se usan sus horas; si no, el plan de ese centro ese día (la
  validación es por centro: validar uno no borra el plan del otro; hay 60 días-persona con turno
  en dos centros). Ausencias que computan (sin tipo_id: vacaciones, permiso o baja): **solo en
  días sin horas planificadas ni validadas** (un día es trabajo O ausencia, como en Skello; en la
  base había 63 días-persona con ausencia aprobada y turno publicado el mismo día); con `horas`
  se usa ese valor por día; si no, días dentro de la semana (medio día = 0,5) con tope
  `dias_laborables_semana` × jornada diaria (horas_contrato / dias_laborables). Se omiten filas
  con todo a 0.
- **Saldo horas**: `contador_inicial_fecha` es el **saldo a cierre de ese día** (lo que se trae
  de Skello, normalmente un domingo): si no es lunes se empieza a contar el lunes siguiente (esa
  semana ya está dentro del saldo inicial); si es lunes se cuenta esa semana entera. Sin fecha,
  1 de enero del año de `hasta`. Semanas completas hasta la de `hasta`, + ajustes con fecha en ese
  rango. La ficha del empleado debe explicarlo así.
- **Saldo vacaciones**: resto = derecho − disfrutados − pendientes_aprobar. Días de contrato desde
  periodos (o alta/baja del empleado si no tiene periodos).
- **Informe nómina**: solo empleados de la cuenta activa; horas retenidas casadas por (día,
  centro) como en el resumen. Ausencias por **día natural**, descontando los días que ya tienen
  horas retenidas; horas de ausencia = `horas` por día si viene informada, si no días ×
  horas_semana / **7** (lo que Skello muestra para bajas y vacaciones: 5,71 h/día a 40 h; nunca
  pasa del contrato semanal, 14 días de vacaciones = 80 h y no 112). Columna nueva
  `horas_ausencia_contador` (Σ de las que computan contador) y `horas_extra = max(0, retenidas +
  ausencia_contador − contrato_mes)`, la misma idea que `diferencia` en Contadores (una semana
  de vacaciones no resta extras). Divergencia conocida: Contadores usa jornada = contrato /
  dias_laborables con tope semanal, así que un permiso suelto vale 8 h en Contadores y 5,71 h en
  nómina; en semanas enteras coinciden. Nocturnas = solape del turno con las ventanas [nocturno_inicio,
  nocturno_fin) de la víspera, del día y del día siguiente (cruza medianoche); la pausa no se
  descuenta de las nocturnas. Domingo = turnos cuya fecha es domingo (el turno entero se atribuye
  al día en que empieza). Festivo = fecha en `rrhh_festivos` activos (nacional/autonómico de la
  cuenta o local del centro del turno). Probado el cálculo nocturno con un turno 18:00–02:00 y
  pausa 30: 7,5 h y 4 h nocturnas.
- **Exportar a Ratios**: security definer, comprueba `rrhh_es_gestor()` y que la cuenta activa
  sea Bonita (`rrhh` no tiene cuenta_id: un gestor de otra cuenta borraría e insertaría encima de
  los datos de Bonita). Borra `origen='hostelero'` de las semanas del rango e inserta
  persona/semana/centro (`dni=''` como pide el plan; `horas_reales` por centro: horas_dia validadas
  de ese centro o, si no, plan de ese centro) **más una fila por persona/semana con
  `puesto='(AUSENCIA)'`** en el centro principal y `horas_reales` = horas de ausencia incluidas en
  el contador, que es como Ratios carga el export de Skello (`ratios.html`, `RRHH_SENT`; hay 274
  filas así en la tabla) y lo que usa para el reparto de nóminas y «extra = reales − contrato».
  `anio` = año **natural** del lunes (no isoyear): Ratios monta la clave del reparto como
  `anio||mes` con el mes sacado de `fecha`; `semana` sigue siendo ISO. Código de centro en
  `rrhh_codigo_centro_ratios(nombre)`.
- **Hoy**: fecha en Europe/Madrid; incluye quien tiene turno, quien ha fichado (último fichaje no
  corregido) y ausentes (ausencia del centro, o sin centro si pertenece al centro).

## Fuentes de festivos

- **2026 (generales y locales)**: Resolución de la consejera de Trabajo, Función Pública y Diálogo
  Social por la que se hace público el calendario laboral general y local 2026 en las Illes
  Balears, BOIB núm. 129 de 27-09-2025 (correcciones BOIB 21-10-2025 y 13-11-2025).
  https://www.caib.es/sites/calendarilaboral/es/aao_2026/ ; PDF consolidado:
  https://www.laboral-social.com/sites/laboral-social.com/files/calendario-laboral-general-local-baleares-2026_0.pdf
  Contrastado con menorca.info (02-01-2026): Maó 17 ene y 8 sep; Sant Lluís 17 ene y 8 sep;
  Es Mercadal 17 ene y 11 nov; Fornells 17 ene y 16 jul.
- **2027 (generales)**: Consell de Govern de 13-03-2026, ficha en caib.es «Aprobado el calendario
  de fiestas laborales de Baleares para el año 2027»: 1 ene, 6 ene, 1 mar, 25 mar, 26 mar, 29 mar,
  1 may, 12 oct, 1 nov, 6 dic, 8 dic, 25 dic. Cargados `activo=true` con comentario «pendiente
  BOIB». Los **locales 2027** no están publicados (la resolución sale en septiembre-octubre de
  2026): cargados `activo=false` repitiendo las fechas fijas de 2026.
- Casa Tirant está en Fornells: se activan los de Fornells (17 ene, 16 jul) y el 11 nov de
  Es Mercadal queda `activo=false` por si Sílvia quiere aplicarlo.

## Dudas (para Luis/Sílvia)

1. Casa Tirant: ¿aplican los festivos de Fornells o los del núcleo de Es Mercadal? (He activado
   Fornells.)
2. Tipos de ausencia: maternidad/paternidad los he dejado solicitables por el empleado; lactancia
   computa contador. Ajustable desde Ajustes.
3. `rrhh_exportar_ratios` manda `dni=''` (plan). Ratios tiene DNI en sus filas históricas; si
   algún día Hostelero guarda el DNI completo, cambiar aquí.
4. `contador_inicial_fecha` = saldo a cierre de ese día (si no es lunes, se cuenta desde el lunes
   siguiente). Al importar el saldo de Skello, poner el domingo de cierre.
5. (Cerrada) Huecos en `rrhh_turnos`: ahora el trigger `trg_rrhh_turnos_guard_apuntarse` impide
   cambiar nada que no sea `empleado_id` al apuntarse.
6. `rrhh_nomina_comentarios` es una tabla que no está en el plan (necesaria para el comentario
   del informe). Si se prefiere otro sitio, es trivial moverlo.
7. Festivo computa contador (así lo tiene Skello: 89 días en enero a jornada/5). Si Sílvia no lo
   quiere así, se cambia desde Ajustes.
8. Hueco de RLS anterior a esta migración: `empleados` y `rrhh_periodos_contrato` no tienen
   política de lectura para encargados (responsable_area), así que `rrhh_resumen_semana`,
   `rrhh_informe_nomina`, `rrhh_hoy` y `rrhh_periodos_efectivos` (invoker) les salen vacías.
   Pendiente de decidir si se añade una política «empleados de mis centros» (fuera de este
   fichero).

## Revisión 01-10-2026 (correcciones de los revisores)

Cada punto se contrastó con el plan y con la base (selects de solo lectura) antes de tocarlo. El
fichero sigue siendo aditivo e idempotente; parseado entero con pglast (SQL y cuerpos plpgsql).

### Aplicadas (20 + 1 extra)

| # | Dónde | Qué | Verificación |
|---|---|---|---|
| 1 | VERIFICACIÓN | La prueba de `rrhh_hoy` filtra por `cuenta_id` | Hay 2 centros «Binifadet Restaurante» (uno de la cuenta 7e740c37…) |
| 2 | `rrhh_resumen_semana`, `rrhh_informe_nomina` | `e.cuenta_id = (select cuenta_actual())` en `emp` / `per_todos` | Convención de la casa; además resumen se llama desde una función definer |
| 3 | 1.2 | Política `rrhh_centros_config_lectura` por cuenta | `pg_policies`: la tabla solo tenía `_gestion` |
| 4 | `rrhh_turnos_hueco_apuntarse` | `with check` con centro ∈ mis centros + trigger `trg_rrhh_turnos_guard_apuntarse` | Columnas comprobadas contra `information_schema` (incluye `creado_en`) |
| 5 | `rrhh_cambios_turno_propio_solicitud` | Turno propio y publicado; `resuelto_*` nulos; destinatario de mi cuenta | Plan 1.4 «empleado inserta lo suyo» |
| 6 | `rrhh_cambios_turno_propio_respuesta` | Cuenta en using/with check + trigger `trg_rrhh_cambios_turno_guard` | — |
| 7 | `rrhh_disponibilidades_gestion_lectura` | Helper definer `rrhh_gestiona_empleado` | `empleados` solo tiene `empleados_gestion` (direccion/administracion/jefe_sala) y `empleados_propio`; los encargados sembrados son responsable_area |
| 8 | `rrhh_cambios_turno_propio_lectura` y resto de «propio» nuevas | `cuenta_id = cuenta_actual()` (cambios, disponibilidades, horas_dia, contador_ajustes, variables, ausencias_cancelar) | — |
| 9 | `rrhh_ausencias_derivar_tipo` | Rechaza tipo de otra cuenta y, si no es gestor, tipo inactivo/no solicitable | — |
| 10 | Grants | `revoke insert, update, delete` en historial; `revoke update, delete` en contador_ajustes (+ policy gestión partida en select / insert) | `pg_default_acl`: authenticated=arwdDxtm en public |
| 11 | `rrhh_exportar_ratios` | Solo cuenta Bonita | `rrhh` sin cuenta_id, policy `ratios_sesion` (true) |
| 12 | `rrhh_periodos_efectivos` | Nuevo helper; usado en horas_contrato_semana, saldo_vacaciones, informe_nomina | 5 empleados con periodos abiertos solapados; Jaramillo 07-09-2026: 44 → 40,00 |
| 13 | `aus_dia` (resumen e informe) | Ausencia no suma en días con horas plan/validadas | 29 días permiso + 34 días baja con turno publicado |
| 14 | Seed tipos | Baja, Accidente, Maternidad, Paternidad → computa; Descanso compensatorio → no; fallback enum incluye `baja` | Hoja «Detalles» de los 8 export de enero (ver 1.1) |
| 15 | `rrhh_informe_nomina` | `horas_extra` incluye ausencias que computan; columna nueva `horas_ausencia_contador` | Ningún código TS consume aún la función |
| 16 | `rrhh_informe_nomina` horas_calc | Días naturales × horas_semana / 7 | Skello: jornada/7 en 343 de 527 días de baja |
| 17 | plan_dia/val_dia/dia (resumen e informe) | Casado por (empleado, centro, fecha); `count(distinct fecha)` para días | 60 días-persona con turno en dos centros |
| 18 | `rrhh_exportar_ratios` | `anio` = año natural del lunes | `ratios.html` l. 9482 y clave `dni||anio||mes` (l. 2436-2446) |
| 19 | `rrhh_horas_turno` | `greatest(0, …)` | Como `horasNetas` en tipos.ts |
| 20 | `rrhh_saldo_horas` | `contador_inicial_fecha` no lunes → lunes siguiente | — |
| 14b | `rrhh_exportar_ratios` | Filas `(AUSENCIA)` + helper `rrhh_codigo_centro_ratios` | 274 filas `(AUSENCIA)` en `rrhh`; `RRHH_SENT` en ratios.html |
| extra | Seed tipos | **Festivo → computa_contador = true** (no lo pedía ningún revisor) | Skello: 89 días de Festivo en «incluidas en el contador», 683,84 h, jornada/5 |

Detalles que se apartan del texto literal del revisor:
- #6: el solicitante puede dejar la petición en su estado actual (p. ej. cambiar nota o
  destinatario mientras está pendiente) o cancelar; el trigger sella `resuelto_por/resuelto_en`
  al rechazar/cancelar. Los triggers guard no son security definer (llaman a helpers que ya lo son).
- #10: se ha ido a la opción fuerte («nunca se borra, se compensa» ⇒ tampoco se edita): la policy
  `rrhh_contador_ajustes_gestion` es `for select` y hay `rrhh_contador_ajustes_gestion_insert`.
- #16: se elige /7 (opción principal del revisor) en vez del tope semanal: con el tope, una semana
  de vacaciones partida entre dos meses daba 16 + 40 = 56 h; con /7 da 40 exactas.
- #20: si `contador_inicial_fecha` es lunes se cuenta esa semana (saldo a inicio de semana); si
  no, se empieza el lunes siguiente (saldo a cierre). No se filtra `r.lunes >= desde` para no
  perder la semana que contiene el 1 de enero cuando no hay fecha inicial.

### Descartadas

Ninguna: las 20 observaciones eran correctas contra el plan y contra la base. Lo único que no
se ha hecho es el hueco de RLS de `empleados` para encargados (duda 8): el propio revisor lo
señala como anterior a esta migración y tocar las políticas de `empleados` queda fuera del
contrato (plan 0.4, «no tocar tablas de otros módulos»).
