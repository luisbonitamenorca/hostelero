-- Marcha atrás pedida por Luis (28-08): el Excel vuelve a llevar TODAS las
-- facturas del rango (Lucía selecciona en el propio Excel lo que necesita, y
-- así una prueba no le esconde nada). Lo que se queda de la entrega única:
-- las facturas en REVISAR no se numeran ni salen, y la numeración solo se
-- asigna a las que aún no la tienen — con su asiento, cartera y autocruce.
drop function public.exportar_a3(date, date, boolean, boolean);

create function public.exportar_a3(p_desde date, p_hasta date, p_confirmar boolean default false, p_todo boolean default true)
returns table(cabfecha date, cabnumdoc integer, cabfechacontable date, cabreferencia text, cabcodpro text, captipoirpf text, capporirpf numeric, lindesclin text, linprcmoneda numeric, lintipiva text, linctacon text, lincentrocoste integer, proveedor_nombre text)
language plpgsql
as $function$
declare
  v_docs uuid[];
begin
  -- Elegibles: en rango, sin bloqueos y en estado OK.
  select coalesce(array_agg(t.doc_id), '{}') into v_docs
    from (
      select v.doc_id
        from compras_a3_export_preview v
        join compras_doc d on d.id = v.doc_id
       where v.cabfecha between p_desde and p_hasta
         and d.estado = 'OK'
       group by v.doc_id
      having bool_and(cardinality(v.bloqueos) = 0)
    ) t;

  if p_confirmar then
    update compras_doc d
       set a3_numdoc = coalesce(d.a3_numdoc, nextval('compras_a3_numdoc_seq')),
           a3_exportado_at = coalesce(d.a3_exportado_at, now())
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
