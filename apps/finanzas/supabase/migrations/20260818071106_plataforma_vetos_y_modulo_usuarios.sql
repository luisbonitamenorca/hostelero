-- APLICADA 18-08-2026 (registrada como 20260818071106). Vetos de módulo por
-- usuario + módulo Usuarios (autogestión del dueño). OJO: sus políticas de
-- escritura las RECREA la migración siguiente (20260818071229) — los
-- subselects a perfiles chocaban con la RLS de perfiles.
--
-- MODELO DE PERMISOS EN DOS CAPAS:
--   1. El ROL da el máximo (ACCESO_POR_ROL en la app: dirección ve todo, etc.).
--   2. El VETO resta por usuario. Un módulo nuevo lo ven todos los que su rol
--      permita, sin tocar nada: solo se veta a quien no deba verlo.

create table modulos_vetados (
  cuenta_id uuid not null references cuentas(id),
  perfil_id uuid not null references perfiles(id) on delete cascade,
  modulo_id text not null references modulos(id),
  creado_en timestamptz not null default now(),
  primary key (perfil_id, modulo_id)
);

alter table modulos_vetados enable row level security;

create policy modulos_vetados_select on modulos_vetados
  for select to authenticated
  using (cuenta_id = cuenta_actual() or es_operador());

-- (insert/delete: ver 20260818071229, que las sustituye)
create policy modulos_vetados_insert on modulos_vetados
  for insert to authenticated
  with check (
    (
      cuenta_id = cuenta_actual()
      and exists (
        select 1 from perfiles yo
        where yo.id = (select auth.uid()) and yo.cuenta_id = modulos_vetados.cuenta_id
          and yo.rol = 'direccion'
      )
      and exists (
        select 1 from perfiles victima
        where victima.id = modulos_vetados.perfil_id
          and victima.cuenta_id = modulos_vetados.cuenta_id
      )
    )
    or es_operador()
  );

create policy modulos_vetados_delete on modulos_vetados
  for delete to authenticated
  using (
    (
      cuenta_id = cuenta_actual()
      and exists (
        select 1 from perfiles yo
        where yo.id = (select auth.uid()) and yo.cuenta_id = modulos_vetados.cuenta_id
          and yo.rol = 'direccion'
      )
    )
    or es_operador()
  );

create index modulos_vetados_cuenta on modulos_vetados (cuenta_id);

insert into modulos (id, nombre, area) values ('usuarios', 'Usuarios', 'Equipo')
on conflict (id) do nothing;
insert into modulos_contratados (cuenta_id, modulo_id, activo)
values ('082c5366-d9ae-49b9-a8b8-8caad73985bd', 'usuarios', true)
on conflict do nothing;
