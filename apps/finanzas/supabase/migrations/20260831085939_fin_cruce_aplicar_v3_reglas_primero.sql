-- v3 (definitiva): las reglas de tabla se evalúan ANTES que la liquidación (son
-- baratas y las familias de regla nunca tienen factura en cartera); la búsqueda
-- de candidatos (cara) queda solo para los movimientos sin regla. Lotes con
-- keyset por id: el llamante itera pasando `ultimo` como p_desde hasta que
-- procesados < p_lote (el cargador usa lote 10 para caber en el timeout de 8s).
create or replace function fin_cruce_aplicar(p_banco uuid, p_desde uuid default null, p_lote int default 25)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_banco fin_bancos_cuentas%rowtype;
  v_mov record; v_regla fin_cruce_reglas%rowtype;
  v_cand record; v_elegido uuid; v_n_nombre int; v_n_ref int; v_ref_ap uuid; v_nom_ap uuid;
  v_texto text; v_norm_det text; v_ref text; v_ultimo uuid; v_procesados int := 0;
  v_liquidados int := 0; v_clasificados int := 0; v_ignorados int := 0; v_errores int := 0;
begin
  select * into v_banco from fin_bancos_cuentas where id = p_banco;
  if not found then raise exception 'cuenta bancaria desconocida'; end if;
  if not (es_operador() or auth.role() = 'service_role' or cuenta_actual() = v_banco.cuenta_id) then
    raise exception 'sin permiso';
  end if;
  -- lanzado como servicio (cron/carga): firmar como un usuario de dirección de la
  -- cuenta para que cuenta_actual() funcione en las funciones internas
  if auth.uid() is null then
    perform set_config('request.jwt.claims', json_build_object(
      'sub', (select id from perfiles where cuenta_id = v_banco.cuenta_id
              order by (rol = 'direccion') desc, creado_en limit 1),
      'role', 'authenticated')::text, true);
  end if;

  for v_mov in
    select id, importe, n43_comun, n43_propio, contraparte,
           coalesce(concepto,'')||' '||coalesce(detalle,'') as texto
    from fin_banco_movimientos
    where banco_cuenta_id = p_banco and estado = 'pendiente'
      and (p_desde is null or id > p_desde)
    order by id
    limit p_lote
  loop
    v_procesados := v_procesados + 1; v_ultimo := v_mov.id;

    -- 1) reglas persistentes (baratas)
    select * into v_regla from fin_cruce_reglas r
    where r.cuenta_id = v_banco.cuenta_id and r.activa
      and (r.banco_cuenta_id is null or r.banco_cuenta_id = p_banco)
      and (r.sentido is null or r.sentido = case when v_mov.importe > 0 then 'cobro' else 'pago' end)
      and (r.n43_comun is null or r.n43_comun = v_mov.n43_comun)
      and (r.n43_propio is null or r.n43_propio = v_mov.n43_propio)
      and (r.patron is null or (coalesce(v_mov.contraparte,'')||' '||v_mov.texto) ilike '%'||r.patron||'%')
      and (r.importe_min is null or abs(v_mov.importe) >= r.importe_min)
      and (r.importe_max is null or abs(v_mov.importe) <= r.importe_max)
    order by r.prioridad, r.creado_en limit 1;
    if found then
      begin
        if v_regla.accion = 'clasificar' then
          perform fin_clasificar_a_cuenta(p_banco, v_mov.id, v_regla.cuenta_codigo, v_regla.centro_id);
          update fin_banco_movimientos set nota = 'regla: '||v_regla.nombre where id = v_mov.id;
          v_clasificados := v_clasificados + 1;
        else
          update fin_banco_movimientos
          set estado = 'ignorado', nota = 'regla: '||v_regla.nombre where id = v_mov.id;
          v_ignorados := v_ignorados + 1;
        end if;
        continue;
      exception when others then v_errores := v_errores + 1;
      end;
    end if;

    -- 2) liquidar contra cartera: candidato único, importe exacto, nombre o nº factura
    v_texto := upper(coalesce(nullif(v_mov.contraparte,''), v_mov.texto));
    v_norm_det := regexp_replace(upper(v_mov.texto), '[^A-Z0-9]', '', 'g');
    v_n_nombre := 0; v_n_ref := 0; v_ref_ap := null; v_nom_ap := null;
    for v_cand in
      select ap_id, descripcion from fin_cartera_candidatos(p_banco, v_mov.id)
      where importe = round(abs(v_mov.importe), 2)
    loop
      if exists (
        select 1 from regexp_split_to_table(v_texto, '[^A-ZÑÁÉÍÓÚÜ]+') t(tok)
        where length(t.tok) >= 5 and upper(v_cand.descripcion) like '%'||t.tok||'%'
      ) then
        v_n_nombre := v_n_nombre + 1; v_nom_ap := v_cand.ap_id;
      end if;
      v_ref := regexp_replace(upper(split_part(v_cand.descripcion, '·', 1)), '[^A-Z0-9]|^FRA', '', 'g');
      if length(v_ref) >= 5 and position(v_ref in v_norm_det) > 0 then
        v_n_ref := v_n_ref + 1; v_ref_ap := v_cand.ap_id;
      end if;
    end loop;
    v_elegido := case when v_n_ref = 1 then v_ref_ap
                      when v_n_ref = 0 and v_n_nombre = 1 then v_nom_ap end;
    if v_elegido is not null then
      begin
        perform fin_conciliar_liquidando(p_banco, v_mov.id, array[v_elegido], null, null);
        v_liquidados := v_liquidados + 1;
      exception when others then v_errores := v_errores + 1;
      end;
    end if;
  end loop;

  return jsonb_build_object('procesados', v_procesados, 'ultimo', v_ultimo,
                            'liquidados', v_liquidados, 'clasificados', v_clasificados,
                            'ignorados', v_ignorados, 'errores', v_errores);
end $$;
revoke execute on function fin_cruce_aplicar(uuid, uuid, int) from public, anon;
grant execute on function fin_cruce_aplicar(uuid, uuid, int) to authenticated;
