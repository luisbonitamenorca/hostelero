-- Maestros (22-10-2026, tarde): mae_vincular_cuenta() contaba como «completados» todos los productos con
-- algún hueco aunque el maestro no aportase nada nuevo para ese hueco (153 en cada pasada). Solo se tocan
-- (y cuentan) las filas en las que al menos una columna cambia de verdad.
create or replace function public.mae_vincular_cuenta(p_cuenta uuid)
returns table (proveedores integer, productos integer, completados integer)
language plpgsql security definer set search_path = public as $$
declare n_prov integer; n_prod integer; n_comp integer;
begin
  update compras_proveedor v set mae_proveedor_id = m.id
    from mae_proveedor m
   where v.cuenta_id = p_cuenta and v.mae_proveedor_id is null
     and v.nif_norm is not null and v.nif_norm = m.nif_norm;
  get diagnostics n_prov = row_count;

  update compras_producto p set mae_producto_id = m.id
    from compras_proveedor v, mae_producto m
   where p.proveedor_id = v.id and v.cuenta_id = p_cuenta and p.mae_producto_id is null
     and v.mae_proveedor_id is not null and m.proveedor_id = v.mae_proveedor_id
     and (
       (p.ref_proveedor is not null and mae_ref_norm(p.ref_proveedor) = m.ref_norm)
       or (m.ean is not null and (p.codigo_barras = m.ean or mae_ref_norm(p.ref_proveedor) = mae_ref_norm(m.ean)))
     );
  get diagnostics n_prod = row_count;

  update compras_producto p set
      formato          = coalesce(p.formato, m.formato),
      unidad           = coalesce(p.unidad, case m.unidad_venta when 'kg' then 'kg' when 'l' then 'litro' when 'ud' then 'unidad' end),
      unidades_formato = coalesce(p.unidades_formato, m.unidades_caja),
      codigo_barras    = coalesce(p.codigo_barras, m.ean),
      categoria        = coalesce(p.categoria, m.categoria),
      precio_catalogo  = coalesce(p.precio_catalogo, m.precio_tarifa)
    from mae_producto m
   where p.mae_producto_id = m.id and p.cuenta_id = p_cuenta
     and (
          (p.formato is null and m.formato is not null)
       or (p.unidad is null and m.unidad_venta is not null)
       or (p.unidades_formato is null and m.unidades_caja is not null)
       or (p.codigo_barras is null and m.ean is not null)
       or (p.categoria is null and m.categoria is not null)
       or (p.precio_catalogo is null and m.precio_tarifa is not null)
     );
  get diagnostics n_comp = row_count;

  return query select n_prov, n_prod, n_comp;
end $$;
