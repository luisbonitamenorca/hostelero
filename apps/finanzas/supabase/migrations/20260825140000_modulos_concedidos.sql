-- Concesiones por usuario: la pieza simétrica del veto (pedido de Luis,
-- 25-08-2026: «a Sonia quiero añadirle Visitas»). El rol sigue siendo la
-- base, el veto resta y la concesión SUMA un módulo concreto por encima del
-- rol. Regla de conflicto: el veto manda — un módulo vetado no se ve aunque
-- esté concedido. Espejo exacto de modulos_vetados, con las políticas ya
-- corregidas de la 20260818071229 (es_direccion / perfil_es_de_cuenta,
-- SECURITY DEFINER: los subselects a perfiles chocan con su RLS).
create table modulos_concedidos (
  cuenta_id uuid not null references cuentas(id),
  perfil_id uuid not null references perfiles(id) on delete cascade,
  modulo_id text not null references modulos(id),
  creado_en timestamptz not null default now(),
  primary key (perfil_id, modulo_id)
);

alter table modulos_concedidos enable row level security;

create policy modulos_concedidos_select on modulos_concedidos
  for select to authenticated
  using (cuenta_id = cuenta_actual() or es_operador());

create policy modulos_concedidos_insert on modulos_concedidos
  for insert to authenticated
  with check (
    (cuenta_id = cuenta_actual() and es_direccion()
      and perfil_es_de_cuenta(perfil_id, cuenta_id))
    or es_operador()
  );

create policy modulos_concedidos_delete on modulos_concedidos
  for delete to authenticated
  using (
    (cuenta_id = cuenta_actual() and es_direccion())
    or es_operador()
  );

create index modulos_concedidos_cuenta on modulos_concedidos (cuenta_id);
