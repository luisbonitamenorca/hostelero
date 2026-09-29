-- RENDIMIENTO: políticas RLS evaluadas UNA vez por consulta, no una por fila.
--
-- Auditoría 29-09-2026 (Lucía: Compras, Contabilidad y Ratios lentos).
-- Las 241 políticas del esquema public llaman a cuenta_actual(), es_operador(),
-- es_direccion(), rrhh_es_gestor(), mi_empleado_id() y auth.uid() "a pelo".
-- Postgres las re-ejecuta en CADA fila (cada llamada consulta perfiles/operadores):
-- compras_linea (18k filas) tarda 224 ms en leerse con RLS y 19 ms sin ese coste.
-- Envolverlas en (select f()) las convierte en InitPlan: se calculan una vez.
--
-- NO cambia quién ve qué: las funciones no dependen de la fila, el resultado es
-- idéntico. rrhh_gestiona_centro(centro_id) y perfil_es_de_cuenta(...) reciben
-- columnas de la fila y se dejan tal cual.
--
-- Idempotente: lo ya envuelto aparece en pg_policies como "( SELECT f() AS f)"
-- y el lookbehind (?<!SELECT ) no lo vuelve a tocar.

do $$
declare
  r record;
  pat constant text := '(?<![\w.]|SELECT )(cuenta_actual|es_operador|es_direccion|rrhh_es_gestor|mi_empleado_id)\(\)';
  pat_uid constant text := '(?<!SELECT )auth\.uid\(\)';
  nq text;
  nw text;
  sql text;
  n int := 0;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    nq := regexp_replace(regexp_replace(r.qual, pat, '(select \1())', 'g'), pat_uid, '(select auth.uid())', 'g');
    nw := regexp_replace(regexp_replace(r.with_check, pat, '(select \1())', 'g'), pat_uid, '(select auth.uid())', 'g');

    if (r.qual is not null and nq <> r.qual) or (r.with_check is not null and nw <> r.with_check) then
      sql := format('alter policy %I on public.%I', r.policyname, r.tablename);
      if r.qual is not null and nq <> r.qual then
        sql := sql || format(' using (%s)', nq);
      end if;
      if r.with_check is not null and nw <> r.with_check then
        sql := sql || format(' with check (%s)', nw);
      end if;
      execute sql;
      n := n + 1;
    end if;
  end loop;
  raise notice 'políticas reescritas: %', n;
end $$;

-- Índices que faltan en las consultas calientes de Compras/Ratios
-- (listado de líneas ordenado por fecha de alta; cruce línea→producto).
create index if not exists idx_compras_linea_created on public.compras_linea (created_at desc);
create index if not exists idx_compras_linea_producto on public.compras_linea (producto_id) where producto_id is not null;
create index if not exists idx_compras_doc_proveedor on public.compras_doc (proveedor_id);
create index if not exists idx_compras_doc_tipo_fecha on public.compras_doc (tipo, fecha);
create index if not exists idx_compras_producto_proveedor on public.compras_producto (proveedor_id);
create index if not exists idx_fin_banco_mov_apuntes_apunte on public.fin_banco_mov_apuntes (apunte_id);
-- Contabilidad: informes filtran por estado+fecha; fin_mayor_saldos hace codigo like 'pr%'.
create index if not exists idx_fin_asientos_estado_fecha on public.fin_asientos (estado, fecha);
create index if not exists idx_fin_plan_cuentas_codigo_pat on public.fin_plan_cuentas (codigo text_pattern_ops);
