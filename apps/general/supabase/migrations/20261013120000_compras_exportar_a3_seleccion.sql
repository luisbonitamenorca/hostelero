-- PROPUESTA 13-10-2026 · Exportar a A3 solo las facturas seleccionadas (Lucía)
--
-- exportar_a3_anual numera TODO lo que está OK y sin bloqueos y devuelve el año
-- entero. Lucía necesita a veces un fichero con una o dos facturas (una que se
-- quedó atrás, un abono…). Esta función hermana recibe los doc_id elegidos en
-- la pestaña A3 de Compras, numera SOLO esos (los ya numerados conservan su
-- número) y devuelve solo sus líneas. No toca ninguna otra factura.
--
-- Devuelve las mismas columnas que la vista compras_a3_export_preview, que es
-- lo que la app ya sabe pintar y escribir en el .xls.

create or replace function public.exportar_a3_seleccion(
  p_doc_ids   uuid[],
  p_confirmar boolean default false
)
returns setof public.compras_a3_export_preview
language plpgsql
as $$
declare
  v_docs uuid[];
begin
  if p_doc_ids is null or cardinality(p_doc_ids) = 0 then
    return;
  end if;

  -- Elegibles: de la selección, los que están OK (o ya numerados) y sin bloqueos.
  select coalesce(array_agg(t.doc_id), '{}') into v_docs
    from (
      select v.doc_id
        from compras_a3_export_preview v
        join compras_doc d on d.id = v.doc_id
       where v.doc_id = any(p_doc_ids)
         and (d.estado = 'OK' or d.a3_numdoc is not null)
       group by v.doc_id
      having bool_and(cardinality(v.bloqueos) = 0)
    ) t;

  if p_confirmar then
    update compras_doc d
       set a3_numdoc       = coalesce(d.a3_numdoc, nextval('compras_a3_numdoc_seq')),
           a3_exportado_at = coalesce(d.a3_exportado_at, now())
     where d.id = any(v_docs);
  end if;

  return query
    select v.*
      from compras_a3_export_preview v
     where v.doc_id = any(v_docs)
       and v.cabnumdoc is not null
     order by v.cabnumdoc, v.orden;
end;
$$;

comment on function public.exportar_a3_seleccion(uuid[], boolean) is
  'Numera (si p_confirmar) y devuelve para A3 SOLO las facturas de p_doc_ids que estén OK o ya numeradas y sin bloqueos. Hermana de exportar_a3_anual.';

grant execute on function public.exportar_a3_seleccion(uuid[], boolean) to authenticated;
