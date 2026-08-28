-- Los triggers de un mismo evento corren por orden alfabético. La cartera
-- debe nacer ANTES que el asiento y su autocruce: si no, el vencimiento se
-- crea después de la conciliación y queda «pendiente» con el pago ya hecho
-- (pasó con la primera captura del autocruce, N-00008). Se renombran para
-- fijar el orden: 1_cartera < 2_asiento.
drop trigger if exists trg_compras_doc_cartera on compras_doc;
create trigger compras_doc_1_cartera
after update of a3_numdoc on compras_doc
for each row
when (new.a3_numdoc is not null and new.a3_numdoc is distinct from old.a3_numdoc)
execute function compras_doc_generar_cartera();

drop trigger if exists compras_doc_genera_asiento on compras_doc;
create trigger compras_doc_2_asiento
after update of a3_numdoc on compras_doc
for each row
when (new.a3_numdoc is not null and new.a3_numdoc is distinct from old.a3_numdoc)
execute function compras_doc_asiento_tg();
