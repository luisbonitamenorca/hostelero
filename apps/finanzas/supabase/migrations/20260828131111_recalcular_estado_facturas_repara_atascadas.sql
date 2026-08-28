-- Una factura que nacía con detalle CORRECTO pero estado REVISAR se quedaba
-- atascada: el recálculo solo actuaba si CAMBIABA el detalle. Ahora también
-- repara el estado cuando el detalle está bien pero el estado no corresponde
-- (caso N-00008 de Laura Latorre, 28-08-2026).
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
                  or d.canal is null then 'REVISAR'
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
