-- (28-08-2026, pregunta de Luis) Toda factura de compra que queda OK genera
-- su vencimiento de cartera SOLA: al insertarse ya validada o al pasar de
-- REVISAR a OK. Plazo: los días de las condiciones del proveedor, o 30. El
-- botón «A cartera» queda como repesca manual. (La función se corrige en la
-- migración siguiente: sociedades.creada_en.)

drop trigger if exists trg_compras_doc_cartera on compras_doc;
create trigger trg_compras_doc_cartera
  after insert or update of estado on compras_doc
  for each row execute function compras_doc_generar_cartera();
