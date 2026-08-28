-- El Excel de A3 pasa a ser de ENTREGA ÚNICA: cada generación incluye solo
-- las facturas que aún no han salido en ningún fichero (a3_exportado_at nulo),
-- para que Lucía nunca vuelva a recibir facturas ya cargadas. Además una
-- factura en REVISAR ya no se numera ni se exporta aunque tenga los campos
-- completos. p_todo=true recupera el comportamiento antiguo (regenerar un
-- fichero perdido con todo el rango, sin renumerar nada).
drop function public.exportar_a3(date, date, boolean);

create function public.exportar_a3(p_desde date, p_hasta date, p_confirmar boolean default false, p_todo boolean default false)
returns table(cabfecha date, cabnumdoc integer, cabfechacontable date, cabreferencia text, cabcodpro text, captipoirpf text, capporirpf numeric, lindesclin text, linprcmoneda numeric, lintipiva text, linctacon text, lincentrocoste integer, proveedor_nombre text)
language plpgsql
as $function$
declare
  v_docs uuid[];
begin
  -- Elegibles: en rango, sin bloqueos, estado OK y (si no es p_todo) sin entregar.
  select coalesce(array_agg(t.doc_id), '{}') into v_docs
    from (
      select v.doc_id
        from compras_a3_export_preview v
        join compras_doc d on d.id = v.doc_id
       where v.cabfecha between p_desde and p_hasta
         and d.estado = 'OK'
         and (p_todo or d.a3_exportado_at is null)
       group by v.doc_id
      having bool_and(cardinality(v.bloqueos) = 0)
    ) t;

  if p_confirmar then
    update compras_doc d
       set a3_numdoc = coalesce(d.a3_numdoc, nextval('compras_a3_numdoc_seq')),
           a3_exportado_at = now()
     where d.id = any(v_docs);
  end if;

  return query
    select v.cabfecha, v.cabnumdoc, v.cabfechacontable, v.cabreferencia,
           v.cabcodpro, v.captipoirpf, v.capporirpf, v.lindesclin, v.linprcmoneda,
           v.lintipiva, v.linctacon, v.lincentrocoste, v.proveedor_nombre
      from compras_a3_export_preview v
     where v.doc_id = any(v_docs)
     order by v.cabnumdoc nulls last, v.cabfecha, v.cabreferencia, v.orden;
end;
$function$;
