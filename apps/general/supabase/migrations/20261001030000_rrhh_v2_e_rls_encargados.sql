-- RRHH v2 · parte E (01-10-2026): huecos detectados al construir las secciones.
--
--  1. Los jefes de centro (rol responsable_area, encargados vía rrhh_encargados_centro) no podían
--     leer empleados, periodos de contrato ni ausencias: el panel les salía vacío. Se les da
--     lectura (y edición de la ficha) de la gente de SUS centros.
--  2. Rendimiento: las políticas «gestión» llamaban a rrhh_gestiona_centro(centro_id) FILA A FILA
--     (13.700 turnos × 0,45 ms). Ahora comparan contra rrhh_centros_gestionados(), un conjunto que
--     Postgres evalúa una sola vez por consulta (initplan + hash).
--  3. Dirección puede actualizar la ubicación (lat/lng) de sus centros desde Ajustes.
--  4. App del empleado: compañeros del centro (para pedir un cambio) y lectura del turno que te
--     piden cambiar.
-- Solo aditivo: no se borra nada; las políticas se recrean con el mismo nombre.

-- ─── Centros que gestiona quien ha iniciado sesión ─────────────────────────
-- Gestor (dirección/administración/operador): todos los de su cuenta. Encargado: los suyos.
create or replace function public.rrhh_centros_gestionados()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id from public.centros c
  where c.cuenta_id = public.cuenta_actual() and public.rrhh_es_gestor()
  union
  select ec.centro_id from public.rrhh_encargados_centro ec
  where ec.user_id = auth.uid()
$$;
revoke execute on function public.rrhh_centros_gestionados() from anon, public;
grant execute on function public.rrhh_centros_gestionados() to authenticated;

-- Empleados que gestiona quien ha iniciado sesión (centro principal o asignación vigente en un
-- centro gestionado). Definer: no depende de la RLS de empleados.
create or replace function public.rrhh_empleados_gestionados()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id from public.empleados e
  where e.cuenta_id = public.cuenta_actual()
    and (public.rrhh_es_gestor()
         or e.centro_principal_id in (select public.rrhh_centros_gestionados())
         or exists (select 1 from public.rrhh_asignaciones a
                    where a.empleado_id = e.id
                      and a.centro_id in (select public.rrhh_centros_gestionados())
                      and (a.fecha_fin is null or a.fecha_fin >= current_date - 365)))
$$;
revoke execute on function public.rrhh_empleados_gestionados() from anon, public;
grant execute on function public.rrhh_empleados_gestionados() to authenticated;

-- ─── 1. Lectura/edición para encargados ────────────────────────────────────
drop policy if exists empleados_encargado_lectura on public.empleados;
create policy empleados_encargado_lectura on public.empleados
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) and id in (select rrhh_empleados_gestionados()));

drop policy if exists empleados_encargado_edicion on public.empleados;
create policy empleados_encargado_edicion on public.empleados
  for update to authenticated
  using (cuenta_id = (select cuenta_actual()) and id in (select rrhh_empleados_gestionados()))
  with check (cuenta_id = (select cuenta_actual()) and id in (select rrhh_empleados_gestionados()));

drop policy if exists rrhh_periodos_encargado on public.rrhh_periodos_contrato;
create policy rrhh_periodos_encargado on public.rrhh_periodos_contrato
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) and empleado_id in (select rrhh_empleados_gestionados()))
  with check (cuenta_id = (select cuenta_actual()) and empleado_id in (select rrhh_empleados_gestionados()));

drop policy if exists rrhh_ausencias_encargado on public.rrhh_ausencias;
create policy rrhh_ausencias_encargado on public.rrhh_ausencias
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) and empleado_id in (select rrhh_empleados_gestionados()))
  with check (cuenta_id = (select cuenta_actual()) and empleado_id in (select rrhh_empleados_gestionados()));

drop policy if exists rrhh_contador_ajustes_encargado_lectura on public.rrhh_contador_ajustes;
create policy rrhh_contador_ajustes_encargado_lectura on public.rrhh_contador_ajustes
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) and empleado_id in (select rrhh_empleados_gestionados()));

-- ─── 2. Políticas «gestión» por centro, evaluadas una vez por consulta ──────
-- Mismo alcance que antes (gestor todo · encargado sus centros · operador), sin la llamada por fila.
drop policy if exists rrhh_turnos_gestion on public.rrhh_turnos;
create policy rrhh_turnos_gestion on public.rrhh_turnos
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()));

drop policy if exists rrhh_fichajes_gestion on public.rrhh_fichajes;
create policy rrhh_fichajes_gestion on public.rrhh_fichajes
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()));

drop policy if exists rrhh_asignaciones_gestion on public.rrhh_asignaciones;
create policy rrhh_asignaciones_gestion on public.rrhh_asignaciones
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()));

drop policy if exists rrhh_dispositivos_gestion on public.rrhh_dispositivos;
create policy rrhh_dispositivos_gestion on public.rrhh_dispositivos
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()));

drop policy if exists rrhh_centros_config_gestion on public.rrhh_centros_config;
create policy rrhh_centros_config_gestion on public.rrhh_centros_config
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()));

drop policy if exists rrhh_horas_dia_gestion on public.rrhh_horas_dia;
create policy rrhh_horas_dia_gestion on public.rrhh_horas_dia
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()));

drop policy if exists rrhh_plantillas_semana_gestion on public.rrhh_plantillas_semana;
create policy rrhh_plantillas_semana_gestion on public.rrhh_plantillas_semana
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()));

drop policy if exists rrhh_plantillas_turno_gestion on public.rrhh_plantillas_turno;
create policy rrhh_plantillas_turno_gestion on public.rrhh_plantillas_turno
  for all to authenticated
  using (
    (cuenta_id = (select cuenta_actual())
      and (case when centro_id is null then (select rrhh_es_gestor()) else centro_id in (select rrhh_centros_gestionados()) end))
    or (select es_operador())
  )
  with check (
    (cuenta_id = (select cuenta_actual())
      and (case when centro_id is null then (select rrhh_es_gestor()) else centro_id in (select rrhh_centros_gestionados()) end))
    or (select es_operador())
  );

drop policy if exists rrhh_turnos_historial_lectura on public.rrhh_turnos_historial;
create policy rrhh_turnos_historial_lectura on public.rrhh_turnos_historial
  for select to authenticated
  using ((cuenta_id = (select cuenta_actual()) and centro_id in (select rrhh_centros_gestionados())) or (select es_operador()));

drop policy if exists rrhh_disponibilidades_gestion_lectura on public.rrhh_disponibilidades;
create policy rrhh_disponibilidades_gestion_lectura on public.rrhh_disponibilidades
  for select to authenticated
  using ((cuenta_id = (select cuenta_actual()) and empleado_id in (select rrhh_empleados_gestionados())) or (select es_operador()));

-- Cambios de turno: la gestión se evalúa por el centro del turno; para no llamar a rrhh_turnos
-- fila a fila (y evitar recursión de políticas), un definer devuelve los turnos de mis centros
-- que tienen peticiones.
create or replace function public.rrhh_turnos_de_mis_centros_con_cambios()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id from public.rrhh_turnos t
  where t.id in (select c.turno_id from public.rrhh_cambios_turno c)
    and t.cuenta_id = public.cuenta_actual()
    and t.centro_id in (select public.rrhh_centros_gestionados())
$$;
revoke execute on function public.rrhh_turnos_de_mis_centros_con_cambios() from anon, public;
grant execute on function public.rrhh_turnos_de_mis_centros_con_cambios() to authenticated;

drop policy if exists rrhh_cambios_turno_gestion on public.rrhh_cambios_turno;
create policy rrhh_cambios_turno_gestion on public.rrhh_cambios_turno
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_turnos_de_mis_centros_con_cambios())) or (select es_operador()))
  with check ((cuenta_id = (select cuenta_actual()) and turno_id in (select rrhh_turnos_de_mis_centros_con_cambios())) or (select es_operador()));

-- rrhh_gestiona_centro sigue existiendo (la usan triggers y funciones); ahora pasa por el conjunto.
create or replace function public.rrhh_gestiona_centro(p_centro_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.rrhh_es_gestor()
      or exists (select 1 from public.rrhh_encargados_centro
                 where user_id = auth.uid() and centro_id = p_centro_id)
$$;

-- ─── 3. Dirección actualiza sus centros (ubicación para el fichaje móvil) ──
drop policy if exists centros_actualizacion_direccion on public.centros;
create policy centros_actualizacion_direccion on public.centros
  for update to authenticated
  using (cuenta_id = (select cuenta_actual()) and (select es_direccion()))
  with check (cuenta_id = (select cuenta_actual()) and (select es_direccion()));

-- ─── 4. App del empleado ───────────────────────────────────────────────────
-- Compañeros activos de mis centros (solo nombre): para elegir a quién pedir el cambio.
create or replace function public.rrhh_companeros_centro()
returns table (id uuid, nombre text, apellidos text, centro_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct e.id, e.nombre, e.apellidos, a.centro_id
  from public.rrhh_asignaciones a
  join public.empleados e on e.id = a.empleado_id
  where a.centro_id in (select public.rrhh_mis_centros())
    and e.cuenta_id = public.cuenta_actual()
    and e.id <> public.mi_empleado_id()
    and e.fecha_baja is null
    and (a.fecha_fin is null or a.fecha_fin >= current_date)
    and exists (select 1 from public.rrhh_periodos_contrato p
                where p.empleado_id = e.id and p.fecha_alta <= current_date
                  and (p.fecha_baja is null or p.fecha_baja >= current_date))
  order by e.apellidos, e.nombre
$$;
revoke execute on function public.rrhh_companeros_centro() from anon, public;
grant execute on function public.rrhh_companeros_centro() to authenticated;

-- Turnos que me piden cambiar (soy destinatario de una petición viva): lectura.
create or replace function public.rrhh_turnos_que_me_piden()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.turno_id from public.rrhh_cambios_turno c
  where c.destinatario_id = public.mi_empleado_id()
    and c.estado in ('pendiente', 'aceptado_companero')
$$;
revoke execute on function public.rrhh_turnos_que_me_piden() from anon, public;
grant execute on function public.rrhh_turnos_que_me_piden() to authenticated;

drop policy if exists rrhh_turnos_me_piden_lectura on public.rrhh_turnos;
create policy rrhh_turnos_me_piden_lectura on public.rrhh_turnos
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) and id in (select rrhh_turnos_que_me_piden()));

-- VERIFICACIÓN (con claims de un responsable_area):
--   select count(*) from empleados;              -- > 0 (antes 0)
--   select count(*) from rrhh_periodos_contrato; -- > 0
--   explain analyze select * from rrhh_resumen_semana(null, '2026-09-01', '2026-09-30');
