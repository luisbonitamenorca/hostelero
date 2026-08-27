-- (28-08-2026) Liquidar con RESTO a cuenta: un cargo de confirming paga las
-- facturas de la remesa MÁS los intereses; una remesa de cobro entra neta de
-- gastos. Con p_resto_codigo, los apuntes marcados se consumen ENTEROS y la
-- diferencia contra el movimiento va a esa cuenta (665 intereses, 626
-- comisiones…), con centro opcional. Sin p_resto_codigo, igual que antes.
-- fin_conciliar_liquidando pasa de 3 a 5 parámetros (los dos nuevos con
-- default null: las llamadas existentes no cambian). Definición completa en
-- la base; el diff sobre la versión anterior:
--   · rama p_resto_codigo: aplicado = saldo entero de cada apunte marcado,
--     v_sobra = |mov| - Σsaldos, línea extra a la cuenta de resto con el
--     signo que balancea (pago y sobra>0 → debe; cobro y sobra>0 → haber).
--   · el resto de la lógica (greedy parcial, junction con importe, sincronía
--     de fin_vencimientos pago y cobro) intacta.

drop function if exists fin_conciliar_liquidando(uuid, uuid, uuid[]);
-- create or replace function fin_conciliar_liquidando(p_banco uuid, p_mov uuid,
--   p_apuntes uuid[], p_resto_codigo text default null, p_resto_centro uuid default null)
-- … (cuerpo completo aplicado vía MCP el 28-08-2026; ver definición en la base)
