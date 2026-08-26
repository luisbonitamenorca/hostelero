-- Motor del cruce automático de la conciliación bancaria (F2). Solo empareja
-- cuando el candidato es ÚNICO en los dos sentidos (un movimiento <-> un
-- apunte), importe exacto y fecha a <=5 días; lo ambiguo queda pendiente para
-- una persona. En bucle: cada ronda de parejas resuelve ambigüedades de la
-- siguiente. Primer cruce real (27-08-2026): 1.701/2.485 movimientos (68%).
create or replace function fin_conciliar_auto(p_banco uuid)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_total int := 0;
  v_ronda int;
begin
  loop
    with cand as (
      select m.id as mov_id, ap.id as ap_id
      from fin_banco_movimientos m
      join fin_bancos_cuentas bc on bc.id = m.banco_cuenta_id
      join fin_apuntes ap on ap.cuenta_plan_id = bc.cuenta_plan_id
      join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
      where m.banco_cuenta_id = p_banco
        and m.estado = 'pendiente'
        and ap.id not in (select apunte_id from fin_banco_movimientos where apunte_id is not null)
        and abs(a.fecha - m.fecha) <= 5
        and ((m.importe > 0 and ap.debe = m.importe)
          or (m.importe < 0 and ap.haber = -m.importe))
    ),
    unicos as (
      select mov_id, min(ap_id::text)::uuid as ap_id
      from cand group by mov_id having count(*) = 1
    ),
    parejas as (
      select u.mov_id, u.ap_id
      from unicos u
      join (select ap_id from unicos group by ap_id having count(*) = 1) x using (ap_id)
    )
    update fin_banco_movimientos m
       set estado = 'conciliado', apunte_id = p.ap_id,
           conciliado_via = 'auto', conciliado_en = now()
      from parejas p
     where m.id = p.mov_id;
    get diagnostics v_ronda = row_count;
    v_total := v_total + v_ronda;
    exit when v_ronda = 0;
  end loop;
  return v_total;
end $$;

-- Sugerencias para la conciliación MANUAL: candidatos por importe exacto a
-- <=10 días, aunque sean ambiguos — decidir entre ellos es el trabajo humano.
create or replace function fin_conciliacion_sugerencias(p_banco uuid)
returns table(mov_id uuid, ap_id uuid, asiento_numero bigint, asiento_fecha date, descripcion text)
language sql stable
set search_path to 'public'
as $$
  select m.id, ap.id, a.numero, a.fecha, a.descripcion
  from fin_banco_movimientos m
  join fin_bancos_cuentas bc on bc.id = m.banco_cuenta_id
  join fin_apuntes ap on ap.cuenta_plan_id = bc.cuenta_plan_id
  join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
  where m.banco_cuenta_id = p_banco
    and m.estado = 'pendiente'
    and ap.id not in (select x.apunte_id from fin_banco_movimientos x where x.apunte_id is not null)
    and abs(a.fecha - m.fecha) <= 10
    and ((m.importe > 0 and ap.debe = m.importe)
      or (m.importe < 0 and ap.haber = -m.importe))
  order by m.id, abs(a.fecha - m.fecha);
$$;

-- Resumen para la cabecera de la pantalla: recuentos por estado, último saldo
-- del banco y saldo contable de la 572 asociada. La diferencia entre esos dos
-- saldos es la deuda de la conciliación: cero = cuadrado.
create or replace function fin_conciliacion_resumen(p_banco uuid)
returns table(total int, conciliados int, pendientes int, ignorados int,
              saldo_banco numeric, saldo_contable numeric)
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
      where ap.cuenta_plan_id = (select bc.cuenta_plan_id from fin_bancos_cuentas bc where bc.id = p_banco))
  from fin_banco_movimientos m
  where m.banco_cuenta_id = p_banco;
$$;
