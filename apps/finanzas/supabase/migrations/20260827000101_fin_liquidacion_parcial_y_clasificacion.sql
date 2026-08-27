-- Liquidación PARCIAL y clasificación directa (28-08-2026, revisión de Luis):
--  · fin_banco_mov_apuntes.importe: qué parte del apunte consume cada
--    movimiento (null = el apunte entero, compat con los grupos de la 572).
--    Con esto un apunte grande (la 465 de nóminas del mes, la 476 de la SS)
--    se va liquidando a trozos, pago a pago.
--  · fin_apuntes_conciliados() pasa a devolver solo los apuntes AGOTADOS.
--  · fin_cartera_candidatos muestra el saldo vivo y ya no exige que el apunte
--    quepa en el movimiento.
--  · fin_conciliar_liquidando consume en orden (pequeños enteros, el último
--    parcial) y exige que todo apunte marcado aporte algo.
--  · fin_clasificar_a_cuenta: movimientos sin factura (liquidaciones Adyen,
--    imposiciones de efectivo, comisiones) van directos a una cuenta (caja de
--    centro…) generando su asiento. conciliado_via='clasificacion'.

alter table fin_banco_mov_apuntes add column if not exists importe numeric;
update fin_banco_mov_apuntes ma set importe = ap.debe + ap.haber
from fin_apuntes ap where ap.id = ma.apunte_id and ma.importe is null;
alter table fin_banco_mov_apuntes drop constraint fin_banco_mov_apuntes_apunte_id_key;

alter table fin_banco_movimientos drop constraint fin_banco_movimientos_conciliado_via_check;
alter table fin_banco_movimientos add constraint fin_banco_movimientos_conciliado_via_check
  check (conciliado_via in ('auto','manual','grupo','liquidacion','clasificacion'));

create or replace function fin_apuntes_conciliados()
returns setof uuid
language sql stable
set search_path to 'public'
as $$
  select apunte_id from fin_banco_movimientos where apunte_id is not null
  union
  select ma.apunte_id
  from fin_banco_mov_apuntes ma
  join fin_apuntes ap on ap.id = ma.apunte_id
  group by ma.apunte_id, ap.debe, ap.haber
  having sum(coalesce(ma.importe, ap.debe + ap.haber)) >= ap.debe + ap.haber - 0.005;
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

create or replace function fin_conciliar_liquidando(p_banco uuid, p_mov uuid, p_apuntes uuid[])
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_mov fin_banco_movimientos%rowtype;
  v_banco fin_bancos_cuentas%rowtype;
  v_total numeric; v_resto numeric; v_ejercicio uuid; v_asiento uuid; v_ap_banco uuid; v_n int;
begin
  select * into v_mov from fin_banco_movimientos where id = p_mov and banco_cuenta_id = p_banco for update;
  if not found or v_mov.estado <> 'pendiente' then
    raise exception 'movimiento no pendiente';
  end if;
  select * into v_banco from fin_bancos_cuentas where id = p_banco;

  -- saldo vivo de cada apunte marcado; consumo en orden (pequeños primero,
  -- el último puede quedar parcial). Todo marcado debe aportar algo.
  create temp table _liq on commit drop as
  select ap.id, ap.cuenta_plan_id,
         round((case when v_mov.importe > 0 then ap.debe else ap.haber end)
           - coalesce((select sum(coalesce(x.importe,0)) from fin_banco_mov_apuntes x where x.apunte_id = ap.id), 0), 2) as saldo,
         0::numeric as aplicado,
         a.origen_tipo, a.origen_id
  from fin_apuntes ap
  join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
  where ap.id = any(p_apuntes) and ap.cuenta_id = v_mov.cuenta_id
    and ap.id not in (select apunte_id from fin_banco_movimientos where apunte_id is not null)
    and ((v_mov.importe > 0 and ap.debe > 0) or (v_mov.importe < 0 and ap.haber > 0));

  select count(*), coalesce(sum(saldo), 0) into v_n, v_total from _liq where saldo > 0;
  if v_n = 0 or v_n <> coalesce(array_length(p_apuntes, 1), 0) then
    raise exception 'apuntes no válidos o agotados';
  end if;
  if round(v_total, 2) < round(abs(v_mov.importe), 2) then
    raise exception 'los apuntes marcados (%) no llegan al movimiento (%)', v_total, abs(v_mov.importe);
  end if;

  v_resto := round(abs(v_mov.importe), 2);
  update _liq l set aplicado = least(l.saldo, greatest(0, v_resto - coalesce(prev.antes, 0)))
  from (
    select id, coalesce(sum(saldo) over (order by saldo, id rows between unbounded preceding and 1 preceding), 0) antes
    from _liq
  ) prev
  where prev.id = l.id;

  if exists (select 1 from _liq where aplicado <= 0) then
    raise exception 'hay apuntes marcados de más: quita alguno';
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
  select v_mov.cuenta_id, v_asiento, row_number() over (order by aplicado desc, id),
         cuenta_plan_id,
         case when v_mov.importe > 0 then 0 else aplicado end,
         case when v_mov.importe > 0 then aplicado else 0 end
  from _liq;

  insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
  values (v_mov.cuenta_id, v_asiento, v_n + 1, v_banco.cuenta_plan_id,
          case when v_mov.importe > 0 then abs(v_mov.importe) else 0 end,
          case when v_mov.importe > 0 then 0 else abs(v_mov.importe) end)
  returning id into v_ap_banco;

  perform fin_confirmar_asiento(v_asiento);

  insert into fin_banco_mov_apuntes (movimiento_id, apunte_id, cuenta_id, importe)
  select p_mov, id, v_mov.cuenta_id, aplicado from _liq;

  update fin_banco_movimientos
  set estado = 'conciliado', conciliado_via = 'liquidacion', apunte_id = v_ap_banco, conciliado_en = now()
  where id = p_mov;

  update fin_vencimientos v
  set importe_liquidado = v.importe_liquidado + l.aplicado,
      estado = case when v.importe_liquidado + l.aplicado >= v.importe - 0.005 then 'liquidado' else 'parcial' end,
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
  if not found or v_mov.conciliado_via not in ('liquidacion','clasificacion') then
    raise exception 'no es una liquidación ni una clasificación';
  end if;
  select asiento_id into v_asiento from fin_apuntes where id = v_mov.apunte_id;

  update fin_vencimientos v
  set importe_liquidado = greatest(0, v.importe_liquidado - x.imp),
      estado = case when greatest(0, v.importe_liquidado - x.imp) <= 0.005 then 'pendiente' else 'parcial' end,
      actualizado_en = now()
  from (
    select a.origen_id, coalesce(ma.importe, case when v_mov.importe > 0 then ap.debe else ap.haber end) as imp
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

create or replace function fin_clasificar_a_cuenta(p_banco uuid, p_mov uuid, p_codigo text, p_centro uuid default null)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_mov fin_banco_movimientos%rowtype;
  v_banco fin_bancos_cuentas%rowtype;
  v_plan uuid; v_ejercicio uuid; v_asiento uuid; v_ap_banco uuid;
begin
  select * into v_mov from fin_banco_movimientos where id = p_mov and banco_cuenta_id = p_banco for update;
  if not found or v_mov.estado <> 'pendiente' then
    raise exception 'movimiento no pendiente';
  end if;
  select * into v_banco from fin_bancos_cuentas where id = p_banco;

  select id into v_plan from fin_plan_cuentas
  where cuenta_id = v_mov.cuenta_id and codigo = p_codigo and activo;
  if v_plan is null then
    raise exception 'cuenta % no existe', p_codigo;
  end if;

  select id into v_ejercicio from fin_ejercicios
  where sociedad_id = v_banco.sociedad_id and anio = extract(year from v_mov.fecha)::int;
  if v_ejercicio is null then
    raise exception 'sin ejercicio para %', v_mov.fecha;
  end if;

  insert into fin_asientos (cuenta_id, sociedad_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (v_mov.cuenta_id, v_banco.sociedad_id, v_ejercicio, v_mov.fecha,
          left(coalesce(v_mov.concepto, '') || coalesce(' · ' || nullif(v_mov.detalle, ''), ''), 180),
          'banco', p_mov, auth.uid())
  returning id into v_asiento;

  insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber, centro_id)
  values (v_mov.cuenta_id, v_asiento, 1, v_plan,
          case when v_mov.importe > 0 then 0 else abs(v_mov.importe) end,
          case when v_mov.importe > 0 then abs(v_mov.importe) else 0 end,
          p_centro);

  insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
  values (v_mov.cuenta_id, v_asiento, 2, v_banco.cuenta_plan_id,
          case when v_mov.importe > 0 then abs(v_mov.importe) else 0 end,
          case when v_mov.importe > 0 then 0 else abs(v_mov.importe) end)
  returning id into v_ap_banco;

  perform fin_confirmar_asiento(v_asiento);

  update fin_banco_movimientos
  set estado = 'conciliado', conciliado_via = 'clasificacion', apunte_id = v_ap_banco, conciliado_en = now()
  where id = p_mov;

  return v_asiento;
end $$;
