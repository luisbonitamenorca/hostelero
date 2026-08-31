-- v2: el paso de liquidación es caro (candidatos por movimiento) y no cabe en el
-- statement_timeout de PostgREST (8s del authenticator). La función procesa un
-- lote (keyset por id) y devuelve el cursor; el llamante itera hasta que
-- procesados < lote.
-- NOTA: superada por la v3 (20260831085939), que evalúa las reglas ANTES que la
-- liquidación; el cuerpo definitivo es el de esa migración.
drop function if exists fin_cruce_aplicar(uuid);
