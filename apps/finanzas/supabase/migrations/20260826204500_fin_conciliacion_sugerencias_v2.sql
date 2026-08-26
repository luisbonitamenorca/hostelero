-- Sugerencias v2 (feedback de Luis con el caso Morvedra): cada candidato
-- lleva su IMPORTE (dos pagos idénticos de -193,44 no se distinguían) y la
-- ventana pasa de ±10 a ±45 días — muchos pagos se contabilizan en la fecha
-- de la factura y el banco los carga semanas después (recibos, pagos
-- agrupados a fin de mes), y el importe exacto sigue siendo muy específico.
-- Máximo 6 candidatos por movimiento, ordenados por cercanía de fecha. El
-- cruce AUTOMÁTICO no cambia: ±5 días y pareja única; la manga ancha es solo
-- para proponer, decidir sigue siendo humano. Drop obligado: cambia el tipo
-- de retorno.
drop function fin_conciliacion_sugerencias(uuid);

create function fin_conciliacion_sugerencias(p_banco uuid)
returns table(mov_id uuid, ap_id uuid, asiento_numero bigint, asiento_fecha date,
              descripcion text, importe numeric, dias int)
language sql stable
set search_path to 'public'
as $$
  with cand as (
    select m.id as mov_id, ap.id as ap_id, a.numero, a.fecha, a.descripcion,
           case when ap.debe > 0 then ap.debe else -ap.haber end as importe,
           abs(a.fecha - m.fecha) as dias,
           row_number() over (partition by m.id order by abs(a.fecha - m.fecha), a.numero) as pos
    from fin_banco_movimientos m
    join fin_bancos_cuentas bc on bc.id = m.banco_cuenta_id
    join fin_apuntes ap on ap.cuenta_plan_id = bc.cuenta_plan_id
    join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
    where m.banco_cuenta_id = p_banco
      and m.estado = 'pendiente'
      and ap.id not in (select x.apunte_id from fin_banco_movimientos x where x.apunte_id is not null)
      and abs(a.fecha - m.fecha) <= 45
      and ((m.importe > 0 and ap.debe = m.importe)
        or (m.importe < 0 and ap.haber = -m.importe))
  )
  select c.mov_id, c.ap_id, c.numero, c.fecha, c.descripcion, c.importe, c.dias
  from cand c
  where c.pos <= 6
  order by c.mov_id, c.dias, c.numero;
$$;
