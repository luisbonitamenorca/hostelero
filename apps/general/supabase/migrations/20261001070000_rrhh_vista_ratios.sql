-- RRHH v2 · vista rrhh_desde_personal (01-10-2026): Ratios lee las horas EN VIVO desde Personal.
--
-- Hasta ahora Ratios (apps/general/datos/ratios.html) cargaba la tabla `rrhh` subiendo los 8
-- Excel de Skello, o la rellenaba el botón «Enviar a Ratios» de Contadores (rrhh_exportar_ratios).
-- Esta vista devuelve EXACTAMENTE el mismo formato que `rrhh` calculado al vuelo desde
-- rrhh_turnos, rrhh_horas_dia, rrhh_periodos_contrato y rrhh_ausencias, con la MISMA regla que
-- rrhh_exportar_ratios:
--   · una fila por persona/semana/centro con el trabajo:
--     persona      = upper(apellidos)||', '||upper(nombre)   (dni = '': Ratios casa por nombre)
--     anio         = año NATURAL del lunes (Ratios monta la clave anio||mes con el mes de `fecha`)
--     semana       = semana ISO
--     fecha        = lunes de la semana
--     centro       = código Skello (rrhh_codigo_centro_ratios)
--     puesto       = puesto más frecuente de sus turnos publicados esa semana en ese centro
--     contrato     = horas de contrato de la semana (rrhh_resumen_semana.horas_contrato: misma
--                    regla que rrhh_horas_contrato_semana, calculada en bloque para no llamar a la
--                    función fila a fila)
--     horas_reales = por día y centro: horas_dia validadas de ese centro; si no, horas planificadas
--                    (turnos publicados) de ese centro. Suma de la semana.
--   · una fila por persona/semana con puesto = '(AUSENCIA)' en el centro principal y
--     horas_reales = horas de ausencia incluidas en el contador (rrhh_resumen_semana), para que
--     el reparto de nóminas y «extra = reales − contrato» no dejen a alguien de vacaciones a 0 h.
-- Rango: del lunes de la primera semana con turnos publicados al domingo de la última (cuenta activa).
-- id = hash estable de (persona, lunes, centro, puesto): Ratios pagina ordenando por id.
-- security_invoker: cada fila sale filtrada por la RLS de las tablas base (cuenta_actual()).
-- Solo lectura. La tabla `rrhh` y el cargador de Skello quedan como respaldo.

create or replace view public.rrhh_desde_personal
with (security_invoker = true)
as
with cta as (
  select public.cuenta_actual() as id
),
rango as (
  select date_trunc('week', min(t.fecha)::timestamp)::date as ini,
         date_trunc('week', max(t.fecha)::timestamp)::date + 6 as fin
  from public.rrhh_turnos t
  cross join cta
  where t.cuenta_id = cta.id
    and t.estado = 'publicado'
    and t.empleado_id is not null
),
-- resumen semanal de toda la plantilla (contrato y ausencias del contador), una sola llamada
res as (
  select r.empleado_id, r.lunes, r.semana, r.centro_principal_id,
         r.horas_contrato, r.horas_ausencia_contador
  from rango
  cross join lateral public.rrhh_resumen_semana(null, rango.ini, rango.fin) r
  where rango.ini is not null
),
plan as (
  select t.empleado_id, t.centro_id, t.fecha,
         sum(public.rrhh_horas_turno(t.hora_inicio, t.hora_fin, t.pausa_min)) as horas
  from public.rrhh_turnos t
  cross join cta
  cross join rango
  where t.cuenta_id = cta.id
    and t.estado = 'publicado'
    and t.empleado_id is not null
    and t.fecha between rango.ini and rango.fin
  group by 1, 2, 3
),
val as (
  select h.empleado_id, h.centro_id, h.fecha, sum(h.horas_retenidas) as horas
  from public.rrhh_horas_dia h
  cross join cta
  cross join rango
  where h.cuenta_id = cta.id
    and h.estado = 'validada'
    and h.fecha between rango.ini and rango.fin
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
  cross join cta
  cross join rango
  where t.cuenta_id = cta.id
    and t.estado = 'publicado'
    and t.empleado_id is not null
    and t.puesto is not null
    and t.fecha between rango.ini and rango.fin
  group by 1, 2, 3
),
trabajo as (
  select
    case when coalesce(e.apellidos, '') = '' then upper(e.nombre)
         else upper(e.apellidos) || ', ' || upper(e.nombre) end as persona,
    s.lunes,
    public.rrhh_codigo_centro_ratios(c.nombre) as centro,
    coalesce(p.puesto, e.departamento, '') as puesto,
    coalesce(r.horas_contrato, 0) as contrato,
    round(s.horas, 2) as horas_reales
  from sem s
  cross join cta
  join public.empleados e on e.id = s.empleado_id and e.cuenta_id = cta.id
  join public.centros c on c.id = s.centro_id
  left join puesto p on p.empleado_id = s.empleado_id and p.centro_id = s.centro_id and p.lunes = s.lunes
  left join res r on r.empleado_id = s.empleado_id and r.lunes = s.lunes
),
ausencia as (
  select
    case when coalesce(e.apellidos, '') = '' then upper(e.nombre)
         else upper(e.apellidos) || ', ' || upper(e.nombre) end as persona,
    r.lunes,
    public.rrhh_codigo_centro_ratios(c.nombre) as centro,
    '(AUSENCIA)'::text as puesto,
    r.horas_contrato as contrato,
    r.horas_ausencia_contador as horas_reales
  from res r
  cross join cta
  join public.empleados e on e.id = r.empleado_id and e.cuenta_id = cta.id
  join public.centros c on c.id = e.centro_principal_id
  where r.horas_ausencia_contador > 0
),
todo as (
  select * from trabajo
  union all
  select * from ausencia
)
select
  abs(hashtext(u.persona || '|' || u.lunes::text || '|' || u.centro || '|' || u.puesto)::bigint) as id,
  u.persona,
  ''::text as dni,
  extract(year from u.lunes)::integer as anio,
  extract(week from u.lunes)::integer as semana,
  u.lunes as fecha,
  u.centro,
  u.puesto,
  u.contrato::numeric as contrato,
  u.horas_reales::numeric as horas_reales
from todo u;

comment on view public.rrhh_desde_personal is
  'Horas semanales por persona/centro/puesto en el formato de la tabla rrhh de Ratios, calculadas en vivo desde Personal (turnos publicados, horas validadas, contrato y ausencias del contador). Solo lectura; security_invoker.';

revoke all on public.rrhh_desde_personal from public, anon;
grant select on public.rrhh_desde_personal to authenticated;
