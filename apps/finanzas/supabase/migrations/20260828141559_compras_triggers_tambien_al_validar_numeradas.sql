-- Una factura puede tener ya su número de A3 y estar aún en REVISAR (caso
-- real: la 2367, renumerada a su número de A3 tras un borrado de duplicados).
-- El motor debe dispararse también cuando una factura YA numerada pasa a OK,
-- no solo al numerarse. Ambas funciones son idempotentes (comprueban si el
-- asiento/vencimiento ya existe), así que ampliar el evento es inocuo.
drop trigger if exists compras_doc_1_cartera on compras_doc;
create trigger compras_doc_1_cartera
after update of a3_numdoc, estado on compras_doc
for each row
when (new.a3_numdoc is not null and new.estado = 'OK')
execute function compras_doc_generar_cartera();

drop trigger if exists compras_doc_2_asiento on compras_doc;
create trigger compras_doc_2_asiento
after update of a3_numdoc, estado on compras_doc
for each row
when (new.a3_numdoc is not null and new.estado = 'OK')
execute function compras_doc_asiento_tg();
