-- ESTADO: APLICADA en producción el 14-08-2026 vía MCP. No reaplicar.
-- ============================================================================
-- MIGRACIÓN F0 — Núcleo fiscal del módulo Finanzas (familia fin_*)
-- Proyecto: hostelero · Fecha: 14-08-2026 · Para revisión antes de aplicar
--
-- Qué hace: crea las tablas de facturación, Verifactu y contabilidad base.
-- Qué NO hace: no altera ninguna tabla existente. Bancos (F2), impuestos (F3)
-- y remesas (F4) llegarán con sus propias migraciones en su fase.
--
-- Convenciones de la casa que reutiliza:
--   · cuenta_actual() y es_operador() para RLS (mismo patrón que compras_/reservas_)
--   · norm_nif() para normalizar NIF
--   · trigger de actualizado_en al estilo *_tocar_actualizado
--   · append-only al estilo rrhh_fichajes_solo_append
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Funciones de apoyo
-- ----------------------------------------------------------------------------

create or replace function fin_tocar_actualizado() returns trigger
language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

-- Tablas de registro fiscal: solo inserción, jamás UPDATE ni DELETE.
create or replace function fin_solo_append() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'La tabla % es de solo inserción: registro fiscal inmutable', tg_table_name;
end $$;

-- ----------------------------------------------------------------------------
-- 1) Configuración fiscal y clientes
-- ----------------------------------------------------------------------------

create table fin_config (
  sociedad_id      uuid primary key references sociedades(id),
  cuenta_id        uuid not null references cuentas(id),
  verifactu_modo   text not null default 'verifactu' check (verifactu_modo in ('verifactu','no_verifactu')),
  regimen_iva      text not null default 'general',
  retencion_defecto numeric(5,2) not null default 0,
  serie_defecto_id uuid,                        -- FK se añade tras crear fin_series
  pie_factura      text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

create trigger fin_config_tocar before update on fin_config
  for each row execute function fin_tocar_actualizado();

-- Cliente FISCAL (NIF, domicilio…). Entidad distinta del comensal de `clientes`,
-- con enlace opcional. La supresión RGPD de un comensal nunca toca esta tabla.
create table fin_clientes (
  id               uuid primary key default gen_random_uuid(),
  cuenta_id        uuid not null references cuentas(id),
  nif              text,
  nif_norm         text,
  nombre_fiscal    text not null,
  nombre_comercial text,
  direccion        text,
  codigo_postal    text,
  municipio        text,
  provincia        text,
  pais             text not null default 'ES',
  email            text,
  telefono         text,
  iban             text,
  dias_vencimiento int  not null default 0,
  tipo_iva_defecto numeric(5,2) not null default 21.00,
  retencion_pct    numeric(5,2) not null default 0,
  comensal_id      uuid references clientes(id) on delete set null,
  notas            text,
  activo           boolean not null default true,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

create or replace function fin_clientes_normalizar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nif_norm := norm_nif(new.nif);
  return new;
end $$;

create trigger fin_clientes_norm before insert or update on fin_clientes
  for each row execute function fin_clientes_normalizar();
create trigger fin_clientes_tocar before update on fin_clientes
  for each row execute function fin_tocar_actualizado();

-- ----------------------------------------------------------------------------
-- 2) Series y facturas
-- ----------------------------------------------------------------------------

create table fin_series (
  id               uuid primary key default gen_random_uuid(),
  cuenta_id        uuid not null references cuentas(id),
  sociedad_id      uuid not null references sociedades(id),
  codigo           text not null,               -- p. ej. 'F', 'S', 'R'
  ejercicio        int  not null,
  descripcion      text,
  tipo_defecto     text not null default 'F1' check (tipo_defecto in ('F1','F2')),
  siguiente_numero bigint not null default 1,
  activa           boolean not null default true,
  creado_en        timestamptz not null default now(),
  unique (sociedad_id, codigo, ejercicio)
);

alter table fin_config
  add constraint fin_config_serie_fk
  foreign key (serie_defecto_id) references fin_series(id);

-- La factura nace como BORRADOR editable. "Expedir" (función de F1) asigna
-- número, congela el contenido y genera el registro Verifactu en la misma
-- transacción. Tras expedir, solo mutan cobro y notas internas (trigger).
create table fin_facturas (
  id                     uuid primary key default gen_random_uuid(),
  cuenta_id              uuid not null references cuentas(id),
  sociedad_id            uuid not null references sociedades(id),
  centro_id              uuid references centros(id),
  serie_id               uuid not null references fin_series(id),
  ejercicio              int  not null,
  numero                 bigint,                -- null hasta expedir
  numero_completo        text,                  -- p. ej. 'F-2026-000012'
  tipo                   text not null default 'F1'
                         check (tipo in ('F1','F2','F3','R1','R2','R3','R4','R5')),
  estado                 text not null default 'borrador'
                         check (estado in ('borrador','expedida','anulada')),
  cliente_id             uuid references fin_clientes(id),  -- opcional solo en F2
  fecha_expedicion       timestamptz,
  fecha_operacion        date,
  descripcion_operacion  text,
  base_total             numeric(14,2) not null default 0,
  cuota_iva_total        numeric(14,2) not null default 0,
  cuota_retencion        numeric(14,2) not null default 0,
  total                  numeric(14,2) not null default 0,
  moneda                 text not null default 'EUR',
  factura_rectificada_id uuid references fin_facturas(id),
  motivo_rectificacion   text,
  estado_cobro           text not null default 'pendiente'
                         check (estado_cobro in ('pendiente','parcial','cobrada')),
  importe_cobrado        numeric(14,2) not null default 0,
  notas_internas         text,
  creado_por             uuid,
  expedida_por           uuid,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now()
);

create unique index fin_facturas_numero_unico
  on fin_facturas (serie_id, numero) where numero is not null;

-- Inmutabilidad: comparamos la fila completa en jsonb menos los únicos campos
-- que pueden cambiar tras expedir. Así el trigger sobrevive a columnas futuras.
create or replace function fin_facturas_proteger() returns trigger
language plpgsql set search_path = public as $$
declare
  mutables text[] := array['estado','estado_cobro','importe_cobrado','notas_internas','actualizado_en'];
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then
      raise exception 'Una factura expedida no se borra: se anula o se rectifica (R1–R5)';
    end if;
    return old;
  end if;
  if old.estado = 'borrador' then
    return new;
  end if;
  if (to_jsonb(new) - mutables) is distinct from (to_jsonb(old) - mutables) then
    raise exception 'Factura % expedida: su contenido fiscal es inmutable', old.numero_completo;
  end if;
  if old.estado = 'expedida' and new.estado not in ('expedida','anulada') then
    raise exception 'Transición de estado no permitida';
  end if;
  if old.estado = 'anulada' and new.estado <> 'anulada' then
    raise exception 'Una factura anulada no puede reactivarse';
  end if;
  return new;
end $$;

create trigger fin_facturas_proteger_upd before update on fin_facturas
  for each row execute function fin_facturas_proteger();
create trigger fin_facturas_proteger_del before delete on fin_facturas
  for each row execute function fin_facturas_proteger();
create trigger fin_facturas_tocar before update on fin_facturas
  for each row execute function fin_tocar_actualizado();

create table fin_factura_lineas (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null references cuentas(id),
  factura_id      uuid not null references fin_facturas(id) on delete cascade,
  orden           int  not null default 1,
  concepto        text not null,
  cantidad        numeric(12,3) not null default 1,
  precio_unitario numeric(14,4) not null default 0,
  descuento_pct   numeric(5,2)  not null default 0,
  base            numeric(14,2) not null default 0,
  tipo_iva        numeric(5,2)  not null default 21.00,
  cuota_iva       numeric(14,2) not null default 0,
  tipo_retencion  numeric(5,2)  not null default 0,
  cuota_retencion numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0
);

-- Desglose por tipo impositivo: la fuente de los libros de IVA y del 303.
create table fin_factura_impuestos (
  id         uuid primary key default gen_random_uuid(),
  cuenta_id  uuid not null references cuentas(id),
  factura_id uuid not null references fin_facturas(id) on delete cascade,
  impuesto   text not null default 'IVA' check (impuesto in ('IVA','IRPF')),
  tipo_pct   numeric(5,2)  not null,
  base       numeric(14,2) not null,
  cuota      numeric(14,2) not null
);

-- Líneas y desglose solo se tocan mientras la factura es borrador.
create or replace function fin_lineas_proteger() returns trigger
language plpgsql set search_path = public as $$
declare
  v_estado text;
begin
  if tg_op in ('UPDATE','DELETE') then
    select estado into v_estado from fin_facturas where id = old.factura_id;
    if v_estado is distinct from 'borrador' then
      raise exception 'El detalle de una factura expedida es inmutable';
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select estado into v_estado from fin_facturas where id = new.factura_id;
    if v_estado is distinct from 'borrador' then
      raise exception 'El detalle de una factura expedida es inmutable';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger fin_factura_lineas_proteger
  before insert or update or delete on fin_factura_lineas
  for each row execute function fin_lineas_proteger();
create trigger fin_factura_impuestos_proteger
  before insert or update or delete on fin_factura_impuestos
  for each row execute function fin_lineas_proteger();

-- ----------------------------------------------------------------------------
-- 3) Verifactu: registros encadenados, envíos y eventos
-- ----------------------------------------------------------------------------

-- Registro de facturación (alta o anulación). INMUTABLE. Una cadena de huellas
-- por sociedad (obligado tributario), numerada por `orden`.
create table fin_verifactu_registros (
  id                  uuid primary key default gen_random_uuid(),
  cuenta_id           uuid not null references cuentas(id),
  sociedad_id         uuid not null references sociedades(id),
  factura_id          uuid not null references fin_facturas(id),
  tipo_registro       text not null check (tipo_registro in ('alta','anulacion')),
  orden               bigint not null,
  huella              text not null,            -- SHA-256 hex
  huella_anterior     text,                     -- null solo en el primer registro
  fecha_hora_registro timestamptz not null default now(),
  payload             jsonb not null,           -- contenido canónico del registro
  creado_en           timestamptz not null default now(),
  unique (sociedad_id, orden)
);

create trigger fin_verifactu_registros_append
  before update or delete on fin_verifactu_registros
  for each row execute function fin_solo_append();

-- Estado de la remisión a AEAT, separado para no mutar el registro inmutable.
create table fin_verifactu_envios (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null references cuentas(id),
  registro_id uuid not null references fin_verifactu_registros(id),
  intento     int  not null default 1,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','enviando','aceptado','aceptado_errores','rechazado','error')),
  respuesta   jsonb,
  csv_aeat    text,
  enviado_en  timestamptz,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create trigger fin_verifactu_envios_tocar before update on fin_verifactu_envios
  for each row execute function fin_tocar_actualizado();

-- Registro de eventos del sistema de facturación (trazabilidad del SIF).
create table fin_verifactu_eventos (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null references cuentas(id),
  sociedad_id uuid references sociedades(id),
  tipo        text not null,
  detalle     jsonb,
  creado_en   timestamptz not null default now()
);

create trigger fin_verifactu_eventos_append
  before update or delete on fin_verifactu_eventos
  for each row execute function fin_solo_append();

-- ----------------------------------------------------------------------------
-- 4) Contabilidad: plan, ejercicios y diario
-- ----------------------------------------------------------------------------

create table fin_plan_cuentas (
  id            uuid primary key default gen_random_uuid(),
  cuenta_id     uuid not null references cuentas(id),
  sociedad_id   uuid not null references sociedades(id),
  codigo        text not null,
  nombre        text not null,
  nif           text,
  contrapartida text,
  origen        text not null default 'manual' check (origen in ('pgc','a3','manual')),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (sociedad_id, codigo)
);

create trigger fin_plan_cuentas_tocar before update on fin_plan_cuentas
  for each row execute function fin_tocar_actualizado();

create table fin_ejercicios (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null references cuentas(id),
  sociedad_id  uuid not null references sociedades(id),
  anio         int  not null,
  fecha_inicio date not null,
  fecha_fin    date not null,
  estado       text not null default 'abierto' check (estado in ('abierto','cerrado')),
  unique (sociedad_id, anio)
);

create table fin_periodos (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null references cuentas(id),
  ejercicio_id uuid not null references fin_ejercicios(id) on delete cascade,
  mes          int  not null check (mes between 1 and 12),
  bloqueado    boolean not null default false,
  unique (ejercicio_id, mes)
);

create table fin_asientos (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null references cuentas(id),
  sociedad_id  uuid not null references sociedades(id),
  ejercicio_id uuid not null references fin_ejercicios(id),
  numero       bigint,
  fecha        date not null,
  descripcion  text,
  origen_tipo  text not null default 'manual'
               check (origen_tipo in ('manual','factura_emitida','compra','banco','apertura','regularizacion','cierre')),
  origen_id    uuid,
  estado       text not null default 'confirmado' check (estado in ('borrador','confirmado')),
  creado_por   uuid,
  creado_en    timestamptz not null default now()
);

create unique index fin_asientos_numero_unico
  on fin_asientos (ejercicio_id, numero) where numero is not null;

create table fin_apuntes (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null references cuentas(id),
  asiento_id     uuid not null references fin_asientos(id) on delete cascade,
  orden          int  not null default 1,
  cuenta_plan_id uuid not null references fin_plan_cuentas(id),
  descripcion    text,
  debe           numeric(14,2) not null default 0 check (debe  >= 0),
  haber          numeric(14,2) not null default 0 check (haber >= 0),
  check (not (debe > 0 and haber > 0))
);
-- Nota: el cuadre debe=haber por asiento lo garantiza la función de
-- contabilización (F1/F2), no un constraint diferido. Anotado como decisión.

-- ----------------------------------------------------------------------------
-- 5) RLS — patrón de la casa: (cuenta_id = cuenta_actual()) OR es_operador()
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'fin_config','fin_clientes','fin_series','fin_facturas','fin_factura_lineas',
    'fin_factura_impuestos','fin_verifactu_registros','fin_verifactu_envios',
    'fin_verifactu_eventos','fin_plan_cuentas','fin_ejercicios','fin_periodos',
    'fin_asientos','fin_apuntes'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using ((cuenta_id = cuenta_actual()) or es_operador())
         with check ((cuenta_id = cuenta_actual()) or es_operador())',
      t || '_acceso', t);
  end loop;
end $$;

-- Cinturón extra sobre los registros fiscales: ni siquiera con RLS a favor.
revoke update, delete on fin_verifactu_registros from authenticated, anon;
revoke update, delete on fin_verifactu_eventos   from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 6) Índices de trabajo
-- ----------------------------------------------------------------------------

create index fin_clientes_cuenta_idx    on fin_clientes (cuenta_id, nif_norm);
create index fin_facturas_soc_ej_idx    on fin_facturas (sociedad_id, ejercicio);
create index fin_facturas_estado_idx    on fin_facturas (cuenta_id, estado);
create index fin_facturas_cliente_idx   on fin_facturas (cliente_id);
create index fin_lineas_factura_idx     on fin_factura_lineas (factura_id);
create index fin_imp_factura_idx        on fin_factura_impuestos (factura_id);
create index fin_vf_reg_factura_idx     on fin_verifactu_registros (factura_id);
create index fin_vf_env_registro_idx    on fin_verifactu_envios (registro_id, estado);
create index fin_apuntes_asiento_idx    on fin_apuntes (asiento_id);
create index fin_apuntes_cuenta_idx     on fin_apuntes (cuenta_plan_id);
create index fin_asientos_soc_fecha_idx on fin_asientos (sociedad_id, fecha);

-- ============================================================================
-- FIN DE LA MIGRACIÓN F0
-- Pendiente para después de aplicar (mismo día):
--   1. Migrar compras_cuenta_a3 → fin_plan_cuentas (con cuadre 635 = 635)
--   2. Crear ejercicio 2026, periodos y serie F-2026 para vuestra sociedad
--   3. Registrar el área Finanzas en `modulos` (decisión aparte, toca tabla común)
-- ============================================================================
