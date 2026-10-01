-- Reservas v2 · parte B (01-10-2026): el camino Cover → módulo Reservas → Ratios.
--
-- Hasta el corte con CoverManager, el informe «Tracking de reservas» de Cover se carga en el
-- módulo con scripts/cargar-cover-tracking.mjs (igual que Skello → Personal). Ratios deja de
-- necesitar el Excel COVERMANAGER: lee los comensales en vivo de la vista
-- comensales_desde_reservas, con el mismo formato que su tabla `comensales`.
--
-- Solo aditiva. Va DESPUÉS de 20261001120000_reservas_v2.sql.

-- ─── 1. Rastro de Cover en clientes y reservas ───────────────────────────
alter table public.reservas_clientes
  add column if not exists cover_id   text null,
  add column if not exists cover_meta jsonb null;
create unique index if not exists reservas_clientes_cover_id_ux
  on public.reservas_clientes (cuenta_id, cover_id) where cover_id is not null;
comment on column public.reservas_clientes.cover_id is 'ID del cliente en CoverManager (listado de clientes); re-importación idempotente.';
comment on column public.reservas_clientes.cover_meta is 'Datos de Cover sin columna propia: {origen, reservas_cover, direccion}.';

alter table public.reservas_reservas
  add column if not exists cover_meta jsonb null;
comment on column public.reservas_reservas.cover_meta is 'Datos del tracking de Cover sin columna propia (anotado_por, creado_por, zona/mesa de Cover, políticas…).';

-- ─── 2. Aforo por turno (lo que Cover llama «capacidad» en «personas por turno y día») ──
update public.reservas_turnos t
set max_pax_total = v.cap
from (values ('binifadet', 216), ('tamarindos', 101), ('bar-tamarindos', 107), ('casa-tirant', 96)) as v(slug, cap),
     public.reservas_restaurantes r
where r.slug = v.slug and t.restaurante_id = r.id and t.max_pax_total is null;

-- ─── 3. Vista para Ratios: comensales por día, centro y servicio ─────────
-- Misma salida que la tabla `comensales` de Ratios:
--   id, fecha, anio, mes, semana, dia_semana, servicio (Comida|Cena), centro (código Ratios),
--   comensales, capacidad, created_at.
-- Reglas (calcadas del informe de Cover «Número de personas por turno y por día»):
--   * Un día cuenta para un restaurante/turno desde su primera reserva de la temporada hasta la
--     última (así no salen «días a cero» fuera de temporada); solo hasta hoy.
--   * comensales = pax de las reservas que estuvieron (llegada/sentada/postre/cuenta/terminada);
--     para hoy y días futuros se cuentan también las vivas (pendiente/confirmada/reconfirmada).
--   * capacidad = cupo del día (reservas_cupos.max_pax_total) o aforo del turno
--     (reservas_turnos.max_pax_total); 0 si el día/turno está cerrado (cupo o cierre).
--   * El turno de una reserva: su turno_id; si no lo tiene, por la hora (< 17:00 Comida).
create or replace view public.comensales_desde_reservas
with (security_invoker = true) as
with cta as (
  select cuenta_actual() as id
),
rest as (
  select r.id, r.slug, r.cuenta_id,
         case r.slug
           when 'binifadet' then 'BINIFADET'
           when 'tamarindos' then 'TAMARINDOS'
           when 'bar-tamarindos' then 'TAMARINDOS BAR'
           when 'casa-tirant' then 'TIRANT'
           else coalesce(replace(rrhh_codigo_centro_ratios(c.nombre), '_', ' '), upper(r.slug))
         end as centro
  from public.reservas_restaurantes r
  cross join cta
  left join public.centros c on c.id = r.centro_id
  where r.cuenta_id = cta.id
),
turno as (
  select t.id, t.restaurante_id,
         case when lower(t.nombre) like 'cena%' then 'Cena' else 'Comida' end as servicio,
         t.max_pax_total, t.hora_inicio, t.hora_fin
  from public.reservas_turnos t
  join rest on rest.id = t.restaurante_id
  where t.activo
),
res as (
  select r.restaurante_id, r.fecha, r.pax, r.estado, r.actualizado_en,
         coalesce(t.servicio, case when r.hora < time '17:00' then 'Comida' else 'Cena' end) as servicio
  from public.reservas_reservas r
  join rest on rest.id = r.restaurante_id
  left join turno t on t.id = r.turno_id
  where r.estado not in ('cancelada', 'tarjeta_pendiente', 'lista_espera')
),
temporada as (
  select restaurante_id, servicio, min(fecha) as desde, least(max(fecha), current_date) as hasta
  from res
  group by restaurante_id, servicio
),
dias as (
  select tp.restaurante_id, tp.servicio, g.d::date as fecha
  from temporada tp
  cross join lateral generate_series(tp.desde::timestamp, tp.hasta::timestamp, interval '1 day') as g(d)
),
suma as (
  select restaurante_id, servicio, fecha,
         sum(pax) filter (where estado in ('llegada', 'sentada', 'postre', 'cuenta', 'terminada')
                             or (fecha >= current_date and estado in ('pendiente', 'confirmada', 'reconfirmada'))) as comensales,
         max(actualizado_en) as actualizado_en
  from res
  group by restaurante_id, servicio, fecha
)
select abs(hashtext(d.fecha::text || '|' || rest.centro || '|' || d.servicio))::bigint as id,
       d.fecha,
       extract(year from d.fecha)::integer as anio,
       extract(month from d.fecha)::integer as mes,
       extract(week from d.fecha)::integer as semana,
       extract(isodow from d.fecha)::integer as dia_semana,
       d.servicio,
       rest.centro,
       coalesce(s.comensales, 0)::integer as comensales,
       case
         when coalesce(cu.cerrado, false) or ci.id is not null then 0
         else coalesce(cu.max_pax_total, t.max_pax_total, 0)
       end::integer as capacidad,
       coalesce(s.actualizado_en, now()) as created_at
from dias d
join rest on rest.id = d.restaurante_id
left join turno t on t.restaurante_id = d.restaurante_id and t.servicio = d.servicio
left join suma s on s.restaurante_id = d.restaurante_id and s.servicio = d.servicio and s.fecha = d.fecha
-- cupo del día: el del turno manda sobre el de «todo el día»
left join lateral (
  select c.cerrado, c.max_pax_total
  from public.reservas_cupos c
  where c.restaurante_id = d.restaurante_id and c.fecha = d.fecha
    and (c.turno_id = t.id or c.turno_id is null)
  order by (c.turno_id is null)
  limit 1
) cu on true
left join lateral (
  select c.id
  from public.reservas_cierres c
  where c.restaurante_id = d.restaurante_id and c.fecha = d.fecha
    and (c.turno_id = t.id or c.turno_id is null)
  limit 1
) ci on true
order by d.fecha, rest.centro, d.servicio;

grant select on public.comensales_desde_reservas to authenticated;
revoke all on public.comensales_desde_reservas from anon;
