-- El resumen de conciliación separa los pendientes por SENTIDO (cobros =
-- entradas, pagos = salidas): la pregunta de Luis era «¿dónde está el mayor
-- grupo sin conciliar?» y la respuesta resultó ser los cobros (49% pendiente,
-- +1M€: las liquidaciones de Adyen/Stripe entran agrupadas en A3). El drop es
-- obligado: cambia el tipo de retorno y Postgres no deja reemplazar.
drop function fin_conciliacion_resumen(uuid);

create function fin_conciliacion_resumen(p_banco uuid)
returns table(total int, conciliados int, pendientes int, ignorados int,
              saldo_banco numeric, saldo_contable numeric,
              pend_cobros int, pend_cobros_importe numeric,
              pend_pagos int, pend_pagos_importe numeric)
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
      order by m2.fecha desc, m2.creado_en desc limit 1),
    (select round(sum(ap.debe - ap.haber), 2)
       from fin_apuntes ap
       join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
      where ap.cuenta_plan_id = (select bc.cuenta_plan_id from fin_bancos_cuentas bc where bc.id = p_banco)),
    count(*) filter (where m.estado='pendiente' and m.importe > 0)::int,
    coalesce(round(sum(m.importe) filter (where m.estado='pendiente' and m.importe > 0), 2), 0),
    count(*) filter (where m.estado='pendiente' and m.importe < 0)::int,
    coalesce(round(sum(m.importe) filter (where m.estado='pendiente' and m.importe < 0), 2), 0)
  from fin_banco_movimientos m
  where m.banco_cuenta_id = p_banco;
$$;
