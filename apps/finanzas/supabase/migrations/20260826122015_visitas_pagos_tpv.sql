-- T3 de Visitas: cobro online con el TPV Virtual de CaixaBank (Cyberpac /
-- Redsys), NO Stripe (decisión de Luis). Aplicada en dos pasos porque un
-- valor nuevo de enum no puede usarse en la misma transacción que lo crea:
--   1) visitas_metodo_pago_tpv:  alter type visitas_metodo_pago add value 'tpv';
--   2) esta tabla.
-- Un intento de pago por fila: ds_order es el número de pedido Redsys (único,
-- 12 caracteres, los 4 primeros numéricos). Una reserva puede acumular varios
-- intentos (rechazado y reintento). Escrituras solo desde el servidor con la
-- service key; la RLS deja leer a la cuenta para el panel de Visitas.
create table visitas_pagos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas(id),
  reserva_id uuid not null references visitas_reservas(id) on delete cascade,
  ds_order text not null unique,
  importe numeric(10,2) not null,
  estado text not null default 'iniciado' check (estado in ('iniciado','pagado','rechazado')),
  ds_respuesta jsonb,
  autorizacion text,
  created_at timestamptz not null default now(),
  pagado_at timestamptz
);

alter table visitas_pagos enable row level security;

create policy visitas_pagos_select on visitas_pagos
  for select to authenticated
  using (cuenta_id = cuenta_actual() or es_operador());

create index visitas_pagos_reserva on visitas_pagos (reserva_id);
