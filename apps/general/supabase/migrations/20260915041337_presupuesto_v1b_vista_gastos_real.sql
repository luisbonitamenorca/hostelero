-- Presupuesto v1b — APLICADA 15-09-2026 desde Code (MCP Supabase), registrada como 20260915041337.
-- Real de compras de Ratios agregado por centro × familia × mes, separando compras
-- internas (BODEGA (INTERNO), PRODUCCION (INTERNA)). Referencia del año anterior
-- para los % de compras del módulo Presupuesto.
create or replace view v_gastos_real_mes as
  select extract(year from fecha::date)::int as ejercicio,
         extract(month from fecha::date)::int as mes,
         centro, familia,
         (upper(coalesce(proveedor,'')) like '%(INTERN%') as interno,
         round(sum(coalesce(base,0))::numeric, 2) as importe
  from gastos
  where fecha ~ '^\d{4}-\d{2}-\d{2}'
  group by 1,2,3,4,5;
