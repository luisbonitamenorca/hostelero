-- ESTADO: PROPUESTA. No aplicada. Para revisión de Luis.
-- ============================================================================
-- MIGRACIÓN F1b — Cerrar el permiso de expedir y anular al rol anónimo
-- Proyecto: hostelero · Fecha: 16-08-2026
--
-- QUÉ PASÓ
-- La F1a hacía `revoke all ... from public` antes de conceder a authenticated,
-- con la intención de que solo un usuario con sesión pudiera expedir. No basta:
-- Supabase tiene privilegios por defecto que conceden EXECUTE a `anon` y
-- `authenticated` sobre cada función nueva del esquema public, y esa concesión
-- a `anon` es explícita, no viene de PUBLIC. Revocar de PUBLIC no la quita.
-- Verificado tras aplicar la F1a: ambas funciones aparecían concedidas a anon.
--
-- QUÉ NO PASÓ, Y CONVIENE DECIRLO
-- No hubo agujero. Las dos funciones comprueban por dentro que la factura sea
-- de la cuenta de quien llama (cuenta_actual()), y para un anónimo eso es nulo.
-- Comprobado ejecutándolo de verdad como `anon` en una transacción con
-- rollback: la llamada se rechaza, no se crea registro, la factura sigue en
-- borrador y la serie no gasta número.
--
-- POR QUÉ SE ARREGLA IGUAL
-- Porque la única defensa era la comprobación de dentro. En algo que asigna
-- numeración fiscal y escribe en una cadena inmutable, quiero las dos capas:
-- que no puedan ni llamarla, y que si la llaman, no puedan hacer nada.
-- ============================================================================

revoke execute on function fin_expedir_factura(uuid) from anon;
revoke execute on function fin_anular_factura(uuid, text) from anon;

-- Las funciones de apoyo (fin_vf_*) se dejan como están: son cálculo puro, no
-- leen ni escriben ninguna tabla, y no revelan nada de nadie.

-- ----------------------------------------------------------------------------
-- Comprobación posterior: las dos filas deben salir SIN 'anon'.
--
-- select p.proname,
--        array(select g.grantee::text from information_schema.role_routine_grants g
--              where g.specific_name = p.proname||'_'||p.oid) as concedido_a
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname='public'
--   and p.proname in ('fin_expedir_factura','fin_anular_factura');
-- ----------------------------------------------------------------------------
