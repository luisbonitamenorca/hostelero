-- APLICADA 20-09-2026 (registrada como 20260920163855)
-- Corrección de facturas de Compras ya contabilizadas, tomando el listado de A3
-- de Lucía como referencia (su listado manda):
--   · compras_asiento_rehacer(doc): el asiento confirmado es inmutable, así que se
--     anula con un contra-asiento (mismo día, apuntes invertidos) y se genera uno
--     nuevo con las cuentas y centros actuales de la factura. Los nuevos nacen con
--     origen_tipo 'manual' (el índice fin_asientos_origen_unico solo permite UN
--     asiento 'compra' por factura) y siempre con origen_id = la factura, para no
--     perder el hilo. compras_asiento_rehecho guarda qué se anuló y con qué.
--   · compras_borrar_duplicado(doc, doc_bueno): contra-asiento de lo contabilizado,
--     su vencimiento se anula (si estaba liquidado por el banco, la liquidación se
--     traspasa al vencimiento de la factura buena) y se borra el documento. El
--     candado de A3 no se puentea: se retira el nº de A3 antes de borrar, que es
--     lo que el candado protege, y queda constancia en compras_asiento_rehecho.
--   · compras_construir_asiento(doc, origen_tipo, sufijo): la lógica de
--     compras_generar_asiento, parametrizada. compras_generar_asiento pasa a ser
--     un envoltorio y se comporta igual que antes.
-- fin_confirmar_asiento exige un usuario con permiso: cuando se ejecuta desde
-- servidor (sin JWT) se pasa p_por = uuid del usuario que firma la corrección.

create table if not exists compras_asiento_rehecho (
  id             bigserial primary key,
  cuenta_id      uuid not null,
  doc_id         uuid,
  a3_numdoc      int,
  accion         text not null check (accion in ('rehacer','borrar_duplicado')),
  asiento_anulado uuid,
  asiento_contra  uuid,
  asiento_nuevo   uuid,
  motivo         text,
  hecho_por      uuid,
  hecho_en       timestamptz not null default now()
);
alter table compras_asiento_rehecho enable row level security;
drop policy if exists "auth lectura" on compras_asiento_rehecho;
create policy "auth lectura" on compras_asiento_rehecho for select to authenticated using (cuenta_id = cuenta_actual() or es_operador());

-- Firma de servidor: si no hay JWT, se actúa como p_por (transacción local).
create or replace function fin_firmar_como(p_por uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null and p_por is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_por, 'role', 'authenticated')::text, true);
  end if;
end $$;

create or replace function fin_contra_asiento(p_asiento uuid, p_motivo text, p_por uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_a fin_asientos%rowtype; v_nuevo uuid; r record;
begin
  perform fin_firmar_como(p_por);
  select * into v_a from fin_asientos where id = p_asiento;
  if not found then raise exception 'El asiento no existe'; end if;
  if v_a.estado <> 'confirmado' then raise exception 'Solo se contra-asienta un asiento confirmado'; end if;
  insert into fin_asientos (cuenta_id, sociedad_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (v_a.cuenta_id, v_a.sociedad_id, v_a.ejercicio_id, v_a.fecha,
          left('Anula asiento nº ' || v_a.numero || ' · ' || coalesce(p_motivo, '') || ' · ' || coalesce(v_a.descripcion, ''), 180),
          'manual', v_a.origen_id, coalesce(auth.uid(), p_por))
  returning id into v_nuevo;
  for r in select * from fin_apuntes where asiento_id = p_asiento order by orden loop
    insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber, centro_id, descripcion)
    values (r.cuenta_id, v_nuevo, r.orden, r.cuenta_plan_id, r.haber, r.debe, r.centro_id, r.descripcion);
  end loop;
  perform fin_confirmar_asiento(v_nuevo);
  return v_nuevo;
end $$;

-- Asientos "vivos" de una factura: los suyos (compra o manual con origen_id) que
-- no han sido anulados ni son contra-asientos.
create or replace function compras_asientos_vivos(p_doc uuid)
returns setof fin_asientos language sql stable security definer set search_path = public as $$
  select a.* from fin_asientos a
  where a.origen_id = p_doc and a.origen_tipo in ('compra','manual') and a.estado = 'confirmado'
    and not exists (select 1 from compras_asiento_rehecho r where r.asiento_anulado = a.id or r.asiento_contra = a.id)
  order by a.numero
$$;

create or replace function compras_construir_asiento(p_doc uuid, p_origen_tipo text default 'compra', p_sufijo text default '')
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
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
  if p_origen_tipo = 'compra' and exists (select 1 from fin_asientos where origen_tipo = 'compra' and origen_id = p_doc) then
    return null;                                     -- ya tiene asiento
  end if;
  select cuenta_proveedor into v_cta_prov from compras_proveedor where id = v_doc.proveedor_id;
  if v_cta_prov is null then
    raise warning 'compras_construir_asiento %: proveedor sin cuenta contable', v_doc.num_documento;
    return null;
  end if;
  if exists (select 1 from compras_a3_lineas l where l.doc_id = p_doc and l.linctacon is null) or
     not exists (select 1 from compras_a3_lineas l where l.doc_id = p_doc) then
    raise warning 'compras_construir_asiento %: líneas sin cuenta de gasto', v_doc.num_documento;
    return null;
  end if;
  select id into v_ejercicio from fin_ejercicios
  where sociedad_id = c_sociedad and anio = extract(year from v_doc.fecha)::int;
  if v_ejercicio is null then
    raise warning 'compras_construir_asiento %: sin ejercicio para %', v_doc.num_documento, v_doc.fecha;
    return null;
  end if;
  insert into fin_asientos (cuenta_id, sociedad_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id)
  values (v_doc.cuenta_id, c_sociedad, v_ejercicio, v_doc.fecha,
          left('Fra. ' || coalesce(v_doc.num_documento, 's/n') || ' · ' || coalesce(v_doc.proveedor, '') || coalesce(p_sufijo, ''), 180),
          p_origen_tipo, p_doc)
  returning id into v_asiento;
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
  v_iva := round(coalesce(v_doc.iva, 0), 2);
  for i in 2..5 loop
    v_cuotas[i] := round(v_bases[i] * c_pcts[i] / 100.0, 2);
  end loop;
  v_resid := v_iva - (v_cuotas[2] + v_cuotas[3] + v_cuotas[4] + v_cuotas[5]);
  if (v_cuotas[2] + v_cuotas[3] + v_cuotas[4] + v_cuotas[5]) <> 0 then
    select i into v_mayor from unnest(array[2,3,4,5]) i order by abs(v_cuotas[i]) desc limit 1;
    v_cuotas[v_mayor] := v_cuotas[v_mayor] + v_resid;
  elsif v_iva <> 0 then
    v_cuotas[5] := v_iva;
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
      values (v_doc.cuenta_id, v_asiento, v_orden, v_plan, greatest(v_cuotas[i], 0), greatest(-v_cuotas[i], 0));
    end if;
  end loop;
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
  select id into v_plan from fin_plan_cuentas
  where cuenta_id = v_doc.cuenta_id and codigo = v_cta_prov and activo;
  if v_plan is null then
    raise exception 'cuenta de proveedor % no existe', v_cta_prov;
  end if;
  v_orden := v_orden + 1;
  insert into fin_apuntes (cuenta_id, asiento_id, orden, cuenta_plan_id, debe, haber)
  values (v_doc.cuenta_id, v_asiento, v_orden, v_plan,
          greatest(round(-v_doc.total, 2), 0), greatest(round(v_doc.total, 2), 0));
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

create or replace function compras_generar_asiento(p_doc uuid) returns uuid
language sql security definer set search_path = public as $$
  select compras_construir_asiento(p_doc, 'compra', '');
$$;

create or replace function compras_asiento_rehacer(p_doc uuid, p_motivo text, p_por uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc compras_doc%rowtype; a record; v_contra uuid; v_nuevo uuid;
begin
  perform fin_firmar_como(p_por);
  select * into v_doc from compras_doc where id = p_doc;
  if not found then raise exception 'La factura no existe'; end if;
  for a in select * from compras_asientos_vivos(p_doc) loop
    v_contra := fin_contra_asiento(a.id, p_motivo, p_por);
    insert into compras_asiento_rehecho (cuenta_id, doc_id, a3_numdoc, accion, asiento_anulado, asiento_contra, motivo, hecho_por)
    values (v_doc.cuenta_id, p_doc, v_doc.a3_numdoc, 'rehacer', a.id, v_contra, p_motivo, coalesce(auth.uid(), p_por));
  end loop;
  v_nuevo := compras_construir_asiento(p_doc, 'manual', ' · rehecho');
  if v_nuevo is null then raise exception 'No se pudo generar el asiento nuevo de %', v_doc.num_documento; end if;
  update compras_asiento_rehecho set asiento_nuevo = v_nuevo where doc_id = p_doc and accion = 'rehacer' and asiento_nuevo is null;
  return v_nuevo;
end $$;

create or replace function compras_borrar_duplicado(p_doc uuid, p_doc_bueno uuid, p_motivo text, p_por uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_doc compras_doc%rowtype; a record; v record; v_contra uuid; vb record;
begin
  perform fin_firmar_como(p_por);
  select * into v_doc from compras_doc where id = p_doc;
  if not found then raise exception 'La factura no existe'; end if;
  if exists (select 1 from fin_activos where compra_doc_id = p_doc) then
    raise exception 'La factura % tiene un activo enlazado: no se borra', v_doc.num_documento;
  end if;
  for a in select * from compras_asientos_vivos(p_doc) loop
    v_contra := fin_contra_asiento(a.id, p_motivo, p_por);
    insert into compras_asiento_rehecho (cuenta_id, doc_id, a3_numdoc, accion, asiento_anulado, asiento_contra, motivo, hecho_por)
    values (v_doc.cuenta_id, p_doc, v_doc.a3_numdoc, 'borrar_duplicado', a.id, v_contra, p_motivo, coalesce(auth.uid(), p_por));
  end loop;
  for v in select * from fin_vencimientos where compra_doc_id = p_doc loop
    if exists (select 1 from fin_remesas_items where vencimiento_id = v.id) then
      raise exception 'El vencimiento de % está en una remesa: no se borra', v_doc.num_documento;
    end if;
    if coalesce(v.importe_liquidado, 0) <> 0 then
      if p_doc_bueno is null then
        raise exception 'El vencimiento de % está liquidado y no hay factura buena a la que traspasarlo', v_doc.num_documento;
      end if;
      select * into vb from fin_vencimientos where compra_doc_id = p_doc_bueno order by creado_en limit 1;
      if not found then
        raise exception 'La factura buena no tiene vencimiento al que traspasar la liquidación';
      end if;
      update fin_vencimientos
         set importe_liquidado = round(coalesce(vb.importe_liquidado, 0) + v.importe_liquidado, 2),
             estado = case when round(coalesce(vb.importe_liquidado, 0) + v.importe_liquidado, 2) >= vb.importe then 'liquidado' else 'parcial' end,
             notas = left(coalesce(vb.notas, '') || ' · liquidación traspasada del duplicado A3 ' || coalesce(v_doc.a3_numdoc::text, '?'), 500)
       where id = vb.id;
    end if;
    delete from fin_vencimientos where id = v.id;
  end loop;
  if not exists (select 1 from compras_asiento_rehecho where doc_id = p_doc and accion = 'borrar_duplicado') then
    insert into compras_asiento_rehecho (cuenta_id, doc_id, a3_numdoc, accion, motivo, hecho_por)
    values (v_doc.cuenta_id, p_doc, v_doc.a3_numdoc, 'borrar_duplicado', p_motivo, coalesce(auth.uid(), p_por));
  end if;
  update compras_doc set a3_numdoc = null, a3_exportado_at = null where id = p_doc;
  delete from compras_doc where id = p_doc;
end $$;

revoke all on function fin_contra_asiento(uuid, text, uuid) from public, anon;
revoke all on function compras_asiento_rehacer(uuid, text, uuid) from public, anon;
revoke all on function compras_borrar_duplicado(uuid, uuid, text, uuid) from public, anon;
revoke all on function fin_firmar_como(uuid) from public, anon, authenticated;
grant execute on function fin_contra_asiento(uuid, text, uuid) to authenticated, service_role;
grant execute on function compras_asiento_rehacer(uuid, text, uuid) to authenticated, service_role;
grant execute on function compras_borrar_duplicado(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function fin_firmar_como(uuid) to service_role;
