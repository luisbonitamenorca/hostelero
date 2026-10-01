-- RRHH v2 · parte H (01-10-2026): lo visto en Skello que faltaba.
--   1. Confirmación de jornada por el propio empleado (app /empleado) → feed y Fichajes › Jornada.
--   2. Tareas y archivos en el turno (modal de Planificación y app del empleado).
--   3. Coste/hora por empleado (solo dirección) + tasa de coste de empresa en el convenio.
-- Solo aditivo. Políticas con (select cuenta_actual()) y conjuntos (rrhh_centros_gestionados()).

-- ─── 1. Jornadas confirmadas por el empleado ──────────────────────────────
create table if not exists public.rrhh_jornadas_confirmadas (
  id            uuid primary key default gen_random_uuid(),
  cuenta_id     uuid not null default cuenta_actual() references public.cuentas(id),
  empleado_id   uuid not null references public.empleados(id),
  fecha         date not null,
  centro_id     uuid null references public.centros(id),
  horas_vistas  numeric null,
  nota          text null,
  confirmada_en timestamptz not null default now(),
  unique (empleado_id, fecha)
);
create index if not exists idx_rrhh_jornadas_conf_cuenta_fecha on public.rrhh_jornadas_confirmadas (cuenta_id, fecha);
create index if not exists idx_rrhh_jornadas_conf_centro_fecha on public.rrhh_jornadas_confirmadas (centro_id, fecha);

alter table public.rrhh_jornadas_confirmadas enable row level security;
revoke all on public.rrhh_jornadas_confirmadas from anon;
grant select, insert, update, delete on public.rrhh_jornadas_confirmadas to authenticated;

drop policy if exists rrhh_jornadas_conf_propio on public.rrhh_jornadas_confirmadas;
create policy rrhh_jornadas_conf_propio on public.rrhh_jornadas_confirmadas
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) and empleado_id = (select mi_empleado_id()))
  with check (cuenta_id = (select cuenta_actual()) and empleado_id = (select mi_empleado_id()));

drop policy if exists rrhh_jornadas_conf_gestion_lectura on public.rrhh_jornadas_confirmadas;
create policy rrhh_jornadas_conf_gestion_lectura on public.rrhh_jornadas_confirmadas
  for select to authenticated
  using ((cuenta_id = (select cuenta_actual()) and empleado_id in (select rrhh_empleados_gestionados())) or (select es_operador()));

-- ─── 2. Tareas y archivos del turno ───────────────────────────────────────
create table if not exists public.rrhh_turno_tareas (
  id        uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default cuenta_actual() references public.cuentas(id),
  turno_id  uuid not null references public.rrhh_turnos(id) on delete cascade,
  texto     text not null,
  hecha     boolean not null default false,
  hecha_en  timestamptz null,
  orden     integer not null default 0,
  creado_en timestamptz not null default now()
);
create index if not exists idx_rrhh_turno_tareas_turno on public.rrhh_turno_tareas (turno_id, orden);
create index if not exists idx_rrhh_turno_tareas_cuenta on public.rrhh_turno_tareas (cuenta_id);

create table if not exists public.rrhh_turno_archivos (
  id         uuid primary key default gen_random_uuid(),
  cuenta_id  uuid not null default cuenta_actual() references public.cuentas(id),
  turno_id   uuid not null references public.rrhh_turnos(id) on delete cascade,
  nombre     text not null,
  -- ruta en el bucket privado `docs`: <cuenta_id>/rrhh/turnos/<turno_id>/<fichero>
  ruta       text not null,
  tamano     integer null,
  tipo_mime  text null,
  subido_por uuid null,
  creado_en  timestamptz not null default now()
);
create index if not exists idx_rrhh_turno_archivos_turno on public.rrhh_turno_archivos (turno_id);
create index if not exists idx_rrhh_turno_archivos_cuenta on public.rrhh_turno_archivos (cuenta_id);

-- Turnos de mis centros (gestión) y mis turnos publicados (empleado), sin recursión de políticas.
create or replace function public.rrhh_turnos_gestionados()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id from public.rrhh_turnos t
  where t.cuenta_id = public.cuenta_actual()
    and t.centro_id in (select public.rrhh_centros_gestionados())
$$;
revoke execute on function public.rrhh_turnos_gestionados() from anon, public;
grant execute on function public.rrhh_turnos_gestionados() to authenticated;

create or replace function public.rrhh_mis_turnos_publicados()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id from public.rrhh_turnos t
  where t.empleado_id = public.mi_empleado_id()
    and t.estado = 'publicado'
$$;
revoke execute on function public.rrhh_mis_turnos_publicados() from anon, public;
grant execute on function public.rrhh_mis_turnos_publicados() to authenticated;

alter table public.rrhh_turno_tareas enable row level security;
revoke all on public.rrhh_turno_tareas from anon;
grant select, insert, update, delete on public.rrhh_turno_tareas to authenticated;

drop policy if exists rrhh_turno_tareas_gestion on public.rrhh_turno_tareas;
create policy rrhh_turno_tareas_gestion on public.rrhh_turno_tareas
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_turnos_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_turnos_gestionados())) or (select es_operador()));

drop policy if exists rrhh_turno_tareas_propio_lectura on public.rrhh_turno_tareas;
create policy rrhh_turno_tareas_propio_lectura on public.rrhh_turno_tareas
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_mis_turnos_publicados()));

-- El empleado solo marca/desmarca «hecha» en sus turnos: el trigger impide tocar el texto u orden.
drop policy if exists rrhh_turno_tareas_propio_hecha on public.rrhh_turno_tareas;
create policy rrhh_turno_tareas_propio_hecha on public.rrhh_turno_tareas
  for update to authenticated
  using (cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_mis_turnos_publicados()))
  with check (cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_mis_turnos_publicados()));

create or replace function public.rrhh_turno_tareas_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.rrhh_gestiona_centro((select t.centro_id from public.rrhh_turnos t where t.id = old.turno_id)) then
    if new.texto is distinct from old.texto or new.orden is distinct from old.orden
       or new.turno_id is distinct from old.turno_id or new.cuenta_id is distinct from old.cuenta_id then
      raise exception 'Solo puedes marcar la tarea como hecha';
    end if;
  end if;
  if new.hecha and not old.hecha then new.hecha_en := now(); end if;
  if not new.hecha then new.hecha_en := null; end if;
  return new;
end $$;
revoke all on function public.rrhh_turno_tareas_guard() from public, anon, authenticated;
drop trigger if exists trg_rrhh_turno_tareas_guard on public.rrhh_turno_tareas;
create trigger trg_rrhh_turno_tareas_guard
  before update on public.rrhh_turno_tareas
  for each row execute function public.rrhh_turno_tareas_guard();

alter table public.rrhh_turno_archivos enable row level security;
revoke all on public.rrhh_turno_archivos from anon;
grant select, insert, update, delete on public.rrhh_turno_archivos to authenticated;

drop policy if exists rrhh_turno_archivos_gestion on public.rrhh_turno_archivos;
create policy rrhh_turno_archivos_gestion on public.rrhh_turno_archivos
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_turnos_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_turnos_gestionados())) or (select es_operador()));

drop policy if exists rrhh_turno_archivos_propio_lectura on public.rrhh_turno_archivos;
create policy rrhh_turno_archivos_propio_lectura on public.rrhh_turno_archivos
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_mis_turnos_publicados()));

-- ─── 3. Coste/hora (solo dirección) y tasa de empresa ─────────────────────
create table if not exists public.rrhh_coste_hora (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null default cuenta_actual() references public.cuentas(id),
  empleado_id uuid not null references public.empleados(id),
  desde       date not null,
  coste_hora  numeric not null check (coste_hora >= 0),
  nota        text null,
  creado_por  uuid null,
  creado_en   timestamptz not null default now(),
  unique (empleado_id, desde)
);
create index if not exists idx_rrhh_coste_hora_cuenta on public.rrhh_coste_hora (cuenta_id);
create index if not exists idx_rrhh_coste_hora_emp on public.rrhh_coste_hora (empleado_id, desde desc);

alter table public.rrhh_coste_hora enable row level security;
revoke all on public.rrhh_coste_hora from anon;
grant select, insert, update, delete on public.rrhh_coste_hora to authenticated;

-- Dato salarial: solo dirección (y operadores). Ni administración ni encargados.
drop policy if exists rrhh_coste_hora_direccion on public.rrhh_coste_hora;
create policy rrhh_coste_hora_direccion on public.rrhh_coste_hora
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and (select es_direccion())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and (select es_direccion())) or (select es_operador()));

-- Tasa de coste de empresa sobre el bruto (Seguridad Social a cargo de la empresa): Skello usa 32,15 %.
alter table public.rrhh_convenios add column if not exists coste_empresa_pct numeric not null default 32.15;

-- ─── Feed: la confirmación del empleado también es noticia ───────────────
create or replace function public.rrhh_novedades_empleado(p_centro_id uuid default null, p_limite int default 30)
returns table (ts timestamptz, tipo text, texto text, autor text, centro text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select j.confirmada_en, 'jornada_confirmada_empleado',
         trim(e.nombre || ' ' || coalesce(e.apellidos, '')) || ' ha confirmado su jornada del ' || to_char(j.fecha, 'DD/MM')
           || coalesce(' en ' || c.nombre, ''),
         trim(e.nombre || ' ' || coalesce(e.apellidos, '')),
         c.nombre
  from public.rrhh_jornadas_confirmadas j
  join public.empleados e on e.id = j.empleado_id
  left join public.centros c on c.id = coalesce(j.centro_id, e.centro_principal_id)
  where j.cuenta_id = public.cuenta_actual()
    and coalesce(j.centro_id, e.centro_principal_id) in (select public.rrhh_centros_gestionados())
    and (p_centro_id is null or coalesce(j.centro_id, e.centro_principal_id) = p_centro_id)
  order by j.confirmada_en desc
  limit greatest(1, least(coalesce(p_limite, 30), 200))
$$;
revoke all on function public.rrhh_novedades_empleado(uuid, int) from public, anon;
grant execute on function public.rrhh_novedades_empleado(uuid, int) to authenticated;
