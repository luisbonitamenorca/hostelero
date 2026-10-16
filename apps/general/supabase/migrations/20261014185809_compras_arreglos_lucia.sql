-- COMPRAS: arreglos a partir de las notas de Lucía (30-09-2026)
--
-- 1) regenerar_reparto_iva creaba una línea de reparto por CADA fila del pie de
--    IVA que lee el OCR, también las de base 0 (Biniarroca 613/2026 leía
--    4 %: 0 · 10 %: 194,91 · 21 %: 0). Las líneas a 0 disparaban el bloqueo
--    «sin base imponible» y la factura no se traspasaba a A3. Ahora se ignoran
--    las filas con base 0, tanto para decidir si hay desglose (más de una fila)
--    como al insertar. Las 5 líneas a 0 existentes ya se borraron a mano.

create or replace function public.regenerar_reparto_iva(p_doc uuid default null::uuid)
returns table(num_documento text, lineas integer, base_repartida numeric)
language plpgsql
as $function$
begin
  return query
  with candidatas as (
    select d.id, d.num_documento, d.base,
           coalesce((select jsonb_agg(v) from jsonb_array_elements(d.raw->'desglose_iva') v
                      where coalesce((v->>'base')::numeric, 0) <> 0), '[]'::jsonb) as dg
      from compras_doc d
     where d.tipo='factura'
       and (p_doc is null or d.id = p_doc)
       and d.raw ? 'desglose_iva'
       and not exists (select 1 from compras_doc_reparto r where r.doc_id=d.id)
  ), validas as (
    select c.* from candidatas c
     where jsonb_array_length(c.dg) > 1
       and abs(coalesce((select sum((v->>'base')::numeric) from jsonb_array_elements(c.dg) v),0)
               - coalesce(c.base,0)) <= 0.02
  ), ins as (
    insert into compras_doc_reparto (doc_id, orden, base, tipo_iva, manual)
    select c.id,
           row_number() over (partition by c.id order by (v->>'base')::numeric desc),
           (v->>'base')::numeric,
           tipo_iva_de((v->>'base')::numeric, (v->>'cuota')::numeric),
           false
      from validas c, jsonb_array_elements(c.dg) v
    returning doc_id, base
  )
  select c.num_documento, count(i.*)::int, round(sum(i.base),2)
    from validas c join ins i on i.doc_id=c.id
   group by c.num_documento
   order by c.num_documento;
end;
$function$;

-- 2) recalcular_estado_facturas dejaba en REVISAR toda factura sin centro en la
--    cabecera (canal null)… incluidas las REPARTIDAS entre varios centros, que
--    justo por eso no tienen centro único (Ahorreluz de Binifadet 50/50 por
--    CUPS, Orfila, Model Grafic…). Y exportar_a3_anual solo numera las OK, así
--    que se quedaban sin número aunque no tuvieran ningún bloqueo. Ahora una
--    factura sin canal pasa si TODAS sus líneas de reparto tienen centro.
create or replace function public.recalcular_estado_facturas()
returns table(num_documento text, estado_antes text, estado_ahora text, motivo text)
language plpgsql
as $function$
begin
  return query
  with calc as (
    select d.id, d.num_documento, d.estado_detalle as antes, d.estado as estado_viejo,
           c.desglose_cuadra, c.importes_cuadran,
           case
             -- el aviso de duplicado no se pisa nunca: es información que costó detectar
             when d.estado_detalle = 'DUPLICADO' then 'DUPLICADO'
             when d.total is null                then 'REVISAR'
             when c.importes_cuadran is false    then 'NO_CUADRA'
             when c.desglose_cuadra  is false    then 'NO_CUADRA'
             else 'CORRECTO'
           end as ahora,
           case
             when d.estado_detalle = 'DUPLICADO' or d.total is null
                  or c.importes_cuadran is false or c.desglose_cuadra is false
                  or (d.canal is null and not (
                        exists (select 1 from compras_doc_reparto r where r.doc_id = d.id)
                        and not exists (select 1 from compras_doc_reparto r
                                         where r.doc_id = d.id and r.centro_coste is null)))
                  then 'REVISAR'
             else 'OK'
           end as estado_nuevo
      from compras_doc d
      join compras_a3_cabecera c on c.doc_id = d.id
     where d.tipo = 'factura'
  ), upd as (
    update compras_doc d
       set estado_detalle = calc.ahora,
           estado = calc.estado_nuevo
      from calc
     where d.id = calc.id
       and (d.estado_detalle is distinct from calc.ahora or d.estado is distinct from calc.estado_nuevo)
    returning d.id
  )
  select calc.num_documento, calc.antes, calc.ahora,
         case when calc.importes_cuadran is false then 'base + IVA - retención no da el total'
              when calc.desglose_cuadra  is false then 'el desglose de IVA no cuadra con la base'
              when calc.antes = calc.ahora and calc.estado_viejo is distinct from calc.estado_nuevo
                   then 'estado reparado (detalle ya correcto)'
              else null end
    from calc
   where calc.antes is distinct from calc.ahora or calc.estado_viejo is distinct from calc.estado_nuevo
   order by calc.num_documento;
end;
$function$;
