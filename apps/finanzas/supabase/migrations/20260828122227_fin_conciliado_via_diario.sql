-- Nueva vía de conciliación 'diario': el movimiento se enlaza con un asiento
-- que YA existe en el diario (p. ej. remesas cargadas desde A3). Al
-- desconciliar solo se deshace el enlace: el asiento no se toca.
alter table fin_banco_movimientos drop constraint fin_banco_movimientos_conciliado_via_check;
alter table fin_banco_movimientos add constraint fin_banco_movimientos_conciliado_via_check
  check (conciliado_via = any (array['auto','manual','grupo','liquidacion','clasificacion','traspaso','diario']));
