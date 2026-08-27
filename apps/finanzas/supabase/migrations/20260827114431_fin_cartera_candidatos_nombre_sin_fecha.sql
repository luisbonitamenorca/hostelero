-- (28-08-2026) fin_cartera_candidatos v4: si el asiento comparte nombre con
-- el concepto/detalle del movimiento, entra SIEMPRE (todas las pendientes de
-- ese proveedor/cliente, da igual la fecha). La ventana ±10 días solo acota
-- los candidatos sin coincidencia de nombre. Orden: nombre → importe exacto
-- → cercanía de fecha. Límite 150.

create or replace function fin_cartera_candidatos(p_banco uuid, p_mov uuid)
returns table(ap_id uuid, asiento_numero bigint, asiento_fecha date, cuenta_codigo text, descripcion text, importe numeric)
language sql stable
set search_path to 'public'
as $$
  with consumido as (
    select ma.apunte_id, sum(coalesce(ma.importe, 0)) usado
    from fin_banco_mov_apuntes ma group by ma.apunte_id
  ),
  base as (
    select ap.id, a.numero, a.fecha, pc.codigo, a.descripcion,
           round((case when m.importe > 0 then ap.debe else ap.haber end) - coalesce(c.usado, 0), 2) as saldo,
           m.fecha as mov_fecha, m.importe as mov_importe,
           exists (
             select 1 from regexp_split_to_table(upper(coalesce(m.concepto, '') || ' ' || coalesce(m.detalle, '')), '[^A-ZÑÁÉÍÓÚÜ]+') t(tok)
             where length(t.tok) >= 5 and upper(a.descripcion) like '%' || t.tok || '%'
           ) as nombre_casa
    from fin_banco_movimientos m
    join fin_apuntes ap on ap.cuenta_id = m.cuenta_id
    join fin_plan_cuentas pc on pc.id = ap.cuenta_plan_id
    join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
    left join consumido c on c.apunte_id = ap.id
    where m.id = p_mov and m.banco_cuenta_id = p_banco
      and ap.id not in (select apunte_id from fin_banco_movimientos where apunte_id is not null)
      and not exists (select 1 from fin_asientos cb where cb.origen_tipo = 'manual'
                      and cb.origen_id = a.id and cb.estado = 'confirmado')
      and ((m.importe > 0 and ap.debe > 0 and (pc.codigo like '43%' or pc.codigo like '44%'))
        or (m.importe < 0 and ap.haber > 0
            and (pc.codigo like '40%' or pc.codigo like '41%' or pc.codigo like '465%'
                 or pc.codigo like '475%' or pc.codigo like '476%')))
      and (case when m.importe > 0 then ap.debe else ap.haber end) - coalesce(c.usado, 0) > 0.005
  )
  select id, numero, fecha, codigo, descripcion, saldo
  from base
  where nombre_casa or fecha <= mov_fecha + 10
  order by
    case when nombre_casa then 0 else 1 end,
    case when saldo = round(abs(mov_importe), 2) then 0 else 1 end,
    abs(fecha - mov_fecha), numero
  limit 150;
$$;
