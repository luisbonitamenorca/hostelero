-- (28-08-2026) Estado de COBRO de las facturas de ingreso:
--  · Las nominativas cobradas en el acto (efectivo, tarjeta, Agorapay,
--    Shopify…) tienen su asiento de cobro por caja: 'manual' con origen_id
--    apuntando al asiento de la factura. Ese marcador las declara cobradas.
--  · Las de Transferencia/Giro quedan pendientes: son la cartera de cobro
--    viva que el conciliador liquida contra el banco.
--  · fin_facturas_ingreso devuelve cobro: 'caja' | 'banco' | 'pendiente'
--    (diarias siempre 'caja').
--  · fin_cartera_candidatos y el selector excluyen los apuntes de asientos
--    ya cobrados por caja (el marcador): no esperan banco.

drop function fin_facturas_ingreso();
create or replace function fin_facturas_ingreso()
returns table(asiento_id uuid, numero bigint, fecha date, tipo text, descripcion text, total numeric, cobro text)
language sql stable
set search_path to 'public'
as $$
  select a.id, a.numero, a.fecha,
         case when a.descripcion like 'Fra. %' then 'nominativa' else 'diaria' end,
         a.descripcion,
         (select round(sum(ap.debe), 2) from fin_apuntes ap where ap.asiento_id = a.id),
         case
           when a.descripcion like 'Ventas %' then 'caja'
           when exists (select 1 from fin_apuntes ap join fin_banco_mov_apuntes ma on ma.apunte_id = ap.id
                        where ap.asiento_id = a.id) then 'banco'
           when exists (select 1 from fin_asientos cb where cb.origen_tipo = 'manual'
                        and cb.origen_id = a.id and cb.estado = 'confirmado') then 'caja'
           else 'pendiente'
         end
  from fin_asientos a
  where a.estado = 'confirmado' and a.origen_tipo = 'manual'
    and (a.descripcion like 'Fra. %' or a.descripcion like 'Ventas %')
  order by a.fecha desc, a.numero desc;
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
