-- Resumen fiscal por trimestre para la página de Impuestos: flujos de IVA
-- (477/472 por tipo), retenciones practicadas (4751 por porcentaje, solo el
-- haber: el debe son los pagos al presentar), resultado (6/7) y créditos
-- (473, 4752). Se excluyen la apertura y los asientos de regularización o
-- liquidación del IVA (los que tocan 4750/470), que no son flujo del periodo.
-- Corre con los permisos del invocador: la RLS de fin_apuntes acota la cuenta.
create or replace function public.fin_impuestos(p_anio int)
returns table(trimestre int, clave text, importe numeric)
language sql
stable
set search_path to 'public'
as $$
  with excl as (
    select distinct ap.asiento_id as id
    from fin_apuntes ap
    join fin_plan_cuentas p on p.id = ap.cuenta_plan_id
    where p.codigo in ('475000000', '470000000')
    union
    select id from fin_asientos where descripcion ilike 'apertura%'
  ),
  ap as (
    select extract(quarter from a.fecha)::int as t, p.codigo, x.debe, x.haber
    from fin_apuntes x
    join fin_asientos a on a.id = x.asiento_id and a.estado = 'confirmado'
    join fin_plan_cuentas p on p.id = x.cuenta_plan_id
    where extract(year from a.fecha)::int = p_anio
      and a.id not in (select id from excl)
  )
  select t, clave, round(sum(imp), 2)
  from (
    select t, 'rep_' || right(codigo, 3) as clave, haber - debe as imp
      from ap where codigo like '477000___' and codigo not in ('477000500', '477000000')
    union all
    select t, 'rep_otros', haber - debe from ap where codigo = '477000000'
    union all
    select t, 'rep_isp', haber - debe from ap where codigo = '477000500'
    union all
    select t, 'sop_' || right(codigo, 3), debe - haber
      from ap where codigo like '472000___' and codigo not in ('472000500', '472000000')
    union all
    select t, 'sop_otros', debe - haber from ap where codigo = '472000000'
    union all
    select t, 'sop_isp', debe - haber from ap where codigo = '472000500'
    union all
    select t, 'ret_' || right(codigo, 3), haber from ap where codigo like '475100___'
    union all
    select t, 'ingresos', haber - debe from ap where codigo like '7%'
    union all
    select t, 'gastos', debe - haber from ap where codigo like '6%'
    union all
    select t, 'ret_favor', debe - haber from ap where codigo like '4730%'
    union all
    select t, 'pagos_is', debe from ap where codigo like '4752%'
  ) s
  group by t, clave
  having abs(sum(imp)) > 0.004
  order by t, clave;
$$;
