-- Motor factura OK → asiento automático. Hasta hoy el asiento de gasto de las
-- facturas de Compras se cargaba por lotes con un script; desde ahora, cuando
-- una factura queda en OK genera sola su asiento (gasto por centro + IVA
-- soportado + retención + proveedor), igual que ya generaba sola su cartera.
-- La numeración la pone fin_confirmar_asiento. Si falta algo (cuenta de gasto,
-- cuenta de proveedor, descuadre), se avisa y se deja sin asiento: se
-- reintenta solo la próxima vez que la factura se guarde.

create or replace function public.compras_generar_asiento(p_doc uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- misma sociedad que usó la carga por lotes (Compras es de Bonita)
  c_sociedad constant uuid := '798cf9dc-0146-4a24-94e8-fdb04f93ab70';
  c_pcts constant int[] := array[0, 4, 10, 12, 21];
  v_doc compras_doc%rowtype;
  v_asiento uuid; v_ejercicio uuid;
  v_cta_prov text; v_plan uuid;
  v_orden int := 0;
  v_debe numeric := 0; v_haber numeric := 0;
  v_dif numeric;
  v_linea record; v_pct int; v_pct_doc int;
  v_cuotas numeric[] := array[0,0,0,0,0];
  v_bases  numeric[] := array[0,0,0,0,0];
  v_iva numeric; v_resid numeric; v_mayor int; v_ret numeric; v_ret_pct int;
  v_ap uuid; v_ap_mayor uuid; v_mayor_debe numeric := 0;
begin
  select * into v_doc from compras_doc where id = p_doc;
  if not found or v_doc.tipo <> 'factura' or v_doc.estado <> 'OK' then return null; end if;
  if exists (select 1 from fin_asientos where origen_tipo = 'compra' and origen_id = p_doc) then
    return null;                                     -- ya tiene asiento
  end if;

  select cuenta_proveedor into v_cta_prov from compras_proveedor where id = v_doc.proveedor_id;
  if v_cta_prov is null then
    raise warning 'compras_generar_asiento %: proveedor sin cuenta contable', v_doc.num_documento;
    return null;
  end if;
  if exists (select 1 from compras_a3_lineas l where l.doc_id = p_doc and l.linctacon is null) or
     not exists (select 1 from compras_a3_lineas l where l.doc_id = p_doc) then
    raise warning 'compras_generar_asiento %: líneas sin cuenta de gasto', v_doc.num_documento;
    return null;
  end if;

  select id into v_ejercicio from fin_ejercicios
  where sociedad_id = c_sociedad and anio = extract(year from v_doc.fecha)::int;
  if v_ejercicio is null then
    raise warning 'compras_generar_asiento %: sin ejercicio para %', v_doc.num_documento, v_doc.fecha;
    return null;
  end if;

  insert into fin_asientos (cuenta_id, sociedad_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id)
  values (v_doc.cuenta_id, c_sociedad, v_ejercicio, v_doc.fecha,
          left('Fra. ' || coalesce(v_doc.num_documento, 's/n') || ' · ' || coalesce(v_doc.proveedor, ''), 180),
          'compra', p_doc)
  returning id into v_asiento;

  -- 1) gasto por línea, con su centro (mapa A3 1-8 → centros, el de la carga)
  for v_linea in
    select l.linctacon, l.linprcmoneda, l.lintipiva, l.lincentrocoste
    from compras_a3_lineas l where l.doc_id = p_doc order by l.orden
  loop
    if round(coalesce(v_linea.linprcmoneda, 0), 2) <> 0 then
      select id into v_plan from fin_plan_cuentas
      where cuenta_id = v_doc.cuenta_id and codigo = v_linea.linctacon and activo;
      if v_plan is null then
        raise exception 'cuenta % no existe en el plan', v_linea.linctacon;
      end if;
      v_orden := v_orden + 1;
      insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber, centro_id)
      values (v_doc.cuenta_id, v_asiento, v_orden, v_plan,
              greatest(round(v_linea.linprcmoneda, 2), 0), greatest(round(-v_linea.linprcmoneda, 2), 0),
              case v_linea.lincentrocoste
                when 1 then '0e5c90bd-62e9-4f6f-877e-bb2228f10325'::uuid
                when 2 then 'a2c6e3e1-c8e0-4c0a-a70f-8c612a3a2d77'::uuid
                when 3 then 'b62bee30-03d3-4f61-9cc7-1c0f5492873b'::uuid
                when 4 then '2c3b1092-bf98-4a59-bdc4-8df06c067a0a'::uuid
                when 5 then '1c6593a8-f805-43a5-b920-9bb2d4a93f59'::uuid
                when 6 then 'fb9e4af7-e50d-4617-b5e7-2de795faa894'::uuid
                when 7 then 'e89c055e-956d-4eba-a1f3-581dd7740a6f'::uuid
                when 8 then 'c974f3b0-ffbf-45f2-90ae-26745bb2f8f1'::uuid
                else null end)
      returning id into v_ap;
      if round(v_linea.linprcmoneda, 2) > v_mayor_debe then
        v_mayor_debe := round(v_linea.linprcmoneda, 2); v_ap_mayor := v_ap;
      end if;
    end if;
    -- acumular bases por tipo de IVA (tipo desconocido → se deduce del doc)
    v_pct := case v_linea.lintipiva
               when 'ORD21' then 21 when 'RED10' then 10 when 'SRE' then 4
               when 'REGESP12' then 12 when 'EXE' then 0 when 'EXENODED' then 0
               when 'NOSUJETO' then 0 else null end;
    if v_pct is null then
      if v_pct_doc is null then
        v_iva := round(coalesce(v_doc.iva, 0), 2);
        select t into v_pct_doc
        from unnest(c_pcts) t
        order by abs(round(coalesce(v_doc.base,0) * t / 100.0, 2) - v_iva) limit 1;
      end if;
      v_pct := v_pct_doc;
    end if;
    v_bases[array_position(c_pcts, v_pct)] := v_bases[array_position(c_pcts, v_pct)] + round(coalesce(v_linea.linprcmoneda, 0), 2);
  end loop;

  -- 2) IVA soportado por tipo, cuadrado contra el IVA del documento
  v_iva := round(coalesce(v_doc.iva, 0), 2);
  for i in 2..5 loop
    v_cuotas[i] := round(v_bases[i] * c_pcts[i] / 100.0, 2);
  end loop;
  v_resid := v_iva - (v_cuotas[2] + v_cuotas[3] + v_cuotas[4] + v_cuotas[5]);
  if (v_cuotas[2] + v_cuotas[3] + v_cuotas[4] + v_cuotas[5]) <> 0 then
    select i into v_mayor from unnest(array[2,3,4,5]) i order by abs(v_cuotas[i]) desc limit 1;
    v_cuotas[v_mayor] := v_cuotas[v_mayor] + v_resid;
  elsif v_iva <> 0 then
    v_cuotas[5] := v_iva;                            -- IVA sin tipo: al 21
  end if;
  for i in 2..5 loop
    if v_cuotas[i] <> 0 then
      select id into v_plan from fin_plan_cuentas
      where cuenta_id = v_doc.cuenta_id and codigo = '4720000' || lpad(c_pcts[i]::text, 2, '0') and activo;
      if v_plan is null then
        raise exception 'cuenta de IVA 4720000% no existe', lpad(c_pcts[i]::text, 2, '0');
      end if;
      v_orden := v_orden + 1;
      insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
      values (v_doc.cuenta_id, v_asiento, v_orden, v_plan,
              greatest(v_cuotas[i], 0), greatest(-v_cuotas[i], 0));
    end if;
  end loop;

  -- 3) retención (475100pp por porcentaje; genérica si no hay mapa)
  v_ret := round(coalesce(v_doc.retencion, 0), 2);
  if v_ret <> 0 then
    v_ret_pct := coalesce(nullif(round(coalesce(v_doc.retencion_pct, 0))::int, 0),
                          case when coalesce(v_doc.retencion_base, 0) <> 0
                               then round(v_ret / v_doc.retencion_base * 100)::int else 0 end);
    select id into v_plan from fin_plan_cuentas
    where cuenta_id = v_doc.cuenta_id and activo
      and codigo = case v_ret_pct when 19 then '475100019' when 15 then '475100015'
                                  when 7 then '475100007' when 2 then '475100002'
                                  else '475100000' end;
    if v_plan is null then
      select id into v_plan from fin_plan_cuentas
      where cuenta_id = v_doc.cuenta_id and codigo = '475100000' and activo;
    end if;
    v_orden := v_orden + 1;
    insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
    values (v_doc.cuenta_id, v_asiento, v_orden, v_plan, 0, v_ret);
  end if;

  -- 4) proveedor por el total
  select id into v_plan from fin_plan_cuentas
  where cuenta_id = v_doc.cuenta_id and codigo = v_cta_prov and activo;
  if v_plan is null then
    raise exception 'cuenta de proveedor % no existe', v_cta_prov;
  end if;
  v_orden := v_orden + 1;
  insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
  values (v_doc.cuenta_id, v_asiento, v_orden, v_plan,
          greatest(round(-v_doc.total, 2), 0), greatest(round(v_doc.total, 2), 0));

  -- 5) cuadre al céntimo: la diferencia (redondeos) va a la línea de gasto mayor
  select sum(debe), sum(haber) into v_debe, v_haber from fin_apuntes where asiento_id = v_asiento;
  v_dif := round(v_haber - v_debe, 2);
  if v_dif <> 0 then
    if abs(v_dif) > 0.02 or v_ap_mayor is null then
      raise exception 'descuadre de % en la factura %', v_dif, v_doc.num_documento;
    end if;
    update fin_apuntes set debe = round(debe + v_dif, 2) where id = v_ap_mayor;
  end if;

  perform fin_confirmar_asiento(v_asiento);
  return v_asiento;
end $$;

-- El trigger no debe tumbar el guardado de la factura: si el asiento no puede
-- generarse se avisa y ya se reintentará al volver a guardar.
create or replace function public.compras_doc_asiento_tg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.tipo = 'factura' and new.estado = 'OK' then
    begin
      perform compras_generar_asiento(new.id);
    exception when others then
      raise warning 'asiento automático de % falló: %', new.num_documento, sqlerrm;
    end;
  end if;
  return null;
end $$;

drop trigger if exists compras_doc_genera_asiento on compras_doc;
create trigger compras_doc_genera_asiento
after insert or update of estado on compras_doc
for each row execute function compras_doc_asiento_tg();
