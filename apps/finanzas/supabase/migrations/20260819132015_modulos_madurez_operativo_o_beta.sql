-- APLICADA 19-08-2026 (registrada como 20260819132015).
-- Madurez de cada módulo, para que la portada distinga lo OPERATIVO de lo
-- que aún está en pruebas (decisión de Luis tras el Consejo, 19-08-2026).
-- Es una columna y no código para que promocionar un módulo sea un update.
-- Los módulos sin app (TPV) siguen saliendo como «Próximamente»: su madurez
-- no se pinta.

alter table modulos add column madurez text not null default 'beta'
  check (madurez in ('operativo', 'beta'));

update modulos set madurez = 'operativo'
where id in ('ratios', 'pyg', 'compras', 'usuarios', 'agentes', 'curso', 'docs');
