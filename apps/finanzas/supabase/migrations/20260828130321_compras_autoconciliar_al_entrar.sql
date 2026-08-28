-- Primer tramo del cruce automático (objetivo 95% en enero): cuando una
-- factura entra en contabilidad, busca ella sola su pago en el extracto.
-- Solo se atreve con el caso inequívoco: UN movimiento pendiente con el
-- importe exacto de la factura y el nombre del proveedor en el concepto.
-- Si hay cero o varios candidatos, se queda quieta y espera a un humano.
create or replace function public.compras_autoconciliar(p_doc uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_doc compras_doc%rowtype;
  v_apunte uuid;
  v_mov uuid; v_banco uuid; v_n int;
begin
  select * into v_doc from compras_doc where id = p_doc;
  if not found or coalesce(v_doc.total, 0) = 0 then return null; end if;

  -- el apunte del proveedor (40x/41x al haber) del asiento de la factura
  select ap.id into v_apunte
  from fin_asientos a
  join fin_apuntes ap on ap.asiento_id = a.id
  join fin_plan_cuentas pc on pc.id = ap.cuenta_plan_id
  where a.origen_tipo = 'compra' and a.origen_id = p_doc and a.estado = 'confirmado'
    and ap.haber > 0 and (pc.codigo like '40%' or pc.codigo like '41%')
  limit 1;
  if v_apunte is null then return null; end if;

  select count(*), min(m.id::text)::uuid, min(m.banco_cuenta_id::text)::uuid
    into v_n, v_mov, v_banco
  from fin_banco_movimientos m
  where m.cuenta_id = v_doc.cuenta_id
    and m.estado = 'pendiente'
    and m.importe < 0
    and abs(abs(m.importe) - v_doc.total) <= 0.005
    and exists (
      select 1 from regexp_split_to_table(upper(coalesce(m.concepto, '') || ' ' || coalesce(m.detalle, '')), '[^A-ZÑÁÉÍÓÚÜ]+') t(tok)
      where length(t.tok) >= 5 and upper(coalesce(v_doc.proveedor, '')) like '%' || t.tok || '%'
    );

  if v_n <> 1 then return null; end if;              -- ambiguo o sin pago: humano

  perform fin_conciliar_liquidando(v_banco, v_mov, array[v_apunte]);
  return v_mov;
end $$;

-- El trigger de asiento intenta también el autocruce; ninguno de los dos
-- puede tumbar la generación del Excel.
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
    begin
      perform compras_autoconciliar(new.id);
    exception when others then
      raise warning 'autocruce de % falló: %', new.num_documento, sqlerrm;
    end;
  end if;
  return null;
end $$;
