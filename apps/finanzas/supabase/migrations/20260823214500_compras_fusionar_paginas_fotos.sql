-- fusionar_paginas_sueltas: al unir folios de un mismo albarán ahora también
-- se mueven las FOTOS al documento que se conserva (antes solo las líneas, y
-- un reproceso posterior releía únicamente el folio 1 y deshacía la unión).
-- También se repuntan los adjuntos de la bandeja para no dejar fotos huérfanas.
create or replace function public.fusionar_paginas_sueltas(p_proveedor uuid, p_aplicar boolean default false)
 returns table(num_norm text, accion text, se_conserva uuid, se_absorbe uuid, detalle text)
 language plpgsql
as $function$
declare r record; v_huella_a text; v_huella_b text;
begin
  for r in
    select upper(regexp_replace(d.num_documento,'[^A-Za-z0-9]','','g')) nn,
           array_agg(d.id order by d.created_at) ids
      from compras_doc d
     where d.tipo='albaran' and d.proveedor_id=p_proveedor
       and coalesce(d.num_documento,'')<>''
     group by 1 having count(*)>1
  loop
    select md5(coalesce(string_agg(coalesce(l.producto,'')||'#'||coalesce(l.importe::text,''),';'
             order by coalesce(l.producto,''), l.importe),''))
      into v_huella_a from compras_linea l where l.doc_id = r.ids[1];
    select md5(coalesce(string_agg(coalesce(l.producto,'')||'#'||coalesce(l.importe::text,''),';'
             order by coalesce(l.producto,''), l.importe),''))
      into v_huella_b from compras_linea l where l.doc_id = r.ids[2];

    if v_huella_a = v_huella_b then
      num_norm:=r.nn; accion:='COPIA — se borra la segunda';
      se_conserva:=r.ids[1]; se_absorbe:=r.ids[2];
      detalle:='mismo contenido de líneas';
      if p_aplicar then
        update compras_correo_adjunto set doc_id = r.ids[1] where doc_id = r.ids[2];
        delete from compras_doc where id = r.ids[2];
      end if;
    else
      num_norm:=r.nn; accion:='PÁGINAS — se unen';
      se_conserva:=r.ids[1]; se_absorbe:=r.ids[2];
      detalle:='líneas distintas: folios del mismo albarán';
      if p_aplicar then
        update compras_linea set doc_id = r.ids[1] where doc_id = r.ids[2];
        update compras_doc a set
          base  = coalesce(a.base , b.base),
          iva   = coalesce(a.iva  , b.iva),
          total = coalesce(a.total, b.total),
          canal = coalesce(a.canal, b.canal),
          paginas_vistas = (select array_agg(distinct x order by x) from unnest(
                             coalesce(a.paginas_vistas,array[coalesce(a.pagina,1)]) ||
                             coalesce(b.paginas_vistas,array[coalesce(b.pagina,2)])) x),
          -- las fotos del folio absorbido pasan al documento conservado,
          -- renumeradas en orden (1..n) para que el visor y el reproceso las vean todas
          imagenes = (
            select coalesce(jsonb_agg(jsonb_set(t.f,'{pagina}',to_jsonb(t.rn)) order by t.rn),'[]'::jsonb)
            from (
              select f, row_number() over () as rn
              from jsonb_array_elements(
                coalesce(nullif(a.imagenes,'[]'::jsonb),
                  case when a.imagen_url is not null
                       then jsonb_build_array(jsonb_build_object('url',a.imagen_url,'pagina',coalesce(a.pagina,1)))
                       else '[]'::jsonb end)
                ||
                coalesce(nullif(b.imagenes,'[]'::jsonb),
                  case when b.imagen_url is not null
                       then jsonb_build_array(jsonb_build_object('url',b.imagen_url,'pagina',coalesce(b.pagina,2)))
                       else '[]'::jsonb end)
              ) f
            ) t
          )
        from compras_doc b where a.id = r.ids[1] and b.id = r.ids[2];
        update compras_correo_adjunto set doc_id = r.ids[1] where doc_id = r.ids[2];
        delete from compras_doc where id = r.ids[2];
      end if;
    end if;
    return next;
  end loop;
end $function$;
