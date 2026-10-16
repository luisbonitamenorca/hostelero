-- Distribuidores (16-10-2026): herramienta para que un distribuidor de Jano haga presupuestos
-- a clientes a partir de una lista de precios por módulo y plan.
--
-- Apartado nuevo en la portada: «Soporte» (área). Primer módulo: distribuidores.
-- App de un solo HTML (datos/distribuidores.html) servida por app/distribuidores/route.ts.
--
-- Reglas (las mismas que Pedidos y Presupuesto):
--   * SOLO ADITIVA e idempotente.
--   * RLS por cuenta: cuenta_id = (select cuenta_actual()) or (select es_operador()). Nada para anon.
--   * Se revocan truncate/references/trigger/maintain de authenticated (default privileges del proyecto).
--   * Seeds con cuenta_id explícito de Bonita (082c5366-d9ae-49b9-a8b8-8caad73985bd).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LISTA DE PRECIOS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.dist_precios (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null default cuenta_actual() references public.cuentas(id) on delete cascade,
  orden       integer not null default 0,
  modulo      text not null,
  plan        text not null default 'Normal',
  contenido   text not null default '',          -- qué incluye, una línea por elemento
  tipo        text not null default 'precio'
    constraint dist_precios_tipo_chk check (tipo in ('precio', 'incluido', 'consultar')),
  precio      numeric null,                       -- € al mes; solo cuando tipo = 'precio'
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint dist_precios_precio_chk check (tipo <> 'precio' or precio is not null)
);
comment on table public.dist_precios is 'Lista de precios de Jano por módulo y plan (pestaña Precios de Distribuidores). tipo: precio (€/mes), incluido (0 €, va de serie) o consultar (sin precio cerrado).';

create index if not exists idx_dist_precios_cuenta on public.dist_precios (cuenta_id, orden);

alter table public.dist_precios enable row level security;
revoke all on public.dist_precios from anon;
grant select, insert, update, delete on public.dist_precios to authenticated;
revoke truncate, references, trigger, maintain on public.dist_precios from authenticated;
drop policy if exists dist_precios_acceso on public.dist_precios;
create policy dist_precios_acceso on public.dist_precios
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. PRESUPUESTOS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.dist_presupuestos (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id) on delete cascade,
  numero         text not null default '',        -- lo pone el trigger: PR-AAAA-NNN por cuenta y año
  fecha          date not null default current_date,
  estado         text not null default 'borrador'
    constraint dist_presupuestos_estado_chk check (estado in ('borrador', 'enviado', 'aceptado', 'rechazado')),
  cliente_nombre text not null default '',
  cif            text null,
  contacto       text null,
  email          text null,
  telefono       text null,
  direccion      text null,
  n_centros      integer null,
  n_empleados    integer null,
  -- Copia de las líneas elegidas en el momento de hacer el presupuesto (si luego cambia la
  -- lista de precios, el presupuesto no se mueve):
  -- [{precio_id, modulo, plan, contenido, tipo, precio, cantidad}]
  lineas         jsonb not null default '[]'::jsonb,
  descuento_pct  numeric not null default 0,
  alta_inicial   numeric not null default 0,      -- importe único de puesta en marcha, si lo hay
  notas          text null,
  total_mensual  numeric not null default 0,      -- Σ precio × cantidad, con descuento aplicado
  creado_por     uuid null default auth.uid(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint dist_presupuestos_numero_ux unique (cuenta_id, numero)
);
comment on table public.dist_presupuestos is 'Presupuestos hechos a clientes desde Distribuidores. Las líneas son una copia (jsonb) de la lista de precios en el momento de hacerlo.';

create index if not exists idx_dist_presupuestos_cuenta on public.dist_presupuestos (cuenta_id, fecha desc);

alter table public.dist_presupuestos enable row level security;
revoke all on public.dist_presupuestos from anon;
grant select, insert, update, delete on public.dist_presupuestos to authenticated;
revoke truncate, references, trigger, maintain on public.dist_presupuestos from authenticated;
drop policy if exists dist_presupuestos_acceso on public.dist_presupuestos;
create policy dist_presupuestos_acceso on public.dist_presupuestos
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- Número PR-AAAA-NNN por cuenta y año. Bloqueo consultivo por cuenta para que dos altas a la vez
-- no repitan número. actualizado_en se refresca en cada update.
create or replace function public.dist_presupuestos_numerar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anio text := to_char(coalesce(new.fecha, current_date), 'YYYY');
  v_sig  integer;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('dist_presupuestos:' || new.cuenta_id::text));
    select coalesce(max(substring(numero from '\d+$')::integer), 0) + 1
      into v_sig
      from public.dist_presupuestos
     where cuenta_id = new.cuenta_id and numero like 'PR-' || v_anio || '-%';
    new.numero := 'PR-' || v_anio || '-' || lpad(v_sig::text, 3, '0');
    new.creado_en := now();
  else
    new.numero := old.numero;      -- el número no se cambia desde el panel
    new.creado_en := old.creado_en;
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;
revoke all on function public.dist_presupuestos_numerar() from public, anon, authenticated;

drop trigger if exists dist_presupuestos_numerar on public.dist_presupuestos;
create trigger dist_presupuestos_numerar
  before insert or update on public.dist_presupuestos
  for each row execute function public.dist_presupuestos_numerar();

create or replace function public.dist_precios_tocar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
revoke all on function public.dist_precios_tocar() from public, anon, authenticated;

drop trigger if exists dist_precios_tocar on public.dist_precios;
create trigger dist_precios_tocar
  before update on public.dist_precios
  for each row execute function public.dist_precios_tocar();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SEEDS
-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo nuevo en un apartado nuevo (Soporte). La portada lo pinta el último
-- (ORDEN_AREAS en lib/modulos.ts).
insert into public.modulos (id, nombre, area, madurez)
  values ('distribuidores', 'Distribuidores', 'Soporte', 'beta')
  on conflict (id) do nothing;
insert into public.modulos_contratados (cuenta_id, modulo_id, activo)
  values ('082c5366-d9ae-49b9-a8b8-8caad73985bd', 'distribuidores', true)
  on conflict do nothing;

-- Lista de precios inicial (documento «precios Jano», 16-10-2026). Solo si la cuenta no tiene ninguna.
insert into public.dist_precios (cuenta_id, orden, modulo, plan, contenido, tipo, precio)
select '082c5366-d9ae-49b9-a8b8-8caad73985bd', v.orden, v.modulo, v.plan, v.contenido, v.tipo, v.precio
from (values
  (10,  'TPV',           'Normal',   E'TPV\nPresupuesto',                                                                    'precio',    100),
  (20,  'Reservas',      'Normal',   E'Reservas\nAvisos personalizados',                                                     'precio',    50),
  (30,  'Reservas',      'Normal',   E'Tarjeta\nBonos regalo',                                                               'precio',    50),
  (40,  'Compras',       'Normal',   E'Albaranes\nFacturas',                                                                 'precio',    100),
  (50,  'Compras',       'Premium',  E'Asesoría personalizada',                                                              'consultar', null),
  (60,  'Contabilidad',  'Normal',   E'Contabilidad financiera\nContabilidad analítica\nInformes',                           'precio',    50),
  (70,  'Contabilidad',  'Premium',  E'Remesas\nConciliación bancaria\nPresupuesto\nImpuestos',                              'precio',    50),
  (80,  'Contabilidad',  'Asesoría', E'Revisión y asesoría\nPresentación cuentas e impuestos',                               'consultar', null),
  (90,  'RRHH',          'Normal',   E'Listado de empleados\nFichajes\nInforme de horas para la gestoría\nApp del empleado', 'precio',    50),
  (100, 'RRHH',          'Premium',  E'Planificación y horarios\nFormación manipulador alimentos',                           'precio',    50),
  (110, 'Ratios',        'Normal',   E'Ratios operativos',                                                                   'incluido',  null),
  (120, 'PyG',           'Normal',   E'Cuenta de resultado con detalle por proveedor',                                       'incluido',  null),
  (130, 'Agentes',       'Normal',   E'Google Reviews\nMensajes Instagram\nMensajes Facebook\nInformación competencia\nSubvenciones\nVigilante horarios', 'precio', 50),
  (140, 'Agentes',       'Premium',  E'Whatsapp\nemail',                                                                     'precio',    50),
  (150, 'Clientes',      'Normal',   E'Base de datos CRM\nCampañas email\nCampañas whatsapp',                                'precio',    100),
  (160, 'Clientes',      'Premium',  E'Campañas Meta\nCampañas Google',                                                      'consultar', null),
  (170, 'Mantenimiento', 'Normal',   E'Partes de trabajo',                                                                   'incluido',  null),
  (180, 'Documentos',    'Normal',   E'Archivo de documentos',                                                               'precio',    20),
  (190, 'Web',           'Normal',   E'Creación, mantenimiento y hosting de la web',                                         'precio',    30)
) as v(orden, modulo, plan, contenido, tipo, precio)
where not exists (select 1 from public.dist_precios p where p.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd');

-- VERIFICACIÓN (no se ejecuta):
--   select * from modulos where id = 'distribuidores';                          -- Distribuidores / Soporte / beta
--   select count(*) from dist_precios;                                           -- 19
--   select numero from dist_presupuestos order by creado_en;                     -- PR-2026-001, 002…
