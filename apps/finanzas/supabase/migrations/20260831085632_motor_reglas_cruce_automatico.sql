-- Motor de reglas del cruce automático (objetivo 95%).
-- Paso 1 (integrado, sin tabla): liquidar contra cartera con candidato único e
-- importe exacto, casando por nombre de contraparte o por nº de factura del
-- asiento («Fra. X · PROVEEDOR» contra el texto del banco).
-- Paso 2: reglas persistentes de fin_cruce_reglas (clasificar a cuenta / ignorar),
-- filtrando por códigos Norma 43, contraparte/texto, sentido e importe.
-- NOTA: la función de esta versión quedó superada por la v3 (20260831085939):
-- lotes con keyset y reglas antes que liquidación. Aquí queda la tabla.
create table if not exists fin_cruce_reglas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas(id),
  nombre text not null,
  activa boolean not null default true,
  prioridad int not null default 100,          -- menor = antes
  banco_cuenta_id uuid references fin_bancos_cuentas(id),  -- null = cualquier banco
  sentido text check (sentido in ('cobro','pago')),
  n43_comun text,
  n43_propio text,
  patron text,                                 -- ilike %patron% sobre contraparte+concepto+detalle
  importe_min numeric,
  importe_max numeric,
  accion text not null check (accion in ('clasificar','ignorar')),
  cuenta_codigo text,                          -- obligatoria si accion=clasificar
  centro_id uuid references centros(id),
  creado_en timestamptz not null default now(),
  constraint fin_cruce_reglas_clasificar_cuenta
    check (accion <> 'clasificar' or cuenta_codigo is not null)
);
alter table fin_cruce_reglas enable row level security;
create policy fin_cruce_reglas_acceso on fin_cruce_reglas
  using ((cuenta_id = cuenta_actual()) or es_operador());
create index fin_cruce_reglas_cuenta_idx on fin_cruce_reglas (cuenta_id, activa, prioridad);
