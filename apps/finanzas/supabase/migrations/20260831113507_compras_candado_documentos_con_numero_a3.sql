-- Candado de duplicados (incidente 28-08: se borraron copias exportadas y hubo
-- que re-casar 15 facturas con sus números de A3). Un documento con nº de A3
-- asignado NUNCA puede borrarse ni marcarse como DUPLICADO: si sobra una copia,
-- la que muere es siempre la copia SIN número.
create or replace function compras_doc_candado_a3() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.a3_numdoc is not null then
      raise exception 'candado: el documento % tiene nº de A3 (%) — no se puede borrar; borra la copia sin número',
        coalesce(old.num_documento, old.id::text), old.a3_numdoc;
    end if;
    return old;
  end if;
  if new.estado_detalle = 'DUPLICADO' and new.a3_numdoc is not null then
    raise exception 'candado: el documento % tiene nº de A3 (%) — no puede marcarse como DUPLICADO; marca la copia sin número',
      coalesce(new.num_documento, new.id::text), new.a3_numdoc;
  end if;
  return new;
end $$;

drop trigger if exists compras_doc_candado_a3_del on compras_doc;
create trigger compras_doc_candado_a3_del
  before delete on compras_doc
  for each row execute function compras_doc_candado_a3();

drop trigger if exists compras_doc_candado_a3_upd on compras_doc;
create trigger compras_doc_candado_a3_upd
  before update of estado_detalle on compras_doc
  for each row execute function compras_doc_candado_a3();
