-- Pedido por Luis (01-09): el Excel de A3 lleva SIEMPRE todas las facturas
-- numeradas del año, no solo las del rango de fechas. Así lo definimos al
-- principio y es más fácil para Lucía: un único fichero completo del que
-- selecciona en Excel lo que necesita cargar. El rango de fechas de la
-- pantalla queda solo para previsualizar.
--
-- La numeración también cambia: se asigna a TODA factura elegible (OK y sin
-- bloqueos) sin mirar fechas. Esto arregla las "huérfanas": facturas con
-- fecha vieja que llegaban tarde y nunca caían en ningún rango (Miarco,
-- John Deere, Eva Huergo en el incidente del 01-09).

create function public.exportar_a3_anual(p_confirmar boolean default false)
returns table(cabfecha date, cabnumdoc integer, cabfechacontable date, cabreferencia text, cabcodpro text, captipoirpf text, capporirpf numeric, lindesclin text, linprcmoneda numeric, lintipiva text, linctacon text, lincentrocoste integer, proveedor_nombre text)
language plpgsql
as $function$
declare
  v_docs uuid[];
begin
  -- Elegibles para numerar: OK y sin bloqueos, da igual la fecha.
  select coalesce(array_agg(t.doc_id), '{}') into v_docs
    from (
      select v.doc_id
        from compras_a3_export_preview v
        join compras_doc d on d.id = v.doc_id
       where d.estado = 'OK'
       group by v.doc_id
      having bool_and(cardinality(v.bloqueos) = 0)
    ) t;

  if p_confirmar then
    update compras_doc d
       set a3_numdoc = coalesce(d.a3_numdoc, nextval('compras_a3_numdoc_seq')),
           a3_exportado_at = coalesce(d.a3_exportado_at, now())
     where d.id = any(v_docs);
  end if;

  -- El fichero: TODO lo numerado del año en curso (por fecha contable).
  return query
    select v.cabfecha, v.cabnumdoc, v.cabfechacontable, v.cabreferencia,
           v.cabcodpro, v.captipoirpf, v.capporirpf, v.lindesclin, v.linprcmoneda,
           v.lintipiva, v.linctacon, v.lincentrocoste, v.proveedor_nombre
      from compras_a3_export_preview v
     where v.cabnumdoc is not null
       and v.cabfechacontable >= date_trunc('year', current_date)::date
     order by v.cabnumdoc, v.orden;
end;
$function$;
