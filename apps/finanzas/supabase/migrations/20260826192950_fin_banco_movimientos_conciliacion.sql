-- F2 Bancos, primera pieza real: el EXTRACTO y su conciliación contra el
-- diario. Cada fila es un movimiento del banco tal cual llega en el Excel de
-- CaixaNow (fecha, concepto, importe firmado, saldo corrido). La conciliación
-- enlaza el movimiento con SU apunte de la cuenta 572 correspondiente
-- (fin_bancos_cuentas.cuenta_plan_id dice cuál es): 'auto' cuando el cruce
-- por importe exacto y fecha cercana es inequívoco, 'manual' cuando lo decide
-- una persona. hash_mov deduplica recargas del mismo extracto.
alter table fin_bancos_cuentas
  add column cuenta_plan_id uuid references fin_plan_cuentas(id);

create table fin_banco_movimientos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas(id),
  sociedad_id uuid not null,
  banco_cuenta_id uuid not null references fin_bancos_cuentas(id) on delete cascade,
  fecha date not null,
  fecha_valor date,
  concepto text not null,
  detalle text,
  importe numeric(14,2) not null,
  saldo numeric(14,2),
  hash_mov text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','conciliado','ignorado')),
  apunte_id uuid references fin_apuntes(id) on delete set null,
  conciliado_via text check (conciliado_via in ('auto','manual')),
  conciliado_en timestamptz,
  nota text,
  creado_en timestamptz not null default now(),
  unique (banco_cuenta_id, hash_mov)
);

alter table fin_banco_movimientos enable row level security;

create policy fin_banco_movimientos_acceso on fin_banco_movimientos
  for all to authenticated
  using (cuenta_id = cuenta_actual() or es_operador())
  with check (cuenta_id = cuenta_actual() or es_operador());

create index fin_banco_mov_cuenta_fecha on fin_banco_movimientos (banco_cuenta_id, fecha);
create index fin_banco_mov_estado on fin_banco_movimientos (banco_cuenta_id, estado);
create index fin_banco_mov_apunte on fin_banco_movimientos (apunte_id);
