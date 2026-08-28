-- Credenciales de plataformas externas de los agentes (tokens OAuth).
-- RLS activada SIN políticas a propósito: solo el service role del servidor
-- puede leerlas/escribirlas; ningún usuario del panel las ve.
create table public.agentes_credenciales (
  cuenta_id uuid not null,
  proveedor text not null,
  datos jsonb not null,
  actualizado_en timestamptz not null default now(),
  primary key (cuenta_id, proveedor)
);
alter table public.agentes_credenciales enable row level security;
