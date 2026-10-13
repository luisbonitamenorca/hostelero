-- PROPUESTA 13-10-2026 · Valoraciones de clientes (informe de satisfacción de Cover) para Ratios
--
-- Cover pide al cliente, tras la visita, una nota de 0 a 10 en Cocina, Servicio y
-- Ambiente (y en Binifadet también Vinos y Visita y cata) más una opinión libre.
-- Luis quiere verlas en Ratios como una pestaña más. El informe de Cover no trae
-- el localizador de la reserva, así que no se puede colgar de reservas_reservas
-- (y además arranca en 2023, antes de lo que tiene el módulo). Van a su propia
-- tabla, idempotente por una huella de la fila, y se enlazan a la reserva cuando
-- se encuentra (mismo restaurante, fecha, hora y teléfono o correo).
--
-- Ratios lee la vista valoraciones_ratios (seguridad del que consulta, como
-- comensales_desde_reservas): una fila por valoración con el centro en el
-- vocabulario de Ratios y sin datos personales.

create table if not exists public.reservas_valoraciones (
  id               uuid primary key default gen_random_uuid(),
  cuenta_id        uuid not null references cuentas(id),
  restaurante_id   uuid not null references reservas_restaurantes(id),
  reserva_id       uuid null references reservas_reservas(id) on delete set null,
  huella           text not null,                 -- idempotencia (md5 de la fila de Cover)
  fecha_valoracion date not null,
  fecha_reserva    date null,
  hora             time null,
  servicio         text null,                     -- Comida / Cena
  pax              integer null,
  cocina           smallint null check (cocina between 0 and 10),
  servicio_nota    smallint null check (servicio_nota between 0 and 10),
  ambiente         smallint null check (ambiente between 0 and 10),
  vinos            smallint null check (vinos between 0 and 10),
  visita_cata      smallint null check (visita_cata between 0 and 10),
  opinion          text null,
  nombre           text null,
  apellidos        text null,
  telefono         text null,
  email            text null,
  origen           text null,                     -- moduloweb, terceros, software…
  prescriptor      text null,
  cover_meta       jsonb null,                    -- resto de columnas del informe
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  unique (cuenta_id, huella)
);

comment on table public.reservas_valoraciones is
  'Valoraciones de clientes importadas del informe de satisfacción de CoverManager (0-10). Idempotente por huella.';

create index if not exists reservas_valoraciones_fecha_idx on public.reservas_valoraciones (cuenta_id, restaurante_id, fecha_valoracion);
create index if not exists reservas_valoraciones_reserva_idx on public.reservas_valoraciones (reserva_id);

drop trigger if exists reservas_valoraciones_tocar on public.reservas_valoraciones;
create trigger reservas_valoraciones_tocar before update on public.reservas_valoraciones
  for each row execute function fin_tocar_actualizado();

alter table public.reservas_valoraciones enable row level security;

drop policy if exists reservas_valoraciones_acceso on public.reservas_valoraciones;
create policy reservas_valoraciones_acceso on public.reservas_valoraciones
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

grant select, insert, update, delete on public.reservas_valoraciones to authenticated;

-- Vista para Ratios: una fila por valoración, centro en el vocabulario de Ratios,
-- sin datos personales. Media global = media de las notas que haya (0-10).
create or replace view public.valoraciones_ratios
with (security_invoker = true) as
select
  v.id,
  v.fecha_valoracion as fecha,
  extract(year from v.fecha_valoracion)::int  as anio,
  extract(month from v.fecha_valoracion)::int as mes,
  extract(week from v.fecha_valoracion)::int  as semana,
  v.fecha_reserva,
  v.servicio,
  case r.slug
    when 'binifadet'      then 'BINIFADET'
    when 'tamarindos'     then 'TAMARINDOS'
    when 'bar-tamarindos' then 'TAMARINDOS BAR'
    when 'casa-tirant'    then 'TIRANT'
    else upper(r.slug)
  end as centro,
  v.pax,
  v.cocina,
  v.servicio_nota as servicio_nota,
  v.ambiente,
  v.vinos,
  v.visita_cata,
  round((
    coalesce(v.cocina, 0) + coalesce(v.servicio_nota, 0) + coalesce(v.ambiente, 0)
    + coalesce(v.vinos, 0) + coalesce(v.visita_cata, 0)
  )::numeric / nullif(
    (v.cocina is not null)::int + (v.servicio_nota is not null)::int + (v.ambiente is not null)::int
    + (v.vinos is not null)::int + (v.visita_cata is not null)::int, 0), 2) as media,
  v.opinion,
  v.origen,
  v.prescriptor,
  (v.reserva_id is not null) as con_reserva,
  v.creado_en as created_at
from public.reservas_valoraciones v
join public.reservas_restaurantes r on r.id = v.restaurante_id
where v.cuenta_id = (select cuenta_actual()) or (select es_operador());

comment on view public.valoraciones_ratios is
  'Valoraciones de Cover para Ratios: centro en vocabulario de Ratios, notas 0-10, media de las notas presentes, sin datos personales.';

grant select on public.valoraciones_ratios to authenticated;
