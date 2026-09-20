-- APLICADA 20-09-2026 (registrada como 20260920164852)
-- Generar el asiento 'compra' de una factura desde servidor (sin JWT): firma como p_por.
-- Motivo: al cargar desde script las facturas que faltaban del listado de A3, el
-- disparador compras_doc_2_asiento no podía confirmar (fin_confirmar_asiento exige
-- un usuario con permiso y con la service key auth.uid() es nulo).
create or replace function compras_generar_asiento_como(p_doc uuid, p_por uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform fin_firmar_como(p_por);
  return compras_construir_asiento(p_doc, 'compra', '');
end $$;
revoke all on function compras_generar_asiento_como(uuid, uuid) from public, anon, authenticated;
grant execute on function compras_generar_asiento_como(uuid, uuid) to service_role;
