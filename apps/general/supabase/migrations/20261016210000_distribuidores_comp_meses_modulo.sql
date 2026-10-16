-- Distribuidores (16-10-2026): la comparativa con la competencia se hace en los MISMOS meses que cada
-- módulo (decisión de Luis: no se pueden comparar 7 meses de Jano con 12 de Ágora). Se retira el selector
-- 12 meses / apertura; comp_meses pasa a valer 'modulo'.
alter table public.dist_presupuestos drop constraint if exists dist_presupuestos_comp_meses_chk;
alter table public.dist_presupuestos add constraint dist_presupuestos_comp_meses_chk check (comp_meses in ('todo', 'apertura', 'modulo'));
alter table public.dist_presupuestos alter column comp_meses set default 'modulo';
update public.dist_presupuestos set comp_meses = 'modulo' where comp_meses <> 'modulo';
comment on column public.dist_presupuestos.comp_meses is 'Siempre ''modulo'' desde el 16-10-2026: a la competencia se le cuentan los mismos meses que al módulo de Jano. (''todo'' y ''apertura'' quedaron sin uso.)';
