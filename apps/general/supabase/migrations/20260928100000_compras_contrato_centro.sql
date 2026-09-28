-- Rentings de CaixaBank Equipment Finance (28-09-2026, petición de Lucía).
-- Una factura trae varias cuotas de arrendamiento, una por contrato, y cada
-- contrato es un equipo de un centro. Esta tabla dice a qué centro va cada
-- contrato; Compras reparte la factura con ella al cargarla:
--   alquiler y servicios -> cuenta_alquiler (621000100 RENTING)
--   seguro               -> cuenta_seguro   (625000000 SEGUROS)
-- Un contrato que no esté aquí deja la factura sin reparto y sin centro, para
-- que alguien lo dé de alta (mismo patrón que compras_terminal y compras_cups).

create table if not exists compras_contrato_centro (
  cuenta_id        uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd'::uuid,
  id               bigserial primary key,
  contrato         text not null,
  centro_coste     int  not null,
  cuenta_alquiler  text not null default '621000100',
  cuenta_seguro    text not null default '625000000',
  proveedor        text,
  nota             text,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (cuenta_id, contrato)
);

alter table compras_contrato_centro enable row level security;
drop policy if exists compras_contrato_centro_select on compras_contrato_centro;
drop policy if exists compras_contrato_centro_insert on compras_contrato_centro;
drop policy if exists compras_contrato_centro_update on compras_contrato_centro;
drop policy if exists compras_contrato_centro_delete on compras_contrato_centro;
create policy compras_contrato_centro_select on compras_contrato_centro for select to authenticated
  using ((cuenta_id = cuenta_actual()) or es_operador());
create policy compras_contrato_centro_insert on compras_contrato_centro for insert to authenticated
  with check ((cuenta_id = cuenta_actual()) or es_operador());
create policy compras_contrato_centro_update on compras_contrato_centro for update to authenticated
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());
create policy compras_contrato_centro_delete on compras_contrato_centro for delete to authenticated
  using ((cuenta_id = cuenta_actual()) or es_operador());

-- Contratos vigentes (facturas 2026-7200157371 y 2026-7200160020 de 01-09-2026),
-- centros según como los contabiliza Lucía en A3 (asientos 7471 y 8860).
-- El contrato se guarda solo con dígitos para comparar sin guiones ni espacios.
insert into compras_contrato_centro (contrato, centro_coste, proveedor, nota) values
  ('680072010720033', 3, 'CAIXABANK EQUIPMENT FINANCE', 'Equipo de cocina'),
  ('680072010723292', 3, 'CAIXABANK EQUIPMENT FINANCE', 'Tren de lavado'),
  ('680072011360115', 2, 'CAIXABANK EQUIPMENT FINANCE', 'Maquinaria agrícola (atomizador)'),
  ('680072012741444', 8, 'CAIXABANK EQUIPMENT FINANCE', 'Brasa abierta'),
  ('680072012741557', 8, 'CAIXABANK EQUIPMENT FINANCE', 'Horno Rational'),
  ('680072012741670', 8, 'CAIXABANK EQUIPMENT FINANCE', 'Equipo tratamiento y depuración de agua'),
  ('680072012742342', 8, 'CAIXABANK EQUIPMENT FINANCE', 'Lavavajillas'),
  ('680072012763945', 8, 'CAIXABANK EQUIPMENT FINANCE', 'Cámara frigorífica'),
  ('680076009652463', 6, 'CAIXABANK EQUIPMENT FINANCE', 'Tamarindos Restaurante'),
  ('680076009723472', 7, 'CAIXABANK EQUIPMENT FINANCE', 'Tamarindos Bar')
on conflict (cuenta_id, contrato) do nothing;
