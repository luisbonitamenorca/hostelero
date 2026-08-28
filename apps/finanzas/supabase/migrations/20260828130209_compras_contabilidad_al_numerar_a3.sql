-- Decisión de Luis (28-08): mientras conviva A3, una factura pasa a
-- contabilidad (asiento + cartera) cuando RECIBE SU NÚMERO DE A3 al generar el
-- Excel — no al quedar OK. Así nadie tiene que abrir factura a factura: las OK
-- se validan en bloque con el Excel, y la revisión una a una queda solo para
-- las que están mal. Cuando A3 se apague, se decidirá el nuevo disparo.
drop trigger if exists compras_doc_genera_asiento on compras_doc;
create trigger compras_doc_genera_asiento
after update of a3_numdoc on compras_doc
for each row
when (new.a3_numdoc is not null and new.a3_numdoc is distinct from old.a3_numdoc)
execute function compras_doc_asiento_tg();

drop trigger if exists trg_compras_doc_cartera on compras_doc;
create trigger trg_compras_doc_cartera
after update of a3_numdoc on compras_doc
for each row
when (new.a3_numdoc is not null and new.a3_numdoc is distinct from old.a3_numdoc)
execute function compras_doc_generar_cartera();
