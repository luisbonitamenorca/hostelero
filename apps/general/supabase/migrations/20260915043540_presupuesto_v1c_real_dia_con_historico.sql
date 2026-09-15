-- Presupuesto v1c — APLICADA 15-09-2026 desde Code (MCP Supabase), registrada como 20260915043540.
-- El real diario de ventas incluye ingresos_historico (2024-2025), que es lo que Ratios
-- enseña como años anteriores. La vista original tenía fecha como text (ingresos.fecha es
-- text): se recrea con date.
drop view if exists v_ingresos_real_dia;
create view v_ingresos_real_dia as
  select fecha, centro, familia, round(sum(importe)::numeric, 2) as importe
  from (
    select fecha::date as fecha, centro, familia, coalesce(base,0) as importe from ingresos where fecha ~ '^\d{4}-\d{2}-\d{2}'
    union all
    select fecha::date, centro, familia, coalesce(base,0) from ingresos_historico where fecha ~ '^\d{4}-\d{2}-\d{2}'
  ) t
  group by fecha, centro, familia;
