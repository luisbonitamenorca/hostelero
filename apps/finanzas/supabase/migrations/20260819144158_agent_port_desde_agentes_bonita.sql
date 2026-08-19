-- APLICADA 19-08-2026 (registrada como 20260819144158).
-- Port de Agentes al esqueleto (decisión de Luis, 19-08-2026): las 13 tablas
-- del proyecto agentes-bonita, calcadas + cuenta_id. El DEFAULT de cuenta_id
-- es deliberado: el panel y las funciones insertan sin mencionarla y la casa
-- sigue siendo multi-tenant sin tocar su código. RLS patrón de la casa en
-- todas (el panel escribe como authenticated con el token de sesión). Los
-- 361 registros se copiaron con scripts/migrar-agentes.mjs.

create table agent_tones (
  venue text primary key,
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  name text not null,
  color text not null,
  tone text not null default '',
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);

create table agent_reviews (
  id text primary key,
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  venue text not null,
  platform text not null,
  author text,
  rating integer,
  lang text default 'es',
  review_date date,
  text text not null,
  status text not null default 'pendiente',
  draft text,
  source text not null default 'mock',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  ts timestamptz not null default now(),
  agent text not null,
  items integer not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost numeric not null default 0
);

create table agent_knowledge (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  venue text not null,
  title text not null,
  content text not null default '',
  active boolean not null default true,
  source text default 'texto',
  updated_at timestamptz not null default now()
);

create table agent_competitors (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  name text not null,
  ambito text not null default 'restauracion',
  web text,
  notas text default '',
  active boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table agent_watch_findings (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  competitor_id uuid not null references agent_competitors(id) on delete cascade,
  tipo text not null default 'otro',
  titulo text not null,
  detalle text,
  url text,
  relevancia integer,
  estado text not null default 'nuevo',
  created_at timestamptz not null default now()
);

create table agent_sync_checks (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  venue text not null,
  ok boolean not null,
  comprobadas integer not null default 0,
  discrepancias integer not null default 0,
  resumen text,
  created_at timestamptz not null default now()
);

create table agent_sync_alerts (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  venue text not null,
  plataforma text not null,
  esperado text,
  encontrado text,
  detalle text,
  estado text not null default 'abierta',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table agent_grants (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  fuente text not null default 'BDNS',
  bdns text,
  titulo text not null,
  organo text,
  ambito text not null default 'autonomica',
  materia text,
  encaje integer,
  razon text,
  importe text,
  plazo date,
  fecha_pub date,
  url text,
  detalle text,
  estado text not null default 'nueva',
  notas text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agent_grant_profile (
  id integer primary key default 1,
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  perfil text not null default '',
  updated_at timestamptz not null default now()
);

create table agent_prospects (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  zone text not null,
  name text not null,
  city text,
  web text,
  email text,
  phone text,
  perfil text,
  score integer,
  razon text,
  angulo text,
  stage text not null default 'nuevo',
  notas text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agent_wa_chats (
  id text primary key,
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  venue text not null,
  customer_name text not null,
  phone_masked text,
  status text not null default 'agente',
  last_ts timestamptz not null default now(),
  source text not null default 'mock',
  created_at timestamptz not null default now()
);

create table agent_wa_messages (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default '082c5366-d9ae-49b9-a8b8-8caad73985bd' references cuentas(id),
  chat_id text not null references agent_wa_chats(id) on delete cascade,
  sender text not null,
  text text not null,
  ts timestamptz not null default now()
);

create index agent_reviews_status on agent_reviews (cuenta_id, status);
create index agent_wa_messages_chat on agent_wa_messages (chat_id, ts);
create index agent_watch_findings_comp on agent_watch_findings (competitor_id);

-- RLS patrón de la casa, igual en las 13: cada cuenta lo suyo (más el operador).
do $$
declare t text;
begin
  foreach t in array array['agent_tones','agent_reviews','agent_runs','agent_knowledge',
    'agent_competitors','agent_watch_findings','agent_sync_checks','agent_sync_alerts',
    'agent_grants','agent_grant_profile','agent_prospects','agent_wa_chats','agent_wa_messages']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (cuenta_id = cuenta_actual() or es_operador())', t || '_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (cuenta_id = cuenta_actual() or es_operador())', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (cuenta_id = cuenta_actual() or es_operador()) with check (cuenta_id = cuenta_actual() or es_operador())', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (cuenta_id = cuenta_actual() or es_operador())', t || '_delete', t);
  end loop;
end $$;

-- El WhatsApp en vivo del panel escucha cambios por realtime.
alter publication supabase_realtime add table agent_wa_chats, agent_wa_messages;
