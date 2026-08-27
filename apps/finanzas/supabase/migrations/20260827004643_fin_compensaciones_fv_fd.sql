-- (28-08-2026, último detalle de la guardia) Compensación FV↔FD:
-- una rectificativa (FD, en negativo) anula a una factura de venta (FV) del
-- mismo cliente e importe: una se paga con la otra. fin_compensaciones casa
-- el apunte al debe de la FV con el apunte al haber de la FD; ambos quedan
-- fuera de la cartera de cobro y de los candidatos del conciliador, y las
-- dos facturas se muestran «compensada».
-- (fin_facturas_ingreso y fin_cartera_candidatos redefinidas aquí; la
-- versión final de fin_facturas_ingreso, con la columna pareja, está en la
-- migración siguiente.)

create table fin_compensaciones (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas(id),
  apunte_debe uuid not null references fin_apuntes(id) on delete cascade unique,
  apunte_haber uuid not null references fin_apuntes(id) on delete cascade unique,
  importe numeric not null,
  creado_en timestamptz not null default now()
);
alter table fin_compensaciones enable row level security;
create policy fin_compensaciones_acceso on fin_compensaciones
  for all to authenticated
  using (cuenta_id = cuenta_actual() or es_operador())
  with check (cuenta_id = cuenta_actual() or es_operador());

create or replace function fin_apuntes_compensados()
returns setof uuid
language sql stable
set search_path to 'public'
as $$
  select apunte_debe from fin_compensaciones
  union
  select apunte_haber from fin_compensaciones;
$$;

create or replace function fin_cartera_candidatos(p_banco uuid, p_mov uuid)
returns table(ap_id uuid, asiento_numero bigint, asiento_fecha date, cuenta_codigo text, descripcion text, importe numeric)
language sql stable
set search_path to 'public'
as $$
  with consumido as (
    select ma.apunte_id, sum(coalesce(ma.importe, 0)) usado
    from fin_banco_mov_apuntes ma group by ma.apunte_id
  )
  select ap.id, a.numero, a.fecha, pc.codigo, a.descripcion,
         round((case when m.importe > 0 then ap.debe else ap.haber end) - coalesce(c.usado, 0), 2)
  from fin_banco_movimientos m
  join fin_apuntes ap on ap.cuenta_id = m.cuenta_id
  join fin_plan_cuentas pc on pc.id = ap.cuenta_plan_id
  join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
  left join consumido c on c.apunte_id = ap.id
  where m.id = p_mov and m.banco_cuenta_id = p_banco
    and ap.id not in (select apunte_id from fin_banco_movimientos where apunte_id is not null)
    and ap.id not in (select fin_apuntes_compensados())
    and not exists (select 1 from fin_asientos cb where cb.origen_tipo = 'manual'
                    and cb.origen_id = a.id and cb.estado = 'confirmado')
    and a.fecha <= m.fecha + 10
    and ((m.importe > 0 and ap.debe > 0 and (pc.codigo like '43%' or pc.codigo like '44%'))
      or (m.importe < 0 and ap.haber > 0
          and (pc.codigo like '40%' or pc.codigo like '41%' or pc.codigo like '465%'
               or pc.codigo like '475%' or pc.codigo like '476%')))
    and (case when m.importe > 0 then ap.debe else ap.haber end) - coalesce(c.usado, 0) > 0.005
  order by
    case when round((case when m.importe > 0 then ap.debe else ap.haber end) - coalesce(c.usado, 0), 2) = round(abs(m.importe), 2) then 0 else 1 end,
    abs(a.fecha - m.fecha), a.numero
  limit 80;
$$;
