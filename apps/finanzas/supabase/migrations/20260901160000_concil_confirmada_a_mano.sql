-- Pedido por Luis (01-09): los cruces PROBABLES de la conciliación (nº de
-- albarán que no coincide al 100% pero cuadran proveedor/importe/fecha/centro)
-- se pueden dar por buenos a mano. La confirmación se guarda aquí: la pareja
-- factura+nº detectado → albarán cargado queda conciliada en verde para
-- siempre, sin tocar el número del albarán ni el de la factura.

create table public.compras_concil_confirmada (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.compras_doc(id) on delete cascade,
  num_albaran text not null,
  albaran_id uuid not null references public.compras_doc(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (factura_id, num_albaran)
);

alter table public.compras_concil_confirmada enable row level security;
create policy "authenticated todo" on public.compras_concil_confirmada
  for all to authenticated using (true) with check (true);
grant select, insert, delete on public.compras_concil_confirmada to authenticated, service_role;
