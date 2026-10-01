-- RRHH v2 (30-09-2026): modelo de datos para el módulo que sustituye a Skello.
--
-- Contrato: docs/rrhh-v2-plan.md, sección 1 (1.1 a 1.6). Notas de decisiones y
-- fuentes: docs/rrhh-v2-migracion-notas.md.
--
-- Reglas:
--   * SOLO ADITIVA: tablas/columnas/funciones nuevas, seeds, alter NOT NULL→NULL.
--     No se borra ninguna columna ni ningún dato. rrhh_fichajes sigue append-only.
--   * Idempotente donde es razonable (if not exists / where not exists).
--   * RLS en toda tabla nueva con (select cuenta_actual()) / (select rrhh_es_gestor())
--     / rrhh_gestiona_centro(centro_id). Nada para anon.
--   * Los seeds llevan cuenta_id explícito de Bonita
--     (082c5366-d9ae-49b9-a8b8-8caad73985bd): en una migración cuenta_actual() vale NULL.
--   * Las funciones van con search_path = public, pg_temp y revoke execute from anon, public.
--
-- Orden del fichero:
--   0. helpers (sin acentos, horas de un turno)
--   1.1 catálogos: puestos, tipos de ausencia, ausencias (columnas, trigger de tipo), festivos
--   1.2 convenios, config de centros (+ lectura por cuenta), convenio de un centro, mis centros,
--       gestiona_empleado / empleado_misma_cuenta (definer, para políticas), encargados
--   1.3 empleados
--   1.4 planificación: turnos (nullable, puesto_id, huecos + guard, historial), plantillas,
--       disponibilidades, cambios de turno (+ guard de transiciones)
--   1.5 horas: horas_dia, fichajes (columnas), ajustes contador (inmutables), variables nómina,
--       comentarios nómina
--   1.6 funciones: semana iso, periodos efectivos, horas contrato, resumen semana, saldo horas,
--       saldo vacaciones, informe nómina, código centro Ratios, exportar a Ratios, hoy
--   VERIFICACIÓN (comentarios con selects para el orquestador)
--
-- Revisión 01-10-2026: correcciones de los revisores aplicadas (ver
-- docs/rrhh-v2-migracion-notas.md, «Revisión»).

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

-- No hay extensión unaccent en el proyecto: quitamos acentos con translate.
create or replace function public.rrhh_sin_acentos(p text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select lower(translate(coalesce(p, ''),
    'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ',
    'aeiouaeiouaeiouaeiouncAEIOUAEIOUAEIOUAEIOUNC'))
$$;
revoke execute on function public.rrhh_sin_acentos(text) from anon, public;
grant execute on function public.rrhh_sin_acentos(text) to authenticated;

-- Horas de un turno = (fin − inicio, sumando 24 h si fin <= inicio) − pausa_min/60.
-- Nunca negativo (una pausa mayor que el turno da 0, como horasNetas en tipos.ts).
create or replace function public.rrhh_horas_turno(p_inicio time, p_fin time, p_pausa_min integer)
returns numeric
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select greatest(0, round(
    (extract(epoch from (p_fin - p_inicio)) / 3600.0
      + case when p_fin <= p_inicio then 24 else 0 end)
    - coalesce(p_pausa_min, 0) / 60.0
  , 2))
$$;
revoke execute on function public.rrhh_horas_turno(time, time, integer) from anon, public;
grant execute on function public.rrhh_horas_turno(time, time, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.1 CATÁLOGOS
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── rrhh_puestos_cat: puestos de trabajo (el «Puesto» del turno en Skello) ───
create table if not exists public.rrhh_puestos_cat (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null default cuenta_actual() references public.cuentas(id),
  nombre          text not null,
  departamento_id uuid null references public.departamentos(id),
  color           text not null default '#888888',
  activo          boolean not null default true,
  orden           integer not null default 100,
  creado_en       timestamptz not null default now(),
  constraint rrhh_puestos_cat_color_check check (color ~ '^#[0-9A-Fa-f]{6}$')
);
create unique index if not exists rrhh_puestos_cat_cuenta_nombre_ux
  on public.rrhh_puestos_cat (cuenta_id, lower(nombre));
create index if not exists idx_rrhh_puestos_cat_cuenta_id on public.rrhh_puestos_cat (cuenta_id);
create index if not exists idx_rrhh_puestos_cat_departamento on public.rrhh_puestos_cat (departamento_id);

alter table public.rrhh_puestos_cat enable row level security;
revoke all on public.rrhh_puestos_cat from anon;
grant select, insert, update, delete on public.rrhh_puestos_cat to authenticated;

drop policy if exists rrhh_puestos_cat_gestion on public.rrhh_puestos_cat;
create policy rrhh_puestos_cat_gestion on public.rrhh_puestos_cat
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()));

drop policy if exists rrhh_puestos_cat_lectura on public.rrhh_puestos_cat;
create policy rrhh_puestos_cat_lectura on public.rrhh_puestos_cat
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()));

-- Color por departamento (tabla del plan).
create or replace function public.rrhh_color_departamento(p_nombre_departamento text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case rrhh_sin_acentos(p_nombre_departamento)
    when 'cocina'         then '#E8590C'
    when 'sala'           then '#1D9E75'
    when 'recepcion'      then '#185FA5'
    when 'visitas'        then '#534AB7'
    when 'tienda'         then '#BA7517'
    when 'bodega'         then '#7B1FA2'
    when 'campo'          then '#2E7D32'
    when 'mantenimiento'  then '#607D8B'
    when 'administracion' then '#455A64'
    when 'direccion'      then '#1a1a1a'
    else '#888888'
  end
$$;
revoke execute on function public.rrhh_color_departamento(text) from anon, public;
grant execute on function public.rrhh_color_departamento(text) to authenticated;

-- Seed: puestos distintos (normalizados: btrim + espacios colapsados) de rrhh_turnos.
-- Si dos grafías solo difieren en mayúsculas («Jefe/a de cocina» / «Jefe/a de Cocina»)
-- se queda la más frecuente. Departamento:
--   1) 'visitad' → Visitas (Ratios los mete en RECEPCION pero aquí existe Visitas),
--   2) rrhh_puestos de Ratios (COCINA/SALA/RECEPCION; OTROS no resuelve),
--   3) palabras clave del nombre.
insert into public.rrhh_puestos_cat (cuenta_id, nombre, departamento_id, color, orden)
select
  p.cuenta_id,
  p.nombre,
  dep.id,
  rrhh_color_departamento(dep.nombre),
  100
from (
  select distinct on (cuenta_id, lower(nombre)) cuenta_id, nombre, n
  from (
    select cuenta_id, btrim(regexp_replace(puesto, '\s+', ' ', 'g')) as nombre, count(*) as n
    from public.rrhh_turnos
    where puesto is not null and btrim(puesto) <> ''
    group by 1, 2
  ) b
  order by cuenta_id, lower(nombre), n desc, nombre
) p
left join lateral (
  select d.id, d.nombre
  from public.departamentos d
  where d.cuenta_id = p.cuenta_id
    and rrhh_sin_acentos(d.nombre) = coalesce(
      -- 1) Visitador/a → Visitas
      case when p.nombre ~* 'visitad' then 'visitas' end,
      -- 2) tabla rrhh_puestos de Ratios
      (select case rp.departamento
                when 'COCINA' then 'cocina'
                when 'SALA' then 'sala'
                when 'RECEPCION' then 'recepcion'
              end
       from public.rrhh_puestos rp
       where lower(btrim(regexp_replace(rp.puesto, '\s+', ' ', 'g'))) = lower(p.nombre)
         and rp.departamento in ('COCINA', 'SALA', 'RECEPCION')
       limit 1),
      -- 3) palabras clave
      case
        when p.nombre ~* 'tienda' then 'tienda'
        when p.nombre ~* 'bodega' then 'bodega'
        when p.nombre ~* 'campo|pe[oó]n' then 'campo'
        when p.nombre ~* 'mantenim' then 'mantenimiento'
        when p.nombre ~* 'administr|auxiliar' then 'administracion'
        when p.nombre ~* 'recepci' then 'recepcion'
        when p.nombre ~* 'cocin|pinche|fregad|partida|che[fz]' then 'cocina'
        when p.nombre ~* 'camarer|camerer|comedor|barra|\mbar\M|\msala\M|cafet[ií]n|\mhost\M|sector|servicio' then 'sala'
        when p.nombre ~* 'manager|responsable|direcci' then 'direccion'
      end
    )
  limit 1
) dep on true
where not exists (
  select 1 from public.rrhh_puestos_cat c
  where c.cuenta_id = p.cuenta_id and lower(c.nombre) = lower(p.nombre)
);

-- Normaliza rrhh_turnos.puesto (solo limpia espacios) para que case con el catálogo.
update public.rrhh_turnos
set puesto = btrim(regexp_replace(puesto, '\s+', ' ', 'g'))
where puesto is not null
  and puesto <> btrim(regexp_replace(puesto, '\s+', ' ', 'g'));

-- rrhh_turnos.puesto_id (el texto puesto se conserva para compatibilidad y para Ratios).
alter table public.rrhh_turnos add column if not exists puesto_id uuid null references public.rrhh_puestos_cat(id);
create index if not exists idx_rrhh_turnos_puesto_id on public.rrhh_turnos (puesto_id);

update public.rrhh_turnos t
set puesto_id = c.id
from public.rrhh_puestos_cat c
where t.puesto_id is null
  and t.puesto is not null
  and c.cuenta_id = t.cuenta_id
  and lower(c.nombre) = lower(t.puesto);

-- ─── rrhh_tipos_ausencia: se amplía ───────────────────────────────────────
alter table public.rrhh_tipos_ausencia add column if not exists categoria text not null default 'retribuida_empresa';
alter table public.rrhh_tipos_ausencia add column if not exists computa_contador boolean not null default true;
alter table public.rrhh_tipos_ausencia add column if not exists color text null;
alter table public.rrhh_tipos_ausencia add column if not exists codigo text null;
alter table public.rrhh_tipos_ausencia add column if not exists requiere_justificante boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rrhh_tipos_ausencia_categoria_check') then
    alter table public.rrhh_tipos_ausencia
      add constraint rrhh_tipos_ausencia_categoria_check
      check (categoria in ('retribuida_empresa', 'retribuida_terceros', 'no_retribuida', 'neutra'));
  end if;
end $$;

-- Seed de tipos (lista del plan). Los que ya existen se actualizan una sola vez
-- (categoría, color, código, computa_contador) — solo si color is null, para no
-- pisar cambios hechos después desde Ajustes.
-- computa_contador sigue lo que Bonita tiene configurado en Skello (hoja «Detalles» del
-- export de enero, columna «Ausencias incluidas en el contador», 8 centros): Baja por
-- enfermedad (527 días, jornada/7), Accidente laboral (81), Festivo (89, jornada/5),
-- Permiso de paternidad (28), Formación, Vacaciones, Matrimonio y Lactancia SÍ entran en el
-- contador; Descanso compensatorio (29 días), Permiso sin sueldo y Ausencia injustificada van
-- en «Ausencias NO incluidas». Maternidad se iguala a paternidad.
with lista (nombre, categoria, computa_vacaciones, computa_contador, solicitable, codigo, color, orden, requiere_justificante) as (
  values
    ('Vacaciones',                            'retribuida_empresa',  true,  true,  true,  'VAC',  '#1D9E75', 10, false),
    ('Descanso semanal',                      'neutra',              false, false, false, 'DS',   '#9AA0A6', 15, false),
    ('Festivo',                               'neutra',              false, true,  false, 'FES',  '#B0BEC5', 16, false),
    ('Descanso compensatorio',                'retribuida_empresa',  false, false, true,  'DC',   '#26A69A', 17, false),
    ('Baja por enfermedad',                   'retribuida_terceros', false, true,  false, 'IT',   '#D32F2F', 20, true),
    ('Accidente laboral',                     'retribuida_terceros', false, true,  false, 'AT',   '#B71C1C', 21, true),
    ('Permiso de maternidad',                 'retribuida_terceros', false, true,  true,  'MAT',  '#EC407A', 22, true),
    ('Permiso de paternidad',                 'retribuida_terceros', false, true,  true,  'PAT',  '#AB47BC', 23, true),
    ('Permiso de lactancia',                  'retribuida_terceros', false, true,  true,  'LAC',  '#F06292', 24, false),
    ('Permiso retribuido',                    'retribuida_empresa',  false, true,  true,  'PR',   '#42A5F5', 30, false),
    ('Permiso por matrimonio',                'retribuida_empresa',  false, true,  true,  'MATR', '#5C6BC0', 31, false),
    ('Permiso por hospitalización de familiar','retribuida_empresa', false, true,  true,  'HOSP', '#7E57C2', 32, true),
    ('Fuerza mayor',                          'retribuida_empresa',  false, true,  true,  'FM',   '#8D6E63', 33, false),
    ('Formación',                             'retribuida_empresa',  false, true,  true,  'FORM', '#26C6DA', 34, false),
    ('Permiso sin sueldo',                    'no_retribuida',       false, false, true,  'PSS',  '#FFA726', 40, false),
    ('Ausencia injustificada',                'no_retribuida',       false, false, false, 'AI',   '#5D4037', 45, false),
    ('Ausencia incorporación/salida',         'neutra',              false, false, false, 'INC',  '#BDBDBD', 50, false),
    ('Otro',                                  'neutra',              false, false, true,  'OTR',  '#888888', 90, false)
),
actualiza as (
  update public.rrhh_tipos_ausencia t
  set categoria = l.categoria,
      computa_contador = l.computa_contador,
      color = l.color,
      codigo = coalesce(t.codigo, l.codigo),
      requiere_justificante = l.requiere_justificante
  from lista l
  where t.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
    and lower(t.nombre) = lower(l.nombre)
    and t.color is null
  returning t.id
)
insert into public.rrhh_tipos_ausencia
  (cuenta_id, nombre, categoria, computa_vacaciones, computa_contador, solicitable_empleado, codigo, color, orden, requiere_justificante)
select '082c5366-d9ae-49b9-a8b8-8caad73985bd', l.nombre, l.categoria, l.computa_vacaciones, l.computa_contador,
       l.solicitable, l.codigo, l.color, l.orden, l.requiere_justificante
from lista l
where not exists (
  select 1 from public.rrhh_tipos_ausencia t
  where t.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and lower(t.nombre) = lower(l.nombre)
);

-- Mapa tipo → enum rrhh_tipo_ausencia (compatibilidad con rrhh_ausencias.tipo).
create or replace function public.rrhh_enum_tipo_ausencia(p_tipo_id uuid)
returns public.rrhh_tipo_ausencia
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when x.n = 'vacaciones' then 'vacaciones'::public.rrhh_tipo_ausencia
    when x.n like 'baja%' or x.n like 'accidente%' or x.n like '%maternidad%' or x.n like '%paternidad%'
      then 'baja'::public.rrhh_tipo_ausencia
    when x.n like 'permiso%' or x.n like 'formaci%' or x.n like 'descanso compensatorio%' or x.n like 'fuerza mayor%'
      then 'permiso'::public.rrhh_tipo_ausencia
    else 'otro'::public.rrhh_tipo_ausencia
  end
  from (select rrhh_sin_acentos(nombre) as n from public.rrhh_tipos_ausencia where id = p_tipo_id) x
$$;
revoke execute on function public.rrhh_enum_tipo_ausencia(uuid) from anon, public;
grant execute on function public.rrhh_enum_tipo_ausencia(uuid) to authenticated;

-- ─── rrhh_ausencias: se amplía ────────────────────────────────────────────
alter table public.rrhh_ausencias add column if not exists tipo_id uuid null references public.rrhh_tipos_ausencia(id);
alter table public.rrhh_ausencias add column if not exists medio_dia boolean not null default false;
alter table public.rrhh_ausencias add column if not exists horas numeric null;
alter table public.rrhh_ausencias add column if not exists nota text null;
alter table public.rrhh_ausencias add column if not exists motivo_rechazo text null;
alter table public.rrhh_ausencias add column if not exists resuelta_en timestamptz null;
alter table public.rrhh_ausencias add column if not exists centro_id uuid null references public.centros(id);
create index if not exists idx_rrhh_ausencias_tipo_id on public.rrhh_ausencias (tipo_id);
create index if not exists idx_rrhh_ausencias_emp_fechas on public.rrhh_ausencias (empleado_id, fecha_inicio, fecha_fin);
create index if not exists idx_rrhh_ausencias_estado on public.rrhh_ausencias (cuenta_id, estado);

-- Backfill tipo_id desde el enum.
update public.rrhh_ausencias a
set tipo_id = t.id
from public.rrhh_tipos_ausencia t
where a.tipo_id is null
  and t.cuenta_id = a.cuenta_id
  and lower(t.nombre) = case a.tipo
    when 'vacaciones' then 'vacaciones'
    when 'baja' then 'baja por enfermedad'
    when 'permiso' then 'permiso retribuido'
    else 'otro'
  end;

-- Trigger: si llega tipo_id, el enum tipo se deriva de él (la app solo manda tipo_id).
-- Además vigila que el tipo sea de la misma cuenta y, si quien escribe no es gestor
-- (solicitud del propio empleado), que sea un tipo activo y solicitable: tipo_id solo
-- tiene FK a rrhh_tipos_ausencia y la política de insert propio no lo comprueba.
create or replace function public.rrhh_ausencias_derivar_tipo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tipo_id is not null then
    if not exists (select 1 from public.rrhh_tipos_ausencia t
                   where t.id = new.tipo_id and t.cuenta_id = new.cuenta_id) then
      raise exception 'Tipo de ausencia de otra cuenta';
    end if;
    if not public.rrhh_es_gestor()
       and not exists (select 1 from public.rrhh_tipos_ausencia t
                       where t.id = new.tipo_id and t.activo and t.solicitable_empleado) then
      raise exception 'Este tipo de ausencia no se puede solicitar desde la app';
    end if;
    new.tipo := coalesce(public.rrhh_enum_tipo_ausencia(new.tipo_id), new.tipo, 'otro');
  elsif new.tipo is null then
    new.tipo := 'otro';
  end if;
  return new;
end $$;
revoke all on function public.rrhh_ausencias_derivar_tipo() from public, anon, authenticated;

drop trigger if exists trg_rrhh_ausencias_derivar_tipo on public.rrhh_ausencias;
create trigger trg_rrhh_ausencias_derivar_tipo
  before insert or update of tipo_id on public.rrhh_ausencias
  for each row execute function public.rrhh_ausencias_derivar_tipo();

-- Política nueva: el empleado puede cancelar (delete) su ausencia si aún está solicitada.
drop policy if exists rrhh_ausencias_propio_cancelar on public.rrhh_ausencias;
create policy rrhh_ausencias_propio_cancelar on public.rrhh_ausencias
  for delete to authenticated
  using (cuenta_id = (select cuenta_actual())
         and empleado_id = (select mi_empleado_id()) and estado = 'solicitada');

-- ─── rrhh_festivos ────────────────────────────────────────────────────────
create table if not exists public.rrhh_festivos (
  id         uuid primary key default gen_random_uuid(),
  cuenta_id  uuid not null default cuenta_actual() references public.cuentas(id),
  fecha      date not null,
  nombre     text not null,
  ambito     text not null check (ambito in ('nacional', 'autonomico', 'local')),
  centro_id  uuid null references public.centros(id),
  activo     boolean not null default true,
  comentario text null,
  creado_en  timestamptz not null default now(),
  constraint rrhh_festivos_local_centro check (ambito <> 'local' or centro_id is not null)
);
create unique index if not exists rrhh_festivos_ux
  on public.rrhh_festivos (cuenta_id, fecha, coalesce(centro_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_rrhh_festivos_cuenta_fecha on public.rrhh_festivos (cuenta_id, fecha);

alter table public.rrhh_festivos enable row level security;
revoke all on public.rrhh_festivos from anon;
grant select, insert, update, delete on public.rrhh_festivos to authenticated;

drop policy if exists rrhh_festivos_gestion on public.rrhh_festivos;
create policy rrhh_festivos_gestion on public.rrhh_festivos
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()));

drop policy if exists rrhh_festivos_lectura on public.rrhh_festivos;
create policy rrhh_festivos_lectura on public.rrhh_festivos
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()));

-- Seed festivos 2026 (cuenta Bonita).
-- FUENTE 2026: Resolución de la consejera de Trabajo, Función Pública y Diálogo Social
--   por la que se hace público el calendario laboral general y local para el año 2026
--   en el ámbito de las Illes Balears — BOIB núm. 129 de 27-09-2025 (correcciones de
--   errores BOIB 21-10-2025 y 13-11-2025). Consultado el 01-10-2026 en
--   https://www.caib.es/sites/calendarilaboral/es/aao_2026/ y en el PDF de
--   laboral-social.com (calendario-laboral-general-local-baleares-2026_0.pdf).
--   Contrastado con menorca.info (02-01-2026, «calendario laboral de Menorca 2026, pueblo a pueblo»).
--   Generales Illes Balears 2026: 1 ene, 6 ene, 2 mar, 2 abr, 3 abr, 6 abr, 1 may, 15 ago,
--   12 oct, 8 dic, 25 dic, 26 dic.
--   Locales 2026: Maó 17 ene (Sant Antoni) y 8 sep (Mare de Déu de Gràcia);
--   Sant Lluís 17 ene y 8 sep; Es Mercadal 17 ene y 11 nov (Sant Martí d'hivern);
--   Fornells 17 ene y 16 jul (Mare de Déu del Carme).
-- FUENTE 2027: Consell de Govern de 13-03-2026 (caib.es, ficha «Aprobado el calendario de
--   fiestas laborales de Baleares para el año 2027»): 1 ene, 6 ene, 1 mar, 25 mar, 26 mar,
--   29 mar, 1 may, 12 oct, 1 nov, 6 dic, 8 dic, 25 dic. La resolución con los LOCALES 2027
--   aún no está en el BOIB (se publica en septiembre-octubre de 2026): los locales 2027 se
--   cargan con activo=false y comentario, repitiendo las fechas fijas de 2026.
-- Municipios (plan): Binifadet* + Cocina Produccion = Sant Lluís; Tamarindos* y Estructura =
--   Maó; Casa Tirant = Fornells (Es Mercadal). Para Casa Tirant se activan los de Fornells y
--   se deja el 11 nov de Es Mercadal como activo=false.
with c as (
  select id, nombre from public.centros where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
),
generales (fecha, nombre, ambito, activo, comentario) as (
  values
    (date '2026-01-01', 'Año Nuevo',                               'nacional',   true, null),
    (date '2026-01-06', 'Epifanía del Señor',                      'nacional',   true, null),
    (date '2026-03-02', 'Día siguiente al Día de les Illes Balears','autonomico', true, null),
    (date '2026-04-02', 'Jueves Santo',                            'autonomico', true, null),
    (date '2026-04-03', 'Viernes Santo',                           'nacional',   true, null),
    (date '2026-04-06', 'Lunes de Pascua',                         'autonomico', true, null),
    (date '2026-05-01', 'Fiesta del Trabajo',                      'nacional',   true, null),
    (date '2026-08-15', 'Asunción de la Virgen',                   'nacional',   true, null),
    (date '2026-10-12', 'Fiesta Nacional de España',               'nacional',   true, null),
    (date '2026-12-08', 'Inmaculada Concepción',                   'nacional',   true, null),
    (date '2026-12-25', 'Navidad',                                 'nacional',   true, null),
    (date '2026-12-26', 'Segunda fiesta de Navidad',               'autonomico', true, null),
    (date '2027-01-01', 'Año Nuevo',                               'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-01-06', 'Epifanía del Señor',                      'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-03-01', 'Día de les Illes Balears',                'autonomico', true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-03-25', 'Jueves Santo',                            'autonomico', true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-03-26', 'Viernes Santo',                           'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-03-29', 'Lunes de Pascua',                         'autonomico', true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-05-01', 'Fiesta del Trabajo',                      'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-10-12', 'Fiesta Nacional de España',               'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-11-01', 'Todos los Santos',                        'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-12-06', 'Día de la Constitución',                  'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-12-08', 'Inmaculada Concepción',                   'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB'),
    (date '2027-12-25', 'Navidad',                                 'nacional',   true, 'Consell de Govern 13-03-2026; pendiente BOIB')
),
locales (municipio, fecha, nombre, activo, comentario) as (
  values
    ('mao',        date '2026-01-17', 'Sant Antoni',              true,  null),
    ('mao',        date '2026-09-08', 'Mare de Déu de Gràcia',    true,  null),
    ('santlluis',  date '2026-01-17', 'Sant Antoni',              true,  null),
    ('santlluis',  date '2026-09-08', 'Mare de Déu de Gràcia',    true,  null),
    ('fornells',   date '2026-01-17', 'Sant Antoni',              true,  null),
    ('fornells',   date '2026-07-16', 'Mare de Déu del Carme',    true,  null),
    ('fornells',   date '2026-11-11', 'Sant Martí d''hivern (Es Mercadal)', false, 'Festivo del núcleo de Es Mercadal; Casa Tirant está en Fornells. Activar si aplica.'),
    ('mao',        date '2027-01-17', 'Sant Antoni',              false, 'Locales 2027 no publicados en BOIB (previsión por fecha fija)'),
    ('mao',        date '2027-09-08', 'Mare de Déu de Gràcia',    false, 'Locales 2027 no publicados en BOIB (previsión por fecha fija)'),
    ('santlluis',  date '2027-01-17', 'Sant Antoni',              false, 'Locales 2027 no publicados en BOIB (previsión por fecha fija)'),
    ('santlluis',  date '2027-09-08', 'Mare de Déu de Gràcia',    false, 'Locales 2027 no publicados en BOIB (previsión por fecha fija)'),
    ('fornells',   date '2027-01-17', 'Sant Antoni',              false, 'Locales 2027 no publicados en BOIB (previsión por fecha fija)'),
    ('fornells',   date '2027-07-16', 'Mare de Déu del Carme',    false, 'Locales 2027 no publicados en BOIB (previsión por fecha fija)')
),
centro_municipio as (
  select c.id as centro_id,
         case
           when c.nombre in ('Binifadet Restaurante', 'Binifadet Bodega', 'Binifadet Tienda', 'Cocina Produccion') then 'santlluis'
           when c.nombre in ('Tamarindos Restaurante', 'Tamarindos Bar', 'Estructura') then 'mao'
           when c.nombre = 'Casa Tirant' then 'fornells'
         end as municipio
  from c
),
filas as (
  select '082c5366-d9ae-49b9-a8b8-8caad73985bd'::uuid as cuenta_id, g.fecha, g.nombre, g.ambito, null::uuid as centro_id, g.activo, g.comentario
  from generales g
  union all
  select '082c5366-d9ae-49b9-a8b8-8caad73985bd'::uuid, l.fecha, l.nombre, 'local', cm.centro_id, l.activo, l.comentario
  from locales l
  join centro_municipio cm on cm.municipio = l.municipio
)
insert into public.rrhh_festivos (cuenta_id, fecha, nombre, ambito, centro_id, activo, comentario)
select f.cuenta_id, f.fecha, f.nombre, f.ambito, f.centro_id, f.activo, f.comentario
from filas f
where not exists (
  select 1 from public.rrhh_festivos x
  where x.cuenta_id = f.cuenta_id and x.fecha = f.fecha
    and coalesce(x.centro_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(f.centro_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.2 REGLAS Y CONFIGURACIÓN
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.rrhh_convenios add column if not exists dias_vacaciones_anuales numeric not null default 30;
alter table public.rrhh_convenios add column if not exists dias_laborables_semana numeric not null default 5;
alter table public.rrhh_convenios add column if not exists nocturno_inicio time not null default '22:00';
alter table public.rrhh_convenios add column if not exists nocturno_fin time not null default '06:00';
alter table public.rrhh_convenios add column if not exists horas_extra_max_anual numeric not null default 80;
alter table public.rrhh_convenios add column if not exists complementarias_max_pct numeric not null default 30;
alter table public.rrhh_convenios add column if not exists jornada_anual_h numeric null;

alter table public.rrhh_centros_config add column if not exists regla_horas text not null default 'plan_tolerancia';
alter table public.rrhh_centros_config add column if not exists tolerancia_min integer not null default 10;
alter table public.rrhh_centros_config add column if not exists redondeo_min integer not null default 0;
alter table public.rrhh_centros_config add column if not exists aviso_retraso_min integer not null default 10;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rrhh_centros_config_regla_horas_check') then
    alter table public.rrhh_centros_config
      add constraint rrhh_centros_config_regla_horas_check
      check (regla_horas in ('planificado', 'fichado', 'plan_tolerancia'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rrhh_centros_config_redondeo_check') then
    alter table public.rrhh_centros_config
      add constraint rrhh_centros_config_redondeo_check
      check (redondeo_min in (0, 5, 10, 15));
  end if;
end $$;

-- Lectura de la config de centros por cuenta (como ya tienen rrhh_convenios y
-- rrhh_tipos_ausencia): rrhh_convenio_centro es security invoker y lee convenio_id de aquí;
-- sin esta política, a un empleado (rrhh_saldo_horas / rrhh_saldo_vacaciones desde la app)
-- le salía siempre el convenio por defecto de la cuenta en vez del de su centro.
drop policy if exists rrhh_centros_config_lectura on public.rrhh_centros_config;
create policy rrhh_centros_config_lectura on public.rrhh_centros_config
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()));

-- Convenio que aplica a un centro: el de su config → el por defecto de su cuenta.
-- Devuelve una fila de rrhh_convenios (o una fila de nulos si no hay ninguno:
-- las funciones que la usan hacen coalesce con los valores por defecto).
create or replace function public.rrhh_convenio_centro(p_centro_id uuid, p_cuenta_id uuid default null)
returns public.rrhh_convenios
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.*
  from public.rrhh_convenios c
  where c.id = coalesce(
    (select cc.convenio_id from public.rrhh_centros_config cc where cc.centro_id = p_centro_id),
    (select c2.id from public.rrhh_convenios c2
      where c2.es_por_defecto
        and c2.cuenta_id = coalesce(p_cuenta_id,
                                    (select ce.cuenta_id from public.centros ce where ce.id = p_centro_id),
                                    cuenta_actual())
      order by c2.creado_en limit 1)
  )
$$;
revoke execute on function public.rrhh_convenio_centro(uuid, uuid) from anon, public;
grant execute on function public.rrhh_convenio_centro(uuid, uuid) to authenticated;

-- Centros del empleado que ha iniciado sesión (principal + asignaciones vigentes).
-- Security definer para que las políticas de turnos no dependan de la RLS de
-- empleados/asignaciones del propio empleado.
create or replace function public.rrhh_mis_centros()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.centro_principal_id
  from public.empleados e
  where e.user_id = auth.uid() and e.centro_principal_id is not null
  union
  select a.centro_id
  from public.rrhh_asignaciones a
  join public.empleados e on e.id = a.empleado_id
  where e.user_id = auth.uid()
    and (a.fecha_inicio is null or a.fecha_inicio <= current_date)
    and (a.fecha_fin is null or a.fecha_fin >= current_date)
$$;
revoke execute on function public.rrhh_mis_centros() from anon, public;
grant execute on function public.rrhh_mis_centros() to authenticated;

-- ¿Gestiono a este empleado? Gestor de la cuenta, o encargado de su centro principal o de
-- una asignación vigente. Security definer porque empleados solo tiene RLS para
-- direccion/administracion/jefe_sala y para el propio: un encargado (responsable_area) no
-- puede leer empleados, así que un subselect sobre empleados en una política le daría
-- siempre false. Lo usan las políticas de lectura «gestión» de las tablas por empleado.
create or replace function public.rrhh_gestiona_empleado(p_empleado_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.rrhh_es_gestor()
      or exists (
        select 1 from public.empleados e
        where e.id = p_empleado_id
          and e.cuenta_id = public.cuenta_actual()
          and (public.rrhh_gestiona_centro(e.centro_principal_id)
               or exists (select 1 from public.rrhh_asignaciones a
                          where a.empleado_id = e.id
                            and public.rrhh_gestiona_centro(a.centro_id)
                            and (a.fecha_inicio is null or a.fecha_inicio <= current_date)
                            and (a.fecha_fin is null or a.fecha_fin >= current_date))))
$$;
revoke execute on function public.rrhh_gestiona_empleado(uuid) from anon, public;
grant execute on function public.rrhh_gestiona_empleado(uuid) to authenticated;

-- ¿Es este empleado de mi cuenta? Security definer por el mismo motivo (un empleado no puede
-- leer a sus compañeros). Lo usan las políticas de cambios de turno para que el destinatario
-- no pueda ser alguien de otra cuenta (el FK no lo impide).
create or replace function public.rrhh_empleado_misma_cuenta(p_empleado_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.empleados e
    where e.id = p_empleado_id and e.cuenta_id = public.cuenta_actual()
  )
$$;
revoke execute on function public.rrhh_empleado_misma_cuenta(uuid) from anon, public;
grant execute on function public.rrhh_empleado_misma_cuenta(uuid) to authenticated;

-- Encargados por centro: seed por dominio de correo (perfiles responsable_area / jefe_sala
-- de la cuenta Bonita). Insert solo si no existe.
insert into public.rrhh_encargados_centro (cuenta_id, user_id, centro_id)
select p.cuenta_id, p.id, c.id
from public.perfiles p
join (values
  ('binifadet.com',         'Binifadet Restaurante'),
  ('binifadet.com',         'Binifadet Bodega'),
  ('binifadet.com',         'Binifadet Tienda'),
  ('binifadet.com',         'Cocina Produccion'),
  ('tamarindosmenorca.com', 'Tamarindos Restaurante'),
  ('elbardetamarindos.com', 'Tamarindos Bar'),
  ('casatirant.com',        'Casa Tirant')
) m (dominio, centro) on lower(split_part(p.correo, '@', 2)) = m.dominio
join public.centros c on c.cuenta_id = p.cuenta_id and c.nombre = m.centro
where p.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
  and p.rol in ('responsable_area', 'jefe_sala')
  and not exists (
    select 1 from public.rrhh_encargados_centro x
    where x.user_id = p.id and x.centro_id = c.id
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.3 EMPLEADOS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.empleados add column if not exists codigo_nomina text null;
alter table public.empleados add column if not exists puesto_defecto_id uuid null references public.rrhh_puestos_cat(id);
alter table public.empleados add column if not exists fecha_nacimiento date null;
alter table public.empleados add column if not exists nota text null;
alter table public.empleados add column if not exists contador_inicial_h numeric not null default 0;
alter table public.empleados add column if not exists contador_inicial_fecha date null;
alter table public.empleados add column if not exists vacaciones_ajuste_dias numeric not null default 0;
create index if not exists idx_empleados_puesto_defecto on public.empleados (puesto_defecto_id);

-- Backfill puesto_defecto_id: el puesto más frecuente de sus turnos.
update public.empleados e
set puesto_defecto_id = x.puesto_id
from (
  select distinct on (empleado_id) empleado_id, puesto_id
  from (
    select empleado_id, puesto_id, count(*) as n
    from public.rrhh_turnos
    where empleado_id is not null and puesto_id is not null
    group by 1, 2
  ) q
  order by empleado_id, n desc
) x
where x.empleado_id = e.id
  and e.puesto_defecto_id is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.4 PLANIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── rrhh_turnos: turno sin asignar + columnas nuevas ─────────────────────
alter table public.rrhh_turnos alter column empleado_id drop not null;
alter table public.rrhh_turnos add column if not exists nota text null;
alter table public.rrhh_turnos add column if not exists color text null;
alter table public.rrhh_turnos add column if not exists modificado_en timestamptz not null default now();
create index if not exists idx_rrhh_turnos_huecos
  on public.rrhh_turnos (centro_id, fecha) where empleado_id is null;

-- Políticas nuevas para el empleado (2.9 «Apuntarme a huecos»): ver turnos publicados sin
-- asignar de sus centros y apuntarse (update empleado_id = yo). Las existentes no se tocan.
drop policy if exists rrhh_turnos_huecos_lectura on public.rrhh_turnos;
create policy rrhh_turnos_huecos_lectura on public.rrhh_turnos
  for select to authenticated
  using (
    empleado_id is null
    and estado = 'publicado'
    and cuenta_id = (select cuenta_actual())
    and centro_id in (select rrhh_mis_centros())
  );

drop policy if exists rrhh_turnos_hueco_apuntarse on public.rrhh_turnos;
create policy rrhh_turnos_hueco_apuntarse on public.rrhh_turnos
  for update to authenticated
  using (
    empleado_id is null
    and estado = 'publicado'
    and cuenta_id = (select cuenta_actual())
    and centro_id in (select rrhh_mis_centros())
  )
  with check (
    empleado_id = (select mi_empleado_id())
    and estado = 'publicado'
    and cuenta_id = (select cuenta_actual())
    and centro_id in (select rrhh_mis_centros())
  );

-- Al apuntarse a un hueco, quien no gestiona el centro solo puede poner empleado_id = yo:
-- la política no puede fijar el resto de columnas (horas, fecha, puesto, centro…), así que
-- lo vigila este trigger comparando old/new. Para gestores/encargados no hace nada.
create or replace function public.rrhh_turnos_guard_apuntarse()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.empleado_id is null and not public.rrhh_gestiona_centro(old.centro_id) then
    if new.empleado_id is distinct from public.mi_empleado_id()
       or new.centro_id is distinct from old.centro_id
       or new.fecha is distinct from old.fecha
       or new.hora_inicio is distinct from old.hora_inicio
       or new.hora_fin is distinct from old.hora_fin
       or new.pausa_min is distinct from old.pausa_min
       or new.puesto is distinct from old.puesto
       or new.puesto_id is distinct from old.puesto_id
       or new.estado is distinct from old.estado
       or new.cuenta_id is distinct from old.cuenta_id
       or new.color is distinct from old.color
       or new.nota is distinct from old.nota
       or new.publicado_at is distinct from old.publicado_at
       or new.creado_por is distinct from old.creado_por
       or new.creado_en is distinct from old.creado_en then
      raise exception 'Al apuntarte a un hueco solo puedes asignártelo; no se cambia nada más';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.rrhh_turnos_guard_apuntarse() from public, anon, authenticated;

drop trigger if exists trg_rrhh_turnos_guard_apuntarse on public.rrhh_turnos;
create trigger trg_rrhh_turnos_guard_apuntarse
  before update on public.rrhh_turnos
  for each row when (old.empleado_id is null)
  execute function public.rrhh_turnos_guard_apuntarse();

-- ─── rrhh_turnos_historial: quién cambió qué ──────────────────────────────
create table if not exists public.rrhh_turnos_historial (
  id        uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null,
  turno_id  uuid not null,
  centro_id uuid null,
  accion    text not null check (accion in ('insert', 'update', 'delete')),
  antes     jsonb null,
  despues   jsonb null,
  user_id   uuid null,
  ts        timestamptz not null default now()
);
create index if not exists idx_rrhh_turnos_historial_turno on public.rrhh_turnos_historial (turno_id, ts desc);
create index if not exists idx_rrhh_turnos_historial_cuenta_ts on public.rrhh_turnos_historial (cuenta_id, ts desc);

alter table public.rrhh_turnos_historial enable row level security;
revoke all on public.rrhh_turnos_historial from anon;
-- El default ACL de public da arwdDxtm a authenticated en toda tabla nueva: hay que
-- revocar explícitamente lo que no se quiere, el grant por sí solo no restringe.
revoke insert, update, delete on public.rrhh_turnos_historial from authenticated;
grant select on public.rrhh_turnos_historial to authenticated;

-- Lectura: gestores y encargados del centro del turno. Escribe solo el trigger (definer).
drop policy if exists rrhh_turnos_historial_lectura on public.rrhh_turnos_historial;
create policy rrhh_turnos_historial_lectura on public.rrhh_turnos_historial
  for select to authenticated
  using ((cuenta_id = (select cuenta_actual()) and rrhh_gestiona_centro(centro_id)) or (select es_operador()));

create or replace function public.rrhh_turnos_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.rrhh_turnos_historial (cuenta_id, turno_id, centro_id, accion, antes, despues, user_id)
    values (new.cuenta_id, new.id, new.centro_id, 'insert', null, to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.rrhh_turnos_historial (cuenta_id, turno_id, centro_id, accion, antes, despues, user_id)
    values (new.cuenta_id, new.id, new.centro_id, 'update', to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    insert into public.rrhh_turnos_historial (cuenta_id, turno_id, centro_id, accion, antes, despues, user_id)
    values (old.cuenta_id, old.id, old.centro_id, 'delete', to_jsonb(old), null, auth.uid());
    return old;
  end if;
end $$;
revoke all on function public.rrhh_turnos_log() from public, anon, authenticated;

-- Sello modificado_en en cada update.
create or replace function public.rrhh_turnos_tocar_modificado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.modificado_en := now();
  return new;
end $$;
revoke all on function public.rrhh_turnos_tocar_modificado() from public, anon, authenticated;

-- Los triggers se crean DESPUÉS de los backfills de arriba (puesto, puesto_id) para no
-- generar 14.000 filas de historial por la propia migración.
drop trigger if exists trg_rrhh_turnos_modificado on public.rrhh_turnos;
create trigger trg_rrhh_turnos_modificado
  before update on public.rrhh_turnos
  for each row execute function public.rrhh_turnos_tocar_modificado();

drop trigger if exists trg_rrhh_turnos_log on public.rrhh_turnos;
create trigger trg_rrhh_turnos_log
  after insert or update or delete on public.rrhh_turnos
  for each row execute function public.rrhh_turnos_log();

-- ─── rrhh_plantillas_turno: turnos rápidos por centro ─────────────────────
create table if not exists public.rrhh_plantillas_turno (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null default cuenta_actual() references public.cuentas(id),
  centro_id   uuid null references public.centros(id),
  nombre      text not null,
  hora_inicio time not null,
  hora_fin    time not null,
  pausa_min   integer not null default 0 check (pausa_min >= 0),
  puesto_id   uuid null references public.rrhh_puestos_cat(id),
  orden       integer not null default 100,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_rrhh_plantillas_turno_cuenta on public.rrhh_plantillas_turno (cuenta_id);
create index if not exists idx_rrhh_plantillas_turno_centro on public.rrhh_plantillas_turno (centro_id);

alter table public.rrhh_plantillas_turno enable row level security;
revoke all on public.rrhh_plantillas_turno from anon;
grant select, insert, update, delete on public.rrhh_plantillas_turno to authenticated;

drop policy if exists rrhh_plantillas_turno_gestion on public.rrhh_plantillas_turno;
create policy rrhh_plantillas_turno_gestion on public.rrhh_plantillas_turno
  for all to authenticated
  using (
    (cuenta_id = (select cuenta_actual())
      and (case when centro_id is null then (select rrhh_es_gestor()) else rrhh_gestiona_centro(centro_id) end))
    or (select es_operador())
  )
  with check (
    (cuenta_id = (select cuenta_actual())
      and (case when centro_id is null then (select rrhh_es_gestor()) else rrhh_gestiona_centro(centro_id) end))
    or (select es_operador())
  );

drop policy if exists rrhh_plantillas_turno_lectura on public.rrhh_plantillas_turno;
create policy rrhh_plantillas_turno_lectura on public.rrhh_plantillas_turno
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()));

-- Seed: los 6 pares (hora_inicio, hora_fin, pausa) más frecuentes de cada centro,
-- nombre «HH:MM–HH:MM». Solo para centros que aún no tienen plantillas.
insert into public.rrhh_plantillas_turno (cuenta_id, centro_id, nombre, hora_inicio, hora_fin, pausa_min, orden)
select q.cuenta_id, q.centro_id,
       to_char(q.hora_inicio, 'HH24:MI') || '–' || to_char(q.hora_fin, 'HH24:MI')
         || case when q.pausa_min > 0 then ' · ' || q.pausa_min || ' min' else '' end,
       q.hora_inicio, q.hora_fin, q.pausa_min, q.rn
from (
  select cuenta_id, centro_id, hora_inicio, hora_fin, pausa_min, count(*) as n,
         row_number() over (partition by centro_id order by count(*) desc, hora_inicio) as rn
  from public.rrhh_turnos
  group by cuenta_id, centro_id, hora_inicio, hora_fin, pausa_min
) q
where q.rn <= 6
  and not exists (select 1 from public.rrhh_plantillas_turno p where p.centro_id = q.centro_id);

-- ─── rrhh_plantillas_semana: modelos de semana (Skello) ───────────────────
create table if not exists public.rrhh_plantillas_semana (
  id         uuid primary key default gen_random_uuid(),
  cuenta_id  uuid not null default cuenta_actual() references public.cuentas(id),
  centro_id  uuid not null references public.centros(id),
  nombre     text not null,
  -- [{empleado_id, dow 0-6 (0 = lunes), hora_inicio, hora_fin, pausa_min, puesto_id}]
  turnos     jsonb not null default '[]'::jsonb,
  creado_por uuid null,
  creado_en  timestamptz not null default now()
);
create index if not exists idx_rrhh_plantillas_semana_cuenta on public.rrhh_plantillas_semana (cuenta_id);
create index if not exists idx_rrhh_plantillas_semana_centro on public.rrhh_plantillas_semana (centro_id);

alter table public.rrhh_plantillas_semana enable row level security;
revoke all on public.rrhh_plantillas_semana from anon;
grant select, insert, update, delete on public.rrhh_plantillas_semana to authenticated;

drop policy if exists rrhh_plantillas_semana_gestion on public.rrhh_plantillas_semana;
create policy rrhh_plantillas_semana_gestion on public.rrhh_plantillas_semana
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and rrhh_gestiona_centro(centro_id)) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and rrhh_gestiona_centro(centro_id)) or (select es_operador()));

-- ─── rrhh_disponibilidades: el empleado marca días que no puede / prefiere ─
create table if not exists public.rrhh_disponibilidades (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null default cuenta_actual() references public.cuentas(id),
  empleado_id uuid not null references public.empleados(id),
  fecha       date not null,
  tipo        text not null check (tipo in ('no_disponible', 'prefiere')),
  nota        text null,
  creado_en   timestamptz not null default now(),
  unique (empleado_id, fecha)
);
create index if not exists idx_rrhh_disponibilidades_cuenta on public.rrhh_disponibilidades (cuenta_id);
create index if not exists idx_rrhh_disponibilidades_emp_fecha on public.rrhh_disponibilidades (empleado_id, fecha);

alter table public.rrhh_disponibilidades enable row level security;
revoke all on public.rrhh_disponibilidades from anon;
grant select, insert, update, delete on public.rrhh_disponibilidades to authenticated;

drop policy if exists rrhh_disponibilidades_propio on public.rrhh_disponibilidades;
create policy rrhh_disponibilidades_propio on public.rrhh_disponibilidades
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) and empleado_id = (select mi_empleado_id()))
  with check (cuenta_id = (select cuenta_actual()) and empleado_id = (select mi_empleado_id()));

-- Lectura para gestores y encargados vía rrhh_gestiona_empleado (definer): un subselect
-- sobre empleados aquí se evaluaría con la RLS del encargado, que no puede leer empleados.
drop policy if exists rrhh_disponibilidades_gestion_lectura on public.rrhh_disponibilidades;
create policy rrhh_disponibilidades_gestion_lectura on public.rrhh_disponibilidades
  for select to authenticated
  using (
    (cuenta_id = (select cuenta_actual()) and rrhh_gestiona_empleado(empleado_id))
    or (select es_operador())
  );

-- ─── rrhh_cambios_turno: intercambio entre compañeros ─────────────────────
create table if not exists public.rrhh_cambios_turno (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null default cuenta_actual() references public.cuentas(id),
  turno_id        uuid not null references public.rrhh_turnos(id) on delete cascade,
  solicitante_id  uuid not null references public.empleados(id),
  destinatario_id uuid null references public.empleados(id),
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'aceptado_companero', 'aprobado', 'rechazado', 'cancelado')),
  nota            text null,
  resuelto_por    uuid null,
  resuelto_en     timestamptz null,
  creado_en       timestamptz not null default now()
);
create index if not exists idx_rrhh_cambios_turno_cuenta on public.rrhh_cambios_turno (cuenta_id, estado);
create index if not exists idx_rrhh_cambios_turno_turno on public.rrhh_cambios_turno (turno_id);
create index if not exists idx_rrhh_cambios_turno_solicitante on public.rrhh_cambios_turno (solicitante_id);
create index if not exists idx_rrhh_cambios_turno_destinatario on public.rrhh_cambios_turno (destinatario_id);

alter table public.rrhh_cambios_turno enable row level security;
revoke all on public.rrhh_cambios_turno from anon;
grant select, insert, update, delete on public.rrhh_cambios_turno to authenticated;

drop policy if exists rrhh_cambios_turno_gestion on public.rrhh_cambios_turno;
create policy rrhh_cambios_turno_gestion on public.rrhh_cambios_turno
  for all to authenticated
  using (
    (cuenta_id = (select cuenta_actual())
      and ((select rrhh_es_gestor())
           or exists (select 1 from public.rrhh_turnos t
                      where t.id = rrhh_cambios_turno.turno_id and rrhh_gestiona_centro(t.centro_id))))
    or (select es_operador())
  )
  with check (
    (cuenta_id = (select cuenta_actual())
      and ((select rrhh_es_gestor())
           or exists (select 1 from public.rrhh_turnos t
                      where t.id = rrhh_cambios_turno.turno_id and rrhh_gestiona_centro(t.centro_id))))
    or (select es_operador())
  );

drop policy if exists rrhh_cambios_turno_propio_lectura on public.rrhh_cambios_turno;
create policy rrhh_cambios_turno_propio_lectura on public.rrhh_cambios_turno
  for select to authenticated
  using (cuenta_id = (select cuenta_actual())
         and (solicitante_id = (select mi_empleado_id()) or destinatario_id = (select mi_empleado_id())));

-- El empleado solo abre cambios sobre un turno SUYO y publicado (rrhh_turnos_propio ya le deja
-- ver sus turnos publicados, así que el exists resuelve bajo RLS) y el destinatario, si lo
-- hay, tiene que ser de su cuenta.
drop policy if exists rrhh_cambios_turno_propio_solicitud on public.rrhh_cambios_turno;
create policy rrhh_cambios_turno_propio_solicitud on public.rrhh_cambios_turno
  for insert to authenticated
  with check (
    solicitante_id = (select mi_empleado_id())
    and cuenta_id = (select cuenta_actual())
    and estado = 'pendiente'
    and resuelto_por is null and resuelto_en is null
    and exists (select 1 from public.rrhh_turnos t
                where t.id = rrhh_cambios_turno.turno_id
                  and t.empleado_id = (select mi_empleado_id())
                  and t.estado = 'publicado')
    and (destinatario_id is null or rrhh_empleado_misma_cuenta(destinatario_id))
  );

-- El solicitante cancela; el destinatario acepta o rechaza. La política acota cuenta, quién y
-- estados; las columnas que no se pueden tocar y las transiciones las vigila el trigger
-- rrhh_cambios_turno_guard (abajo).
drop policy if exists rrhh_cambios_turno_propio_respuesta on public.rrhh_cambios_turno;
create policy rrhh_cambios_turno_propio_respuesta on public.rrhh_cambios_turno
  for update to authenticated
  using (cuenta_id = (select cuenta_actual())
         and (solicitante_id = (select mi_empleado_id()) or destinatario_id = (select mi_empleado_id())))
  with check (
    cuenta_id = (select cuenta_actual())
    and (solicitante_id = (select mi_empleado_id()) or destinatario_id = (select mi_empleado_id()))
    and estado in ('pendiente', 'aceptado_companero', 'rechazado', 'cancelado')
    and (destinatario_id is null or rrhh_empleado_misma_cuenta(destinatario_id))
  );

-- Guard de transiciones para quien no gestiona el turno:
--   · no se cambia turno_id, solicitante_id, cuenta_id ni creado_en;
--   · solo se tocan peticiones pendientes o aceptadas por el compañero;
--   · el solicitante solo puede cancelar (o dejarla pendiente, p. ej. para cambiar la nota o
--     el destinatario mientras nadie ha aceptado);
--   · el destinatario solo puede aceptar o rechazar, sin reasignarse.
-- Gestores y encargados del centro del turno pasan sin restricción (aprueban/rechazan).
create or replace function public.rrhh_cambios_turno_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_yo uuid := public.mi_empleado_id();
begin
  if public.rrhh_es_gestor()
     or exists (select 1 from public.rrhh_turnos t
                where t.id = old.turno_id and public.rrhh_gestiona_centro(t.centro_id)) then
    return new;
  end if;
  if new.turno_id is distinct from old.turno_id
     or new.solicitante_id is distinct from old.solicitante_id
     or new.cuenta_id is distinct from old.cuenta_id
     or new.creado_en is distinct from old.creado_en then
    raise exception 'No puedes cambiar el turno ni el solicitante de una petición';
  end if;
  if old.estado not in ('pendiente', 'aceptado_companero') then
    raise exception 'La petición ya está resuelta';
  end if;
  if old.solicitante_id = v_yo then
    if new.estado not in (old.estado, 'cancelado') then
      raise exception 'Como solicitante solo puedes cancelar';
    end if;
  elsif old.destinatario_id = v_yo then
    if new.destinatario_id is distinct from old.destinatario_id
       or new.estado not in ('aceptado_companero', 'rechazado') then
      raise exception 'Como destinatario solo puedes aceptar o rechazar';
    end if;
  else
    raise exception 'No es tu petición';
  end if;
  if new.estado in ('rechazado', 'cancelado') and new.estado <> old.estado then
    new.resuelto_por := auth.uid();
    new.resuelto_en := now();
  end if;
  return new;
end $$;
revoke all on function public.rrhh_cambios_turno_guard() from public, anon, authenticated;

drop trigger if exists trg_rrhh_cambios_turno_guard on public.rrhh_cambios_turno;
create trigger trg_rrhh_cambios_turno_guard
  before update on public.rrhh_cambios_turno
  for each row execute function public.rrhh_cambios_turno_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.5 FICHAJES Y HORAS
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── rrhh_horas_dia: planificado vs fichado, validación (Skello) ──────────
create table if not exists public.rrhh_horas_dia (
  id               uuid primary key default gen_random_uuid(),
  cuenta_id        uuid not null default cuenta_actual() references public.cuentas(id),
  empleado_id      uuid not null references public.empleados(id),
  centro_id        uuid not null references public.centros(id),
  fecha            date not null,
  horas_plan       numeric null,
  horas_fichadas   numeric null,
  horas_retenidas  numeric not null,
  retraso_min      integer not null default 0,
  salida_antic_min integer not null default 0,
  incidencias      jsonb not null default '[]'::jsonb,
  estado           text not null default 'propuesta' check (estado in ('propuesta', 'validada')),
  nota             text null,
  validado_por     uuid null,
  validado_en      timestamptz null,
  creado_en        timestamptz not null default now(),
  modificado_en    timestamptz not null default now(),
  unique (empleado_id, fecha, centro_id)
);
create index if not exists idx_rrhh_horas_dia_cuenta on public.rrhh_horas_dia (cuenta_id);
create index if not exists idx_rrhh_horas_dia_emp_fecha on public.rrhh_horas_dia (empleado_id, fecha);
create index if not exists idx_rrhh_horas_dia_centro_fecha on public.rrhh_horas_dia (centro_id, fecha);

alter table public.rrhh_horas_dia enable row level security;
revoke all on public.rrhh_horas_dia from anon;
grant select, insert, update, delete on public.rrhh_horas_dia to authenticated;

drop policy if exists rrhh_horas_dia_gestion on public.rrhh_horas_dia;
create policy rrhh_horas_dia_gestion on public.rrhh_horas_dia
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and rrhh_gestiona_centro(centro_id)) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and rrhh_gestiona_centro(centro_id)) or (select es_operador()));

drop policy if exists rrhh_horas_dia_propio on public.rrhh_horas_dia;
create policy rrhh_horas_dia_propio on public.rrhh_horas_dia
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) and empleado_id = (select mi_empleado_id()));

create or replace function public.rrhh_horas_dia_tocar_modificado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.modificado_en := now();
  return new;
end $$;
revoke all on function public.rrhh_horas_dia_tocar_modificado() from public, anon, authenticated;

drop trigger if exists trg_rrhh_horas_dia_modificado on public.rrhh_horas_dia;
create trigger trg_rrhh_horas_dia_modificado
  before update on public.rrhh_horas_dia
  for each row execute function public.rrhh_horas_dia_tocar_modificado();

-- ─── rrhh_fichajes: hora del dispositivo (cola sin conexión) y nota ───────
-- El trigger rrhh_fichajes_ts_servidor NO cambia: ts sigue siendo la hora del servidor.
alter table public.rrhh_fichajes add column if not exists ts_dispositivo timestamptz null;
alter table public.rrhh_fichajes add column if not exists nota text null;

-- ─── rrhh_contador_ajustes: ajustes manuales del contador de horas ────────
create table if not exists public.rrhh_contador_ajustes (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null default cuenta_actual() references public.cuentas(id),
  empleado_id uuid not null references public.empleados(id),
  fecha       date not null default current_date,
  horas       numeric not null,
  tipo        text not null check (tipo in ('ajuste', 'pago', 'descanso', 'inicial')),
  motivo      text not null,
  creado_por  uuid null,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_rrhh_contador_ajustes_cuenta on public.rrhh_contador_ajustes (cuenta_id);
create index if not exists idx_rrhh_contador_ajustes_emp_fecha on public.rrhh_contador_ajustes (empleado_id, fecha);

alter table public.rrhh_contador_ajustes enable row level security;
revoke all on public.rrhh_contador_ajustes from anon;
-- Apuntes inmutables («nunca se borra, se compensa», plan 1.5): solo select e insert.
-- El default ACL de public da arwdDxtm a authenticated, así que update/delete se revocan.
revoke update, delete on public.rrhh_contador_ajustes from authenticated;
grant select, insert on public.rrhh_contador_ajustes to authenticated;

drop policy if exists rrhh_contador_ajustes_gestion on public.rrhh_contador_ajustes;
create policy rrhh_contador_ajustes_gestion on public.rrhh_contador_ajustes
  for select to authenticated
  using ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()));

drop policy if exists rrhh_contador_ajustes_gestion_insert on public.rrhh_contador_ajustes;
create policy rrhh_contador_ajustes_gestion_insert on public.rrhh_contador_ajustes
  for insert to authenticated
  with check ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()));

drop policy if exists rrhh_contador_ajustes_propio on public.rrhh_contador_ajustes;
create policy rrhh_contador_ajustes_propio on public.rrhh_contador_ajustes
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) and empleado_id = (select mi_empleado_id()));

-- Nunca se borra: se compensa con otro apunte (como Skello, pero visible).
create or replace function public.rrhh_contador_ajustes_no_borrar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Los ajustes del contador no se borran: añade un apunte que lo compense';
end $$;
revoke all on function public.rrhh_contador_ajustes_no_borrar() from public, anon, authenticated;

drop trigger if exists trg_rrhh_contador_ajustes_no_borrar on public.rrhh_contador_ajustes;
create trigger trg_rrhh_contador_ajustes_no_borrar
  before delete on public.rrhh_contador_ajustes
  for each row execute function public.rrhh_contador_ajustes_no_borrar();

-- ─── rrhh_variables_nomina: primas, anticipos, plus, dietas del mes ───────
create table if not exists public.rrhh_variables_nomina (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null default cuenta_actual() references public.cuentas(id),
  empleado_id uuid not null references public.empleados(id),
  anio        integer not null check (anio between 2000 and 2100),
  mes         integer not null check (mes between 1 and 12),
  concepto    text not null,
  importe     numeric not null,
  descripcion text null,
  creado_por  uuid null,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_rrhh_variables_nomina_cuenta_mes on public.rrhh_variables_nomina (cuenta_id, anio, mes);
create index if not exists idx_rrhh_variables_nomina_emp_mes on public.rrhh_variables_nomina (empleado_id, anio, mes);

alter table public.rrhh_variables_nomina enable row level security;
revoke all on public.rrhh_variables_nomina from anon;
grant select, insert, update, delete on public.rrhh_variables_nomina to authenticated;

drop policy if exists rrhh_variables_nomina_gestion on public.rrhh_variables_nomina;
create policy rrhh_variables_nomina_gestion on public.rrhh_variables_nomina
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()));

drop policy if exists rrhh_variables_nomina_propio on public.rrhh_variables_nomina;
create policy rrhh_variables_nomina_propio on public.rrhh_variables_nomina
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) and empleado_id = (select mi_empleado_id()));

-- ─── rrhh_nomina_comentarios: comentario para la gestoría por empleado y mes ──
-- (No está en el plan como tabla, pero 2.6 pide «comentario para la gestoría» y
-- rrhh_informe_nomina lo devuelve; hace falta dónde guardarlo.)
create table if not exists public.rrhh_nomina_comentarios (
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id),
  empleado_id    uuid not null references public.empleados(id),
  anio           integer not null check (anio between 2000 and 2100),
  mes            integer not null check (mes between 1 and 12),
  comentario     text not null default '',
  modificado_por uuid null,
  modificado_en  timestamptz not null default now(),
  primary key (empleado_id, anio, mes)
);
create index if not exists idx_rrhh_nomina_comentarios_cuenta_mes on public.rrhh_nomina_comentarios (cuenta_id, anio, mes);

alter table public.rrhh_nomina_comentarios enable row level security;
revoke all on public.rrhh_nomina_comentarios from anon;
grant select, insert, update, delete on public.rrhh_nomina_comentarios to authenticated;

drop policy if exists rrhh_nomina_comentarios_gestion on public.rrhh_nomina_comentarios;
create policy rrhh_nomina_comentarios_gestion on public.rrhh_nomina_comentarios
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()));

-- ─── rrhh (tabla de Ratios): columna origen ───────────────────────────────
alter table public.rrhh add column if not exists origen text null;
create index if not exists idx_rrhh_origen_fecha on public.rrhh (origen, fecha);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.6 FUNCIONES
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── rrhh_semana_iso(fecha) → (anio, semana, lunes) ───────────────────────
create or replace function public.rrhh_semana_iso(p_fecha date)
returns table (anio integer, semana integer, lunes date)
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select extract(isoyear from p_fecha)::integer,
         extract(week from p_fecha)::integer,
         date_trunc('week', p_fecha::timestamp)::date
$$;
revoke execute on function public.rrhh_semana_iso(date) from anon, public;
grant execute on function public.rrhh_semana_iso(date) to authenticated;

-- ─── rrhh_periodos_efectivos(empleado) → (fecha_alta, fecha_baja, horas_semana) ───
-- Periodos de contrato SIN solapes: cada periodo se cierra en la víspera del siguiente
-- (por fecha_alta) si estaba abierto o acababa más tarde. En la base hay 5 empleados con
-- varios periodos abiertos a la vez (p. ej. tres «abiertos» tras llamamientos sucesivos de
-- un fijo discontinuo); si se sumaran tal cual, el contrato semanal saldría 44 h en vez de 40,
-- el informe de nómina tendría más días de contrato que el mes y el derecho de vacaciones
-- pasaría de 30. Si un periodo no tiene horas_semana se toma la del empleado. Si el empleado
-- no tiene periodos, se usa empleados (fecha_alta/fecha_baja/horas_semana).
create or replace function public.rrhh_periodos_efectivos(p_empleado_id uuid)
returns table (fecha_alta date, fecha_baja date, horas_semana numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select pc.fecha_alta, pc.fecha_baja,
           coalesce(pc.horas_semana, e.horas_semana, 0) as horas_semana,
           lead(pc.fecha_alta) over (order by pc.fecha_alta, pc.creado_en) as sig_alta
    from public.rrhh_periodos_contrato pc
    join public.empleados e on e.id = pc.empleado_id
    where pc.empleado_id = p_empleado_id
  )
  select p.fecha_alta,
         case when p.sig_alta is null then p.fecha_baja
              else least(coalesce(p.fecha_baja, p.sig_alta - 1), p.sig_alta - 1) end,
         p.horas_semana
  from p
  union all
  select coalesce(e.fecha_alta, date '1900-01-01'), e.fecha_baja, coalesce(e.horas_semana, 0)
  from public.empleados e
  where e.id = p_empleado_id
    and not exists (select 1 from public.rrhh_periodos_contrato pc where pc.empleado_id = p_empleado_id)
$$;
revoke execute on function public.rrhh_periodos_efectivos(uuid) from anon, public;
grant execute on function public.rrhh_periodos_efectivos(uuid) to authenticated;

-- ─── rrhh_horas_contrato_semana(empleado, lunes) ──────────────────────────
-- Horas de contrato de la semana [lunes, lunes+6]: horas_semana de cada periodo de
-- contrato vigente (rrhh_periodos_efectivos, sin solapes), prorrateadas por los días del
-- periodo dentro de la semana (alta o baja a mitad de semana).
create or replace function public.rrhh_horas_contrato_semana(p_empleado_id uuid, p_lunes date)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with per as (
    select * from public.rrhh_periodos_efectivos(p_empleado_id)
  )
  select round(coalesce(sum(
      horas_semana
      * greatest(0, least(coalesce(fecha_baja, p_lunes + 6), p_lunes + 6) - greatest(fecha_alta, p_lunes) + 1)
      / 7.0
    ), 0), 2)
  from per
  where fecha_alta <= p_lunes + 6
    and (fecha_baja is null or fecha_baja >= p_lunes)
$$;
revoke execute on function public.rrhh_horas_contrato_semana(uuid, date) from anon, public;
grant execute on function public.rrhh_horas_contrato_semana(uuid, date) to authenticated;

-- ─── rrhh_resumen_semana(centro, desde, hasta [, empleado]) ───────────────
-- Una fila por empleado y semana ISO (semanas COMPLETAS que tocan [desde, hasta]).
--
-- Empleados incluidos: los de la cuenta; si se da centro, los que tienen ese centro como
-- principal, una asignación que solape el rango o algún turno en ese centro en el rango.
-- El contador es de la PERSONA: las horas suman los turnos de todos los centros
-- (horas_plan_centro da solo las del centro filtrado).
--
-- Cálculo por semana:
--   horas_contrato    = rrhh_horas_contrato_semana(empleado, lunes).
--   horas_plan        = Σ horas de turnos estado='publicado' con empleado_id no nulo
--                       (horas de un turno = rrhh_horas_turno: fin−inicio, +24 h si fin<=inicio, −pausa).
--   horas_retenidas   = por cada (día, centro): si hay rrhh_horas_dia estado='validada' para
--                       (empleado, fecha, centro), sus horas_retenidas; si no, las horas planificadas
--                       en ese centro ese día. Se casa por centro porque la validación (Fichajes) es
--                       por centro: validar un centro no borra el plan del otro. Se suman los días.
--   horas_ausencia_contador = ausencias aprobadas cuyo tipo computa_contador (si la ausencia no
--                       tiene tipo_id, computa si el enum es vacaciones, permiso o baja), SOLO en los
--                       días sin horas planificadas ni validadas (un día es trabajo O ausencia,
--                       nunca los dos, como en Skello):
--                       · con `horas`: ese valor por cada día de la ausencia dentro de la semana;
--                       · si no: días de la ausencia dentro de la semana (medio_dia = 0,5), con tope
--                         dias_laborables_semana del convenio (una semana entera de vacaciones
--                         = horas_contrato), × jornada diaria (horas_contrato / dias_laborables_semana).
--   diferencia        = horas_retenidas + horas_ausencia_contador − horas_contrato.
-- Se omiten las filas sin contrato ni actividad (todo 0). Solo empleados de la cuenta activa.
create or replace function public.rrhh_resumen_semana(
  p_centro_id uuid,
  p_desde date,
  p_hasta date,
  p_empleado_id uuid default null
)
returns table (
  anio integer,
  semana integer,
  lunes date,
  empleado_id uuid,
  nombre text,
  apellidos text,
  departamento_id uuid,
  centro_principal_id uuid,
  horas_contrato numeric,
  horas_plan numeric,
  horas_plan_centro numeric,
  horas_retenidas numeric,
  horas_ausencia_contador numeric,
  diferencia numeric,
  dias_plan integer,
  dias_validados integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with semanas as (
    select g.d::date as lunes
    from generate_series(date_trunc('week', p_desde::timestamp),
                         date_trunc('week', p_hasta::timestamp),
                         interval '7 days') as g(d)
  ),
  rango as (
    select min(lunes) as ini, max(lunes) + 6 as fin from semanas
  ),
  emp as (
    select e.id, e.cuenta_id, e.nombre, e.apellidos, e.departamento_id, e.centro_principal_id,
           coalesce(cv.dias_laborables_semana, 5) as dias_laborables
    from public.empleados e
    cross join rango r
    left join lateral public.rrhh_convenio_centro(e.centro_principal_id, e.cuenta_id) cv on true
    where e.cuenta_id = (select cuenta_actual())
      and (p_empleado_id is null or e.id = p_empleado_id)
      and (
        p_centro_id is null
        or e.centro_principal_id = p_centro_id
        or exists (select 1 from public.rrhh_asignaciones a
                   where a.empleado_id = e.id and a.centro_id = p_centro_id
                     and (a.fecha_inicio is null or a.fecha_inicio <= r.fin)
                     and (a.fecha_fin is null or a.fecha_fin >= r.ini))
        or exists (select 1 from public.rrhh_turnos t
                   where t.empleado_id = e.id and t.centro_id = p_centro_id
                     and t.fecha between r.ini and r.fin)
      )
  ),
  plan_dia as (
    select t.empleado_id, t.centro_id, t.fecha,
           sum(public.rrhh_horas_turno(t.hora_inicio, t.hora_fin, t.pausa_min)) as horas
    from public.rrhh_turnos t
    join emp on emp.id = t.empleado_id
    cross join rango r
    where t.estado = 'publicado'
      and t.empleado_id is not null
      and t.fecha between r.ini and r.fin
    group by t.empleado_id, t.centro_id, t.fecha
  ),
  val_dia as (
    select h.empleado_id, h.centro_id, h.fecha, sum(h.horas_retenidas) as horas
    from public.rrhh_horas_dia h
    join emp on emp.id = h.empleado_id
    cross join rango r
    where h.estado = 'validada'
      and h.fecha between r.ini and r.fin
    group by h.empleado_id, h.centro_id, h.fecha
  ),
  dia as (
    select coalesce(p.empleado_id, v.empleado_id) as empleado_id,
           coalesce(p.centro_id, v.centro_id) as centro_id,
           coalesce(p.fecha, v.fecha) as fecha,
           coalesce(p.horas, 0) as horas_plan,
           case when coalesce(p.centro_id, v.centro_id) = p_centro_id then coalesce(p.horas, 0) else 0 end as horas_plan_centro,
           coalesce(v.horas, p.horas, 0) as horas_ret,
           (v.empleado_id is not null) as validado
    from plan_dia p
    full join val_dia v on v.empleado_id = p.empleado_id and v.centro_id = p.centro_id and v.fecha = p.fecha
  ),
  dia_sem as (
    select empleado_id, date_trunc('week', fecha::timestamp)::date as lunes,
           sum(horas_plan) as horas_plan,
           sum(horas_plan_centro) as horas_plan_centro,
           sum(horas_ret) as horas_ret,
           count(distinct fecha) filter (where horas_plan > 0) as dias_plan,
           count(distinct fecha) filter (where validado) as dias_validados
    from dia
    group by 1, 2
  ),
  aus_dia as (
    select a.empleado_id, g.dia::date as fecha,
           case when a.horas is not null then a.horas
                when a.medio_dia then 0.5
                else 1 end as peso,
           (a.horas is not null) as es_horas
    from public.rrhh_ausencias a
    join emp on emp.id = a.empleado_id
    cross join rango r
    left join public.rrhh_tipos_ausencia ta on ta.id = a.tipo_id
    cross join lateral generate_series(greatest(a.fecha_inicio, r.ini)::timestamp,
                                       least(a.fecha_fin, r.fin)::timestamp,
                                       interval '1 day') as g(dia)
    where a.estado = 'aprobada'
      and coalesce(ta.computa_contador, a.tipo in ('vacaciones', 'permiso', 'baja'))
      -- un día es trabajo O ausencia: si ese día ya tiene horas (plan o validadas) no suma
      and not exists (select 1 from dia d
                      where d.empleado_id = a.empleado_id and d.fecha = g.dia::date
                        and (d.horas_plan > 0 or d.horas_ret > 0))
  ),
  aus_sem as (
    select empleado_id, date_trunc('week', fecha::timestamp)::date as lunes,
           coalesce(sum(peso) filter (where es_horas), 0) as horas_directas,
           coalesce(sum(peso) filter (where not es_horas), 0) as dias
    from aus_dia
    group by 1, 2
  ),
  base as (
    select s.lunes,
           emp.id as empleado_id, emp.nombre, emp.apellidos, emp.departamento_id, emp.centro_principal_id,
           public.rrhh_horas_contrato_semana(emp.id, s.lunes) as horas_contrato,
           coalesce(ds.horas_plan, 0) as horas_plan,
           coalesce(ds.horas_plan_centro, 0) as horas_plan_centro,
           coalesce(ds.horas_ret, 0) as horas_retenidas,
           coalesce(ds.dias_plan, 0)::integer as dias_plan,
           coalesce(ds.dias_validados, 0)::integer as dias_validados,
           coalesce(au.horas_directas, 0) as aus_horas_directas,
           coalesce(au.dias, 0) as aus_dias,
           emp.dias_laborables
    from emp
    cross join semanas s
    left join dia_sem ds on ds.empleado_id = emp.id and ds.lunes = s.lunes
    left join aus_sem au on au.empleado_id = emp.id and au.lunes = s.lunes
  ),
  calc as (
    select b.*,
           round(b.aus_horas_directas
                 + least(b.aus_dias, b.dias_laborables)
                   * (case when b.dias_laborables > 0 then b.horas_contrato / b.dias_laborables else 0 end)
           , 2) as horas_ausencia_contador
    from base b
  )
  select extract(isoyear from c.lunes)::integer,
         extract(week from c.lunes)::integer,
         c.lunes,
         c.empleado_id, c.nombre, c.apellidos, c.departamento_id, c.centro_principal_id,
         c.horas_contrato,
         round(c.horas_plan, 2),
         round(c.horas_plan_centro, 2),
         round(c.horas_retenidas, 2),
         c.horas_ausencia_contador,
         round(c.horas_retenidas + c.horas_ausencia_contador - c.horas_contrato, 2),
         c.dias_plan,
         c.dias_validados
  from calc c
  where c.horas_contrato > 0 or c.horas_plan > 0 or c.horas_retenidas > 0 or c.horas_ausencia_contador > 0
  order by c.apellidos, c.nombre, c.lunes
$$;
revoke execute on function public.rrhh_resumen_semana(uuid, date, date, uuid) from anon, public;
grant execute on function public.rrhh_resumen_semana(uuid, date, date, uuid) to authenticated;

-- ─── rrhh_saldo_horas(empleado, hasta) ────────────────────────────────────
-- contador_inicial_h + Σ diferencia de las semanas desde `desde` hasta la semana que
-- contiene `hasta` (semanas completas) + Σ rrhh_contador_ajustes con fecha en ese rango.
-- `desde`: contador_inicial_fecha es el «saldo a cierre de ese día» (lo que se trae de Skello,
-- normalmente un domingo de cierre): si no es lunes, se empieza a contar el lunes SIGUIENTE
-- (la semana que contiene esa fecha ya está dentro del saldo inicial); si es lunes, se cuenta
-- esa semana entera (saldo a inicio de semana). Sin fecha: 1 de enero del año de `hasta`.
create or replace function public.rrhh_saldo_horas(p_empleado_id uuid, p_hasta date default current_date)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select round(
    coalesce(e.contador_inicial_h, 0)
    + coalesce((select sum(r.diferencia)
                from public.rrhh_resumen_semana(null, d.desde, p_hasta, p_empleado_id) r), 0)
    + coalesce((select sum(a.horas)
                from public.rrhh_contador_ajustes a
                where a.empleado_id = p_empleado_id
                  and a.fecha between d.desde and p_hasta), 0)
  , 2)
  from public.empleados e
  cross join lateral (
    select coalesce(
      case when extract(isodow from e.contador_inicial_fecha) = 1 then e.contador_inicial_fecha
           else date_trunc('week', e.contador_inicial_fecha::timestamp)::date + 7 end,
      make_date(extract(year from p_hasta)::integer, 1, 1)) as desde
  ) d
  where e.id = p_empleado_id
$$;
revoke execute on function public.rrhh_saldo_horas(uuid, date) from anon, public;
grant execute on function public.rrhh_saldo_horas(uuid, date) to authenticated;

-- ─── rrhh_saldo_vacaciones(empleado, anio) ────────────────────────────────
-- derecho_anual     = dias_vacaciones_anuales (convenio del centro principal; 30 si no hay)
--                     × días de contrato en el año / días del año.
-- devengado_hoy     = lo mismo, contando solo los días de contrato hasta hoy.
-- disfrutados       = días naturales dentro del año de ausencias APROBADAS cuyo tipo
--                     computa_vacaciones (medio_dia = 0,5 por día) + vacaciones_ajuste_dias.
-- pendientes_aprobar= idem con estado 'solicitada'.
-- resto             = derecho_anual − disfrutados − pendientes_aprobar.
create or replace function public.rrhh_saldo_vacaciones(p_empleado_id uuid, p_anio integer)
returns table (
  derecho_anual numeric,
  devengado_hoy numeric,
  disfrutados numeric,
  pendientes_aprobar numeric,
  resto numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with e as (
    select e.*, coalesce(cv.dias_vacaciones_anuales, 30) as dias_vac
    from public.empleados e
    left join lateral public.rrhh_convenio_centro(e.centro_principal_id, e.cuenta_id) cv on true
    where e.id = p_empleado_id
  ),
  anio as (
    select make_date(p_anio, 1, 1) as ini,
           make_date(p_anio, 12, 31) as fin,
           (make_date(p_anio + 1, 1, 1) - make_date(p_anio, 1, 1)) as dias_anio
  ),
  periodos as (
    -- sin solapes (rrhh_periodos_efectivos): si no, dias_contrato > días del año y derecho > 30
    select pe.fecha_alta, pe.fecha_baja
    from public.rrhh_periodos_efectivos(p_empleado_id) pe
  ),
  dias as (
    select
      coalesce(sum(greatest(0, least(coalesce(p.fecha_baja, a.fin), a.fin) - greatest(p.fecha_alta, a.ini) + 1)), 0) as dias_contrato,
      coalesce(sum(greatest(0, least(coalesce(p.fecha_baja, a.fin), a.fin, current_date) - greatest(p.fecha_alta, a.ini) + 1)), 0) as dias_contrato_hoy
    from periodos p
    cross join anio a
  ),
  aus as (
    select
      coalesce(sum(x.dias_pond) filter (where x.estado = 'aprobada'), 0) as disf,
      coalesce(sum(x.dias_pond) filter (where x.estado = 'solicitada'), 0) as pend
    from (
      select a.estado,
             (least(a.fecha_fin, an.fin) - greatest(a.fecha_inicio, an.ini) + 1)
               * (case when a.medio_dia then 0.5 else 1 end) as dias_pond
      from public.rrhh_ausencias a
      left join public.rrhh_tipos_ausencia ta on ta.id = a.tipo_id
      cross join anio an
      where a.empleado_id = p_empleado_id
        and a.fecha_inicio <= an.fin
        and a.fecha_fin >= an.ini
        and coalesce(ta.computa_vacaciones, a.tipo = 'vacaciones')
    ) x
  ),
  calc as (
    select round(e.dias_vac * d.dias_contrato / an.dias_anio, 2) as derecho_anual,
           round(e.dias_vac * d.dias_contrato_hoy / an.dias_anio, 2) as devengado_hoy,
           round(aus.disf + coalesce(e.vacaciones_ajuste_dias, 0), 2) as disfrutados,
           round(aus.pend, 2) as pendientes_aprobar
    from e
    cross join anio an
    cross join dias d
    cross join aus
  )
  select c.derecho_anual, c.devengado_hoy, c.disfrutados, c.pendientes_aprobar,
         round(c.derecho_anual - c.disfrutados - c.pendientes_aprobar, 2) as resto
  from calc c
$$;
revoke execute on function public.rrhh_saldo_vacaciones(uuid, integer) from anon, public;
grant execute on function public.rrhh_saldo_vacaciones(uuid, integer) to authenticated;

-- ─── rrhh_informe_nomina(anio, mes [, centro]) ────────────────────────────
-- Una fila por empleado con contrato en el mes (periodo o alta/baja) o con turnos publicados
-- en el mes. Con centro: los que lo tienen como principal o tienen turnos publicados en él.
--   horas_semana       = del último periodo de contrato que solapa el mes (o del empleado).
--   horas_contrato_mes = Σ por periodo de horas_semana × 52/12 × días del periodo en el mes / días del mes.
--   dias_trabajados    = días con horas retenidas > 0.
--   horas_retenidas    = misma regla que rrhh_resumen_semana (horas_dia validadas o plan, casado
--                        por empleado, centro y día), en el mes.
--   horas_ausencia_contador = horas de ausencias aprobadas cuyo tipo computa_contador (ver
--                        `ausencias`), solo en días sin horas retenidas.
--   horas_extra        = max(0, horas_retenidas + horas_ausencia_contador − horas_contrato_mes):
--                        la misma idea que `diferencia` en Contadores (una semana de vacaciones no
--                        resta extras), para que nómina y contador no se contradigan.
--   horas_nocturnas    = minutos de cada turno publicado dentro del tramo [nocturno_inicio,
--                        nocturno_fin) del convenio del CENTRO del turno (cruza medianoche; se
--                        miran las ventanas de la víspera, del día y del día siguiente). La pausa
--                        no se descuenta de las nocturnas.
--   horas_domingo      = horas de turnos publicados cuya fecha es domingo (el turno se atribuye
--                        entero al día en que empieza).
--   horas_festivo      = horas de turnos publicados en fechas de rrhh_festivos activos:
--                        nacional/autonómico de la cuenta, o local del centro del turno.
--   ausencias          = jsonb {codigo: {dias, horas}} de ausencias aprobadas en el mes, por día
--                        natural y descontando los días que ya tienen horas retenidas (trabajo O
--                        ausencia). dias: medio_dia = 0,5. horas: `horas` por día si viene
--                        informada; si no, días × horas_semana / 7 (es lo que Skello muestra para
--                        bajas y vacaciones, 5,71 h/día a 40 h, y nunca pasa del contrato semanal:
--                        14 días de vacaciones = 80 h, no 112). Nota: Contadores usa jornada =
--                        contrato / dias_laborables con tope semanal; coinciden en semanas enteras y
--                        difieren en permisos sueltos (8 h vs 5,71 h).
--   variables          = jsonb {concepto: Σ importe} de rrhh_variables_nomina del mes.
--   comentario         = rrhh_nomina_comentarios del mes.
-- Solo empleados de la cuenta activa.
create or replace function public.rrhh_informe_nomina(
  p_anio integer,
  p_mes integer,
  p_centro_id uuid default null
)
returns table (
  empleado_id uuid,
  nombre text,
  apellidos text,
  codigo_nomina text,
  centro_principal_id uuid,
  departamento_id uuid,
  tipo_contrato text,
  horas_semana numeric,
  horas_contrato_mes numeric,
  dias_contrato integer,
  dias_trabajados integer,
  horas_retenidas numeric,
  horas_ausencia_contador numeric,
  horas_extra numeric,
  horas_nocturnas numeric,
  horas_domingo numeric,
  horas_festivo numeric,
  ausencias jsonb,
  variables jsonb,
  comentario text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mes as (
    select make_date(p_anio, p_mes, 1) as ini,
           (make_date(p_anio, p_mes, 1) + interval '1 month' - interval '1 day')::date as fin
  ),
  per_todos as (
    -- periodos sin solapes (rrhh_periodos_efectivos)
    select e.id as empleado_id, pe.fecha_alta, pe.fecha_baja, pe.horas_semana
    from public.empleados e
    cross join lateral public.rrhh_periodos_efectivos(e.id) pe
    where e.cuenta_id = (select cuenta_actual())
  ),
  emp as (
    select e.id, e.cuenta_id, e.nombre, e.apellidos, e.codigo_nomina, e.centro_principal_id,
           e.departamento_id, e.tipo_contrato
    from public.empleados e
    cross join mes m
    where e.cuenta_id = (select cuenta_actual())
      and (
        exists (select 1 from per_todos p
                where p.empleado_id = e.id and p.fecha_alta <= m.fin
                  and (p.fecha_baja is null or p.fecha_baja >= m.ini))
        or exists (select 1 from public.rrhh_turnos t
                   where t.empleado_id = e.id and t.estado = 'publicado'
                     and t.fecha between m.ini and m.fin)
      )
      and (
        p_centro_id is null
        or e.centro_principal_id = p_centro_id
        or exists (select 1 from public.rrhh_turnos t
                   where t.empleado_id = e.id and t.centro_id = p_centro_id
                     and t.estado = 'publicado' and t.fecha between m.ini and m.fin)
      )
  ),
  contrato as (
    select p.empleado_id,
           sum(greatest(0, least(coalesce(p.fecha_baja, m.fin), m.fin) - greatest(p.fecha_alta, m.ini) + 1))::integer as dias_contrato,
           sum(p.horas_semana * 52.0 / 12
               * greatest(0, least(coalesce(p.fecha_baja, m.fin), m.fin) - greatest(p.fecha_alta, m.ini) + 1)
               / (m.fin - m.ini + 1)) as horas_contrato_mes,
           (array_agg(p.horas_semana order by p.fecha_alta desc))[1] as horas_semana
    from per_todos p
    join emp on emp.id = p.empleado_id
    cross join mes m
    where p.fecha_alta <= m.fin
      and (p.fecha_baja is null or p.fecha_baja >= m.ini)
    group by p.empleado_id
  ),
  conv as (
    select ce.id as centro_id,
           coalesce(cv.nocturno_inicio, time '22:00') as nocturno_inicio,
           coalesce(cv.nocturno_fin, time '06:00') as nocturno_fin
    from public.centros ce
    cross join lateral public.rrhh_convenio_centro(ce.id, ce.cuenta_id) cv
  ),
  tur as (
    select t.id, t.empleado_id, t.centro_id, t.cuenta_id, t.fecha,
           public.rrhh_horas_turno(t.hora_inicio, t.hora_fin, t.pausa_min) as horas,
           (t.fecha + t.hora_inicio)::timestamp as t_ini,
           (t.fecha + t.hora_fin
              + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)::timestamp as t_fin,
           cv.nocturno_inicio, cv.nocturno_fin,
           exists (select 1 from public.rrhh_festivos f
                   where f.activo and f.fecha = t.fecha and f.cuenta_id = t.cuenta_id
                     and (f.ambito in ('nacional', 'autonomico') or f.centro_id = t.centro_id)) as es_festivo
    from public.rrhh_turnos t
    join emp on emp.id = t.empleado_id
    cross join mes m
    left join conv cv on cv.centro_id = t.centro_id
    where t.estado = 'publicado'
      and t.fecha between m.ini and m.fin
  ),
  noct as (
    select t.id,
           sum(greatest(0, extract(epoch from (least(t.t_fin, w.fin) - greatest(t.t_ini, w.ini))) / 3600.0)) as horas
    from tur t
    cross join lateral (
      select (t.fecha + g.k + t.nocturno_inicio)::timestamp as ini,
             (t.fecha + g.k + t.nocturno_inicio)::timestamp
               + (t.nocturno_fin - t.nocturno_inicio)
               + case when t.nocturno_fin <= t.nocturno_inicio then interval '1 day' else interval '0' end as fin
      from generate_series(-1, 1) as g(k)
    ) w
    group by t.id
  ),
  turagg as (
    select t.empleado_id,
           coalesce(sum(t.horas) filter (where extract(dow from t.fecha) = 0), 0) as horas_domingo,
           coalesce(sum(t.horas) filter (where t.es_festivo), 0) as horas_festivo,
           coalesce(sum(n.horas), 0) as horas_nocturnas
    from tur t
    left join noct n on n.id = t.id
    group by t.empleado_id
  ),
  plan_dia as (
    select empleado_id, centro_id, fecha, sum(horas) as horas from tur group by 1, 2, 3
  ),
  val_dia as (
    select h.empleado_id, h.centro_id, h.fecha, sum(h.horas_retenidas) as horas
    from public.rrhh_horas_dia h
    join emp on emp.id = h.empleado_id
    cross join mes m
    where h.estado = 'validada' and h.fecha between m.ini and m.fin
    group by h.empleado_id, h.centro_id, h.fecha
  ),
  dia as (
    -- casado por centro: validar un centro no borra el plan del otro ese día
    select coalesce(p.empleado_id, v.empleado_id) as empleado_id,
           coalesce(p.fecha, v.fecha) as fecha,
           coalesce(v.horas, p.horas, 0) as horas
    from plan_dia p
    full join val_dia v on v.empleado_id = p.empleado_id and v.centro_id = p.centro_id and v.fecha = p.fecha
  ),
  ret as (
    select empleado_id, sum(horas) as horas_retenidas,
           count(distinct fecha) filter (where horas > 0) as dias_trabajados
    from dia
    group by empleado_id
  ),
  aus_dia as (
    -- un día natural por fila; se descartan los días con horas retenidas (trabajo O ausencia)
    select a.empleado_id,
           coalesce(ta.codigo, ta.nombre, a.tipo::text) as codigo,
           coalesce(ta.computa_contador, a.tipo in ('vacaciones', 'permiso', 'baja')) as computa,
           (case when a.medio_dia then 0.5 else 1 end) as dias_pond,
           case when a.horas is not null then a.horas
                else (case when a.medio_dia then 0.5 else 1 end) * coalesce(c.horas_semana, 0) / 7.0
           end as horas_calc
    from public.rrhh_ausencias a
    join emp on emp.id = a.empleado_id
    left join contrato c on c.empleado_id = a.empleado_id
    left join public.rrhh_tipos_ausencia ta on ta.id = a.tipo_id
    cross join mes m
    cross join lateral generate_series(greatest(a.fecha_inicio, m.ini)::timestamp,
                                       least(a.fecha_fin, m.fin)::timestamp,
                                       interval '1 day') as g(dia)
    where a.estado = 'aprobada'
      and a.fecha_inicio <= m.fin
      and a.fecha_fin >= m.ini
      and not exists (select 1 from dia d
                      where d.empleado_id = a.empleado_id and d.fecha = g.dia::date and d.horas > 0)
  ),
  aus as (
    select x.empleado_id,
           jsonb_object_agg(x.codigo, jsonb_build_object('dias', x.dias, 'horas', x.horas)) as js,
           round(coalesce(sum(x.horas) filter (where x.computa), 0), 2) as horas_contador
    from (
      select y.empleado_id, y.codigo, bool_or(y.computa) as computa,
             round(sum(y.dias_pond), 2) as dias, round(sum(y.horas_calc), 2) as horas
      from aus_dia y
      group by y.empleado_id, y.codigo
    ) x
    group by x.empleado_id
  ),
  vars as (
    select v.empleado_id, jsonb_object_agg(v.concepto, v.importe) as js
    from (
      select empleado_id, concepto, sum(importe) as importe
      from public.rrhh_variables_nomina
      where anio = p_anio and mes = p_mes
      group by 1, 2
    ) v
    group by v.empleado_id
  )
  select emp.id, emp.nombre, emp.apellidos, emp.codigo_nomina, emp.centro_principal_id,
         emp.departamento_id, emp.tipo_contrato,
         round(coalesce(c.horas_semana, 0), 2),
         round(coalesce(c.horas_contrato_mes, 0), 2),
         coalesce(c.dias_contrato, 0),
         coalesce(r.dias_trabajados, 0)::integer,
         round(coalesce(r.horas_retenidas, 0), 2),
         round(coalesce(aus.horas_contador, 0), 2),
         round(greatest(0, coalesce(r.horas_retenidas, 0) + coalesce(aus.horas_contador, 0)
                          - coalesce(c.horas_contrato_mes, 0)), 2),
         round(coalesce(ta.horas_nocturnas, 0), 2),
         round(coalesce(ta.horas_domingo, 0), 2),
         round(coalesce(ta.horas_festivo, 0), 2),
         coalesce(aus.js, '{}'::jsonb),
         coalesce(vars.js, '{}'::jsonb),
         coalesce(nc.comentario, '')
  from emp
  left join contrato c on c.empleado_id = emp.id
  left join ret r on r.empleado_id = emp.id
  left join turagg ta on ta.empleado_id = emp.id
  left join aus on aus.empleado_id = emp.id
  left join vars on vars.empleado_id = emp.id
  left join public.rrhh_nomina_comentarios nc
         on nc.empleado_id = emp.id and nc.anio = p_anio and nc.mes = p_mes
  order by emp.apellidos, emp.nombre
$$;
revoke execute on function public.rrhh_informe_nomina(integer, integer, uuid) from anon, public;
grant execute on function public.rrhh_informe_nomina(integer, integer, uuid) to authenticated;

-- ─── rrhh_codigo_centro_ratios(nombre) → código de centro que usa Ratios/Skello ───
create or replace function public.rrhh_codigo_centro_ratios(p_nombre text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case p_nombre
    when 'Binifadet Restaurante'  then 'BINIFADET'
    when 'Binifadet Bodega'       then 'BODEGA'
    when 'Binifadet Tienda'       then 'TIENDA'
    when 'Casa Tirant'            then 'TIRANT'
    when 'Cocina Produccion'      then 'PRODUCCION'
    when 'Estructura'             then 'OFICINA'
    when 'Tamarindos Bar'         then 'TAMARINDOS_BAR'
    when 'Tamarindos Restaurante' then 'TAMARINDOS'
    else upper(regexp_replace(coalesce(p_nombre, ''), '\s+', '_', 'g'))
  end
$$;
revoke execute on function public.rrhh_codigo_centro_ratios(text) from anon, public;
grant execute on function public.rrhh_codigo_centro_ratios(text) to authenticated;

-- ─── rrhh_exportar_ratios(desde, hasta) → filas insertadas ────────────────
-- Inserta en `rrhh` (tabla de Ratios) con origen='hostelero', como lo carga Ratios desde el
-- export de Skello (apps/general/datos/ratios.html, parseSkelloDetalles):
--   · una fila por persona/semana/centro con el trabajo:
--     persona      = upper(apellidos)||', '||upper(nombre)   (Ratios casa por nombre si dni = '')
--     anio         = año NATURAL del lunes (Ratios monta la clave del reparto como anio||mes con
--                    mes sacado de `fecha`; con isoyear el lunes 29-12-2025 caería en dic-2026)
--     semana       = semana ISO
--     centro       = código Skello (rrhh_codigo_centro_ratios)
--     puesto       = puesto más frecuente de sus turnos publicados esa semana en ese centro
--     contrato     = rrhh_horas_contrato_semana(empleado, lunes)
--     horas_reales = por día y centro: horas_dia validadas de ese centro; si no, horas planificadas
--                    (turnos publicados) de ese centro. Suma de la semana.
--   · una fila por persona/semana con puesto = '(AUSENCIA)' en el centro principal y
--     horas_reales = horas de ausencia incluidas en el contador (rrhh_resumen_semana), que Ratios
--     usa para el reparto de nóminas por centro y para «extra = reales − contrato» (sin ellas,
--     alguien de vacaciones saldría con 0 h y −40 h extra).
-- Antes borra las filas origen='hostelero' de esas semanas (fecha = lunes). Semanas completas.
-- SECURITY DEFINER: `rrhh` no tiene cuenta_id ni RLS por cuenta; por eso solo se permite desde la
-- cuenta Bonita (la única conectada a Ratios) y solo a gestores.
create or replace function public.rrhh_exportar_ratios(p_desde date, p_hasta date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cuenta uuid;
  v_ini date;
  v_fin date;
  v_n integer;
  v_n_aus integer;
begin
  if not public.rrhh_es_gestor() then
    raise exception 'Solo dirección o administración puede enviar horas a Ratios';
  end if;
  v_cuenta := public.cuenta_actual();
  if v_cuenta is null then
    raise exception 'Sin cuenta activa';
  end if;
  if v_cuenta <> '082c5366-d9ae-49b9-a8b8-8caad73985bd' then
    raise exception 'Ratios solo está conectado a la cuenta Bonita';
  end if;
  v_ini := date_trunc('week', p_desde::timestamp)::date;
  v_fin := date_trunc('week', p_hasta::timestamp)::date + 6;

  delete from public.rrhh
  where origen = 'hostelero'
    and fecha between v_ini and v_fin;

  -- Ratios inserta sus filas con ids propios (Date.now()) por encima de la secuencia de la
  -- identidad: se alinea la secuencia con el máximo real para que el insert no choque.
  perform setval('public.rrhh_id_seq', greatest((select coalesce(max(id), 0) from public.rrhh), 1), true);

  with plan as (
    select t.empleado_id, t.centro_id, t.fecha,
           sum(public.rrhh_horas_turno(t.hora_inicio, t.hora_fin, t.pausa_min)) as horas
    from public.rrhh_turnos t
    where t.cuenta_id = v_cuenta
      and t.estado = 'publicado'
      and t.empleado_id is not null
      and t.fecha between v_ini and v_fin
    group by 1, 2, 3
  ),
  val as (
    select h.empleado_id, h.centro_id, h.fecha, sum(h.horas_retenidas) as horas
    from public.rrhh_horas_dia h
    where h.cuenta_id = v_cuenta
      and h.estado = 'validada'
      and h.fecha between v_ini and v_fin
    group by 1, 2, 3
  ),
  dia as (
    select coalesce(p.empleado_id, v.empleado_id) as empleado_id,
           coalesce(p.centro_id, v.centro_id) as centro_id,
           coalesce(p.fecha, v.fecha) as fecha,
           coalesce(v.horas, p.horas, 0) as horas
    from plan p
    full join val v on v.empleado_id = p.empleado_id and v.centro_id = p.centro_id and v.fecha = p.fecha
  ),
  sem as (
    select empleado_id, centro_id, date_trunc('week', fecha::timestamp)::date as lunes, sum(horas) as horas
    from dia
    group by 1, 2, 3
  ),
  puesto as (
    select t.empleado_id, t.centro_id, date_trunc('week', t.fecha::timestamp)::date as lunes,
           mode() within group (order by t.puesto) as puesto
    from public.rrhh_turnos t
    where t.cuenta_id = v_cuenta
      and t.estado = 'publicado'
      and t.empleado_id is not null
      and t.puesto is not null
      and t.fecha between v_ini and v_fin
    group by 1, 2, 3
  ),
  ins as (
    insert into public.rrhh (persona, dni, anio, semana, fecha, centro, puesto, contrato, horas_reales, origen)
    select
      case when coalesce(e.apellidos, '') = '' then upper(e.nombre)
           else upper(e.apellidos) || ', ' || upper(e.nombre) end,
      '',
      extract(year from s.lunes)::integer,
      extract(week from s.lunes)::integer,
      s.lunes,
      public.rrhh_codigo_centro_ratios(c.nombre),
      coalesce(p.puesto, e.departamento, ''),
      public.rrhh_horas_contrato_semana(e.id, s.lunes),
      round(s.horas, 2),
      'hostelero'
    from sem s
    join public.empleados e on e.id = s.empleado_id and e.cuenta_id = v_cuenta
    join public.centros c on c.id = s.centro_id
    left join puesto p on p.empleado_id = s.empleado_id and p.centro_id = s.centro_id and p.lunes = s.lunes
    returning 1
  )
  select count(*) into v_n from ins;

  -- Ausencias incluidas en el contador: fila '(AUSENCIA)' en el centro principal.
  -- rrhh_resumen_semana es security invoker pero aquí corre como definer: filtra por
  -- cuenta_actual() dentro, así que solo devuelve empleados de la cuenta que llama.
  with ins_aus as (
    insert into public.rrhh (persona, dni, anio, semana, fecha, centro, puesto, contrato, horas_reales, origen)
    select
      case when coalesce(e.apellidos, '') = '' then upper(e.nombre)
           else upper(e.apellidos) || ', ' || upper(e.nombre) end,
      '',
      extract(year from r.lunes)::integer,
      r.semana,
      r.lunes,
      public.rrhh_codigo_centro_ratios(c.nombre),
      '(AUSENCIA)',
      r.horas_contrato,
      r.horas_ausencia_contador,
      'hostelero'
    from public.rrhh_resumen_semana(null, v_ini, v_fin) r
    join public.empleados e on e.id = r.empleado_id and e.cuenta_id = v_cuenta
    join public.centros c on c.id = e.centro_principal_id
    where r.horas_ausencia_contador > 0
    returning 1
  )
  select count(*) into v_n_aus from ins_aus;

  return coalesce(v_n, 0) + coalesce(v_n_aus, 0);
end $$;
revoke all on function public.rrhh_exportar_ratios(date, date) from public, anon;
grant execute on function public.rrhh_exportar_ratios(date, date) to authenticated;

-- ─── rrhh_hoy(centro) → quién tiene turno hoy, si ha fichado, ausencias ───
-- «Hoy» es la fecha en Europe/Madrid. Se listan los empleados con turno publicado hoy en el
-- centro, los que han fichado hoy en el centro (aunque no tuvieran turno) y los ausentes hoy
-- (ausencia aprobada del centro, o sin centro si el empleado pertenece al centro).
-- estado_fichaje: 'sin_fichar' | 'trabajando' | 'en_pausa' | 'salio' (según el último fichaje
-- no corregido de hoy).
create or replace function public.rrhh_hoy(p_centro_id uuid)
returns table (
  empleado_id uuid,
  nombre text,
  apellidos text,
  turno_id uuid,
  hora_inicio time,
  hora_fin time,
  pausa_min integer,
  puesto text,
  puesto_color text,
  ultimo_fichaje_tipo public.rrhh_tipo_fichaje,
  ultimo_fichaje_ts timestamptz,
  estado_fichaje text,
  ausencia_id uuid,
  ausencia_tipo text,
  ausencia_color text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with hoy as (
    select (now() at time zone 'Europe/Madrid')::date as d
  ),
  rango as (
    select (h.d::timestamp at time zone 'Europe/Madrid') as ini,
           ((h.d + 1)::timestamp at time zone 'Europe/Madrid') as fin
    from hoy h
  ),
  fich as (
    select f.empleado_id, f.tipo, f.ts
    from public.rrhh_fichajes f
    cross join rango r
    where f.centro_id = p_centro_id
      and f.ts >= r.ini and f.ts < r.fin
      and not exists (select 1 from public.rrhh_fichajes c where c.corrige_a = f.id)
  ),
  ult as (
    select distinct on (empleado_id) empleado_id, tipo, ts
    from fich
    order by empleado_id, ts desc
  ),
  tur as (
    select distinct on (t.empleado_id)
           t.id, t.empleado_id, t.hora_inicio, t.hora_fin, t.pausa_min,
           coalesce(pc.nombre, t.puesto) as puesto,
           coalesce(t.color, pc.color) as color
    from public.rrhh_turnos t
    cross join hoy h
    left join public.rrhh_puestos_cat pc on pc.id = t.puesto_id
    where t.centro_id = p_centro_id
      and t.fecha = h.d
      and t.estado = 'publicado'
      and t.empleado_id is not null
    order by t.empleado_id, t.hora_inicio
  ),
  aus as (
    select distinct on (a.empleado_id)
           a.empleado_id, a.id, coalesce(ta.nombre, a.tipo::text) as tipo, ta.color
    from public.rrhh_ausencias a
    cross join hoy h
    join public.empleados e on e.id = a.empleado_id
    left join public.rrhh_tipos_ausencia ta on ta.id = a.tipo_id
    where a.estado = 'aprobada'
      and h.d between a.fecha_inicio and a.fecha_fin
      and (
        a.centro_id = p_centro_id
        or (a.centro_id is null and (
              e.centro_principal_id = p_centro_id
              or exists (select 1 from public.rrhh_asignaciones s
                         where s.empleado_id = e.id and s.centro_id = p_centro_id
                           and (s.fecha_inicio is null or s.fecha_inicio <= h.d)
                           and (s.fecha_fin is null or s.fecha_fin >= h.d))))
      )
    order by a.empleado_id, a.fecha_inicio
  ),
  ids as (
    select empleado_id from tur
    union
    select empleado_id from ult
    union
    select empleado_id from aus
  )
  select e.id, e.nombre, e.apellidos,
         t.id, t.hora_inicio, t.hora_fin, t.pausa_min, t.puesto, t.color,
         u.tipo, u.ts,
         case u.tipo
           when 'entrada' then 'trabajando'
           when 'pausa_fin' then 'trabajando'
           when 'pausa_inicio' then 'en_pausa'
           when 'salida' then 'salio'
           else 'sin_fichar'
         end,
         a.id, a.tipo, a.color
  from ids
  join public.empleados e on e.id = ids.empleado_id
  left join tur t on t.empleado_id = e.id
  left join ult u on u.empleado_id = e.id
  left join aus a on a.empleado_id = e.id
  order by t.hora_inicio nulls last, e.apellidos, e.nombre
$$;
revoke execute on function public.rrhh_hoy(uuid) from anon, public;
grant execute on function public.rrhh_hoy(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (para el orquestador; solo lectura)
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Puestos del catálogo (esperados 91, sin duplicados por mayúsculas) y sin departamento (esperados 2:
--    «Presencia» y «correturnos»):
--    select count(*) as puestos, count(*) filter (where departamento_id is null) as sin_depto
--    from rrhh_puestos_cat where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd';
-- 2) Tipos de ausencia (esperados 18) y ausencias sin tipo_id (esperado 0):
--    select (select count(*) from rrhh_tipos_ausencia where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd') as tipos,
--           (select count(*) from rrhh_ausencias where tipo_id is null) as ausencias_sin_tipo;
-- 3) Festivos (esperados 57 = 2026: 12 generales + 16 locales activos + 1 local inactivo;
--    2027: 12 generales + 16 locales inactivos):
--    select extract(year from fecha)::int as anio, ambito, activo, count(*)
--    from rrhh_festivos where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
--    group by 1, 2, 3 order by 1, 2, 3;
-- 4) Encargados por centro (esperados 22 = 4 perfiles @binifadet × 4 centros + 2 @tamarindosmenorca
--    + 2 @elbardetamarindos + 2 @casatirant):
--    select c.nombre, count(*) from rrhh_encargados_centro ec join centros c on c.id = ec.centro_id
--    where ec.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' group by 1 order by 1;
-- 5) Plantillas de turno (esperadas 48 = 6 × 8 centros), turnos sin puesto_id (esperado 0) y
--    empleados con puesto por defecto (esperados 151):
--    select (select count(*) from rrhh_plantillas_turno) as plantillas,
--           (select count(*) from rrhh_turnos where puesto is not null and puesto_id is null) as turnos_sin_puesto_id,
--           (select count(*) from empleados where puesto_defecto_id is not null) as empleados_con_puesto_defecto;
-- 6) Periodos sin solapes: Jaramillo Pacheco (d36dfa2c-127c-448e-8aa8-e6efadec90ad) tiene 5 periodos,
--    3 abiertos; la semana del 07-09-2026 debe dar 40,00 (no 44,00):
--    select rrhh_horas_contrato_semana('d36dfa2c-127c-448e-8aa8-e6efadec90ad', date '2026-09-07');
-- 7) Privilegios revocados (esperado 0 filas):
--    select table_name, privilege_type from information_schema.role_table_grants
--    where grantee = 'authenticated' and (
--      (table_name = 'rrhh_turnos_historial' and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
--      or (table_name = 'rrhh_contador_ajustes' and privilege_type in ('UPDATE', 'DELETE')));
-- Extra) Prueba de funciones (con sesión de gestor). OJO: hay dos centros «Binifadet Restaurante»
--    en la base (uno de otra cuenta): cualquier búsqueda por nombre debe filtrar por cuenta_id.
--    select * from rrhh_semana_iso(current_date);
--    select * from rrhh_resumen_semana(null, current_date - 14, current_date) limit 5;
--    select * from rrhh_informe_nomina(2026, 9) limit 5;
--    select * from rrhh_hoy((select id from centros where nombre = 'Binifadet Restaurante'
--                            and cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'));
