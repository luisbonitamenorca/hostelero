-- (28-08-2026) Traspasos entre cuentas propias: UN asiento (debe banco
-- destino / haber banco origen) que concilia los DOS movimientos a la vez —
-- el pago del banco origen y el cobro del banco destino. conciliado_via
-- 'traspaso'. fin_desconciliar_liquidando acepta 'traspaso' y repone ambos
-- movimientos antes de borrar el asiento. Definiciones completas aplicadas
-- vía MCP; ver la base.

alter table fin_banco_movimientos drop constraint fin_banco_movimientos_conciliado_via_check;
alter table fin_banco_movimientos add constraint fin_banco_movimientos_conciliado_via_check
  check (conciliado_via in ('auto','manual','grupo','liquidacion','clasificacion','traspaso'));
-- create or replace function fin_conciliar_traspaso(p_mov_pago uuid, p_mov_cobro uuid) … (en la base)
-- create or replace function fin_desconciliar_liquidando(p_mov uuid) … (v3, en la base)
