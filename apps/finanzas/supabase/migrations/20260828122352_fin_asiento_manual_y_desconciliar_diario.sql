-- Asiento manual desde la conciliación: el usuario escribe las contrapartidas
-- línea a línea (cuenta, centro, debe/haber) y la línea del banco se añade
-- sola con el importe del movimiento. El asiento debe cuadrar. Vía 'manual'.
create or replace function public.fin_conciliar_asiento_manual(p_banco uuid, p_mov uuid, p_lineas jsonb, p_descripcion text default null)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_mov fin_banco_movimientos%rowtype;
  v_banco fin_bancos_cuentas%rowtype;
  v_ejercicio uuid; v_asiento uuid; v_ap_banco uuid;
  v_linea jsonb; v_plan uuid; v_orden int := 0;
  v_debe numeric; v_haber numeric;
  v_suma_debe numeric := 0; v_suma_haber numeric := 0;
begin
  select * into v_mov from fin_banco_movimientos where id = p_mov and banco_cuenta_id = p_banco for update;
  if not found or v_mov.estado <> 'pendiente' then
    raise exception 'movimiento no pendiente';
  end if;
  select * into v_banco from fin_bancos_cuentas where id = p_banco;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'sin líneas';
  end if;

  select id into v_ejercicio from fin_ejercicios
  where sociedad_id = v_banco.sociedad_id and anio = extract(year from v_mov.fecha)::int;
  if v_ejercicio is null then
    raise exception 'sin ejercicio para %', v_mov.fecha;
  end if;

  insert into fin_asientos (cuenta_id, sociedad_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (v_mov.cuenta_id, v_banco.sociedad_id, v_ejercicio, v_mov.fecha,
          left(coalesce(nullif(trim(p_descripcion), ''), coalesce(v_mov.concepto, 'Asiento manual')), 180),
          'banco', p_mov, auth.uid())
  returning id into v_asiento;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_orden := v_orden + 1;
    v_debe := coalesce((v_linea->>'debe')::numeric, 0);
    v_haber := coalesce((v_linea->>'haber')::numeric, 0);
    if v_debe < 0 or v_haber < 0 or (v_debe = 0 and v_haber = 0) then
      raise exception 'línea %: importe no válido', v_orden;
    end if;
    select id into v_plan from fin_plan_cuentas
    where cuenta_id = v_mov.cuenta_id and codigo = v_linea->>'codigo' and activo;
    if v_plan is null then
      raise exception 'cuenta % no existe', v_linea->>'codigo';
    end if;
    insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, descripcion, debe, haber, centro_id)
    values (v_mov.cuenta_id, v_asiento, v_orden, v_plan,
            nullif(trim(coalesce(v_linea->>'descripcion','')), ''),
            v_debe, v_haber, nullif(v_linea->>'centro','')::uuid);
    v_suma_debe := v_suma_debe + v_debe;
    v_suma_haber := v_suma_haber + v_haber;
  end loop;

  -- Línea del banco, automática, con el importe del movimiento.
  insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
  values (v_mov.cuenta_id, v_asiento, v_orden + 1, v_banco.cuenta_plan_id,
          case when v_mov.importe > 0 then abs(v_mov.importe) else 0 end,
          case when v_mov.importe > 0 then 0 else abs(v_mov.importe) end)
  returning id into v_ap_banco;
  v_suma_debe := v_suma_debe + case when v_mov.importe > 0 then abs(v_mov.importe) else 0 end;
  v_suma_haber := v_suma_haber + case when v_mov.importe > 0 then 0 else abs(v_mov.importe) end;

  if abs(v_suma_debe - v_suma_haber) > 0.005 then
    raise exception 'el asiento no cuadra: debe % / haber %', v_suma_debe, v_suma_haber;
  end if;

  perform fin_confirmar_asiento(v_asiento);

  update fin_banco_movimientos
  set estado = 'conciliado', conciliado_via = 'manual', apunte_id = v_ap_banco, conciliado_en = now()
  where id = p_mov;

  return v_asiento;
end $$;

-- Desconciliar: admite también 'manual' (borra el asiento creado aquí) y
-- 'diario' (solo deshace el enlace: el asiento del diario NO se toca).
create or replace function public.fin_desconciliar_liquidando(p_mov uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mov fin_banco_movimientos%rowtype;
  v_asiento uuid;
begin
  select * into v_mov from fin_banco_movimientos
  where id = p_mov and (cuenta_id = cuenta_actual() or es_operador()) for update;
  if not found or v_mov.conciliado_via not in ('liquidacion','clasificacion','traspaso','manual','diario') then
    raise exception 'no es una conciliación reversible';
  end if;

  if v_mov.conciliado_via = 'diario' then
    update fin_banco_movimientos
    set estado = 'pendiente', apunte_id = null, conciliado_via = null, conciliado_en = null, nota = null
    where id = p_mov;
    return;
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

  update fin_vencimientos v
  set importe_liquidado = greatest(0, v.importe_liquidado - x.imp),
      estado = case when greatest(0, v.importe_liquidado - x.imp) <= 0.005 then 'pendiente' else 'parcial' end,
      actualizado_en = now()
  from (
    select ap.asiento_id aid, coalesce(ma.importe, case when v_mov.importe > 0 then ap.debe else ap.haber end) as imp
    from fin_banco_mov_apuntes ma
    join fin_apuntes ap on ap.id = ma.apunte_id
    where ma.movimiento_id = p_mov
  ) x
  where v.sentido = 'cobro' and v.asiento_id = x.aid;

  delete from fin_banco_mov_apuntes where movimiento_id = p_mov;
  -- un traspaso concilió DOS movimientos con el mismo asiento: se reponen ambos
  update fin_banco_movimientos
  set estado = 'pendiente', apunte_id = null, conciliado_via = null, conciliado_en = null
  where apunte_id in (select id from fin_apuntes where asiento_id = v_asiento) or id = p_mov;

  alter table fin_asientos disable trigger fin_asientos_proteger_del;
  alter table fin_apuntes disable trigger fin_apuntes_proteger_del;
  delete from fin_asientos where id = v_asiento;
  alter table fin_apuntes enable trigger fin_apuntes_proteger_del;
  alter table fin_asientos enable trigger fin_asientos_proteger_del;
end $function$;
