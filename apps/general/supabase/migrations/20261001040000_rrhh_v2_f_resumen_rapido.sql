-- RRHH v2 · parte F (01-10-2026): rrhh_resumen_semana en un solo paso.
--
-- La versión de la parte C llamaba a rrhh_horas_contrato_semana por cada empleado × semana (980
-- llamadas para un mes, ~2,4 ms cada una por la RLS de rrhh_periodos_contrato dentro de cada
-- llamada) y a rrhh_convenio_centro por empleado: ~9,5 s para un mes de toda la plantilla.
-- Mismo contrato de salida y misma regla de cálculo (ver comentarios de la parte C); ahora los
-- periodos efectivos y el convenio se calculan una vez en conjunto. Además, rrhh_saldos_horas(hasta)
-- devuelve el saldo de TODA la plantilla en una llamada (Contadores y Empleados lo necesitan).

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
  -- convenio por centro, una sola vez por centro
  conv as (
    select ce.id as centro_id, coalesce(cv.dias_laborables_semana, 5) as dias_laborables
    from public.centros ce
    left join lateral public.rrhh_convenio_centro(ce.id, ce.cuenta_id) cv on true
    where ce.cuenta_id = (select cuenta_actual())
  ),
  emp as (
    select e.id, e.cuenta_id, e.nombre, e.apellidos, e.departamento_id, e.centro_principal_id,
           e.horas_semana as horas_emp, e.fecha_alta as alta_emp, e.fecha_baja as baja_emp,
           coalesce(cv.dias_laborables, 5) as dias_laborables
    from public.empleados e
    cross join rango r
    left join conv cv on cv.centro_id = e.centro_principal_id
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
  -- periodos de contrato sin solapes, de todos los empleados a la vez (misma regla que
  -- rrhh_periodos_efectivos: cada periodo se cierra en la víspera del siguiente)
  per as (
    select p.empleado_id, p.fecha_alta,
           case when p.sig_alta is null then p.fecha_baja
                else least(coalesce(p.fecha_baja, p.sig_alta - 1), p.sig_alta - 1) end as fecha_baja,
           p.horas_semana
    from (
      select pc.empleado_id, pc.fecha_alta, pc.fecha_baja,
             coalesce(pc.horas_semana, emp.horas_emp, 0) as horas_semana,
             lead(pc.fecha_alta) over (partition by pc.empleado_id order by pc.fecha_alta, pc.creado_en) as sig_alta
      from public.rrhh_periodos_contrato pc
      join emp on emp.id = pc.empleado_id
    ) p
    union all
    select emp.id, coalesce(emp.alta_emp, date '1900-01-01'), emp.baja_emp, coalesce(emp.horas_emp, 0)
    from emp
    where not exists (select 1 from public.rrhh_periodos_contrato pc where pc.empleado_id = emp.id)
  ),
  contrato_sem as (
    select emp.id as empleado_id, s.lunes,
           round(coalesce(sum(
             p.horas_semana
             * greatest(0, least(coalesce(p.fecha_baja, s.lunes + 6), s.lunes + 6) - greatest(p.fecha_alta, s.lunes) + 1)
             / 7.0), 0), 2) as horas_contrato
    from emp
    cross join semanas s
    left join per p on p.empleado_id = emp.id
                   and p.fecha_alta <= s.lunes + 6
                   and (p.fecha_baja is null or p.fecha_baja >= s.lunes)
    group by emp.id, s.lunes
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
  -- días con actividad (trabajo O ausencia: la ausencia no suma en días con horas)
  dia_con_horas as (
    select distinct empleado_id, fecha from dia where horas_plan > 0 or horas_ret > 0
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
    left join dia_con_horas dh on dh.empleado_id = a.empleado_id and dh.fecha = g.dia::date
    where a.estado = 'aprobada'
      and a.fecha_inicio <= r.fin and a.fecha_fin >= r.ini
      and coalesce(ta.computa_contador, a.tipo in ('vacaciones', 'permiso', 'baja'))
      and dh.empleado_id is null
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
           coalesce(cs.horas_contrato, 0) as horas_contrato,
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
    left join contrato_sem cs on cs.empleado_id = emp.id and cs.lunes = s.lunes
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

-- Saldo de horas de toda la plantilla en una llamada (misma regla que rrhh_saldo_horas):
-- contador_inicial_h + Σ diferencia de las semanas desde `desde` (saldo a cierre de ese día: si no es
-- lunes, el lunes siguiente; sin fecha, 1 de enero del año de `hasta`) + ajustes en el rango.
create or replace function public.rrhh_saldos_horas(p_hasta date default current_date)
returns table (empleado_id uuid, saldo numeric, desde date)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with emp as (
    select e.id, coalesce(e.contador_inicial_h, 0) as inicial,
           coalesce(
             case when extract(isodow from e.contador_inicial_fecha) = 1 then e.contador_inicial_fecha
                  else date_trunc('week', e.contador_inicial_fecha::timestamp)::date + 7 end,
             make_date(extract(year from p_hasta)::integer, 1, 1)) as desde
    from public.empleados e
    where e.cuenta_id = (select cuenta_actual())
  ),
  res as (
    select r.empleado_id, r.lunes, r.diferencia
    from public.rrhh_resumen_semana(null, (select min(desde) from emp), p_hasta) r
  )
  select emp.id,
         round(emp.inicial
               + coalesce((select sum(r.diferencia) from res r
                           where r.empleado_id = emp.id and r.lunes >= emp.desde), 0)
               + coalesce((select sum(a.horas) from public.rrhh_contador_ajustes a
                           where a.empleado_id = emp.id and a.fecha between emp.desde and p_hasta), 0)
         , 2) as saldo,
         emp.desde
  from emp
$$;
revoke execute on function public.rrhh_saldos_horas(date) from anon, public;
grant execute on function public.rrhh_saldos_horas(date) to authenticated;
