-- Función definitiva del trigger de cartera automática de Compras.
create or replace function compras_doc_generar_cartera()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dias int;
  v_sociedad uuid;
begin
  if new.tipo <> 'factura' or new.estado <> 'OK' or coalesce(new.total, 0) = 0 then
    return new;
  end if;
  if exists (select 1 from fin_vencimientos v where v.compra_doc_id = new.id) then
    return new;
  end if;
  select dias_pago into v_dias from fin_proveedor_condiciones
  where proveedor_id = new.proveedor_id and cuenta_id = new.cuenta_id;
  select id into v_sociedad from sociedades where cuenta_id = new.cuenta_id order by creada_en limit 1;
  if v_sociedad is null then return new; end if;
  insert into fin_vencimientos (cuenta_id, sociedad_id, sentido, compra_doc_id, fecha_vencimiento, importe, importe_liquidado, estado)
  values (new.cuenta_id, v_sociedad, 'pago', new.id, new.fecha + coalesce(v_dias, 30), new.total, 0, 'pendiente');
  return new;
end $$;
