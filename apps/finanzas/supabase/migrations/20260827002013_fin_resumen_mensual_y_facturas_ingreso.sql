-- (28-08-2026) Dos piezas de la revisión de Luis:
--  · fin_conciliacion_resumen acepta rango de fechas: al filtrar por mes en
--    la pantalla, los indicadores hablan de ESE mes (los saldos, a fin de
--    rango). Sin rango, todo el extracto, como antes.
--  · fin_facturas_ingreso: las facturas de ingreso de Ágora viven como
--    asientos (nominativas una a una, simplificadas agrupadas por día y
--    centro); esta función las lista como facturas para la pantalla de
--    Facturas emitidas, con su asiento y su total.

drop function fin_conciliacion_resumen(uuid);
create or replace function fin_conciliacion_resumen(p_banco uuid, p_desde date default null, p_hasta date default null)
returns table(total integer, conciliados integer, pendientes integer, ignorados integer, saldo_banco numeric, saldo_contable numeric, pend_cobros integer, pend_cobros_importe numeric, pend_pagos integer, pend_pagos_importe numeric)
language sql stable
set search_path to 'public'
as $$
  select
    count(*)::int,
    count(*) filter (where m.estado='conciliado')::int,
    count(*) filter (where m.estado='pendiente')::int,
    count(*) filter (where m.estado='ignorado')::int,
    (select m2.saldo from fin_banco_movimientos m2
      where m2.banco_cuenta_id = p_banco and m2.saldo is not null
        and (p_hasta is null or m2.fecha <= p_hasta)
      order by m2.fecha desc, m2.creado_en desc limit 1),
    (select round(sum(ap.debe - ap.haber), 2)
       from fin_apuntes ap
       join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
      where ap.cuenta_plan_id = (select bc.cuenta_plan_id from fin_bancos_cuentas bc where bc.id = p_banco)
        and (p_hasta is null or a.fecha <= p_hasta)),
    count(*) filter (where m.estado='pendiente' and m.importe > 0)::int,
    coalesce(round(sum(m.importe) filter (where m.estado='pendiente' and m.importe > 0), 2), 0),
    count(*) filter (where m.estado='pendiente' and m.importe < 0)::int,
    coalesce(round(sum(m.importe) filter (where m.estado='pendiente' and m.importe < 0), 2), 0)
  from fin_banco_movimientos m
  where m.banco_cuenta_id = p_banco
    and (p_desde is null or m.fecha >= p_desde)
    and (p_hasta is null or m.fecha <= p_hasta);
$$;

create or replace function fin_facturas_ingreso()
returns table(asiento_id uuid, numero bigint, fecha date, tipo text, descripcion text, total numeric)
language sql stable
set search_path to 'public'
as $$
  select a.id, a.numero, a.fecha,
         case when a.descripcion like 'Fra. %' then 'nominativa' else 'diaria' end,
         a.descripcion,
         (select round(sum(ap.debe), 2) from fin_apuntes ap where ap.asiento_id = a.id)
  from fin_asientos a
  where a.estado = 'confirmado' and a.origen_tipo = 'manual'
    and (a.descripcion like 'Fra. %' or a.descripcion like 'Ventas %')
  order by a.fecha desc, a.numero desc;
$$;
