-- APLICADA 13-10-2026 (registrada como 20261013202351) · Ficha de proveedor en Contabilidad y ajustes del módulo (Luis)
--
-- 1) La ficha del proveedor en Contabilidad necesita datos de contacto y
--    observaciones. El maestro (compras_proveedor) es del módulo de Compras y
--    no se altera (regla 3 de la casa): lo financiero y de contacto vive en
--    fin_proveedor_condiciones, que ya tenía iban y notas. Se añaden teléfono,
--    correo y persona de contacto. El «departamento por defecto» ya existe en
--    el maestro de Compras (lo usa el OCR): la ficha lo enseña, no lo duplica.
--
-- 2) fin_ajustes: preferencias del módulo por cuenta. Primera: qué columnas
--    enseña el listado de proveedores. Una fila por cuenta, jsonb para no
--    abrir una migración por cada preferencia nueva.

alter table public.fin_proveedor_condiciones
  add column if not exists telefono text,
  add column if not exists email    text,
  add column if not exists contacto text;

comment on column public.fin_proveedor_condiciones.telefono is 'Teléfono de contacto para pagos y facturas.';
comment on column public.fin_proveedor_condiciones.email    is 'Correo de contacto para pagos y facturas (no es el de pedidos, que vive en Compras).';
comment on column public.fin_proveedor_condiciones.contacto is 'Persona de contacto.';
comment on column public.fin_proveedor_condiciones.notas    is 'Observaciones libres de la ficha.';

create table if not exists public.fin_ajustes (
  cuenta_id      uuid primary key references cuentas(id),
  ajustes        jsonb not null default '{}'::jsonb,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.fin_ajustes is
  'Preferencias del módulo de Finanzas por cuenta (jsonb). Claves conocidas: proveedores_columnas (text[]).';

drop trigger if exists fin_ajustes_tocar on public.fin_ajustes;
create trigger fin_ajustes_tocar before update on public.fin_ajustes
  for each row execute function fin_tocar_actualizado();

alter table public.fin_ajustes enable row level security;

drop policy if exists fin_ajustes_acceso on public.fin_ajustes;
create policy fin_ajustes_acceso on public.fin_ajustes for all
  using ((cuenta_id = cuenta_actual()) or es_operador())
  with check ((cuenta_id = cuenta_actual()) or es_operador());

grant select, insert, update on public.fin_ajustes to authenticated;
