-- Liquidar desde la conciliación (27-08-2026, contabilidad "desde cero"):
-- el banco ya no se cruza contra apuntes 572 del diario (no existen aún) sino
-- contra lo VIVO: clientes por cobrar (43x/44x), proveedores por pagar
-- (40x/41x), nóminas (465), IRPF (475) y Seguridad Social (476). Tickar los
-- apuntes que suman el movimiento GENERA el asiento de cobro/pago contra el
-- banco, enlaza el movimiento y liquida la cartera (fin_vencimientos) de las
-- facturas de Compras implicadas. Deshacer borra ese asiento (única vía en la
-- que un confirmado muere: security definer con los triggers de protección
-- suspendidos) y revierte cartera y enlaces.

alter table fin_banco_movimientos drop constraint fin_banco_movimientos_conciliado_via_check;
alter table fin_banco_movimientos add constraint fin_banco_movimientos_conciliado_via_check
  check (conciliado_via in ('auto','manual','grupo','liquidacion'));

create or replace function fin_cartera_candidatos(p_banco uuid, p_mov uuid)
returns table(ap_id uuid, asiento_numero bigint, asiento_fecha date, cuenta_codigo text, descripcion text, importe numeric)
language sql stable
set search_path to 'public'
as $$
  select ap.id, a.numero, a.fecha, pc.codigo, a.descripcion,
         case when m.importe > 0 then ap.debe else ap.haber end
  from fin_banco_movimientos m
  join fin_apuntes ap on ap.cuenta_id = m.cuenta_id
  join fin_plan_cuentas pc on pc.id = ap.cuenta_plan_id
  join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
  where m.id = p_mov and m.banco_cuenta_id = p_banco
    and ap.id not in (select fin_apuntes_conciliados())
    and a.fecha <= m.fecha + 10
    and ((m.importe > 0 and ap.debe > 0 and ap.debe <= m.importe
          and (pc.codigo like '43%' or pc.codigo like '44%'))
      or (m.importe < 0 and ap.haber > 0 and ap.haber <= -m.importe
          and (pc.codigo like '40%' or pc.codigo like '41%' or pc.codigo like '465%'
               or pc.codigo like '475%' or pc.codigo like '476%')))
  order by abs(a.fecha - m.fecha), a.numero
  limit 80;
$$;

create or replace function fin_conciliar_liquidando(p_banco uuid, p_mov uuid, p_apuntes uuid[])
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_mov fin_banco_movimientos%rowtype;
  v_banco fin_bancos_cuentas%rowtype;
  v_suma numeric; v_ejercicio uuid; v_asiento uuid; v_ap_banco uuid; v_n int;
begin
  select * into v_mov from fin_banco_movimientos where id = p_mov and banco_cuenta_id = p_banco for update;
  if not found or v_mov.estado <> 'pendiente' then
    raise exception 'movimiento no pendiente';
  end if;
  select * into v_banco from fin_bancos_cuentas where id = p_banco;

  create temp table _liq on commit drop as
  select ap.id, ap.cuenta_plan_id,
         case when v_mov.importe > 0 then ap.debe else ap.haber end as importe,
         a.origen_tipo, a.origen_id
  from fin_apuntes ap
  join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
  where ap.id = any(p_apuntes) and ap.cuenta_id = v_mov.cuenta_id
    and ap.id not in (select fin_apuntes_conciliados())
    and ((v_mov.importe > 0 and ap.debe > 0) or (v_mov.importe < 0 and ap.haber > 0));

  select count(*), coalesce(sum(importe), 0) into v_n, v_suma from _liq;
  if v_n = 0 or v_n <> coalesce(array_length(p_apuntes, 1), 0) then
    raise exception 'apuntes no válidos o ya conciliados';
  end if;
  if round(v_suma, 2) <> round(abs(v_mov.importe), 2) then
    raise exception 'la suma (%) no cuadra con el movimiento (%)', v_suma, v_mov.importe;
  end if;

  select id into v_ejercicio from fin_ejercicios
  where sociedad_id = v_banco.sociedad_id and anio = extract(year from v_mov.fecha)::int;
  if v_ejercicio is null then
    raise exception 'sin ejercicio para %', v_mov.fecha;
  end if;

  insert into fin_asientos (cuenta_id, sociedad_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (v_mov.cuenta_id, v_banco.sociedad_id, v_ejercicio, v_mov.fecha,
          (case when v_mov.importe > 0 then 'Cobro · ' else 'Pago · ' end) || left(coalesce(v_mov.concepto, ''), 160),
          'banco', p_mov, auth.uid())
  returning id into v_asiento;

  insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
  select v_mov.cuenta_id, v_asiento, row_number() over (order by importe desc, id),
         cuenta_plan_id,
         case when v_mov.importe > 0 then 0 else importe end,
         case when v_mov.importe > 0 then importe else 0 end
  from _liq;

  insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
  values (v_mov.cuenta_id, v_asiento, v_n + 1, v_banco.cuenta_plan_id,
          case when v_mov.importe > 0 then abs(v_mov.importe) else 0 end,
          case when v_mov.importe > 0 then 0 else abs(v_mov.importe) end)
  returning id into v_ap_banco;

  perform fin_confirmar_asiento(v_asiento);

  insert into fin_banco_mov_apuntes (movimiento_id, apunte_id, cuenta_id)
  select p_mov, id, v_mov.cuenta_id from _liq;

  update fin_banco_movimientos
  set estado = 'conciliado', conciliado_via = 'liquidacion', apunte_id = v_ap_banco, conciliado_en = now()
  where id = p_mov;

  update fin_vencimientos v
  set importe_liquidado = v.importe_liquidado + l.importe,
      estado = case when v.importe_liquidado + l.importe >= v.importe then 'liquidado' else 'parcial' end,
      actualizado_en = now()
  from _liq l
  where l.origen_tipo = 'compra' and v.compra_doc_id = l.origen_id and v.sentido = 'pago';

  drop table _liq;
  return v_asiento;
end $$;

create or replace function fin_desconciliar_liquidando(p_mov uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mov fin_banco_movimientos%rowtype;
  v_asiento uuid;
begin
  select * into v_mov from fin_banco_movimientos
  where id = p_mov and (cuenta_id = cuenta_actual() or es_operador()) for update;
  if not found or v_mov.conciliado_via <> 'liquidacion' then
    raise exception 'no es una liquidación';
  end if;
  select asiento_id into v_asiento from fin_apuntes where id = v_mov.apunte_id;

  update fin_vencimientos v
  set importe_liquidado = greatest(0, v.importe_liquidado - x.imp),
      estado = case when greatest(0, v.importe_liquidado - x.imp) <= 0 then 'pendiente' else 'parcial' end,
      actualizado_en = now()
  from (
    select a.origen_id, case when v_mov.importe > 0 then ap.debe else ap.haber end as imp
    from fin_banco_mov_apuntes ma
    join fin_apuntes ap on ap.id = ma.apunte_id
    join fin_asientos a on a.id = ap.asiento_id and a.origen_tipo = 'compra'
    where ma.movimiento_id = p_mov
  ) x
  where v.compra_doc_id = x.origen_id and v.sentido = 'pago';

  delete from fin_banco_mov_apuntes where movimiento_id = p_mov;
  update fin_banco_movimientos
  set estado = 'pendiente', apunte_id = null, conciliado_via = null, conciliado_en = null
  where id = p_mov;

  alter table fin_asientos disable trigger fin_asientos_proteger_del;
  alter table fin_apuntes disable trigger fin_apuntes_proteger_del;
  delete from fin_asientos where id = v_asiento;
  alter table fin_apuntes enable trigger fin_apuntes_proteger_del;
  alter table fin_asientos enable trigger fin_asientos_proteger_del;
end $$;
