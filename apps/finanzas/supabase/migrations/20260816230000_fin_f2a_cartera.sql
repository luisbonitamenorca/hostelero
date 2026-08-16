-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
-- ============================================================================
-- MIGRACIÓN F2a — Cartera: vencimientos de cobro y de pago
-- Proyecto: hostelero · Fecha: 16-08-2026
--
-- QUÉ ES ESTO
-- El equivalente al módulo Cartera de A3: cuándo hay que cobrar cada factura
-- emitida y cuándo hay que pagar cada factura recibida, y si ya está.
--
-- Es la pieza que engancha facturación con bancos (F2) y con remesas (F4): una
-- remesa de cobro no es más que un puñado de vencimientos seleccionados, y
-- conciliar un movimiento bancario es casarlo con un vencimiento.
--
-- DECISIONES QUE VAN DENTRO, PARA QUE NO HAYA QUE ADIVINARLAS
--
-- 1. Una tabla, no dos. Un cobro y un pago son el mismo hecho con el signo
--    cambiado: una fecha, un importe y si está saldado. Separarlos duplicaría
--    la lógica de vencido/parcial/liquidado y la conciliación de la F2 tendría
--    que mirar en dos sitios.
--
-- 2. Varios vencimientos por factura desde el diseño, aunque de momento se
--    genere uno. Partir a 30/60/90 es normal en hostelería y no quiero una
--    migración por eso.
--
-- 3. Las condiciones de pago de los proveedores van en tabla propia y no como
--    columnas de compras_proveedor: la regla de la casa prohíbe alterar tablas
--    que no sean fin_*, y esa es del módulo de compras.
--
-- 4. El vencimiento de venta se genera SOLO, con un disparador, al expedir. Si
--    dependiera de que la app se acuerde de crearlo, tarde o temprano habría
--    facturas expedidas sin vencimiento y nadie se enteraría hasta que faltara
--    dinero. Al anular la factura, sus vencimientos se anulan con ella.
--
-- 5. Los importes admiten negativo. Una rectificativa por diferencias genera un
--    "cobro" negativo, que es en realidad una devolución: es correcto y hay que
--    dejarlo pasar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Condiciones de pago por proveedor
-- ----------------------------------------------------------------------------

create table if not exists fin_proveedor_condiciones (
  proveedor_id   uuid primary key references compras_proveedor(id) on delete cascade,
  cuenta_id      uuid not null references cuentas(id),
  dias_pago      int  not null default 30 check (dias_pago >= 0 and dias_pago <= 365),
  forma_pago     text,
  iban           text,
  notas          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table fin_proveedor_condiciones is
  'Condiciones de pago de cada proveedor. Vive aquí y no en compras_proveedor porque esa tabla es del módulo de compras y no se altera.';

create trigger fin_proveedor_condiciones_tocar before update on fin_proveedor_condiciones
  for each row execute function fin_tocar_actualizado();

-- ----------------------------------------------------------------------------
-- 2) Vencimientos
-- ----------------------------------------------------------------------------

create table if not exists fin_vencimientos (
  id                uuid primary key default gen_random_uuid(),
  cuenta_id         uuid not null references cuentas(id),
  sociedad_id       uuid references sociedades(id),
  sentido           text not null check (sentido in ('cobro','pago')),
  factura_id        uuid references fin_facturas(id),   -- si es un cobro
  compra_doc_id     uuid references compras_doc(id),    -- si es un pago
  fecha_vencimiento date not null,
  importe           numeric(14,2) not null,
  importe_liquidado numeric(14,2) not null default 0,
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente','parcial','liquidado','anulado')),
  forma_pago        text,
  notas             text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- Un vencimiento cuelga de una factura emitida O de una recibida, nunca de
  -- las dos ni de ninguna, y el sentido tiene que cuadrar con su origen.
  constraint fin_vencimientos_origen check (
    (sentido = 'cobro' and factura_id is not null and compra_doc_id is null)
    or
    (sentido = 'pago'  and compra_doc_id is not null and factura_id is null)
  )
);

create trigger fin_vencimientos_tocar before update on fin_vencimientos
  for each row execute function fin_tocar_actualizado();

-- La consulta de todos los días: qué está pendiente y ordenado por fecha.
create index if not exists fin_vencimientos_pendientes_idx
  on fin_vencimientos (cuenta_id, sentido, fecha_vencimiento)
  where estado in ('pendiente','parcial');

create index if not exists fin_vencimientos_factura_idx on fin_vencimientos (factura_id);
create index if not exists fin_vencimientos_compra_idx  on fin_vencimientos (compra_doc_id);

-- ----------------------------------------------------------------------------
-- 3) El vencimiento de venta se crea solo al expedir
-- ----------------------------------------------------------------------------

create or replace function fin_vencimiento_al_expedir() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dias  int;
  v_forma text;
begin
  -- Al expedir: un vencimiento por el total, a los días que tenga el cliente.
  if new.estado = 'expedida' and old.estado = 'borrador' then
    select coalesce(dias_vencimiento, 0) into v_dias
      from fin_clientes where id = new.cliente_id;

    insert into fin_vencimientos (
      cuenta_id, sociedad_id, sentido, factura_id, fecha_vencimiento, importe, forma_pago
    ) values (
      new.cuenta_id, new.sociedad_id, 'cobro', new.id,
      coalesce(new.fecha_expedicion::date, current_date) + coalesce(v_dias, 0),
      new.total, v_forma
    );
  end if;

  -- Al anular: se anulan sus vencimientos, salvo los que ya estuvieran
  -- cobrados. Si algo se cobró, eso pasó de verdad y no se borra de un plumazo.
  if new.estado = 'anulada' and old.estado = 'expedida' then
    update fin_vencimientos
       set estado = 'anulado'
     where factura_id = new.id
       and estado in ('pendiente','parcial');
  end if;

  return new;
end $$;

drop trigger if exists fin_facturas_vencimiento on fin_facturas;
create trigger fin_facturas_vencimiento
  after update on fin_facturas
  for each row execute function fin_vencimiento_al_expedir();

-- ----------------------------------------------------------------------------
-- 4) RLS — patrón de la casa
-- ----------------------------------------------------------------------------

alter table fin_vencimientos enable row level security;
alter table fin_proveedor_condiciones enable row level security;

drop policy if exists fin_vencimientos_acceso on fin_vencimientos;
create policy fin_vencimientos_acceso on fin_vencimientos for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

drop policy if exists fin_proveedor_condiciones_acceso on fin_proveedor_condiciones;
create policy fin_proveedor_condiciones_acceso on fin_proveedor_condiciones for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

-- ----------------------------------------------------------------------------
-- PROBADA antes de proponerla, en una transacción con rollback contra la base
-- real (16-08-2026), incluyendo una expedición y una anulación de verdad:
--
--   Vencimiento sin origen ............................. rechazado  ✓
--   Vencimiento con factura Y compra a la vez .......... rechazado  ✓
--   Al expedir (cliente a 30 días, factura de 1.100 €) .. nace a hoy+30, 1.100,00, pendiente  ✓
--   Al anular la factura ............................... queda en anulado  ✓
-- ----------------------------------------------------------------------------
