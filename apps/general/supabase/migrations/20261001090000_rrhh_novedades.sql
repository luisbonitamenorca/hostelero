-- RRHH · Novedades (feed «Noticias» de Skello en la portada Hoy)
--
-- rrhh_novedades(p_centro_id, p_limite): últimas entradas de la cuenta (o del centro) en
-- texto llano, ordenadas por fecha descendente. Une cuatro fuentes:
--   · rrhh_turnos_historial  → turno creado / publicado / modificado / eliminado
--   · rrhh_ausencias         → solicitada (creado_en) y aprobada/rechazada (resuelta_en)
--   · rrhh_horas_dia         → jornada confirmada (validado_en)
--   · rrhh_cambios_turno     → cambio pedido (creado_en) y aprobado/rechazado (resuelto_en)
--
-- Agrupación: una publicación de semana o una importación generan cientos de filas en el
-- mismo minuto. Las entradas del mismo autor, centro y tipo dentro del mismo minuto se
-- funden en una sola («Luis ha publicado 42 turnos en Tamarindos Bar (del 05/10 al 11/10)»).
-- Una entrada sola conserva el detalle («Luis ha creado un turno de Ana el 05/10 (09:00–17:00)»).
--
-- Seguridad: security definer; filtra por cuenta_actual() y por los centros que gestiona
-- quien llama (rrhh_centros_gestionados: todos para dirección, los suyos para encargados).
-- Las ausencias sin centro se cuelgan del centro principal del empleado.

-- «Permiso por matrimonio» → «permiso por matrimonio» para que quede bien dentro de la frase
-- («ha solicitado permiso por matrimonio»). Las siglas (IT, AT) se dejan como están.
create or replace function public.rrhh_novedades_minuscula(p text)
returns text
language sql
immutable
as $$
  select case when p is null then null
              when length(p) <= 3 and upper(p) = p then p
              else lower(left(p, 1)) || substr(p, 2) end
$$;
revoke all on function public.rrhh_novedades_minuscula(text) from public, anon;
grant execute on function public.rrhh_novedades_minuscula(text) to authenticated;

create or replace function public.rrhh_novedades(p_centro_id uuid default null, p_limite int default 30)
returns table (ts timestamptz, tipo text, texto text, autor text, centro text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with
mis_centros as (
  select c.id, c.nombre
  from public.centros c
  where c.cuenta_id = public.cuenta_actual()
    and c.id in (select public.rrhh_centros_gestionados())
    and (p_centro_id is null or c.id = p_centro_id)
),
emp as (
  select e.id, nullif(trim(e.nombre || ' ' || coalesce(e.apellidos, '')), '') as nombre, e.centro_principal_id
  from public.empleados e
  where e.cuenta_id = public.cuenta_actual()
),
-- Eventos atómicos: quién (autor_id), qué (tipo), a quién (sujeto), cuándo (fecha/fecha_fin), dónde (centro_id)
ev as (
  -- Turnos: historial
  select h.ts,
         case
           when h.accion = 'insert' then 'turno_creado'
           when h.accion = 'delete' then 'turno_eliminado'
           when (h.antes->>'estado') is distinct from 'publicado' and (h.despues->>'estado') = 'publicado' then 'turno_publicado'
           else 'turno_modificado'
         end as tipo,
         h.centro_id,
         h.user_id as autor_id,
         coalesce(e.nombre, 'sin asignar') as sujeto,
         (coalesce(h.despues, h.antes)->>'fecha')::date as fecha,
         (coalesce(h.despues, h.antes)->>'fecha')::date as fecha_fin,
         left(coalesce(h.despues, h.antes)->>'hora_inicio', 5) || '–' || left(coalesce(h.despues, h.antes)->>'hora_fin', 5) as extra
  from public.rrhh_turnos_historial h
  left join emp e on e.id = (coalesce(h.despues, h.antes)->>'empleado_id')::uuid
  where h.cuenta_id = public.cuenta_actual()
    and h.centro_id in (select id from mis_centros)
    -- Un update que solo toca el sello modificado_en no es noticia
    and not (h.accion = 'update' and (h.antes - 'modificado_en') = (h.despues - 'modificado_en'))

  union all
  -- Ausencias: solicitud
  select a.creado_en, 'ausencia_solicitada',
         coalesce(a.centro_id, e.centro_principal_id), a.solicitada_por,
         coalesce(e.nombre, 'un empleado'), a.fecha_inicio, a.fecha_fin,
         public.rrhh_novedades_minuscula(coalesce(ta.nombre, a.tipo::text))
  from public.rrhh_ausencias a
  left join emp e on e.id = a.empleado_id
  left join public.rrhh_tipos_ausencia ta on ta.id = a.tipo_id
  where a.cuenta_id = public.cuenta_actual()
    and coalesce(a.centro_id, e.centro_principal_id) in (select id from mis_centros)

  union all
  -- Ausencias: resolución
  select a.resuelta_en,
         case when a.estado::text = 'aprobada' then 'ausencia_aprobada'
              when a.estado::text = 'rechazada' then 'ausencia_rechazada'
              else 'ausencia_resuelta' end,
         coalesce(a.centro_id, e.centro_principal_id), a.resuelta_por,
         coalesce(e.nombre, 'un empleado'), a.fecha_inicio, a.fecha_fin,
         public.rrhh_novedades_minuscula(coalesce(ta.nombre, a.tipo::text))
  from public.rrhh_ausencias a
  left join emp e on e.id = a.empleado_id
  left join public.rrhh_tipos_ausencia ta on ta.id = a.tipo_id
  where a.cuenta_id = public.cuenta_actual()
    and a.resuelta_en is not null
    and coalesce(a.centro_id, e.centro_principal_id) in (select id from mis_centros)

  union all
  -- Jornadas confirmadas
  select hd.validado_en, 'jornada_confirmada', hd.centro_id, hd.validado_por,
         coalesce(e.nombre, 'un empleado'), hd.fecha, hd.fecha, null
  from public.rrhh_horas_dia hd
  left join emp e on e.id = hd.empleado_id
  where hd.cuenta_id = public.cuenta_actual()
    and hd.validado_en is not null
    and hd.centro_id in (select id from mis_centros)

  union all
  -- Cambios de turno: petición (el autor es el propio empleado, no un perfil)
  select c.creado_en, 'cambio_pedido', t.centro_id, null::uuid,
         coalesce(s.nombre, 'un empleado'), t.fecha, t.fecha, d.nombre
  from public.rrhh_cambios_turno c
  join public.rrhh_turnos t on t.id = c.turno_id
  left join emp s on s.id = c.solicitante_id
  left join emp d on d.id = c.destinatario_id
  where c.cuenta_id = public.cuenta_actual()
    and t.centro_id in (select id from mis_centros)

  union all
  -- Cambios de turno: resolución
  select c.resuelto_en,
         case when c.estado = 'aprobado' then 'cambio_aprobado'
              when c.estado = 'rechazado' then 'cambio_rechazado'
              else 'cambio_resuelto' end,
         t.centro_id, c.resuelto_por,
         coalesce(s.nombre, 'un empleado'), t.fecha, t.fecha, d.nombre
  from public.rrhh_cambios_turno c
  join public.rrhh_turnos t on t.id = c.turno_id
  left join emp s on s.id = c.solicitante_id
  left join emp d on d.id = c.destinatario_id
  where c.cuenta_id = public.cuenta_actual()
    and c.resuelto_en is not null
    and t.centro_id in (select id from mis_centros)
),
-- Mismo autor + centro + tipo + minuto → una sola entrada
grp as (
  select max(ev.ts) as ts, ev.tipo, ev.centro_id, ev.autor_id,
         count(*)::int as n,
         min(ev.sujeto) as sujeto,
         min(ev.fecha) as fecha, max(ev.fecha_fin) as fecha_fin,
         min(ev.extra) as extra
  from ev
  where ev.ts is not null
  group by ev.tipo, ev.centro_id, ev.autor_id, date_trunc('minute', ev.ts)
),
con_nombres as (
  select g.*,
         coalesce(nullif(trim(p.nombre), ''), p.correo, 'Sistema') as autor_nombre,
         c.nombre as centro_nombre,
         to_char(g.fecha, 'DD/MM') as f1,
         to_char(g.fecha_fin, 'DD/MM') as f2,
         replace(to_char(g.n, 'FM999,999,999'), ',', '.') as n_txt,
         case when g.fecha = g.fecha_fin then 'el ' || to_char(g.fecha, 'DD/MM')
              else 'del ' || to_char(g.fecha, 'DD/MM') || ' al ' || to_char(g.fecha_fin, 'DD/MM') end as rango
  from grp g
  left join public.perfiles p on p.id = g.autor_id
  left join public.centros c on c.id = g.centro_id
)
select x.ts, x.tipo,
  case x.tipo
    when 'turno_creado' then
      case when x.n = 1 then x.autor_nombre || ' ha creado un turno de ' || x.sujeto || ' el ' || x.f1 || ' (' || x.extra || ') en ' || x.centro_nombre
           else x.autor_nombre || ' ha creado ' || x.n_txt || ' turnos en ' || x.centro_nombre || ' (' || x.rango || ')' end
    when 'turno_publicado' then
      case when x.n = 1 then x.autor_nombre || ' ha publicado el turno de ' || x.sujeto || ' del ' || x.f1 || ' (' || x.extra || ') en ' || x.centro_nombre
           else x.autor_nombre || ' ha publicado ' || x.n_txt || ' turnos en ' || x.centro_nombre || ' (' || x.rango || ')' end
    when 'turno_modificado' then
      case when x.n = 1 then x.autor_nombre || ' ha modificado el turno de ' || x.sujeto || ' del ' || x.f1 || ' (' || x.extra || ') en ' || x.centro_nombre
           else x.autor_nombre || ' ha modificado ' || x.n_txt || ' turnos en ' || x.centro_nombre || ' (' || x.rango || ')' end
    when 'turno_eliminado' then
      case when x.n = 1 then x.autor_nombre || ' ha eliminado el turno de ' || x.sujeto || ' del ' || x.f1 || ' (' || x.extra || ') en ' || x.centro_nombre
           else x.autor_nombre || ' ha eliminado ' || x.n_txt || ' turnos en ' || x.centro_nombre || ' (' || x.rango || ')' end
    when 'ausencia_solicitada' then
      case when x.n = 1 and x.autor_id is null then x.sujeto || ' ha solicitado ' || x.extra || ' ' || x.rango
           when x.n = 1 then x.autor_nombre || ' ha registrado ' || x.extra || ' de ' || x.sujeto || ' ' || x.rango
           else x.autor_nombre || ' ha registrado ' || x.n_txt || ' ausencias (' || x.rango || ')' end
    when 'ausencia_aprobada' then
      case when x.n = 1 then x.autor_nombre || ' ha aprobado ' || x.extra || ' de ' || x.sujeto || ' ' || x.rango
           else x.autor_nombre || ' ha aprobado ' || x.n_txt || ' ausencias (' || x.rango || ')' end
    when 'ausencia_rechazada' then
      case when x.n = 1 then x.autor_nombre || ' ha rechazado ' || x.extra || ' de ' || x.sujeto || ' ' || x.rango
           else x.autor_nombre || ' ha rechazado ' || x.n_txt || ' ausencias (' || x.rango || ')' end
    when 'ausencia_resuelta' then
      case when x.n = 1 then x.autor_nombre || ' ha resuelto ' || x.extra || ' de ' || x.sujeto || ' ' || x.rango
           else x.autor_nombre || ' ha resuelto ' || x.n_txt || ' ausencias (' || x.rango || ')' end
    when 'jornada_confirmada' then
      case when x.n = 1 then x.autor_nombre || ' ha confirmado la jornada del ' || x.f1 || ' de ' || x.sujeto || ' en ' || x.centro_nombre
           else x.autor_nombre || ' ha confirmado ' || x.n_txt || ' jornadas en ' || x.centro_nombre || ' (' || x.rango || ')' end
    when 'cambio_pedido' then
      case when x.n = 1 then x.sujeto || ' ha pedido cambiar su turno del ' || x.f1 || coalesce(' con ' || x.extra, '') || ' en ' || x.centro_nombre
           else 'Se han pedido ' || x.n_txt || ' cambios de turno en ' || x.centro_nombre || ' (' || x.rango || ')' end
    when 'cambio_aprobado' then
      case when x.n = 1 then x.autor_nombre || ' ha aprobado el cambio de turno de ' || x.sujeto || ' del ' || x.f1 || coalesce(' a ' || x.extra, '') || ' en ' || x.centro_nombre
           else x.autor_nombre || ' ha aprobado ' || x.n_txt || ' cambios de turno en ' || x.centro_nombre end
    when 'cambio_rechazado' then
      case when x.n = 1 then x.autor_nombre || ' ha rechazado el cambio de turno de ' || x.sujeto || ' del ' || x.f1 || ' en ' || x.centro_nombre
           else x.autor_nombre || ' ha rechazado ' || x.n_txt || ' cambios de turno en ' || x.centro_nombre end
    else x.autor_nombre || ' ha resuelto el cambio de turno de ' || x.sujeto || ' del ' || x.f1 || ' en ' || x.centro_nombre
  end as texto,
  case when x.tipo in ('cambio_pedido') or (x.tipo = 'ausencia_solicitada' and x.autor_id is null and x.n = 1)
       then x.sujeto else x.autor_nombre end as autor,
  x.centro_nombre as centro
from con_nombres x
order by x.ts desc
limit greatest(1, least(coalesce(p_limite, 30), 200))
$$;

revoke all on function public.rrhh_novedades(uuid, int) from public, anon;
grant execute on function public.rrhh_novedades(uuid, int) to authenticated;

comment on function public.rrhh_novedades(uuid, int) is
  'Feed de novedades de RRHH (portada Hoy): turnos, ausencias, jornadas confirmadas y cambios de turno, agrupados por autor/centro/minuto.';

-- ─── Franja retenida de la vista Jornada (Fichajes) ────────────────────────
alter table public.rrhh_horas_dia
  add column if not exists entrada_ret text,
  add column if not exists salida_ret text,
  add column if not exists descanso_ret_min integer not null default 0,
  add column if not exists ausente boolean not null default false;
comment on column public.rrhh_horas_dia.entrada_ret is 'Entrada retenida HH:MM (vista Jornada)';
comment on column public.rrhh_horas_dia.salida_ret is 'Salida retenida HH:MM; anterior a la entrada = madrugada siguiente';
comment on column public.rrhh_horas_dia.descanso_ret_min is 'Descanso retenido en minutos';
comment on column public.rrhh_horas_dia.ausente is 'Marcado ausente al confirmar la jornada (0 h)';

-- ─── El trigger de tipo de ausencia trata la service key como gestor ───────
-- (los cargadores por script crean bajas, que no son solicitables por el empleado)
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
       and coalesce(auth.role(), '') <> 'service_role'
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
