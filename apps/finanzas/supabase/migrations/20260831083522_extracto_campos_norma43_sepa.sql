-- Campos estructurados del extracto CaixaBank «con referencias SEPA y conceptos
-- adicionales»: contraparte y referencias para el motor de reglas del cruce.
alter table fin_banco_movimientos
  add column if not exists n43_comun text,
  add column if not exists n43_propio text,
  add column if not exists contraparte text,
  add column if not exists referencia text;

comment on column fin_banco_movimientos.n43_comun is 'Código Norma 43 concepto común (02 transferencia, 03 recibo, 04 giro/nómina, 05 préstamo, 12 tarjeta/TPV, 99 varios…)';
comment on column fin_banco_movimientos.n43_propio is 'Código Norma 43 concepto propio de la entidad';
comment on column fin_banco_movimientos.contraparte is 'Nombre del emisor/beneficiario extraído de los conceptos adicionales SEPA';
comment on column fin_banco_movimientos.referencia is 'Referencia del movimiento (mandato SEPA, remesa, ref. transferencia)';
