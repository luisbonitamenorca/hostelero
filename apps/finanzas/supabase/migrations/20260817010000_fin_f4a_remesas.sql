-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
-- ============================================================================
-- MIGRACIÓN F4a — Remesas SEPA: cuentas, mandatos y remesas de cobro y pago
-- Proyecto: hostelero · Fecha: 17-08-2026
--
-- QUÉ ES ESTO
-- Agrupar vencimientos en un fichero que se sube a la banca electrónica. De
-- cobro (adeudos domiciliados, pain.008) y de pago (transferencias, pain.001).
--
-- ADVERTENCIA, PORQUE AQUÍ SE MUEVE DINERO DE VERDAD
-- Un fichero de adeudos mal formado no da un error bonito: carga importes
-- equivocados a clientes reales, genera devoluciones y comisiones. Ningún
-- fichero se sube al banco hasta que la entidad valide uno de prueba.
--
-- DOS COSAS QUE NO SON CÓDIGO Y BLOQUEAN LOS COBROS
--
-- 1. Los MANDATOS. Domiciliar un recibo exige que el cliente haya firmado un
--    mandato SEPA. No es un requisito técnico nuestro: es la norma. Sin mandato
--    vigente, ese cliente no puede ir en una remesa de cobro.
--
-- 2. El IDENTIFICADOR DE ACREEDOR. Lo asigna el banco al contratar el servicio
--    de adeudos. Aquí se guarda en fin_config y NO se calcula ni se inventa:
--    aunque exista un algoritmo para derivarlo del CIF, el sufijo lo acuerda
--    cada empresa con su entidad, y un identificador equivocado tumba la remesa
--    entera.
--
-- Las remesas de PAGO no necesitan ninguna de las dos: basta la cuenta
-- ordenante y el IBAN del proveedor. Por eso son las que antes servirán.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Nuestras cuentas bancarias (las ordenantes)
-- ----------------------------------------------------------------------------

create table if not exists fin_bancos_cuentas (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null references cuentas(id),
  sociedad_id    uuid not null references sociedades(id),
  nombre         text not null,               -- 'CaixaBank operativa', etc.
  iban           text not null,
  bic            text,
  titular        text,
  activa         boolean not null default true,
  es_defecto     boolean not null default false,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cuenta_id, iban)
);

create trigger fin_bancos_cuentas_tocar before update on fin_bancos_cuentas
  for each row execute function fin_tocar_actualizado();

create index if not exists fin_bancos_cuentas_cuenta_idx on fin_bancos_cuentas (cuenta_id);
create index if not exists fin_bancos_cuentas_sociedad_idx on fin_bancos_cuentas (sociedad_id);

-- ----------------------------------------------------------------------------
-- 2) Mandatos SEPA de los clientes
-- ----------------------------------------------------------------------------

create table if not exists fin_mandatos (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null references cuentas(id),
  cliente_id     uuid not null references fin_clientes(id),
  referencia     text not null,               -- la que viaja en el fichero
  tipo           text not null default 'CORE' check (tipo in ('CORE','B2B')),
  fecha_firma    date not null,
  iban           text not null,
  bic            text,
  estado         text not null default 'activo' check (estado in ('activo','revocado')),
  -- El primer adeudo de un mandato va marcado como FRST y los siguientes como
  -- RCUR. Se guarda aquí porque es del mandato, no de la remesa.
  usado          boolean not null default false,
  fecha_ultimo_uso date,
  notas          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cuenta_id, referencia)
);

create trigger fin_mandatos_tocar before update on fin_mandatos
  for each row execute function fin_tocar_actualizado();

create index if not exists fin_mandatos_cliente_idx on fin_mandatos (cliente_id);
create index if not exists fin_mandatos_cuenta_idx on fin_mandatos (cuenta_id);

-- ----------------------------------------------------------------------------
-- 3) Remesas y sus líneas
-- ----------------------------------------------------------------------------

create table if not exists fin_remesas (
  id               uuid primary key default gen_random_uuid(),
  cuenta_id        uuid not null references cuentas(id),
  sociedad_id      uuid not null references sociedades(id),
  sentido          text not null check (sentido in ('cobro','pago')),
  banco_cuenta_id  uuid not null references fin_bancos_cuentas(id),
  concepto         text,
  fecha_ejecucion  date not null,             -- cargo/abono solicitado al banco
  estado           text not null default 'borrador'
                   check (estado in ('borrador','generada','enviada','cerrada','anulada')),
  total            numeric(14,2) not null default 0,
  num_items        int not null default 0,
  nombre_fichero   text,
  generada_en      timestamptz,
  enviada_en       timestamptz,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

create trigger fin_remesas_tocar before update on fin_remesas
  for each row execute function fin_tocar_actualizado();

create index if not exists fin_remesas_cuenta_idx on fin_remesas (cuenta_id, estado);
create index if not exists fin_remesas_sociedad_idx on fin_remesas (sociedad_id);
create index if not exists fin_remesas_banco_idx on fin_remesas (banco_cuenta_id);

-- Los datos del deudor/acreedor se CONGELAN al meter la línea: lo que viajó en
-- el fichero tiene que poder reconstruirse aunque después cambie la ficha del
-- cliente o del proveedor. Sin esto, una devolución dentro de tres meses sería
-- imposible de explicar.
create table if not exists fin_remesas_items (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null references cuentas(id),
  remesa_id       uuid not null references fin_remesas(id) on delete cascade,
  vencimiento_id  uuid not null references fin_vencimientos(id),
  importe         numeric(14,2) not null,
  nombre          text not null,              -- deudor (cobro) u ordenante (pago)
  iban            text not null,
  bic             text,
  mandato_ref     text,                       -- solo en cobros
  mandato_fecha   date,
  secuencia       text check (secuencia in ('FRST','RCUR','OOFF','FNAL')),
  concepto        text,
  referencia      text,                       -- id de la línea dentro del fichero
  creado_en       timestamptz not null default now(),
  unique (remesa_id, vencimiento_id)
);

create index if not exists fin_remesas_items_remesa_idx on fin_remesas_items (remesa_id);
create index if not exists fin_remesas_items_vencimiento_idx on fin_remesas_items (vencimiento_id);
create index if not exists fin_remesas_items_cuenta_idx on fin_remesas_items (cuenta_id);

-- ----------------------------------------------------------------------------
-- 4) Identificador de acreedor: en la configuración de la sociedad
-- ----------------------------------------------------------------------------

alter table fin_config
  add column if not exists identificador_acreedor text;

comment on column fin_config.identificador_acreedor is
  'Identificador de acreedor SEPA, el que asigna el banco al contratar los adeudos. NO se calcula: se copia del que dé la entidad. Sin él no se pueden generar remesas de cobro.';

-- ----------------------------------------------------------------------------
-- 5) RLS — patrón de la casa
-- ----------------------------------------------------------------------------

alter table fin_bancos_cuentas enable row level security;
alter table fin_mandatos       enable row level security;
alter table fin_remesas        enable row level security;
alter table fin_remesas_items  enable row level security;

drop policy if exists fin_bancos_cuentas_acceso on fin_bancos_cuentas;
create policy fin_bancos_cuentas_acceso on fin_bancos_cuentas for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

drop policy if exists fin_mandatos_acceso on fin_mandatos;
create policy fin_mandatos_acceso on fin_mandatos for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

drop policy if exists fin_remesas_acceso on fin_remesas;
create policy fin_remesas_acceso on fin_remesas for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

drop policy if exists fin_remesas_items_acceso on fin_remesas_items;
create policy fin_remesas_items_acceso on fin_remesas_items for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

-- ----------------------------------------------------------------------------
-- 6) Una remesa generada ya no se toca
-- ----------------------------------------------------------------------------
-- En cuanto se genera el fichero y se sube al banco, sus líneas son el reflejo
-- de lo que se mandó. Cambiarlas después dejaría el sistema diciendo una cosa y
-- el banco otra. Se pueden anular y rehacer, no editar.

create or replace function fin_remesas_items_proteger() returns trigger
language plpgsql set search_path = public as $$
declare
  v_estado text;
begin
  select estado into v_estado from fin_remesas
   where id = coalesce(new.remesa_id, old.remesa_id);

  -- Si la remesa ya no existe, esto viene del cascade de su borrado.
  if not found then
    return coalesce(old, new);
  end if;

  if v_estado <> 'borrador' then
    raise exception 'La remesa ya está %: sus líneas no se tocan. Anúlala y haz otra.', v_estado;
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists fin_remesas_items_proteger on fin_remesas_items;
create trigger fin_remesas_items_proteger
  before insert or update or delete on fin_remesas_items
  for each row execute function fin_remesas_items_proteger();

-- ----------------------------------------------------------------------------
-- Comprobación posterior sugerida (en una transacción con rollback):
--
--   · Crear cuenta bancaria, remesa en borrador y una línea: debe funcionar.
--   · Pasar la remesa a 'generada' e intentar tocar la línea: debe fallar.
--   · Borrar la remesa entera: el cascade debe poder llevarse sus líneas.
-- ----------------------------------------------------------------------------
