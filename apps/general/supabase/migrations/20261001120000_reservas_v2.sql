-- Reservas v2 (01-10-2026): el módulo de reservas se pone a la altura de la mejor versión de
-- CoverManager (plano, cupos, bloqueos, CRM de sala, etiquetas, prescriptores, experiencias,
-- mensajería email/SMS/WhatsApp, pagos con tarjeta, informes, permisos).
--
-- Contrato: docs/reservas-v2-plan.md (secciones 1 y 5). Decisiones y dudas:
-- docs/reservas-v2-migracion-notas.md. Inventario de Cover: docs/reservas-v2-cover-inventario.md.
--
-- Reglas:
--   * SOLO ADITIVA: tablas/columnas/funciones nuevas, seeds, checks ampliados. No se borra
--     ninguna columna ni ningún dato. reservas_emails_salientes se queda (lectura) y deja de
--     alimentarse.
--   * Idempotente (if not exists / where not exists / drop policy if exists + create).
--   * RLS en toda tabla nueva con el patrón actual de reservas_*:
--     cuenta_id = (select cuenta_actual()) or (select es_operador()). Nada para anon.
--   * Los seeds llevan cuenta_id explícito de Bonita (082c5366-d9ae-49b9-a8b8-8caad73985bd):
--     en una migración cuenta_actual() vale NULL.
--   * Funciones con set search_path = public, pg_temp y revoke execute from anon, public.
--     Las públicas (las llama el servidor con la service key) validan slug/cuenta y no se
--     conceden a authenticated. OJO: en este proyecto hay ALTER DEFAULT PRIVILEGES (owner
--     postgres y supabase_admin, esquema public) que conceden EXECUTE a anon, authenticated y
--     service_role sobre toda función nueva, así que toda función que NO deba llamar el panel
--     lleva «revoke … from anon, public, authenticated» (las de servidor/cron y las internas).
--     Lo mismo con las tablas: los default privileges dan TRUNCATE/REFERENCES/TRIGGER a
--     authenticated; se revocan explícitamente en todas las reservas_*.
--   * El orden importa: check_function_bodies = on → una función «language sql» o una vista
--     que cite una columna se crea DESPUÉS de añadir esa columna.
--   * Las funciones antiguas conservan su firma y su forma de salida; las nuevas llevan sufijo
--     _v2 cuando cambia la salida (PostgREST no resuelve bien sobrecargas con defaults).
--
-- Orden del fichero:
--   0.  helpers (ts con zona horaria, estados activos, mapa de códigos de Cover, duración por
--       pax, url base, render de plantillas, normalización de email)
--   1.1 restaurantes, salas, mesas, turnos (+columnas) · plano_objetos · cupos · bloqueos · notas_dia
--   1.2 catálogos: etiquetas, prescriptores, experiencias (+seeds)
--   5.x combinaciones de mesas, camareros (+ por día), preguntas, códigos, autotags, permisos
--   1.3 clientes (+columnas, backfill), vista reservas_clientes_stats, fusionar_clientes
--   1.4 reservas (+columnas, estados ampliados, token), historial (trigger), sellado (trigger),
--       lista de espera (+columnas)
--   1.5 plantillas (+seed 12 tipos × 3 canales × 2 idiomas), mensajes, programar_mensajes,
--       trigger reservas_encolar_email → programar_mensajes
--   1.6 pagos
--   1.7 funciones: mesa_ocupada, mesas_libres (v1 recreada), mejor_mesa (v1 recreada) y
--       mejor_mesa_v2, disponibilidad_v2 + disponibilidad (v1 wrapper), crear_online_v2,
--       gestion / gestion_cancelar / gestion_confirmar / gestion_modificar, lista de espera
--       (avisar), ocupacion_mes, estadisticas, tracking
--   1.8 cron: marcar_a_revisar, noshow_automatico, caducar_tarjeta_pendiente, aplicar_autotags
--   VERIFICACIÓN (comentarios con selects para el orquestador)

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

-- fecha + hora locales del restaurante → timestamptz. (El código antiguo hacía
-- (fecha + hora)::timestamptz con la zona de sesión, que en Supabase es UTC.)
create or replace function public.reservas_ts(p_fecha date, p_hora time, p_tz text default 'Europe/Madrid')
returns timestamptz
language sql
stable
parallel safe
set search_path = public, pg_temp
as $$
  select (p_fecha + p_hora) at time zone coalesce(nullif(p_tz, ''), 'Europe/Madrid')
$$;
revoke execute on function public.reservas_ts(date, time, text) from anon, public;
grant execute on function public.reservas_ts(date, time, text) to authenticated;

-- Estados que OCUPAN mesa (los que cuentan para disponibilidad y solapes).
-- tarjeta_pendiente retiene la mesa mientras el cliente mete la tarjeta; la caduca el cron.
create or replace function public.reservas_estados_activos()
returns text[]
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select array['pendiente','confirmada','reconfirmada','llegada','sentada','postre','cuenta','a_revisar','tarjeta_pendiente']
$$;
revoke execute on function public.reservas_estados_activos() from anon, public;
grant execute on function public.reservas_estados_activos() to authenticated;

-- Estados que cuentan como visita realizada (para stats y riesgo de no-show).
create or replace function public.reservas_estados_visita()
returns text[]
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select array['llegada','sentada','postre','cuenta','terminada']
$$;
revoke execute on function public.reservas_estados_visita() from anon, public;
grant execute on function public.reservas_estados_visita() to authenticated;

-- Mapa de códigos de estado de CoverManager (API/Tracking) → estado nuestro.
--   -5 No completada por no introducir tarjeta → tarjeta_pendiente
--   -4 A revisar                               → a_revisar
--   -3 No show                                 → no_show
--   -2 Cancelada cliente                       → cancelada (cancelada_por = 'cliente')
--   -1 Cancelada restaurante                   → cancelada (cancelada_por = 'restaurante')
--    0 Pendiente de confirmación               → pendiente
--    1 Confirmada                              → confirmada
--    2 Reconfirmada (+ Segunda Reconfirmación) → reconfirmada
--    3 Sentada                                 → sentada
--    4 Llegado                                 → llegada
--    5 Liberada                                → terminada
--    6 Cuenta solicitada                       → cuenta
--    7 Postre                                  → postre
--    8 Llegada barra                           → llegada
--    9 A limpiar                               → terminada
create or replace function public.reservas_estado_desde_cover(p_codigo integer)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case p_codigo
    when -5 then 'tarjeta_pendiente'
    when -4 then 'a_revisar'
    when -3 then 'no_show'
    when -2 then 'cancelada'
    when -1 then 'cancelada'
    when 0 then 'pendiente'
    when 1 then 'confirmada'
    when 2 then 'reconfirmada'
    when 3 then 'sentada'
    when 4 then 'llegada'
    when 5 then 'terminada'
    when 6 then 'cuenta'
    when 7 then 'postre'
    when 8 then 'llegada'
    when 9 then 'terminada'
    else null
  end
$$;
revoke execute on function public.reservas_estado_desde_cover(integer) from anon, public;
grant execute on function public.reservas_estado_desde_cover(integer) to authenticated;

-- Email normalizado (minúsculas, sin espacios; vacío → null).
create or replace function public.reservas_norm_email(t text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select nullif(lower(btrim(coalesce(t, ''))), '')
$$;
revoke execute on function public.reservas_norm_email(text) from anon, public;
grant execute on function public.reservas_norm_email(text) to authenticated;
-- reservas_norm_tel ya existe (legado): se asegura el mismo permiso.
revoke execute on function public.reservas_norm_tel(text) from anon, public;
grant execute on function public.reservas_norm_tel(text) to authenticated;

-- Duración (min) según pax leyendo reservas_restaurantes.duracion_por_pax
-- ({"1-2":90,"3-4":120,"5-8":150,"9+":180}). Si no hay regla → p_defecto (duración del turno).
create or replace function public.reservas_duracion_pax(p_restaurante uuid, p_pax integer, p_defecto integer default 120)
returns integer
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_cfg jsonb;
  v_k text;
  v_v text;
  v_min integer;
  v_max integer;
begin
  select duracion_por_pax into v_cfg from public.reservas_restaurantes where id = p_restaurante;
  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then
    return coalesce(p_defecto, 120);
  end if;
  for v_k, v_v in select key, value from jsonb_each_text(v_cfg) loop
    begin
      if v_k like '%+' then
        v_min := left(v_k, length(v_k) - 1)::integer; v_max := 999;
      elsif position('-' in v_k) > 0 then
        v_min := split_part(v_k, '-', 1)::integer; v_max := split_part(v_k, '-', 2)::integer;
      else
        v_min := v_k::integer; v_max := v_min;
      end if;
      if p_pax between v_min and v_max and v_v ~ '^\d+$' then
        return v_v::integer;
      end if;
    exception when others then
      null; -- clave mal escrita: se ignora
    end;
  end loop;
  return coalesce(p_defecto, 120);
end $$;
revoke execute on function public.reservas_duracion_pax(uuid, integer, integer) from anon, public;
grant execute on function public.reservas_duracion_pax(uuid, integer, integer) to authenticated;

-- URL pública base para enlaces de gestión (por restaurante; fallback = app actual).
-- La columna se añade aquí (y no en 1.1) porque la función es language sql y
-- check_function_bodies = on valida el cuerpo al crearla.
alter table public.reservas_restaurantes add column if not exists url_base text null;
create or replace function public.reservas_url_base(p_restaurante uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select nullif(btrim(r.url_base), '') from public.reservas_restaurantes r where r.id = p_restaurante),
    'https://hostelero-app.vercel.app')
$$;
revoke execute on function public.reservas_url_base(uuid) from anon, public;
grant execute on function public.reservas_url_base(uuid) to authenticated;

-- Sustituye {{clave}} por su valor; los placeholders sin valor desaparecen.
create or replace function public.reservas_renderizar(p_texto text, p_vars jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := coalesce(p_texto, '');
  k text;
  val text;
begin
  if p_vars is not null and jsonb_typeof(p_vars) = 'object' then
    for k, val in select key, value from jsonb_each_text(p_vars) loop
      v := replace(v, '{{' || k || '}}', coalesce(val, ''));
    end loop;
  end if;
  return regexp_replace(v, '\{\{[a-z_]+\}\}', '', 'g');
end $$;
revoke execute on function public.reservas_renderizar(text, jsonb) from anon, public;
grant execute on function public.reservas_renderizar(text, jsonb) to authenticated;

-- Token público de gestión: 32 hex en minúsculas (lo que genera encode(gen_random_bytes(16),'hex')).
create or replace function public.reservas_token_valido(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select p is not null and p ~ '^[0-9a-f]{32}$'
$$;
revoke execute on function public.reservas_token_valido(text) from anon, public;
grant execute on function public.reservas_token_valido(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.1 RESTAURANTE Y CONFIGURACIÓN
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.reservas_restaurantes
  add column if not exists direccion                  text null,
  add column if not exists mensaje_widget             text null,
  add column if not exists idiomas                    text[] not null default '{es,en}',
  add column if not exists color_marca                text null,
  add column if not exists logo_url                   text null,
  add column if not exists url_condiciones            text null,
  add column if not exists telefono_whatsapp          text null,
  add column if not exists prefijo_localizador        text null,
  add column if not exists politica_cancelacion_horas integer not null default 24,
  add column if not exists tarjeta_desde_pax          integer null,
  add column if not exists garantia_importe_pax       numeric(10,2) null,
  add column if not exists prepago_importe_pax        numeric(10,2) null,
  add column if not exists recordatorio_horas         integer not null default 24,
  add column if not exists reconfirmacion_horas       integer not null default 48,
  add column if not exists liberar_tras_min           integer not null default 20,
  add column if not exists valoracion_horas           integer not null default 2,
  add column if not exists envio_email                boolean not null default true,
  add column if not exists envio_sms                  boolean not null default false,
  add column if not exists envio_whatsapp             boolean not null default false,
  add column if not exists envio_noshow               boolean not null default false,
  add column if not exists duracion_por_pax           jsonb null,
  add column if not exists max_pax_online             integer not null default 8,
  add column if not exists grupos_telefono            text null,
  add column if not exists zona_horaria               text not null default 'Europe/Madrid',
  add column if not exists cobro_noshow_automatico    boolean not null default false,
  add column if not exists confirmar_online_auto      boolean not null default false,
  add column if not exists tarjeta_caduca_min         integer not null default 30,
  add column if not exists url_base                   text null,
  add column if not exists url_resena_google          text null,
  add column if not exists noshow_automatico          boolean not null default true;

comment on column public.reservas_restaurantes.tarjeta_desde_pax is 'Garantía con tarjeta obligatoria a partir de N comensales (null = nunca).';
comment on column public.reservas_restaurantes.garantia_importe_pax is 'Importe por persona que se cobra si no-show / cancelación tardía (reservas con garantía).';
comment on column public.reservas_restaurantes.prepago_importe_pax is 'Importe por persona de prepago (ticket) para todas las reservas online (null = sin prepago).';
comment on column public.reservas_restaurantes.liberar_tras_min is 'Minutos sin llegada tras la hora de la reserva antes de marcar «a revisar».';
comment on column public.reservas_restaurantes.confirmar_online_auto is 'true = la reserva online nace «confirmada»; false (compatibilidad) = nace «pendiente».';
comment on column public.reservas_restaurantes.tarjeta_caduca_min is 'Minutos que una reserva «tarjeta_pendiente» retiene la mesa antes de caducar.';
comment on column public.reservas_restaurantes.noshow_automatico is 'false = el cron no marca «a revisar» ni no_show (locales que no marcan llegadas en el panel).';

-- anon a cero también en las tablas antiguas (hoy lo frena RLS, pero TRUNCATE no pasa por RLS)
-- y fuera TRUNCATE/REFERENCES/TRIGGER de authenticated (los dan los default privileges).
revoke all on public.reservas_restaurantes, public.reservas_salas, public.reservas_mesas, public.reservas_turnos,
  public.reservas_cierres, public.reservas_clientes, public.reservas_reservas, public.reservas_reserva_mesas,
  public.reservas_lista_espera, public.reservas_emails_salientes from anon;
revoke truncate, references, trigger on public.reservas_restaurantes, public.reservas_salas, public.reservas_mesas,
  public.reservas_turnos, public.reservas_cierres, public.reservas_clientes, public.reservas_reservas,
  public.reservas_reserva_mesas, public.reservas_lista_espera, public.reservas_emails_salientes from authenticated;

-- Seeds de configuración (Bonita): duración por pax, mensaje del widget, dirección desde centros.
update public.reservas_restaurantes
set duracion_por_pax = '{"1-2":90,"3-4":120,"5-8":150,"9+":180}'::jsonb
where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and duracion_por_pax is null;

update public.reservas_restaurantes
set mensaje_widget = 'Podréis disfrutar de la mesa durante 2 horas. ¡Gracias!'
where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and mensaje_widget is null;

update public.reservas_restaurantes r
set direccion = c.direccion,
    telefono = coalesce(r.telefono, c.telefono)
from public.centros c
where c.id = r.centro_id and c.cuenta_id = r.cuenta_id
  and r.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
  and r.direccion is null and c.direccion is not null;

-- El Bar de Tamarindos no marca llegadas en el panel (jul-sep 2026: 473 confirmadas pasadas sin
-- cerrar y 6 visitas marcadas): sin esto el cron las pasaría todas a no_show.
update public.reservas_restaurantes
set noshow_automatico = false
where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and slug = 'bar-tamarindos';

-- ─── reservas_salas: zona reservable, color, prioridad, lienzo ───────────
alter table public.reservas_salas
  add column if not exists reservable_online boolean not null default true,
  add column if not exists color             text null,
  add column if not exists prioridad         integer not null default 100,
  add column if not exists ancho             integer not null default 100,
  add column if not exists alto              integer not null default 70,
  add column if not exists fondo             text not null default 'oscuro';

-- ─── reservas_mesas: tamaño, rotación, prioridad, unible, tipo, etiqueta ──
alter table public.reservas_mesas
  add column if not exists ancho     numeric null,
  add column if not exists alto      numeric null,
  add column if not exists rotacion  integer not null default 0,
  add column if not exists prioridad integer not null default 100,
  add column if not exists unible    boolean not null default true,
  add column if not exists tipo      text not null default 'mesa',
  add column if not exists color     text null,
  add column if not exists etiqueta  text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservas_mesas_tipo_check') then
    alter table public.reservas_mesas
      add constraint reservas_mesas_tipo_check check (tipo in ('mesa', 'barra', 'alta'));
  end if;
end $$;

-- Tamaño por defecto según forma (unidades del lienzo 100×70, como pos_x/pos_y).
update public.reservas_mesas
set ancho = case forma when 'rectangular' then 10 else 7 end,
    alto  = case forma when 'rectangular' then 6 else 7 end
where ancho is null or alto is null;

-- ─── reservas_turnos: fin de servicio, aforos por turno, color ───────────
alter table public.reservas_turnos
  add column if not exists fin_servicio           time null,
  add column if not exists max_pax_total          integer null,
  add column if not exists max_reservas_intervalo integer null,
  add column if not exists color                  text null;
comment on column public.reservas_turnos.fin_servicio is 'Hora real de cierre del servicio (hora_fin = última hora reservable). Null = hora_fin + duracion_min.';

-- ─── reservas_plano_objetos: decoración del plano ────────────────────────
create table if not exists public.reservas_plano_objetos (
  id        uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default cuenta_actual() references public.cuentas(id),
  sala_id   uuid not null references public.reservas_salas(id) on delete cascade,
  tipo      text not null check (tipo in ('planta','pared','barra','texto','puerta','columna','ventana','escalera','cocina')),
  pos_x     numeric not null default 10,
  pos_y     numeric not null default 10,
  ancho     numeric not null default 6,
  alto      numeric not null default 6,
  rotacion  integer not null default 0,
  texto     text null,
  color     text null,
  creado_en timestamptz not null default now()
);
create index if not exists idx_reservas_plano_objetos_cuenta_id on public.reservas_plano_objetos (cuenta_id);
create index if not exists idx_reservas_plano_objetos_sala on public.reservas_plano_objetos (sala_id);
alter table public.reservas_plano_objetos enable row level security;
revoke all on public.reservas_plano_objetos from anon;
grant select, insert, update, delete on public.reservas_plano_objetos to authenticated;
revoke truncate, references, trigger on public.reservas_plano_objetos from authenticated;
drop policy if exists reservas_plano_objetos_acceso on public.reservas_plano_objetos;
create policy reservas_plano_objetos_acceso on public.reservas_plano_objetos
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ─── reservas_cupos: por día y turno (cerrado, aforo online, aforo total, nota) ──
-- turno_id null = todo el día. (reservas_cierres siguen valiendo; la UI nueva escribe aquí.)
create table if not exists public.reservas_cupos (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id uuid not null references public.reservas_restaurantes(id) on delete cascade,
  fecha          date not null,
  turno_id       uuid null references public.reservas_turnos(id) on delete cascade,
  cerrado        boolean not null default false,
  max_pax_online integer null,
  max_pax_total  integer null,
  nota           text null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists reservas_cupos_rest_fecha_turno_ux
  on public.reservas_cupos (restaurante_id, fecha, coalesce(turno_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_reservas_cupos_cuenta_id on public.reservas_cupos (cuenta_id);
create index if not exists idx_reservas_cupos_rest_fecha on public.reservas_cupos (restaurante_id, fecha);
alter table public.reservas_cupos enable row level security;
revoke all on public.reservas_cupos from anon;
grant select, insert, update, delete on public.reservas_cupos to authenticated;
revoke truncate, references, trigger on public.reservas_cupos from authenticated;
drop policy if exists reservas_cupos_acceso on public.reservas_cupos;
create policy reservas_cupos_acceso on public.reservas_cupos
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ─── reservas_bloqueos: mesa / sala / restaurante bloqueado en una franja ─
-- mesa_id y sala_id nulos = todo el restaurante.
create table if not exists public.reservas_bloqueos (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id uuid not null references public.reservas_restaurantes(id) on delete cascade,
  fecha          date not null,
  hora_inicio    time not null default '00:00',
  hora_fin       time not null default '23:59',
  mesa_id        uuid null references public.reservas_mesas(id) on delete cascade,
  sala_id        uuid null references public.reservas_salas(id) on delete cascade,
  motivo         text null,
  creado_por     uuid null,
  creado_en      timestamptz not null default now(),
  constraint reservas_bloqueos_horas_check check (hora_fin > hora_inicio)
);
create index if not exists idx_reservas_bloqueos_cuenta_id on public.reservas_bloqueos (cuenta_id);
create index if not exists idx_reservas_bloqueos_rest_fecha on public.reservas_bloqueos (restaurante_id, fecha);
create index if not exists idx_reservas_bloqueos_mesa on public.reservas_bloqueos (mesa_id);
alter table public.reservas_bloqueos enable row level security;
revoke all on public.reservas_bloqueos from anon;
grant select, insert, update, delete on public.reservas_bloqueos to authenticated;
revoke truncate, references, trigger on public.reservas_bloqueos from authenticated;
drop policy if exists reservas_bloqueos_acceso on public.reservas_bloqueos;
create policy reservas_bloqueos_acceso on public.reservas_bloqueos
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ─── reservas_notas_dia ──────────────────────────────────────────────────
create table if not exists public.reservas_notas_dia (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id uuid not null references public.reservas_restaurantes(id) on delete cascade,
  fecha          date not null,
  texto          text not null,
  creado_por     uuid null,
  creado_en      timestamptz not null default now()
);
create index if not exists idx_reservas_notas_dia_cuenta_id on public.reservas_notas_dia (cuenta_id);
create index if not exists idx_reservas_notas_dia_rest_fecha on public.reservas_notas_dia (restaurante_id, fecha);
alter table public.reservas_notas_dia enable row level security;
revoke all on public.reservas_notas_dia from anon;
grant select, insert, update, delete on public.reservas_notas_dia to authenticated;
revoke truncate, references, trigger on public.reservas_notas_dia from authenticated;
drop policy if exists reservas_notas_dia_acceso on public.reservas_notas_dia;
create policy reservas_notas_dia_acceso on public.reservas_notas_dia
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.2 CATÁLOGOS
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── reservas_etiquetas: reserva / cliente / alérgeno ────────────────────
create table if not exists public.reservas_etiquetas (
  id        uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default cuenta_actual() references public.cuentas(id),
  ambito    text not null check (ambito in ('reserva', 'cliente', 'alergeno')),
  nombre    text not null,
  color     text not null default '#888888',
  orden     integer not null default 100,
  activa    boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint reservas_etiquetas_color_check check (color ~ '^#[0-9A-Fa-f]{6}$')
);
create unique index if not exists reservas_etiquetas_cuenta_ambito_nombre_ux
  on public.reservas_etiquetas (cuenta_id, ambito, lower(nombre));
create index if not exists idx_reservas_etiquetas_cuenta_id on public.reservas_etiquetas (cuenta_id);
alter table public.reservas_etiquetas enable row level security;
revoke all on public.reservas_etiquetas from anon;
grant select, insert, update, delete on public.reservas_etiquetas to authenticated;
revoke truncate, references, trigger on public.reservas_etiquetas from authenticated;
drop policy if exists reservas_etiquetas_acceso on public.reservas_etiquetas;
create policy reservas_etiquetas_acceso on public.reservas_etiquetas
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- Seed Bonita: 20 de reserva, 12 de cliente, 14 alérgenos UE.
insert into public.reservas_etiquetas (cuenta_id, ambito, nombre, color, orden)
select '082c5366-d9ae-49b9-a8b8-8caad73985bd', s.ambito, s.nombre, s.color, s.orden
from (values
  ('reserva', 'Cumpleaños',         '#E8590C', 10),
  ('reserva', 'Celebración',        '#D6336C', 20),
  ('reserva', 'Aniversario',        '#BE4BDB', 30),
  ('reserva', 'Boda',               '#7950F2', 40),
  ('reserva', 'Bautizo',            '#4C6EF5', 50),
  ('reserva', 'Comunión',           '#228BE6', 60),
  ('reserva', 'Empresa',            '#15AABF', 70),
  ('reserva', 'Silla de ruedas',    '#12B886', 80),
  ('reserva', 'Carrito de bebé',    '#40C057', 90),
  ('reserva', 'Trona',              '#82C91E', 100),
  ('reserva', 'Menú concertado',    '#FAB005', 110),
  ('reserva', 'Evento',             '#FD7E14', 120),
  ('reserva', 'Grupo',              '#FA5252', 130),
  ('reserva', 'Invitación',         '#868E96', 140),
  ('reserva', 'Prueba de menú',     '#495057', 150),
  ('reserva', 'Huésped',            '#1D9E75', 160),
  ('reserva', 'Turista',            '#185FA5', 170),
  ('reserva', 'Local',              '#534AB7', 180),
  ('reserva', 'Llegada impuntual',  '#BA7517', 190),
  ('reserva', 'Cliente contactado', '#607D8B', 200),
  ('cliente', 'VIP',            '#FAB005', 10),
  ('cliente', 'Super VIP',      '#E8590C', 20),
  ('cliente', 'Habitual',       '#1D9E75', 30),
  ('cliente', 'Socio',          '#185FA5', 40),
  ('cliente', 'Equipo',         '#534AB7', 50),
  ('cliente', 'Prescriptor',    '#15AABF', 60),
  ('cliente', 'Proveedor',      '#868E96', 70),
  ('cliente', 'Problemático',   '#FA5252', 80),
  ('cliente', 'Lista negra',    '#1a1a1a', 90),
  ('cliente', 'No paga',        '#C92A2A', 100),
  ('cliente', 'Sin tarjeta',    '#BA7517', 110),
  ('cliente', 'No-show previo', '#D6336C', 120),
  ('alergeno', 'Gluten',       '#BA7517', 10),
  ('alergeno', 'Crustáceos',   '#E8590C', 20),
  ('alergeno', 'Huevos',       '#FAB005', 30),
  ('alergeno', 'Pescado',      '#228BE6', 40),
  ('alergeno', 'Cacahuetes',   '#A0522D', 50),
  ('alergeno', 'Soja',         '#82C91E', 60),
  ('alergeno', 'Lácteos',      '#74C0FC', 70),
  ('alergeno', 'Frutos secos', '#8B4513', 80),
  ('alergeno', 'Apio',         '#40C057', 90),
  ('alergeno', 'Mostaza',      '#E6B800', 100),
  ('alergeno', 'Sésamo',       '#D2B48C', 110),
  ('alergeno', 'Sulfitos',     '#7950F2', 120),
  ('alergeno', 'Altramuz',     '#FFD43B', 130),
  ('alergeno', 'Moluscos',     '#15AABF', 140)
) as s(ambito, nombre, color, orden)
where not exists (
  select 1 from public.reservas_etiquetas e
  where e.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
    and e.ambito = s.ambito and lower(e.nombre) = lower(s.nombre)
);

-- ─── reservas_prescriptores: hoteles / agencias / empresas / canales ─────
create table if not exists public.reservas_prescriptores (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null default cuenta_actual() references public.cuentas(id),
  nombre       text not null,
  slug         text null,
  tipo         text not null default 'hotel' check (tipo in ('hotel', 'agencia', 'empresa', 'canal', 'otro')),
  telefono     text null,
  email        text null,
  comision_pct numeric(5,2) null,
  notas        text null,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now()
);
create unique index if not exists reservas_prescriptores_cuenta_nombre_ux
  on public.reservas_prescriptores (cuenta_id, lower(nombre));
create unique index if not exists reservas_prescriptores_cuenta_slug_ux
  on public.reservas_prescriptores (cuenta_id, slug) where slug is not null;
create index if not exists idx_reservas_prescriptores_cuenta_id on public.reservas_prescriptores (cuenta_id);
alter table public.reservas_prescriptores enable row level security;
revoke all on public.reservas_prescriptores from anon;
grant select, insert, update, delete on public.reservas_prescriptores to authenticated;
revoke truncate, references, trigger on public.reservas_prescriptores from authenticated;
drop policy if exists reservas_prescriptores_acceso on public.reservas_prescriptores;
create policy reservas_prescriptores_acceso on public.reservas_prescriptores
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- slug: minúsculas sin acentos ni símbolos (para enlaces de campaña ?p=<slug>).
create or replace function public.reservas_slug(p text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(
    lower(translate(coalesce(p, ''),
      'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ',
      'aeiouaeiouaeiouaeiouncAEIOUAEIOUAEIOUAEIOUNC')),
    '[^a-z0-9]+', '-', 'g'), '-'), '')
$$;
revoke execute on function public.reservas_slug(text) from anon, public;
grant execute on function public.reservas_slug(text) to authenticated;

-- Seed Bonita: 20 hoteles de la lista de Cover + 3 canales.
insert into public.reservas_prescriptores (cuenta_id, nombre, slug, tipo)
select '082c5366-d9ae-49b9-a8b8-8caad73985bd', s.nombre, reservas_slug(s.nombre), s.tipo
from (values
  ('ARTIEM Audax', 'hotel'),
  ('Hotel Torralbenc', 'hotel'),
  ('Meliá Cala Galdana', 'hotel'),
  ('Hotel Can Faustino', 'hotel'),
  ('Insotel Prestige Punta Prima', 'hotel'),
  ('Hotel Cristine Bedfor', 'hotel'),
  ('Hotel Menorca Experimental', 'hotel'),
  ('Hotel Jardí de Ses Bruixes', 'hotel'),
  ('Hotel Port Mahon', 'hotel'),
  ('Hotel Hevresac', 'hotel'),
  ('Hotel Sant Joan de Binissaida', 'hotel'),
  ('Hotel Alcaufar Vell', 'hotel'),
  ('Binissafullet Vell Agroturismo', 'hotel'),
  ('Hotel Tres Sants', 'hotel'),
  ('Hotel Casa Ládico', 'hotel'),
  ('Hotel Rural Biniati', 'hotel'),
  ('Occidental Menorca', 'hotel'),
  ('PortBlue San Luis', 'hotel'),
  ('Hotel Carlos III', 'hotel'),
  ('Hotel Sur Menorca', 'hotel'),
  ('google', 'canal'),
  ('INSTAGRAM', 'canal'),
  ('FACEBOOK', 'canal')
) as s(nombre, tipo)
where not exists (
  select 1 from public.reservas_prescriptores p
  where p.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and lower(p.nombre) = lower(s.nombre)
);

-- ─── reservas_experiencias: menús / experiencias reservables ─────────────
create table if not exists public.reservas_experiencias (
  id               uuid primary key default gen_random_uuid(),
  cuenta_id        uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id   uuid not null references public.reservas_restaurantes(id) on delete cascade,
  nombre           text not null,
  descripcion      text null,
  precio_pax       numeric(10,2) null,
  requiere_prepago boolean not null default false,
  pax_min          integer not null default 1,
  pax_max          integer null,
  turnos           uuid[] null,
  dias_semana      integer[] null,
  fecha_desde      date null,
  fecha_hasta      date null,
  activa           boolean not null default true,
  orden            integer not null default 100,
  imagen_url       text null,
  creado_en        timestamptz not null default now(),
  constraint reservas_experiencias_pax_check check (pax_max is null or pax_max >= pax_min)
);
create index if not exists idx_reservas_experiencias_cuenta_id on public.reservas_experiencias (cuenta_id);
create index if not exists idx_reservas_experiencias_rest on public.reservas_experiencias (restaurante_id);
alter table public.reservas_experiencias enable row level security;
revoke all on public.reservas_experiencias from anon;
grant select, insert, update, delete on public.reservas_experiencias to authenticated;
revoke truncate, references, trigger on public.reservas_experiencias from authenticated;
drop policy if exists reservas_experiencias_acceso on public.reservas_experiencias;
create policy reservas_experiencias_acceso on public.reservas_experiencias
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5.x AÑADIDOS DE LA INVESTIGACIÓN
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── reservas_mesas_combinaciones: uniones habituales ────────────────────
create table if not exists public.reservas_mesas_combinaciones (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id uuid not null references public.reservas_restaurantes(id) on delete cascade,
  nombre         text not null,
  mesas          uuid[] not null,
  pax_min        integer not null default 1,
  pax_max        integer not null default 8,
  prioridad      integer not null default 100,
  activa         boolean not null default true,
  creado_en      timestamptz not null default now(),
  constraint reservas_mesas_combinaciones_pax_check check (pax_max >= pax_min),
  constraint reservas_mesas_combinaciones_mesas_check check (cardinality(mesas) >= 2)
);
create index if not exists idx_reservas_mesas_combinaciones_cuenta_id on public.reservas_mesas_combinaciones (cuenta_id);
create index if not exists idx_reservas_mesas_combinaciones_rest on public.reservas_mesas_combinaciones (restaurante_id);
alter table public.reservas_mesas_combinaciones enable row level security;
revoke all on public.reservas_mesas_combinaciones from anon;
grant select, insert, update, delete on public.reservas_mesas_combinaciones to authenticated;
revoke truncate, references, trigger on public.reservas_mesas_combinaciones from authenticated;
drop policy if exists reservas_mesas_combinaciones_acceso on public.reservas_mesas_combinaciones;
create policy reservas_mesas_combinaciones_acceso on public.reservas_mesas_combinaciones
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ─── reservas_camareros y asignación por mesa y día ──────────────────────
create table if not exists public.reservas_camareros (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id uuid not null references public.reservas_restaurantes(id) on delete cascade,
  nombre         text not null,
  color          text not null default '#888888',
  empleado_id    uuid null,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  constraint reservas_camareros_color_check check (color ~ '^#[0-9A-Fa-f]{6}$')
);
create index if not exists idx_reservas_camareros_cuenta_id on public.reservas_camareros (cuenta_id);
create index if not exists idx_reservas_camareros_rest on public.reservas_camareros (restaurante_id);
alter table public.reservas_camareros enable row level security;
revoke all on public.reservas_camareros from anon;
grant select, insert, update, delete on public.reservas_camareros to authenticated;
revoke truncate, references, trigger on public.reservas_camareros from authenticated;
drop policy if exists reservas_camareros_acceso on public.reservas_camareros;
create policy reservas_camareros_acceso on public.reservas_camareros
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

create table if not exists public.reservas_mesas_camarero_dia (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null default cuenta_actual() references public.cuentas(id),
  fecha       date not null,
  mesa_id     uuid not null references public.reservas_mesas(id) on delete cascade,
  camarero_id uuid not null references public.reservas_camareros(id) on delete cascade,
  turno_id    uuid null references public.reservas_turnos(id) on delete cascade,
  creado_en   timestamptz not null default now()
);
create unique index if not exists reservas_mesas_camarero_dia_ux
  on public.reservas_mesas_camarero_dia (fecha, mesa_id, coalesce(turno_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_reservas_mesas_camarero_dia_cuenta_id on public.reservas_mesas_camarero_dia (cuenta_id);
alter table public.reservas_mesas_camarero_dia enable row level security;
revoke all on public.reservas_mesas_camarero_dia from anon;
grant select, insert, update, delete on public.reservas_mesas_camarero_dia to authenticated;
revoke truncate, references, trigger on public.reservas_mesas_camarero_dia from authenticated;
drop policy if exists reservas_mesas_camarero_dia_acceso on public.reservas_mesas_camarero_dia;
create policy reservas_mesas_camarero_dia_acceso on public.reservas_mesas_camarero_dia
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ─── reservas_preguntas: preguntas personalizadas del widget ─────────────
create table if not exists public.reservas_preguntas (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id uuid not null references public.reservas_restaurantes(id) on delete cascade,
  texto          text not null,
  texto_en       text null,
  tipo           text not null default 'si_no' check (tipo in ('si_no', 'texto', 'desplegable', 'multiple')),
  opciones       text[] null,
  obligatoria    boolean not null default false,
  orden          integer not null default 100,
  activa         boolean not null default true,
  creado_en      timestamptz not null default now()
);
create index if not exists idx_reservas_preguntas_cuenta_id on public.reservas_preguntas (cuenta_id);
create index if not exists idx_reservas_preguntas_rest on public.reservas_preguntas (restaurante_id);
alter table public.reservas_preguntas enable row level security;
revoke all on public.reservas_preguntas from anon;
grant select, insert, update, delete on public.reservas_preguntas to authenticated;
revoke truncate, references, trigger on public.reservas_preguntas from authenticated;
drop policy if exists reservas_preguntas_acceso on public.reservas_preguntas;
create policy reservas_preguntas_acceso on public.reservas_preguntas
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ─── reservas_codigos: códigos promocionales ─────────────────────────────
create table if not exists public.reservas_codigos (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id  uuid null references public.reservas_restaurantes(id) on delete cascade,
  codigo          text not null,
  descripcion     text null,
  descuento_pct   numeric(5,2) null,
  descuento_importe numeric(10,2) null,
  experiencia_id  uuid null references public.reservas_experiencias(id) on delete set null,
  valido_desde    date null,
  valido_hasta    date null,
  usos_max        integer null,
  usos            integer not null default 0,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);
create unique index if not exists reservas_codigos_cuenta_codigo_ux
  on public.reservas_codigos (cuenta_id, upper(codigo));
create index if not exists idx_reservas_codigos_cuenta_id on public.reservas_codigos (cuenta_id);
alter table public.reservas_codigos enable row level security;
revoke all on public.reservas_codigos from anon;
grant select, insert, update, delete on public.reservas_codigos to authenticated;
revoke truncate, references, trigger on public.reservas_codigos from authenticated;
drop policy if exists reservas_codigos_acceso on public.reservas_codigos;
create policy reservas_codigos_acceso on public.reservas_codigos
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ─── reservas_autotags: etiquetas automáticas de cliente ─────────────────
-- «si el cliente ha hecho ≥ n no_show / cancelar / asistir en los últimos periodo_dias → etiqueta».
create table if not exists public.reservas_autotags (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null default cuenta_actual() references public.cuentas(id),
  condicion    text not null check (condicion in ('no_show', 'cancelar', 'asistir')),
  operador     text not null default '>=' check (operador in ('>=', '=', '<=')),
  n            integer not null default 1,
  periodo_dias integer not null default 365,
  etiqueta_id  uuid not null references public.reservas_etiquetas(id) on delete cascade,
  activa       boolean not null default true,
  creado_en    timestamptz not null default now()
);
create index if not exists idx_reservas_autotags_cuenta_id on public.reservas_autotags (cuenta_id);
alter table public.reservas_autotags enable row level security;
revoke all on public.reservas_autotags from anon;
grant select, insert, update, delete on public.reservas_autotags to authenticated;
revoke truncate, references, trigger on public.reservas_autotags from authenticated;
drop policy if exists reservas_autotags_acceso on public.reservas_autotags;
create policy reservas_autotags_acceso on public.reservas_autotags
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- ─── reservas_permisos_perfil: permisos de sala por usuario ──────────────
-- Sin fila = todo permitido salvo cobrar y editar plano (lo decide el panel).
create table if not exists public.reservas_permisos_perfil (
  id                   uuid primary key default gen_random_uuid(),
  cuenta_id            uuid not null default cuenta_actual() references public.cuentas(id),
  perfil_id            uuid not null references public.perfiles(id) on delete cascade,
  puede_cobrar         boolean not null default false,
  puede_mover          boolean not null default true,
  puede_cambiar_estado boolean not null default true,
  puede_editar_plano   boolean not null default false,
  puede_ajustes        boolean not null default false,
  restaurantes         uuid[] null,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now()
);
create unique index if not exists reservas_permisos_perfil_perfil_ux on public.reservas_permisos_perfil (perfil_id);
create index if not exists idx_reservas_permisos_perfil_cuenta_id on public.reservas_permisos_perfil (cuenta_id);
alter table public.reservas_permisos_perfil enable row level security;
revoke all on public.reservas_permisos_perfil from anon;
grant select, insert, update, delete on public.reservas_permisos_perfil to authenticated;
revoke truncate, references, trigger on public.reservas_permisos_perfil from authenticated;
-- Lectura: toda la cuenta (el panel necesita saber qué puede cada uno). Escritura: dirección u operador,
-- y el perfil tiene que ser de la misma cuenta (si no, un gestor de A podría bloquear la fila de B).
drop policy if exists reservas_permisos_perfil_lectura on public.reservas_permisos_perfil;
create policy reservas_permisos_perfil_lectura on public.reservas_permisos_perfil
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()));
drop policy if exists reservas_permisos_perfil_gestion on public.reservas_permisos_perfil;
create policy reservas_permisos_perfil_gestion on public.reservas_permisos_perfil
  for all to authenticated
  using ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()))
  with check (
    ((cuenta_id = (select cuenta_actual()) and (select rrhh_es_gestor())) or (select es_operador()))
    and exists (select 1 from public.perfiles p where p.id = perfil_id and p.cuenta_id = reservas_permisos_perfil.cuenta_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.3 CLIENTES (CRM de sala)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.reservas_clientes
  add column if not exists apellidos               text null,
  add column if not exists idioma                  text not null default 'es',
  add column if not exists pais                    text not null default 'ES',
  add column if not exists codigo_postal           text null,
  add column if not exists telefono_adicional      text null,
  add column if not exists etiquetas               uuid[] not null default '{}',
  add column if not exists alergenos               uuid[] not null default '{}',
  add column if not exists consentimiento_marketing boolean not null default false,
  add column if not exists consentimiento_en       timestamptz null,
  add column if not exists fecha_nacimiento        date null,
  add column if not exists empresa                 text null,
  add column if not exists numero_socio            text null,
  add column if not exists prescriptor_id          uuid null references public.reservas_prescriptores(id) on delete set null,
  add column if not exists lista_negra             boolean not null default false,
  add column if not exists telefono_norm           text null,
  add column if not exists email_norm              text null,
  add column if not exists actualizado_en          timestamptz not null default now();

-- Backfill de normalizados (8 teléfonos con formato distinto del normalizado en la base actual).
update public.reservas_clientes
set telefono_norm = reservas_norm_tel(telefono)
where telefono is not null and telefono_norm is distinct from reservas_norm_tel(telefono);

update public.reservas_clientes
set email_norm = reservas_norm_email(email)
where email is not null and email_norm is distinct from reservas_norm_email(email);

create index if not exists idx_reservas_clientes_tel_norm on public.reservas_clientes (cuenta_id, telefono_norm);
create index if not exists idx_reservas_clientes_email_norm on public.reservas_clientes (cuenta_id, email_norm);
create index if not exists idx_reservas_clientes_nombre_trgm
  on public.reservas_clientes using gin ((coalesce(nombre, '') || ' ' || coalesce(apellidos, '')) gin_trgm_ops);
create index if not exists idx_reservas_clientes_prescriptor on public.reservas_clientes (prescriptor_id);

-- Sello actualizado_en + normalizados al vuelo.
create or replace function public.reservas_clientes_tocar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.actualizado_en := now();
  new.telefono_norm := reservas_norm_tel(new.telefono);
  new.email_norm := reservas_norm_email(new.email);
  if new.consentimiento_marketing and not coalesce(old.consentimiento_marketing, false) and new.consentimiento_en is null then
    new.consentimiento_en := now();
  end if;
  return new;
end $$;
revoke all on function public.reservas_clientes_tocar() from public, anon, authenticated;

drop trigger if exists trg_rsv_clientes_tocar on public.reservas_clientes;
create trigger trg_rsv_clientes_tocar
  before insert or update on public.reservas_clientes
  for each row execute function public.reservas_clientes_tocar();

-- ─── vista reservas_clientes_stats ───────────────────────────────────────
-- riesgo_no_show (0–1): no-shows de los últimos 12 meses a peso 1, más antiguos a 0,5 y
-- cancelaciones tardías (dentro de la política, solo con cancelada_en informado) a 0,5,
-- dividido entre (visitas + visitas_presuntas + no_shows + canceladas_tardias + 1).
-- visitas_presuntas = reservas pasadas que se quedaron en pendiente/confirmada/reconfirmada
-- (locales que no marcan llegadas): cuentan como asistencia, no como no-show.
-- Las columnas que usa la vista se añaden ANTES (las vistas se validan al crearse); el
-- «add column if not exists» de 1.4 queda como no-op.
alter table public.reservas_reservas
  add column if not exists cancelada_en timestamptz null,
  add column if not exists valoracion   integer null;
-- drop + create: «create or replace view» no admite columnas nuevas en medio si la vista ya
-- existiera (las funciones SQL que la leen no registran dependencia, así que el drop es seguro).
drop view if exists public.reservas_clientes_stats;
create view public.reservas_clientes_stats
with (security_invoker = true)
as
with base as (
  select
    c.id as cliente_id,
    c.cuenta_id,
    count(r.id) filter (where r.estado = any(reservas_estados_visita()))::integer as visitas,
    count(r.id) filter (where r.estado in ('pendiente', 'confirmada', 'reconfirmada') and r.fecha < current_date)::integer as visitas_presuntas,
    count(r.id) filter (where r.estado = 'no_show')::integer as no_shows,
    count(r.id) filter (where r.estado = 'no_show' and r.fecha >= current_date - 365)::integer as no_shows_12m,
    count(r.id) filter (where r.estado = 'cancelada')::integer as canceladas,
    count(r.id) filter (where r.estado = 'cancelada' and r.cancelada_en is not null
      and r.cancelada_en > reservas_ts(r.fecha, r.hora, rr.zona_horaria)
        - make_interval(hours => coalesce(rr.politica_cancelacion_horas, 24)))::integer as canceladas_tardias,
    max(r.fecha) filter (where r.estado = any(reservas_estados_visita())) as ultima_visita,
    min(r.fecha) filter (where r.estado = any(reservas_estados_visita())) as primera_visita,
    round(avg(r.pax) filter (where r.estado = any(reservas_estados_visita())), 1) as pax_medio,
    array_remove(array_agg(distinct r.restaurante_id) filter (where r.estado = any(reservas_estados_visita())), null) as restaurantes,
    min(r.fecha) filter (where r.fecha >= current_date and r.estado = any(reservas_estados_activos())) as proxima_reserva,
    round(avg(r.valoracion), 2) as valoracion_media,
    count(r.id)::integer as reservas_total
  from public.reservas_clientes c
  left join public.reservas_reservas r on r.cliente_id = c.id
  left join public.reservas_restaurantes rr on rr.id = r.restaurante_id
  group by c.id, c.cuenta_id
)
select
  b.*,
  least(1, round(
    (b.no_shows_12m + 0.5 * (b.no_shows - b.no_shows_12m) + 0.5 * b.canceladas_tardias)::numeric
    / (b.visitas + b.visitas_presuntas + b.no_shows + b.canceladas_tardias + 1)::numeric, 2)) as riesgo_no_show
from base b;
revoke all on public.reservas_clientes_stats from anon;
grant select on public.reservas_clientes_stats to authenticated;

-- ─── reservas_fusionar_clientes(origen, destino): reapunta y borra el origen ──
-- security invoker: solo funciona sobre clientes visibles por RLS (misma cuenta) y solo para
-- gestores (rrhh_es_gestor = dirección/administración u operador), como pide el plan §1.3.
create or replace function public.reservas_fusionar_clientes(p_origen uuid, p_destino uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_o public.reservas_clientes%rowtype;
  v_d public.reservas_clientes%rowtype;
  v_n integer;
begin
  if p_origen is null or p_destino is null or p_origen = p_destino then
    return jsonb_build_object('error', 'CLIENTES_INVALIDOS');
  end if;
  if not (select rrhh_es_gestor()) then
    return jsonb_build_object('error', 'SIN_PERMISO');
  end if;
  select * into v_o from public.reservas_clientes where id = p_origen;
  if not found then return jsonb_build_object('error', 'ORIGEN_NO_ENCONTRADO'); end if;
  select * into v_d from public.reservas_clientes where id = p_destino;
  if not found then return jsonb_build_object('error', 'DESTINO_NO_ENCONTRADO'); end if;
  if v_o.cuenta_id <> v_d.cuenta_id then return jsonb_build_object('error', 'CUENTAS_DISTINTAS'); end if;

  update public.reservas_reservas set cliente_id = p_destino where cliente_id = p_origen;
  get diagnostics v_n = row_count;
  update public.reservas_mensajes set cliente_id = p_destino where cliente_id = p_origen;
  update public.reservas_lista_espera set cliente_id = p_destino where cliente_id = p_origen;

  update public.reservas_clientes d set
    apellidos = coalesce(d.apellidos, v_o.apellidos),
    email = coalesce(d.email, v_o.email),
    telefono_adicional = coalesce(d.telefono_adicional, case when v_o.telefono <> d.telefono then v_o.telefono end),
    alergias = case when d.alergias is null then v_o.alergias
                    when v_o.alergias is null or v_o.alergias = d.alergias then d.alergias
                    else d.alergias || ' / ' || v_o.alergias end,
    notas = case when d.notas is null then v_o.notas
                 when v_o.notas is null or v_o.notas = d.notas then d.notas
                 else d.notas || E'\n' || v_o.notas end,
    vip = d.vip or v_o.vip,
    lista_negra = d.lista_negra or v_o.lista_negra,
    etiquetas = (select coalesce(array_agg(distinct e), '{}') from unnest(d.etiquetas || v_o.etiquetas) e),
    alergenos = (select coalesce(array_agg(distinct a), '{}') from unnest(d.alergenos || v_o.alergenos) a),
    consentimiento_marketing = d.consentimiento_marketing or v_o.consentimiento_marketing,
    consentimiento_en = coalesce(d.consentimiento_en, v_o.consentimiento_en),
    fecha_nacimiento = coalesce(d.fecha_nacimiento, v_o.fecha_nacimiento),
    empresa = coalesce(d.empresa, v_o.empresa),
    numero_socio = coalesce(d.numero_socio, v_o.numero_socio),
    prescriptor_id = coalesce(d.prescriptor_id, v_o.prescriptor_id),
    cliente_id = coalesce(d.cliente_id, v_o.cliente_id)
  where d.id = p_destino;

  delete from public.reservas_clientes where id = p_origen;
  return jsonb_build_object('ok', true, 'reservas_movidas', v_n, 'destino', p_destino);
end $$;
revoke execute on function public.reservas_fusionar_clientes(uuid, uuid) from anon, public;
grant execute on function public.reservas_fusionar_clientes(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.4 RESERVAS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.reservas_reservas
  add column if not exists zona_id                  uuid null references public.reservas_salas(id) on delete set null,
  add column if not exists tipo                     text not null default 'gratis',
  add column if not exists estado_pago              text not null default 'no_requerido',
  add column if not exists importe_garantia         numeric(10,2) null,
  add column if not exists importe_prepago          numeric(10,2) null,
  add column if not exists experiencia_id           uuid null references public.reservas_experiencias(id) on delete set null,
  add column if not exists idioma                   text not null default 'es',
  add column if not exists pais                     text null,
  add column if not exists etiquetas                uuid[] not null default '{}',
  add column if not exists prescriptor_id           uuid null references public.reservas_prescriptores(id) on delete set null,
  add column if not exists empresa                  text null,
  add column if not exists anotado_por              uuid null,
  add column if not exists referencia               text null,
  add column if not exists alergias                 text null,
  add column if not exists consentimiento_marketing boolean null,
  add column if not exists token                    text null default encode(extensions.gen_random_bytes(16), 'hex'),
  add column if not exists llegada_en               timestamptz null,
  add column if not exists sentada_en               timestamptz null,
  add column if not exists salida_en                timestamptz null,
  add column if not exists cancelada_en             timestamptz null,
  add column if not exists recordatorio_enviado_en  timestamptz null,
  add column if not exists reconfirmada_en          timestamptz null,
  add column if not exists cancelada_por            text null,
  add column if not exists motivo_cancelacion       text null,
  add column if not exists adjuntos                 jsonb not null default '[]',
  add column if not exists valoracion               integer null,
  add column if not exists valoracion_comentario    text null,
  add column if not exists valoracion_detalle       jsonb null,
  add column if not exists valoracion_en            timestamptz null,
  add column if not exists pax_llegados             integer null,
  add column if not exists camarero_id              uuid null references public.reservas_camareros(id) on delete set null,
  add column if not exists respuestas               jsonb not null default '{}',
  add column if not exists codigo_promo             text null,
  add column if not exists cover_id                 text null,
  add column if not exists notificar                boolean not null default false,
  add column if not exists tarjeta_solicitada_en    timestamptz null,
  add column if not exists creado_por               uuid null;

comment on column public.reservas_reservas.tipo is 'gratis · politica_cancelacion (token de tarjeta, cargo si no-show) · garantia (retención) · prepago (ticket) · experiencia.';
comment on column public.reservas_reservas.token is 'Enlace público de gestión /reserva/<token> (32 hex).';
comment on column public.reservas_reservas.valoracion_detalle is '{"comida":1-5,"atencion":1-5,"entorno":1-5,"nps":0-10}';
comment on column public.reservas_reservas.cover_id is 'Id de la reserva en CoverManager (re-importación idempotente).';
comment on column public.reservas_reservas.notificar is 'Default false: el panel solo avisa al cliente con «Reservar y notificar» / «Validar y notificar»; las online nacen con true. Cancelada, no_show y tarjeta_pendiente (Solicitar tarjeta) avisan siempre.';
comment on column public.reservas_reservas.tarjeta_solicitada_en is 'Cuándo se pidió la tarjeta (alta online o «Solicitar tarjeta» del panel); desde ahí cuenta tarjeta_caduca_min.';

-- Backfill del token (la columna nueva ya nace con default; esto cubre filas con null).
alter table public.reservas_reservas disable trigger trg_rsv_reservas_touch;
update public.reservas_reservas set token = encode(extensions.gen_random_bytes(16), 'hex') where token is null;
alter table public.reservas_reservas enable trigger trg_rsv_reservas_touch;

create unique index if not exists reservas_reservas_token_ux on public.reservas_reservas (token);
create unique index if not exists reservas_reservas_cover_id_ux on public.reservas_reservas (cuenta_id, cover_id) where cover_id is not null;
create index if not exists idx_reservas_reservas_estado_fecha on public.reservas_reservas (restaurante_id, estado, fecha);
create index if not exists idx_reservas_reservas_prescriptor on public.reservas_reservas (prescriptor_id);
create index if not exists idx_reservas_reservas_experiencia on public.reservas_reservas (experiencia_id);
create index if not exists idx_reservas_reservas_zona on public.reservas_reservas (zona_id);
create index if not exists idx_reservas_reservas_camarero on public.reservas_reservas (camarero_id);
create index if not exists idx_reservas_reservas_etiquetas on public.reservas_reservas using gin (etiquetas);

-- Checks ampliados (se conservan los 6 estados actuales).
alter table public.reservas_reservas drop constraint if exists reservas_reservas_estado_check;
alter table public.reservas_reservas add constraint reservas_reservas_estado_check
  check (estado in ('pendiente','confirmada','reconfirmada','llegada','sentada','postre','cuenta',
                    'terminada','no_show','cancelada','a_revisar','tarjeta_pendiente','lista_espera'));

alter table public.reservas_reservas drop constraint if exists reservas_reservas_origen_check;
alter table public.reservas_reservas add constraint reservas_reservas_origen_check
  check (origen in ('online','telefono','walkin','panel','importado','api'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservas_reservas_tipo_check') then
    alter table public.reservas_reservas add constraint reservas_reservas_tipo_check
      check (tipo in ('gratis','politica_cancelacion','garantia','prepago','experiencia'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservas_reservas_estado_pago_check') then
    alter table public.reservas_reservas add constraint reservas_reservas_estado_pago_check
      check (estado_pago in ('no_requerido','pendiente_tarjeta','garantizada','pagada','cobrado_noshow','devuelto','fallido'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservas_reservas_cancelada_por_check') then
    alter table public.reservas_reservas add constraint reservas_reservas_cancelada_por_check
      check (cancelada_por is null or cancelada_por in ('cliente','restaurante','sistema'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservas_reservas_valoracion_check') then
    alter table public.reservas_reservas add constraint reservas_reservas_valoracion_check
      check (valoracion is null or valoracion between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservas_reservas_pax_llegados_check') then
    alter table public.reservas_reservas add constraint reservas_reservas_pax_llegados_check
      check (pax_llegados is null or pax_llegados >= 0);
  end if;
end $$;

-- ─── reservas_reservas_historial: quién cambió qué ───────────────────────
create table if not exists public.reservas_reservas_historial (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null,
  reserva_id     uuid not null,
  restaurante_id uuid null,
  accion         text not null check (accion in ('insert', 'update', 'delete')),
  campos         text[] null,
  antes          jsonb null,
  despues        jsonb null,
  user_id        uuid null,
  ts             timestamptz not null default now()
);
create index if not exists idx_reservas_reservas_historial_reserva on public.reservas_reservas_historial (reserva_id, ts desc);
create index if not exists idx_reservas_reservas_historial_cuenta_ts on public.reservas_reservas_historial (cuenta_id, ts desc);
alter table public.reservas_reservas_historial enable row level security;
revoke all on public.reservas_reservas_historial from anon;
revoke insert, update, delete on public.reservas_reservas_historial from authenticated;
grant select on public.reservas_reservas_historial to authenticated;
revoke truncate, references, trigger on public.reservas_reservas_historial from authenticated;
drop policy if exists reservas_reservas_historial_lectura on public.reservas_reservas_historial;
create policy reservas_reservas_historial_lectura on public.reservas_reservas_historial
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()));

create or replace function public.reservas_reservas_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campos text[];
begin
  if tg_op = 'INSERT' then
    insert into public.reservas_reservas_historial (cuenta_id, reserva_id, restaurante_id, accion, campos, antes, despues, user_id)
    values (new.cuenta_id, new.id, new.restaurante_id, 'insert', null, null, to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_campos
    from jsonb_each(to_jsonb(new)) n
    where n.key <> 'actualizado_en' and n.value is distinct from (to_jsonb(old) -> n.key);
    if v_campos is null then return new; end if;
    insert into public.reservas_reservas_historial (cuenta_id, reserva_id, restaurante_id, accion, campos, antes, despues, user_id)
    values (new.cuenta_id, new.id, new.restaurante_id, 'update', v_campos, to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    insert into public.reservas_reservas_historial (cuenta_id, reserva_id, restaurante_id, accion, campos, antes, despues, user_id)
    values (old.cuenta_id, old.id, old.restaurante_id, 'delete', null, to_jsonb(old), null, auth.uid());
    return old;
  end if;
end $$;
revoke all on function public.reservas_reservas_log() from public, anon, authenticated;

-- ─── sellado de llegada / sentada / salida / cancelación ─────────────────
create or replace function public.reservas_reservas_sellar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    if new.estado = 'llegada' then
      new.llegada_en := coalesce(new.llegada_en, now());
    elsif new.estado in ('sentada', 'postre', 'cuenta') then
      new.sentada_en := coalesce(new.sentada_en, now());
      new.llegada_en := coalesce(new.llegada_en, new.sentada_en);
      if new.pax_llegados is null then new.pax_llegados := new.pax; end if;
    elsif new.estado = 'terminada' then
      new.salida_en := coalesce(new.salida_en, now());
    elsif new.estado = 'reconfirmada' then
      new.reconfirmada_en := coalesce(new.reconfirmada_en, now());
    elsif new.estado = 'tarjeta_pendiente' then
      new.tarjeta_solicitada_en := now(); -- «Solicitar tarjeta» desde el panel: la caducidad cuenta desde aquí
    elsif new.estado = 'cancelada' then
      new.cancelada_en := coalesce(new.cancelada_en, now());
      new.cancelada_por := coalesce(new.cancelada_por,
        case when auth.uid() is null then 'sistema' else 'restaurante' end);
    end if;
  end if;
  if new.valoracion is not null and old.valoracion is null and new.valoracion_en is null then
    new.valoracion_en := now();
  end if;
  return new;
end $$;
revoke all on function public.reservas_reservas_sellar() from public, anon, authenticated;

-- Los triggers se crean DESPUÉS del backfill del token (no generan historial de la migración).
drop trigger if exists trg_rsv_reservas_sellar on public.reservas_reservas;
create trigger trg_rsv_reservas_sellar
  before update on public.reservas_reservas
  for each row execute function public.reservas_reservas_sellar();

drop trigger if exists trg_rsv_reservas_log on public.reservas_reservas;
create trigger trg_rsv_reservas_log
  after insert or update or delete on public.reservas_reservas
  for each row execute function public.reservas_reservas_log();

-- ─── reservas_lista_espera: hora preferida, zona, email, token, aviso ────
alter table public.reservas_lista_espera
  add column if not exists hora_preferida time null,
  add column if not exists turno_id       uuid null references public.reservas_turnos(id) on delete set null,
  add column if not exists zona_id        uuid null references public.reservas_salas(id) on delete set null,
  add column if not exists email          text null,
  add column if not exists idioma         text not null default 'es',
  add column if not exists token          text null default encode(extensions.gen_random_bytes(16), 'hex'),
  add column if not exists avisado_en     timestamptz null,
  add column if not exists reserva_id     uuid null references public.reservas_reservas(id) on delete set null,
  add column if not exists cliente_id     uuid null references public.reservas_clientes(id) on delete set null;
update public.reservas_lista_espera set token = encode(extensions.gen_random_bytes(16), 'hex') where token is null;
create unique index if not exists reservas_lista_espera_token_ux on public.reservas_lista_espera (token);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.5 MENSAJERÍA
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── reservas_plantillas ─────────────────────────────────────────────────
-- restaurante_id null = plantilla por defecto de la cuenta. Placeholders: {{nombre}},
-- {{restaurante}}, {{fecha}}, {{hora}}, {{pax}}, {{localizador}}, {{enlace}}, {{enlace_cancelar}},
-- {{enlace_confirmar}}, {{enlace_pago}}, {{enlace_valorar}}, {{direccion}}, {{telefono}},
-- {{mensaje}}, {{importe}}, {{horas_politica}}, {{nombre_completo}}.
create table if not exists public.reservas_plantillas (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id uuid null references public.reservas_restaurantes(id) on delete cascade,
  canal          text not null check (canal in ('email', 'sms', 'whatsapp')),
  tipo           text not null,
  idioma         text not null default 'es',
  asunto         text null,
  cuerpo         text not null,
  activa         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
-- Tipos: los 10 del plan + invitacion + «confirmada» (el restaurante acepta una reserva
-- pendiente; «confirmacion» = hemos recibido tu reserva). Check fuera del create para poder ampliarlo.
alter table public.reservas_plantillas drop constraint if exists reservas_plantillas_tipo_check;
alter table public.reservas_plantillas add constraint reservas_plantillas_tipo_check
  check (tipo in ('confirmacion','confirmada','recordatorio','reconfirmacion','cancelacion','modificacion',
                  'lista_espera','valoracion','pago','garantia','noshow','invitacion'));
create unique index if not exists reservas_plantillas_ux
  on public.reservas_plantillas (cuenta_id, coalesce(restaurante_id, '00000000-0000-0000-0000-000000000000'::uuid), canal, tipo, idioma);
create index if not exists idx_reservas_plantillas_cuenta_id on public.reservas_plantillas (cuenta_id);
alter table public.reservas_plantillas enable row level security;
revoke all on public.reservas_plantillas from anon;
grant select, insert, update, delete on public.reservas_plantillas to authenticated;
revoke truncate, references, trigger on public.reservas_plantillas from authenticated;
drop policy if exists reservas_plantillas_acceso on public.reservas_plantillas;
create policy reservas_plantillas_acceso on public.reservas_plantillas
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- Seed Bonita: 12 tipos × es/en; el email lleva asunto + cuerpo largo, SMS y WhatsApp comparten
-- el cuerpo corto. Total 72 filas.
insert into public.reservas_plantillas (cuenta_id, restaurante_id, canal, tipo, idioma, asunto, cuerpo)
select '082c5366-d9ae-49b9-a8b8-8caad73985bd', null, c.canal, s.tipo, s.idioma,
       case when c.canal = 'email' then s.asunto end,
       case when c.canal = 'email' then s.cuerpo_email else s.cuerpo_corto end
from (values
  -- ── ES ──
  ('confirmacion', 'es',
   'Tu reserva en {{restaurante}} · {{fecha}} {{hora}} · {{localizador}}',
   E'Hola {{nombre}},\n\nHemos recibido tu reserva en {{restaurante}}: {{pax}} personas el {{fecha}} a las {{hora}}.\nLocalizador: {{localizador}}\n\n{{mensaje}}\n\nPuedes ver, modificar o cancelar tu reserva aquí: {{enlace}}\n\n{{direccion}}\n{{telefono}}\n\n¡Te esperamos!',
   'Reserva en {{restaurante}}: {{pax}} pers. el {{fecha}} a las {{hora}}. Loc. {{localizador}}. Gestiona tu reserva: {{enlace}}'),
  ('confirmada', 'es',
   'Tu reserva en {{restaurante}} está confirmada · {{fecha}} {{hora}}',
   E'Hola {{nombre}},\n\nTu reserva en {{restaurante}} está confirmada: {{pax}} personas el {{fecha}} a las {{hora}}.\nLocalizador: {{localizador}}\n\n{{mensaje}}\n\nPuedes ver, modificar o cancelar tu reserva aquí: {{enlace}}\n\n{{direccion}}\n{{telefono}}\n\n¡Te esperamos!',
   '{{restaurante}}: reserva confirmada, {{pax}} pers. el {{fecha}} a las {{hora}} ({{localizador}}). Gestiona tu reserva: {{enlace}}'),
  ('recordatorio', 'es',
   'Te esperamos mañana en {{restaurante}} · {{hora}}',
   E'Hola {{nombre}},\n\nTe recordamos tu reserva en {{restaurante}}: {{pax}} personas el {{fecha}} a las {{hora}}.\n\nConfirmar asistencia: {{enlace_confirmar}}\nNo podré ir: {{enlace_cancelar}}\n\nSi llegas con retraso, avísanos al {{telefono}}.\n\n¡Hasta mañana!',
   'Recordatorio {{restaurante}}: {{pax}} pers. el {{fecha}} a las {{hora}}. Confirma: {{enlace_confirmar}} · Cancela: {{enlace_cancelar}}'),
  ('reconfirmacion', 'es',
   '¿Mantienes tu reserva en {{restaurante}}? · {{fecha}} {{hora}}',
   E'Hola {{nombre}},\n\nNecesitamos que nos confirmes tu reserva en {{restaurante}} ({{pax}} personas, {{fecha}} a las {{hora}}).\n\nSí, mantengo la reserva: {{enlace_confirmar}}\nNo podré ir: {{enlace_cancelar}}\n\nSi no recibimos respuesta, es posible que liberemos la mesa.\n\nGracias.',
   '{{restaurante}}: ¿mantienes tu reserva de {{pax}} pers. el {{fecha}} a las {{hora}}? Sí: {{enlace_confirmar}} · No: {{enlace_cancelar}}'),
  ('cancelacion', 'es',
   'Reserva cancelada · {{restaurante}} · {{localizador}}',
   E'Hola {{nombre}},\n\nConfirmamos la cancelación de tu reserva en {{restaurante}} del {{fecha}} a las {{hora}} ({{pax}} personas), localizador {{localizador}}.\n\nEsperamos verte en otra ocasión: {{enlace}}\n\n{{telefono}}',
   '{{restaurante}}: tu reserva del {{fecha}} a las {{hora}} ({{localizador}}) ha quedado cancelada. Volver a reservar: {{enlace}}'),
  ('modificacion', 'es',
   'Reserva actualizada · {{restaurante}} · {{fecha}} {{hora}}',
   E'Hola {{nombre}},\n\nTu reserva en {{restaurante}} ha quedado así: {{pax}} personas el {{fecha}} a las {{hora}}. Localizador: {{localizador}}.\n\nVer o cambiar: {{enlace}}\n\n¡Te esperamos!',
   '{{restaurante}}: reserva actualizada → {{pax}} pers. el {{fecha}} a las {{hora}} ({{localizador}}). Ver: {{enlace}}'),
  ('lista_espera', 'es',
   '¡Hay mesa en {{restaurante}}! · {{fecha}} {{hora}}',
   E'Hola {{nombre}},\n\nSe ha liberado una mesa en {{restaurante}} para {{pax}} personas el {{fecha}} a las {{hora}}.\n\nResérvala ahora (tienes poco tiempo, la ofrecemos a los siguientes de la lista): {{enlace}}\n\n{{telefono}}',
   '¡Hay mesa en {{restaurante}}! {{pax}} pers. el {{fecha}} a las {{hora}}. Resérvala ya: {{enlace}}'),
  ('valoracion', 'es',
   '¿Qué tal en {{restaurante}}?',
   E'Hola {{nombre}},\n\nGracias por visitarnos en {{restaurante}}. Nos ayudaría mucho saber qué tal ha ido: te llevará menos de un minuto.\n\nValorar mi visita: {{enlace_valorar}}\n\n¡Hasta pronto!',
   'Gracias por venir a {{restaurante}}, {{nombre}}. ¿Nos cuentas qué tal? {{enlace_valorar}}'),
  ('pago', 'es',
   'Completa el pago de tu reserva · {{restaurante}} · {{localizador}}',
   E'Hola {{nombre}},\n\nPara confirmar tu reserva en {{restaurante}} ({{pax}} personas, {{fecha}} a las {{hora}}) falta completar el pago de {{importe}} €.\n\nPagar ahora: {{enlace_pago}}\n\nSi no se completa, la reserva se liberará automáticamente.\n\n{{telefono}}',
   '{{restaurante}}: completa el pago de {{importe}} € para confirmar tu reserva del {{fecha}} a las {{hora}}: {{enlace_pago}}'),
  ('garantia', 'es',
   'Asegura tu reserva con tarjeta · {{restaurante}} · {{localizador}}',
   E'Hola {{nombre}},\n\nPara reservas de {{pax}} personas pedimos una tarjeta de garantía. No se te cobrará nada ahora: solo {{importe}} € en caso de no presentarte o cancelar con menos de {{horas_politica}} horas.\n\nIntroducir tarjeta: {{enlace_pago}}\n\nSi no se completa, la reserva se liberará automáticamente.\n\n{{telefono}}',
   '{{restaurante}}: asegura tu reserva del {{fecha}} a las {{hora}} con tarjeta (sin cargo salvo no-show): {{enlace_pago}}'),
  ('noshow', 'es',
   'Te hemos echado de menos en {{restaurante}}',
   E'Hola {{nombre}},\n\nTeníamos tu mesa preparada el {{fecha}} a las {{hora}} en {{restaurante}} y no pudimos verte. Si ha sido un error, escríbenos.\n\nNos encantará recibirte otro día: {{enlace}}\n\n{{telefono}}',
   '{{restaurante}}: te esperábamos el {{fecha}} a las {{hora}}. ¿Reservamos otro día? {{enlace}}'),
  ('invitacion', 'es',
   '{{nombre}} te invita a {{restaurante}} · {{fecha}} {{hora}}',
   E'Hola,\n\n{{nombre}} ha reservado mesa en {{restaurante}} para {{pax}} personas el {{fecha}} a las {{hora}} y quiere que vengas.\n\n{{mensaje}}\n\nDónde estamos: {{direccion}}\n{{telefono}}',
   '{{nombre}} te invita a {{restaurante}} el {{fecha}} a las {{hora}}. {{mensaje}} {{direccion}}'),
  -- ── EN ──
  ('confirmacion', 'en',
   'Your booking at {{restaurante}} · {{fecha}} {{hora}} · {{localizador}}',
   E'Hi {{nombre}},\n\nWe have received your booking at {{restaurante}}: {{pax}} guests on {{fecha}} at {{hora}}.\nBooking code: {{localizador}}\n\n{{mensaje}}\n\nView, change or cancel your booking here: {{enlace}}\n\n{{direccion}}\n{{telefono}}\n\nSee you soon!',
   'Booking at {{restaurante}}: {{pax}} guests on {{fecha}} at {{hora}}. Code {{localizador}}. Manage it: {{enlace}}'),
  ('confirmada', 'en',
   'Your booking at {{restaurante}} is confirmed · {{fecha}} {{hora}}',
   E'Hi {{nombre}},\n\nYour booking at {{restaurante}} is confirmed: {{pax}} guests on {{fecha}} at {{hora}}.\nBooking code: {{localizador}}\n\n{{mensaje}}\n\nView, change or cancel your booking here: {{enlace}}\n\n{{direccion}}\n{{telefono}}\n\nSee you soon!',
   '{{restaurante}}: booking confirmed, {{pax}} guests on {{fecha}} at {{hora}} ({{localizador}}). Manage it: {{enlace}}'),
  ('recordatorio', 'en',
   'See you tomorrow at {{restaurante}} · {{hora}}',
   E'Hi {{nombre}},\n\nA reminder of your booking at {{restaurante}}: {{pax}} guests on {{fecha}} at {{hora}}.\n\nConfirm: {{enlace_confirmar}}\nI can''t make it: {{enlace_cancelar}}\n\nRunning late? Call us on {{telefono}}.\n\nSee you tomorrow!',
   'Reminder {{restaurante}}: {{pax}} guests on {{fecha}} at {{hora}}. Confirm: {{enlace_confirmar}} · Cancel: {{enlace_cancelar}}'),
  ('reconfirmacion', 'en',
   'Are you keeping your booking at {{restaurante}}? · {{fecha}} {{hora}}',
   E'Hi {{nombre}},\n\nPlease confirm your booking at {{restaurante}} ({{pax}} guests, {{fecha}} at {{hora}}).\n\nYes, I''m coming: {{enlace_confirmar}}\nI can''t make it: {{enlace_cancelar}}\n\nIf we don''t hear from you we may release the table.\n\nThank you.',
   '{{restaurante}}: are you keeping your booking for {{pax}} on {{fecha}} at {{hora}}? Yes: {{enlace_confirmar}} · No: {{enlace_cancelar}}'),
  ('cancelacion', 'en',
   'Booking cancelled · {{restaurante}} · {{localizador}}',
   E'Hi {{nombre}},\n\nYour booking at {{restaurante}} on {{fecha}} at {{hora}} ({{pax}} guests), code {{localizador}}, has been cancelled.\n\nWe hope to see you another time: {{enlace}}\n\n{{telefono}}',
   '{{restaurante}}: your booking on {{fecha}} at {{hora}} ({{localizador}}) has been cancelled. Book again: {{enlace}}'),
  ('modificacion', 'en',
   'Booking updated · {{restaurante}} · {{fecha}} {{hora}}',
   E'Hi {{nombre}},\n\nYour booking at {{restaurante}} is now: {{pax}} guests on {{fecha}} at {{hora}}. Code: {{localizador}}.\n\nView or change: {{enlace}}\n\nSee you soon!',
   '{{restaurante}}: booking updated → {{pax}} guests on {{fecha}} at {{hora}} ({{localizador}}). View: {{enlace}}'),
  ('lista_espera', 'en',
   'A table is free at {{restaurante}}! · {{fecha}} {{hora}}',
   E'Hi {{nombre}},\n\nA table for {{pax}} has just become available at {{restaurante}} on {{fecha}} at {{hora}}.\n\nBook it now (it will be offered to the next person on the list shortly): {{enlace}}\n\n{{telefono}}',
   'A table is free at {{restaurante}}! {{pax}} guests on {{fecha}} at {{hora}}. Book it now: {{enlace}}'),
  ('valoracion', 'en',
   'How was {{restaurante}}?',
   E'Hi {{nombre}},\n\nThank you for visiting {{restaurante}}. We would love to know how it went: it takes less than a minute.\n\nRate my visit: {{enlace_valorar}}\n\nSee you soon!',
   'Thanks for visiting {{restaurante}}, {{nombre}}. How was it? {{enlace_valorar}}'),
  ('pago', 'en',
   'Complete the payment for your booking · {{restaurante}} · {{localizador}}',
   E'Hi {{nombre}},\n\nTo confirm your booking at {{restaurante}} ({{pax}} guests, {{fecha}} at {{hora}}) a payment of {{importe}} € is required.\n\nPay now: {{enlace_pago}}\n\nIf the payment is not completed the booking will be released automatically.\n\n{{telefono}}',
   '{{restaurante}}: complete the payment of {{importe}} € to confirm your booking on {{fecha}} at {{hora}}: {{enlace_pago}}'),
  ('garantia', 'en',
   'Secure your booking with a card · {{restaurante}} · {{localizador}}',
   E'Hi {{nombre}},\n\nFor bookings of {{pax}} guests we ask for a card guarantee. Nothing is charged now: only {{importe}} € in case of no-show or cancellation with less than {{horas_politica}} hours notice.\n\nAdd card: {{enlace_pago}}\n\nIf this step is not completed the booking will be released automatically.\n\n{{telefono}}',
   '{{restaurante}}: secure your booking on {{fecha}} at {{hora}} with a card (no charge unless no-show): {{enlace_pago}}'),
  ('noshow', 'en',
   'We missed you at {{restaurante}}',
   E'Hi {{nombre}},\n\nYour table was ready on {{fecha}} at {{hora}} at {{restaurante}} and we did not see you. If this was a mistake, please let us know.\n\nWe would love to welcome you another day: {{enlace}}\n\n{{telefono}}',
   '{{restaurante}}: we were expecting you on {{fecha}} at {{hora}}. Shall we book another day? {{enlace}}'),
  ('invitacion', 'en',
   '{{nombre}} invites you to {{restaurante}} · {{fecha}} {{hora}}',
   E'Hi,\n\n{{nombre}} has booked a table at {{restaurante}} for {{pax}} guests on {{fecha}} at {{hora}} and would like you to join.\n\n{{mensaje}}\n\nWhere we are: {{direccion}}\n{{telefono}}',
   '{{nombre}} invites you to {{restaurante}} on {{fecha}} at {{hora}}. {{mensaje}} {{direccion}}')
) as s(tipo, idioma, asunto, cuerpo_email, cuerpo_corto)
cross join (values ('email'), ('sms'), ('whatsapp')) as c(canal)
where not exists (
  select 1 from public.reservas_plantillas p
  where p.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and p.restaurante_id is null
    and p.canal = c.canal and p.tipo = s.tipo and p.idioma = s.idioma
);

-- ─── reservas_mensajes: todo envío (email / sms / whatsapp) ──────────────
create table if not exists public.reservas_mensajes (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id  uuid null references public.reservas_restaurantes(id) on delete set null,
  reserva_id      uuid null references public.reservas_reservas(id) on delete set null,
  cliente_id      uuid null references public.reservas_clientes(id) on delete set null,
  lista_espera_id uuid null references public.reservas_lista_espera(id) on delete set null,
  canal           text not null check (canal in ('email', 'sms', 'whatsapp')),
  tipo            text not null,
  destinatario    text not null,
  asunto          text null,
  cuerpo          text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente','enviado','entregado','abierto','error','sin_proveedor','cancelado')),
  proveedor       text null,
  proveedor_id    text null,
  error           text null,
  intentos        integer not null default 0,
  programado_para timestamptz not null default now(),
  enviado_en      timestamptz null,
  creado_por      uuid null,
  creado_en       timestamptz not null default now()
);
alter table public.reservas_mensajes drop constraint if exists reservas_mensajes_tipo_check;
alter table public.reservas_mensajes add constraint reservas_mensajes_tipo_check
  check (tipo in ('confirmacion','confirmada','recordatorio','reconfirmacion','cancelacion','modificacion',
                  'lista_espera','valoracion','pago','garantia','noshow','invitacion','manual'));
create index if not exists idx_reservas_mensajes_cuenta_id on public.reservas_mensajes (cuenta_id);
create index if not exists idx_reservas_mensajes_estado_prog on public.reservas_mensajes (estado, programado_para);
create index if not exists idx_reservas_mensajes_reserva on public.reservas_mensajes (reserva_id);
create index if not exists idx_reservas_mensajes_cliente on public.reservas_mensajes (cliente_id);
-- Un solo pendiente por reserva, canal y tipo (evita duplicar recordatorios al reprogramar).
create unique index if not exists reservas_mensajes_pendiente_ux
  on public.reservas_mensajes (reserva_id, canal, tipo)
  where estado = 'pendiente' and reserva_id is not null and tipo not in ('manual', 'invitacion');
alter table public.reservas_mensajes enable row level security;
revoke all on public.reservas_mensajes from anon;
grant select, insert, update, delete on public.reservas_mensajes to authenticated;
revoke truncate, references, trigger on public.reservas_mensajes from authenticated;
-- Escritura: además de la cuenta, la reserva / el cliente / la lista de espera referenciados
-- tienen que ser de esa misma cuenta (coherencia; el cron envía lo que haya en la tabla).
drop policy if exists reservas_mensajes_acceso on public.reservas_mensajes;
create policy reservas_mensajes_acceso on public.reservas_mensajes
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (
    (cuenta_id = (select cuenta_actual()) or (select es_operador()))
    and (reserva_id is null or exists (select 1 from public.reservas_reservas r where r.id = reserva_id and r.cuenta_id = reservas_mensajes.cuenta_id))
    and (cliente_id is null or exists (select 1 from public.reservas_clientes c where c.id = cliente_id and c.cuenta_id = reservas_mensajes.cuenta_id))
    and (lista_espera_id is null or exists (select 1 from public.reservas_lista_espera l where l.id = lista_espera_id and l.cuenta_id = reservas_mensajes.cuenta_id))
  );

-- ─── reservas_mensaje_encolar: compone y encola un mensaje de una reserva ──
-- Elige plantilla (restaurante → cuenta; idioma → 'es'), rellena placeholders y respeta los
-- canales activos del restaurante. Si no hay destinatario o plantilla, no hace nada.
create or replace function public.reservas_mensaje_encolar(
  p_reserva_id uuid,
  p_tipo text,
  p_programado timestamptz default now(),
  p_mensaje_extra text default null,
  p_destinatario_email text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.reservas_reservas%rowtype;
  v_rest public.reservas_restaurantes%rowtype;
  v_cli public.reservas_clientes%rowtype;
  v_canal text;
  v_pl record;
  v_vars jsonb;
  v_dest text;
  v_url text;
  v_idioma text;
  v_n integer := 0;
  v_importe numeric;
begin
  select * into v_r from public.reservas_reservas where id = p_reserva_id;
  if not found then return 0; end if;
  -- Cinturón: con sesión, solo reservas de la propia cuenta (la función es definer y no se
  -- concede a authenticated, pero por si acaso).
  if auth.uid() is not null and not (v_r.cuenta_id = cuenta_actual() or es_operador()) then
    return 0;
  end if;
  select * into v_rest from public.reservas_restaurantes where id = v_r.restaurante_id;
  if not found then return 0; end if;
  if v_r.cliente_id is not null then
    select * into v_cli from public.reservas_clientes where id = v_r.cliente_id;
  end if;

  v_url := reservas_url_base(v_rest.id);
  v_idioma := coalesce(nullif(v_r.idioma, ''), nullif(v_cli.idioma, ''), 'es');
  v_importe := case v_r.tipo
                 when 'prepago' then v_r.importe_prepago
                 when 'experiencia' then v_r.importe_prepago
                 when 'garantia' then v_r.importe_garantia
                 when 'politica_cancelacion' then v_r.importe_garantia
                 else null end;
  v_vars := jsonb_build_object(
    'nombre', split_part(btrim(coalesce(v_cli.nombre, '')), ' ', 1),
    'nombre_completo', btrim(concat_ws(' ', v_cli.nombre, v_cli.apellidos)),
    'restaurante', v_rest.nombre,
    'fecha', to_char(v_r.fecha, 'DD/MM/YYYY'),
    'hora', to_char(v_r.hora, 'HH24:MI'),
    'pax', v_r.pax::text,
    'localizador', v_r.localizador,
    'enlace', v_url || '/reserva/' || v_r.token,
    'enlace_cancelar', v_url || '/reserva/' || v_r.token || '?accion=cancelar',
    'enlace_confirmar', v_url || '/reserva/' || v_r.token || '?accion=confirmar',
    'enlace_pago', v_url || '/reserva/' || v_r.token || '/pago',
    'enlace_valorar', v_url || '/valorar/' || v_r.token,
    'direccion', coalesce(v_rest.direccion, v_rest.ubicacion, ''),
    'telefono', coalesce(v_rest.telefono, ''),
    'mensaje', coalesce(p_mensaje_extra, v_rest.mensaje_widget, ''),
    'importe', coalesce(to_char(v_importe, 'FM999990.00'), ''),
    'horas_politica', v_rest.politica_cancelacion_horas::text
  );

  foreach v_canal in array array['email', 'sms', 'whatsapp'] loop
    if v_canal = 'email' then
      if not v_rest.envio_email then continue; end if;
      v_dest := coalesce(reservas_norm_email(p_destinatario_email), reservas_norm_email(v_cli.email));
    elsif v_canal = 'sms' then
      -- SMS solo cuando no hay WhatsApp (Cover usa WhatsApp con SMS de respaldo: el cron
      -- reintenta por SMS si el envío de WhatsApp devuelve error).
      if not v_rest.envio_sms or v_rest.envio_whatsapp or p_destinatario_email is not null then continue; end if;
      v_dest := nullif(coalesce(v_cli.telefono_norm, reservas_norm_tel(v_cli.telefono)), '');
    else
      if not v_rest.envio_whatsapp or p_destinatario_email is not null then continue; end if;
      v_dest := nullif(coalesce(v_cli.telefono_norm, reservas_norm_tel(v_cli.telefono)), '');
    end if;
    if v_dest is null then continue; end if;

    select p.* into v_pl
    from public.reservas_plantillas p
    where p.cuenta_id = v_r.cuenta_id and p.activa and p.canal = v_canal and p.tipo = p_tipo
      and (p.restaurante_id = v_rest.id or p.restaurante_id is null)
      and p.idioma in (v_idioma, 'es')
    order by (p.restaurante_id is not null) desc, (p.idioma = v_idioma) desc
    limit 1;
    if not found then continue; end if;

    insert into public.reservas_mensajes
      (cuenta_id, restaurante_id, reserva_id, cliente_id, canal, tipo, destinatario, asunto, cuerpo, programado_para)
    select v_r.cuenta_id, v_rest.id, v_r.id, v_r.cliente_id, v_canal, p_tipo, v_dest,
           nullif(reservas_renderizar(v_pl.asunto, v_vars), ''), reservas_renderizar(v_pl.cuerpo, v_vars),
           greatest(coalesce(p_programado, now()), now())
    where not exists (
      select 1 from public.reservas_mensajes m
      where m.reserva_id = v_r.id and m.canal = v_canal and m.tipo = p_tipo
        and m.estado = 'pendiente' and p_tipo not in ('manual', 'invitacion')
    )
    on conflict do nothing; -- dos updates concurrentes de la misma reserva: el índice parcial no tumba la reserva
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
-- Interna (la llaman programar_mensajes y el servidor): nunca desde el panel.
revoke execute on function public.reservas_mensaje_encolar(uuid, text, timestamptz, text, text) from anon, public, authenticated;

-- ─── reservas_programar_mensajes(reserva_id, evento) ─────────────────────
-- Según restaurante y estado: confirmación (ahora), recordatorio (fecha − recordatorio_horas),
-- reconfirmación (fecha − reconfirmacion_horas, solo tipo con política/garantía/prepago o pax ≥ 6),
-- valoración (fin + valoracion_horas, solo cuando el cliente ha venido). Cancela los pendientes
-- al cancelar / no-show.
-- p_evento:
--   'alta'         → alta de la reserva (o tarjeta_pendiente → pendiente tras meter la tarjeta):
--                    «hemos recibido tu reserva» (confirmacion) o, si nace confirmada, «confirmada».
--   'confirmada'   → el restaurante acepta (pendiente/tarjeta_pendiente → confirmada): «confirmada».
--   'modificacion' → cambió fecha, hora o pax: aviso + reprogramar pendientes.
--   null           → otro cambio de estado: solo reprograma recordatorio/reconfirmación/valoración.
create or replace function public.reservas_programar_mensajes(p_reserva_id uuid, p_evento text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.reservas_reservas%rowtype;
  v_rest public.reservas_restaurantes%rowtype;
  v_ini timestamptz;
  v_fin timestamptz;
  v_n integer := 0;
  v_cancelados integer := 0;
begin
  select * into v_r from public.reservas_reservas where id = p_reserva_id;
  if not found then return jsonb_build_object('error', 'RESERVA_NO_ENCONTRADA'); end if;
  -- Llamada desde el panel (sesión): solo reservas de la propia cuenta.
  if auth.uid() is not null and not (v_r.cuenta_id = cuenta_actual() or es_operador()) then
    return jsonb_build_object('error', 'SIN_PERMISO');
  end if;
  select * into v_rest from public.reservas_restaurantes where id = v_r.restaurante_id;

  v_ini := reservas_ts(v_r.fecha, v_r.hora, v_rest.zona_horaria);
  v_fin := v_ini + make_interval(mins => coalesce(v_r.duracion_min, 120));

  -- 1) Cancelada / no-show / lista de espera: fuera los pendientes. Solo se avisa de reservas
  --    vivas (fecha futura; la re-importación de Cover cambia estados de miles de reservas
  --    históricas y además el trigger no llama aquí para 'importado' sin sesión) y no cuando la
  --    canceló el sistema por no meter la tarjeta (el cliente no «pidió» esa cancelación). Una
  --    reserva futura importada de Cover que Sonia cancele desde el panel SÍ avisa.
  if v_r.estado in ('cancelada', 'no_show') then
    update public.reservas_mensajes set estado = 'cancelado'
    where reserva_id = v_r.id and estado = 'pendiente' and tipo <> 'manual';
    get diagnostics v_cancelados = row_count;
    if v_r.estado = 'cancelada' and v_r.origen <> 'walkin' and v_ini > now()
       and not (coalesce(v_r.cancelada_por, '') = 'sistema' and v_r.estado_pago = 'pendiente_tarjeta') then
      v_n := v_n + reservas_mensaje_encolar(v_r.id, 'cancelacion', now());
    elsif v_r.estado = 'no_show' and v_rest.envio_noshow and v_r.origen <> 'walkin'
       and v_ini > now() - interval '2 days' then
      v_n := v_n + reservas_mensaje_encolar(v_r.id, 'noshow', now());
    end if;
    return jsonb_build_object('ok', true, 'encolados', v_n, 'cancelados', v_cancelados);
  end if;
  if v_r.estado = 'lista_espera' then
    return jsonb_build_object('ok', true, 'encolados', 0);
  end if;

  -- 2) Tarjeta pendiente: solo el aviso de pago / garantía (reservas futuras). Si ya no lo está
  --    (el servidor completó Redsys), el aviso que quedara pendiente se cancela para que el cron
  --    no lo mande.
  if v_r.estado = 'tarjeta_pendiente' then
    if v_ini > now() then
      v_n := v_n + reservas_mensaje_encolar(v_r.id, case when v_r.tipo in ('prepago', 'experiencia') then 'pago' else 'garantia' end, now());
    end if;
    return jsonb_build_object('ok', true, 'encolados', v_n);
  end if;
  update public.reservas_mensajes set estado = 'cancelado'
  where reserva_id = v_r.id and estado = 'pendiente' and tipo in ('garantia', 'pago');

  -- 3) Modificación de fecha/hora/pax: aviso + reprogramar los pendientes.
  if p_evento = 'modificacion' then
    update public.reservas_mensajes set estado = 'cancelado'
    where reserva_id = v_r.id and estado = 'pendiente' and tipo in ('recordatorio', 'reconfirmacion', 'valoracion');
    if v_r.origen <> 'walkin' then
      v_n := v_n + reservas_mensaje_encolar(v_r.id, 'modificacion', now());
    end if;
  end if;

  -- 4) Alta («hemos recibido tu reserva», o «confirmada» si nace confirmada) y aceptación por el
  --    restaurante («tu reserva está confirmada»). Solo con esos eventos: un cambio de estado de
  --    una reserva heredada o una modificación nunca disparan la confirmación.
  if v_r.origen <> 'walkin' and v_r.estado in ('pendiente', 'confirmada', 'reconfirmada')
     and p_evento in ('alta', 'confirmada') then
    if p_evento = 'confirmada' or v_r.estado = 'confirmada' then
      update public.reservas_mensajes set estado = 'cancelado'
      where reserva_id = v_r.id and estado = 'pendiente' and tipo = 'confirmacion';
      v_n := v_n + reservas_mensaje_encolar(v_r.id, 'confirmada', now());
    else
      v_n := v_n + reservas_mensaje_encolar(v_r.id, 'confirmacion', now());
    end if;
  end if;

  -- 5) Recordatorio y reconfirmación (solo si quedan en el futuro y la reserva aún no ha llegado).
  if v_r.origen <> 'walkin' and v_r.estado in ('pendiente', 'confirmada', 'reconfirmada') then
    if v_ini - make_interval(hours => v_rest.recordatorio_horas) > now() + interval '15 minutes' then
      v_n := v_n + reservas_mensaje_encolar(v_r.id, 'recordatorio', v_ini - make_interval(hours => v_rest.recordatorio_horas));
    end if;
    if v_r.estado <> 'reconfirmada' and (v_r.tipo <> 'gratis' or v_r.pax >= 6)
       and v_ini - make_interval(hours => v_rest.reconfirmacion_horas) > now() + interval '15 minutes' then
      v_n := v_n + reservas_mensaje_encolar(v_r.id, 'reconfirmacion', v_ini - make_interval(hours => v_rest.reconfirmacion_horas));
    end if;
  end if;

  -- 6) Valoración tras la visita: solo cuando el cliente ha venido de verdad (estado de visita;
  --    el trigger reprograma al pasar a llegada/sentada). En locales con noshow_automatico = false
  --    (no marcan llegadas) vale la asistencia presunta: confirmada/reconfirmada. Antes se
  --    encolaba para cualquier reserva viva y «¿qué tal?» llegaba horas antes del no-show automático.
  --    El cron, antes de enviar una 'valoracion', comprueba que la reserva sigue en un estado válido.
  if (v_r.estado = any(reservas_estados_visita())
      or (v_r.estado in ('confirmada', 'reconfirmada') and not v_rest.noshow_automatico))
     and v_r.valoracion is null and v_fin + make_interval(hours => v_rest.valoracion_horas) > now() - interval '1 day' then
    v_n := v_n + reservas_mensaje_encolar(v_r.id, 'valoracion', greatest(v_fin + make_interval(hours => v_rest.valoracion_horas), now()));
  end if;

  return jsonb_build_object('ok', true, 'encolados', v_n);
end $$;
revoke execute on function public.reservas_programar_mensajes(uuid, text) from anon, public;
grant execute on function public.reservas_programar_mensajes(uuid, text) to authenticated;

-- ─── trigger reservas_encolar_email → programar_mensajes ─────────────────
-- Conserva el nombre (triggers trg_rsv_email_ins / trg_rsv_email_upd) pero ya no escribe en
-- reservas_emails_salientes. Insert: solo si notificar (default false; las online nacen con
-- true); walk-in nunca. Update: cambio de estado, fecha, hora o pax (las dos comprobaciones son
-- independientes: mover y cancelar en el mismo update manda la cancelación). Cancelada, no_show
-- y tarjeta_pendiente («Solicitar tarjeta») avisan aunque notificar = false: pedir la tarjeta o
-- cancelar sin decírselo al cliente no tiene sentido. Importaciones (origen 'importado' sin
-- sesión = script) no encolan nada. Cualquier error de la mensajería se registra como warning y
-- NUNCA tumba la reserva.
create or replace function public.reservas_encolar_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evento text;
begin
  if tg_op = 'INSERT' then
    if new.origen in ('walkin', 'importado') then return new; end if;
    -- Importación de Cover (cargar-cover-tracking.mjs: service key sin sesión, filas con cover_id;
    -- conservan su origen real online/panel/walkin): nunca encola nada.
    if new.cover_id is not null and auth.uid() is null then return new; end if;
    -- notificar = false: «Reservar» sin avisar (panel) o importaciones masivas.
    if not coalesce(new.notificar, false) then return new; end if;
    begin
      perform reservas_programar_mensajes(new.id, 'alta');
    exception when others then
      raise warning 'reservas_encolar_email: % (reserva %)', sqlerrm, new.id;
    end;
    return new;
  end if;

  -- Script de re-importación (service key, sin sesión) sobre reservas importadas de Cover: nada.
  -- Desde el panel (con sesión) una reserva importada avisa como cualquier otra.
  if (new.origen = 'importado' or new.cover_id is not null) and auth.uid() is null then return new; end if;

  if (new.fecha <> old.fecha or new.hora <> old.hora or new.pax <> old.pax)
     and coalesce(new.notificar, false) and new.estado not in ('cancelada', 'no_show') then
    begin
      perform reservas_programar_mensajes(new.id, 'modificacion');
    exception when others then
      raise warning 'reservas_encolar_email: % (reserva %)', sqlerrm, new.id;
    end;
  end if;

  if new.estado is distinct from old.estado
     and (coalesce(new.notificar, false) or new.estado in ('cancelada', 'no_show', 'tarjeta_pendiente')) then
    v_evento := case
      when new.estado = 'confirmada' and old.estado in ('pendiente', 'tarjeta_pendiente') then 'confirmada'
      when new.estado = 'pendiente' and old.estado = 'tarjeta_pendiente' then 'alta'
      else null end;
    begin
      perform reservas_programar_mensajes(new.id, v_evento);
    exception when others then
      raise warning 'reservas_encolar_email: % (reserva %)', sqlerrm, new.id;
    end;
  end if;
  return new;
end $$;
revoke all on function public.reservas_encolar_email() from public, anon, authenticated;

drop trigger if exists trg_rsv_email_ins on public.reservas_reservas;
create trigger trg_rsv_email_ins
  after insert on public.reservas_reservas
  for each row execute function public.reservas_encolar_email();

drop trigger if exists trg_rsv_email_upd on public.reservas_reservas;
create trigger trg_rsv_email_upd
  after update of estado, fecha, hora, pax on public.reservas_reservas
  for each row execute function public.reservas_encolar_email();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.6 PAGOS (garantía y prepago por Redsys)
-- ═══════════════════════════════════════════════════════════════════════════
-- Flujo (lo ejecuta el servidor, lib/redsys.ts): garantía = operación de 0 € con
-- DS_MERCHANT_IDENTIFIER=REQUIRED + COF_INI=S / COF_TYPE=C (guarda identificador_cof);
-- cargo no-show = REST trataPeticionREST con DS_MERCHANT_IDENTIFIER=<ref>, DIRECTPAYMENT=true,
-- COF_INI=N, COF_TXNID; prepago = redirección normal (como Visitas); devolución = tipo 3 por REST.
create table if not exists public.reservas_pagos (
  id                uuid primary key default gen_random_uuid(),
  cuenta_id         uuid not null default cuenta_actual() references public.cuentas(id),
  restaurante_id    uuid not null references public.reservas_restaurantes(id),
  reserva_id        uuid not null references public.reservas_reservas(id),
  tipo              text not null check (tipo in ('garantia', 'prepago', 'cargo_noshow', 'devolucion')),
  importe           numeric(10,2) not null default 0,
  moneda            text not null default 'EUR',
  estado            text not null default 'iniciado' check (estado in ('iniciado','autorizado','cobrado','devuelto','fallido','cancelado')),
  ds_order          text null,
  autorizacion      text null,
  identificador_cof text null,
  cof_txnid         text null,
  tarjeta_mascara   text null,
  tarjeta_caducidad text null,
  respuesta         jsonb null,
  pago_origen_id    uuid null references public.reservas_pagos(id),
  creado_por        uuid null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);
create unique index if not exists reservas_pagos_ds_order_ux on public.reservas_pagos (ds_order) where ds_order is not null;
create index if not exists idx_reservas_pagos_cuenta_id on public.reservas_pagos (cuenta_id);
create index if not exists idx_reservas_pagos_reserva on public.reservas_pagos (reserva_id);
create index if not exists idx_reservas_pagos_rest_estado on public.reservas_pagos (restaurante_id, estado);
alter table public.reservas_pagos enable row level security;
revoke all on public.reservas_pagos from anon;
-- Lectura para el panel; escribe solo el servidor (service key).
revoke insert, update, delete on public.reservas_pagos from authenticated;
grant select on public.reservas_pagos to authenticated;
revoke truncate, references, trigger on public.reservas_pagos from authenticated;
drop policy if exists reservas_pagos_lectura on public.reservas_pagos;
create policy reservas_pagos_lectura on public.reservas_pagos
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()));

create or replace function public.reservas_pagos_tocar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
revoke all on function public.reservas_pagos_tocar() from public, anon, authenticated;
drop trigger if exists trg_rsv_pagos_tocar on public.reservas_pagos;
create trigger trg_rsv_pagos_tocar
  before update on public.reservas_pagos
  for each row execute function public.reservas_pagos_tocar();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.7 FUNCIONES
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── reservas_mesa_ocupada: solape con reservas activas o bloqueos ───────
-- El solape se compara en timestamp (fecha + hora): «time + interval» da la vuelta a
-- medianoche (22:30 + 150 min = 01:00) y una mesa ocupada parecía libre.
create or replace function public.reservas_mesa_ocupada(
  p_mesa uuid, p_fecha date, p_hora time, p_duracion integer, p_excluir uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.reservas_reserva_mesas rm
    join public.reservas_reservas r on r.id = rm.reserva_id
    where rm.mesa_id = p_mesa
      and r.fecha = p_fecha
      and r.estado = any(reservas_estados_activos())
      and (p_excluir is null or r.id <> p_excluir)
      and (r.fecha + r.hora) < (p_fecha + p_hora) + make_interval(mins => p_duracion)
      and (r.fecha + r.hora) + make_interval(mins => r.duracion_min) > (p_fecha + p_hora)
  ) or exists (
    select 1
    from public.reservas_mesas m
    join public.reservas_salas s on s.id = m.sala_id
    join public.reservas_bloqueos b on b.restaurante_id = s.restaurante_id and b.fecha = p_fecha
    where m.id = p_mesa
      -- bloqueo de mesa concreta, de toda la sala (sin mesa) o de todo el restaurante
      and (b.mesa_id = m.id
           or (b.mesa_id is null and b.sala_id = m.sala_id)
           or (b.mesa_id is null and b.sala_id is null))
      and (p_fecha + b.hora_inicio) < (p_fecha + p_hora) + make_interval(mins => p_duracion)
      and (p_fecha + b.hora_fin) > (p_fecha + p_hora)
  )
$$;
revoke execute on function public.reservas_mesa_ocupada(uuid, date, time, integer, uuid) from anon, public;
grant execute on function public.reservas_mesa_ocupada(uuid, date, time, integer, uuid) to authenticated;

-- ─── reservas_sin_mesa_solapadas (v1 recreada: estados ampliados) ────────
create or replace function public.reservas_sin_mesa_solapadas(p_restaurante uuid, p_fecha date, p_hora time without time zone, p_duracion integer)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.reservas_reservas r
  where r.restaurante_id = p_restaurante
    and r.mesa_id is null
    and r.fecha = p_fecha
    and r.estado = any(reservas_estados_activos())
    and (r.fecha + r.hora) < (p_fecha + p_hora) + make_interval(mins => p_duracion)
    and (r.fecha + r.hora) + make_interval(mins => r.duracion_min) > (p_fecha + p_hora)
$$;
revoke execute on function public.reservas_sin_mesa_solapadas(uuid, date, time, integer) from anon, public;
grant execute on function public.reservas_sin_mesa_solapadas(uuid, date, time, integer) to authenticated;

-- ─── reservas_mesas_libres_v2: mesas libres que caben (zona opcional) ────
create or replace function public.reservas_mesas_libres_v2(
  p_restaurante uuid, p_fecha date, p_hora time, p_duracion integer, p_pax integer,
  p_zona uuid default null, p_solo_online boolean default true, p_excluir uuid default null)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.reservas_mesas m
  join public.reservas_salas s on s.id = m.sala_id
  where s.restaurante_id = p_restaurante
    and s.activa and m.activa
    and (not p_solo_online or (m.reservable_online and s.reservable_online))
    and (p_zona is null or s.id = p_zona)
    and m.cap_min <= p_pax and m.cap_max >= p_pax
    and not reservas_mesa_ocupada(m.id, p_fecha, p_hora, p_duracion, p_excluir)
$$;
revoke execute on function public.reservas_mesas_libres_v2(uuid, date, time, integer, integer, uuid, boolean, uuid) from anon, public;
grant execute on function public.reservas_mesas_libres_v2(uuid, date, time, integer, integer, uuid, boolean, uuid) to authenticated;

-- ─── reservas_mesas_libres (v1 recreada: misma firma, bloqueos + estados) ─
create or replace function public.reservas_mesas_libres(p_restaurante uuid, p_fecha date, p_hora time without time zone, p_duracion integer, p_pax integer)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select reservas_mesas_libres_v2(p_restaurante, p_fecha, p_hora, p_duracion, p_pax, null, true, null)
$$;
revoke execute on function public.reservas_mesas_libres(uuid, date, time, integer, integer) from anon, public;
grant execute on function public.reservas_mesas_libres(uuid, date, time, integer, integer) to authenticated;

-- ─── reservas_mejor_mesa_v2: prioridad, zona preferida, combinaciones, uniones ──
-- Devuelve las mesas asignadas (1 o varias) o null si no cabe.
create or replace function public.reservas_mejor_mesa_v2(
  p_restaurante uuid, p_fecha date, p_hora time, p_duracion integer, p_pax integer,
  p_solo_online boolean default true, p_zona uuid default null,
  p_permitir_union boolean default true, p_excluir uuid default null)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_arr uuid[];
begin
  -- 1) Una sola mesa: zona preferida primero, luego prioridad de mesa y de sala, la más ajustada.
  select m.id into v_id
  from public.reservas_mesas m
  join public.reservas_salas s on s.id = m.sala_id
  where s.restaurante_id = p_restaurante
    and s.activa and m.activa
    and (not p_solo_online or (m.reservable_online and s.reservable_online))
    and m.cap_min <= p_pax and m.cap_max >= p_pax
    and not reservas_mesa_ocupada(m.id, p_fecha, p_hora, p_duracion, p_excluir)
  order by (p_zona is not null and s.id = p_zona) desc, m.prioridad asc, s.prioridad asc, m.cap_max asc, m.nombre asc
  limit 1;
  if v_id is not null then return array[v_id]; end if;
  if not p_permitir_union then return null; end if;

  -- 2) Combinaciones definidas por la sala (todas sus mesas activas, reservables y libres).
  select c.mesas into v_arr
  from public.reservas_mesas_combinaciones c
  where c.restaurante_id = p_restaurante and c.activa
    and p_pax between c.pax_min and c.pax_max
    and not exists (
      select 1 from unnest(c.mesas) u(id)
      where reservas_mesa_ocupada(u.id, p_fecha, p_hora, p_duracion, p_excluir)
         or not exists (
           select 1 from public.reservas_mesas m join public.reservas_salas s on s.id = m.sala_id
           where m.id = u.id and m.activa and s.activa
             and (not p_solo_online or (m.reservable_online and s.reservable_online)))
    )
  order by (p_zona is not null and exists (select 1 from public.reservas_mesas m where m.id = c.mesas[1] and m.sala_id = p_zona)) desc,
           c.prioridad asc, c.pax_max asc
  limit 1;
  if v_arr is not null then return v_arr; end if;

  -- 3) Unión ad hoc: dos mesas unibles de la misma sala, contiguas (≤ 15 unidades del lienzo).
  select array[a.id, b.id] into v_arr
  from public.reservas_mesas a
  join public.reservas_mesas b on b.sala_id = a.sala_id and b.id > a.id
  join public.reservas_salas s on s.id = a.sala_id
  where s.restaurante_id = p_restaurante and s.activa
    and a.activa and b.activa and a.unible and b.unible
    and a.tipo = 'mesa' and b.tipo = 'mesa'
    and (not p_solo_online or (a.reservable_online and b.reservable_online and s.reservable_online))
    and a.cap_max + b.cap_max >= p_pax and a.cap_min + b.cap_min <= p_pax
    and sqrt(power(a.pos_x - b.pos_x, 2) + power(a.pos_y - b.pos_y, 2)) <= 15
    and not reservas_mesa_ocupada(a.id, p_fecha, p_hora, p_duracion, p_excluir)
    and not reservas_mesa_ocupada(b.id, p_fecha, p_hora, p_duracion, p_excluir)
  order by (p_zona is not null and s.id = p_zona) desc, a.cap_max + b.cap_max asc, a.prioridad + b.prioridad asc, a.nombre
  limit 1;
  return v_arr;
end $$;
revoke execute on function public.reservas_mejor_mesa_v2(uuid, date, time, integer, integer, boolean, uuid, boolean, uuid) from anon, public;
grant execute on function public.reservas_mejor_mesa_v2(uuid, date, time, integer, integer, boolean, uuid, boolean, uuid) to authenticated;

-- ─── reservas_mejor_mesa (v1 recreada: misma firma; una sola mesa, con prioridad y bloqueos) ──
create or replace function public.reservas_mejor_mesa(p_restaurante uuid, p_fecha date, p_hora time without time zone, p_duracion integer, p_pax integer, p_solo_online boolean)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (reservas_mejor_mesa_v2(p_restaurante, p_fecha, p_hora, p_duracion, p_pax, p_solo_online, null, false, null))[1]
$$;
revoke execute on function public.reservas_mejor_mesa(uuid, date, time, integer, integer, boolean) from anon, public;
grant execute on function public.reservas_mejor_mesa(uuid, date, time, integer, integer, boolean) to authenticated;

-- ─── reservas_cupo_motivo: ¿cabe p_pax en el turno del día? ──────────────
-- Devuelve null si cabe o el motivo ('cupo_online' | 'cupo_total' | 'intervalo'). Lee el cupo
-- del turno y, si no lo hay, el del día (turno_id null): la vista Mes fija el aforo online del
-- día. p_hora null = sin comprobar max_reservas_intervalo. Lo usan disponibilidad_v2,
-- crear_online_v2 y gestion_modificar (misma regla en los tres sitios).
create or replace function public.reservas_cupo_motivo(
  p_restaurante uuid, p_fecha date, p_turno uuid, p_pax integer,
  p_online boolean default true, p_hora time default null, p_excluir uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_turno public.reservas_turnos%rowtype;
  v_cupo public.reservas_cupos%rowtype;
  v_online_pax integer;
  v_total_pax integer;
  v_max_total integer;
begin
  select * into v_turno from public.reservas_turnos where id = p_turno and restaurante_id = p_restaurante;
  if not found then return 'turno'; end if;
  select * into v_cupo from public.reservas_cupos q
  where q.restaurante_id = p_restaurante and q.fecha = p_fecha and (q.turno_id = p_turno or q.turno_id is null)
  order by (q.turno_id is not null) desc limit 1;
  v_max_total := coalesce(v_cupo.max_pax_total, v_turno.max_pax_total);

  if (p_online and v_cupo.max_pax_online is not null) or v_max_total is not null then
    select coalesce(sum(r.pax) filter (where r.origen = 'online'), 0), coalesce(sum(r.pax), 0)
    into v_online_pax, v_total_pax
    from public.reservas_reservas r
    where r.restaurante_id = p_restaurante and r.fecha = p_fecha
      and r.estado = any(reservas_estados_activos())
      and (p_excluir is null or r.id <> p_excluir)
      and (r.turno_id = v_turno.id or (r.turno_id is null and r.hora between v_turno.hora_inicio and v_turno.hora_fin));
    if p_online and v_cupo.max_pax_online is not null and v_online_pax + p_pax > v_cupo.max_pax_online then
      return 'cupo_online';
    end if;
    if v_max_total is not null and v_total_pax + p_pax > v_max_total then
      return 'cupo_total';
    end if;
  end if;

  if p_hora is not null and v_turno.max_reservas_intervalo is not null then
    if (select count(*) from public.reservas_reservas r
        where r.restaurante_id = p_restaurante and r.fecha = p_fecha and r.hora = p_hora
          and (p_excluir is null or r.id <> p_excluir)
          and r.estado = any(reservas_estados_activos())) >= v_turno.max_reservas_intervalo then
      return 'intervalo';
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.reservas_cupo_motivo(uuid, date, uuid, integer, boolean, time, uuid) from anon, public;
grant execute on function public.reservas_cupo_motivo(uuid, date, uuid, integer, boolean, time, uuid) to authenticated;

-- ─── reservas_disponibilidad_v2(slug, fecha, pax, zona, experiencia) ─────
-- Respeta cierres, cupos (cerrado / aforo online / aforo total), bloqueos, duración por pax,
-- zonas reservables, antelación y máximo de reservas por intervalo. Por turno devuelve las
-- horas con plazas y si la reserva exige tarjeta/prepago (tipo, importe).
create or replace function public.reservas_disponibilidad_v2(
  p_slug text, p_fecha date, p_pax integer, p_zona_id uuid default null, p_experiencia_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rest public.reservas_restaurantes%rowtype;
  v_exp public.reservas_experiencias%rowtype;
  v_turno record;
  v_cupo public.reservas_cupos%rowtype;
  v_hora time;
  v_horas jsonb;
  v_res jsonb := '[]'::jsonb;
  v_limite timestamptz;
  v_tipo text := null;
  v_importe numeric := null;
  v_dur integer;
  v_plazas integer;
  v_max_pax integer;
  v_zonas jsonb;
  v_lleno boolean;
begin
  select * into v_rest from public.reservas_restaurantes where slug = p_slug and activo and online_activo;
  if not found then return jsonb_build_object('error', 'LOCAL_NO_DISPONIBLE'); end if;
  if p_pax is null or p_pax < 1 then return jsonb_build_object('error', 'PAX_INVALIDO'); end if;
  if p_fecha < current_date or p_fecha > current_date + v_rest.antelacion_max_dias then
    return jsonb_build_object('error', 'FECHA_FUERA_DE_RANGO');
  end if;
  if p_zona_id is not null and not exists (
       select 1 from public.reservas_salas s where s.id = p_zona_id and s.restaurante_id = v_rest.id and s.activa and s.reservable_online) then
    return jsonb_build_object('error', 'ZONA_INVALIDA');
  end if;
  if p_experiencia_id is not null then
    select * into v_exp from public.reservas_experiencias e
    where e.id = p_experiencia_id and e.restaurante_id = v_rest.id and e.activa
      and (e.fecha_desde is null or e.fecha_desde <= p_fecha)
      and (e.fecha_hasta is null or e.fecha_hasta >= p_fecha)
      and (e.dias_semana is null or extract(isodow from p_fecha)::int = any(e.dias_semana))
      and p_pax >= e.pax_min and (e.pax_max is null or p_pax <= e.pax_max);
    if not found then return jsonb_build_object('error', 'EXPERIENCIA_NO_DISPONIBLE'); end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.orden), '[]'::jsonb)
  into v_zonas
  from public.reservas_salas s where s.restaurante_id = v_rest.id and s.activa and s.reservable_online;

  -- Día cerrado (cierre antiguo o cupo nuevo sin turno).
  if exists (select 1 from public.reservas_cierres c where c.restaurante_id = v_rest.id and c.fecha = p_fecha and c.turno_id is null)
     or exists (select 1 from public.reservas_cupos q where q.restaurante_id = v_rest.id and q.fecha = p_fecha and q.turno_id is null and q.cerrado) then
    return jsonb_build_object('turnos', '[]'::jsonb, 'cerrado', true, 'zonas', v_zonas);
  end if;

  -- Tipo de reserva y importe (experiencia > prepago del restaurante > garantía desde N pax).
  if v_exp.id is not null and v_exp.requiere_prepago and coalesce(v_exp.precio_pax, 0) > 0 then
    v_tipo := 'prepago'; v_importe := v_exp.precio_pax * p_pax;
  elsif coalesce(v_rest.prepago_importe_pax, 0) > 0 then
    v_tipo := 'prepago'; v_importe := v_rest.prepago_importe_pax * p_pax;
  elsif v_rest.tarjeta_desde_pax is not null and p_pax >= v_rest.tarjeta_desde_pax
        and coalesce(v_rest.garantia_importe_pax, 0) > 0 then
    v_tipo := 'garantia'; v_importe := v_rest.garantia_importe_pax * p_pax;
  end if;

  v_limite := now() + make_interval(hours => v_rest.antelacion_min_horas);

  for v_turno in
    select * from public.reservas_turnos t
    where t.restaurante_id = v_rest.id and t.activo
      and extract(isodow from p_fecha)::int = any(t.dias_semana)
      and not exists (select 1 from public.reservas_cierres c where c.restaurante_id = v_rest.id and c.fecha = p_fecha and c.turno_id = t.id)
      and (v_exp.id is null or v_exp.turnos is null or t.id = any(v_exp.turnos))
    order by t.hora_inicio
  loop
    -- Cupo del turno o, si no lo hay, del día (turno_id null).
    select * into v_cupo from public.reservas_cupos q
    where q.restaurante_id = v_rest.id and q.fecha = p_fecha and (q.turno_id = v_turno.id or q.turno_id is null)
    order by (q.turno_id is not null) desc limit 1;
    if found and v_cupo.cerrado then
      v_res := v_res || jsonb_build_object('turno_id', v_turno.id, 'turno', v_turno.nombre, 'horas', '[]'::jsonb, 'cerrado', true, 'nota', v_cupo.nota);
      continue;
    end if;

    v_max_pax := least(v_turno.max_pax_online, v_rest.max_pax_online);
    if p_pax > v_max_pax then
      v_res := v_res || jsonb_build_object('turno_id', v_turno.id, 'turno', v_turno.nombre, 'horas', '[]'::jsonb, 'grupo_grande', true, 'max_pax_online', v_max_pax);
      continue;
    end if;

    -- Aforo online / total del turno (misma regla que crear_online_v2 y gestion_modificar).
    v_lleno := reservas_cupo_motivo(v_rest.id, p_fecha, v_turno.id, p_pax, true, null, null) is not null;
    if v_lleno then
      v_res := v_res || jsonb_build_object('turno_id', v_turno.id, 'turno', v_turno.nombre, 'horas', '[]'::jsonb, 'completo', true);
      continue;
    end if;

    v_dur := reservas_duracion_pax(v_rest.id, p_pax, v_turno.duracion_min);
    v_horas := '[]'::jsonb;
    v_hora := v_turno.hora_inicio;
    while v_hora <= v_turno.hora_fin loop
      if reservas_ts(p_fecha, v_hora, v_rest.zona_horaria) >= v_limite then
        v_plazas := reservas_mesas_libres_v2(v_rest.id, p_fecha, v_hora, v_dur, p_pax, p_zona_id, true, null)
                    - reservas_sin_mesa_solapadas(v_rest.id, p_fecha, v_hora, v_dur);
        -- Sin mesa individual pero sí por combinación / unión de dos mesas (grupos de 7-8:
        -- ninguna mesa online de Bonita llega a 8, pero hay pares unibles): una plaza.
        if v_plazas <= 0
           and reservas_mejor_mesa_v2(v_rest.id, p_fecha, v_hora, v_dur, p_pax, true, p_zona_id, true, null) is not null then
          v_plazas := 1;
        end if;
        if v_plazas > 0 and v_turno.max_reservas_intervalo is not null then
          if (select count(*) from public.reservas_reservas r
              where r.restaurante_id = v_rest.id and r.fecha = p_fecha and r.hora = v_hora
                and r.estado = any(reservas_estados_activos())) >= v_turno.max_reservas_intervalo then
            v_plazas := 0;
          end if;
        end if;
        if v_plazas > 0 then
          v_horas := v_horas || jsonb_build_object('hora', to_char(v_hora, 'HH24:MI'), 'plazas', v_plazas, 'pocas', v_plazas <= 2);
        end if;
      end if;
      v_hora := v_hora + make_interval(mins => v_turno.intervalo_min);
      exit when v_hora < v_turno.hora_inicio; -- time da la vuelta a 00:00: un turno hasta 23:45 colgaría el bucle
    end loop;
    v_res := v_res || jsonb_build_object('turno_id', v_turno.id, 'turno', v_turno.nombre, 'horas', v_horas,
                                         'duracion_min', v_dur, 'tipo', v_tipo, 'importe', v_importe);
  end loop;

  return jsonb_build_object(
    'turnos', v_res,
    'cerrado', false,
    'zonas', v_zonas,
    'tipo', v_tipo,
    'importe', v_importe,
    'mensaje', v_rest.mensaje_widget,
    'grupos_telefono', coalesce(v_rest.grupos_telefono, v_rest.telefono),
    'max_pax_online', v_rest.max_pax_online,
    'politica_cancelacion_horas', v_rest.politica_cancelacion_horas
  );
end $$;
revoke execute on function public.reservas_disponibilidad_v2(text, date, integer, uuid, uuid) from anon, public, authenticated;

-- ─── reservas_disponibilidad (v1: misma firma y misma salida, sobre la v2) ──
-- Como la v1 antigua, los turnos cerrados (cierre o cupo) y los completos no aparecen.
create or replace function public.reservas_disponibilidad(p_slug text, p_fecha date, p_pax integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
  v_turnos jsonb;
begin
  v := reservas_disponibilidad_v2(p_slug, p_fecha, p_pax, null, null);
  if v ? 'error' then return v; end if;
  if coalesce((v ->> 'cerrado')::boolean, false) then
    return jsonb_build_object('turnos', '[]'::jsonb, 'cerrado', true);
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object('turno_id', t -> 'turno_id', 'turno', t -> 'turno',
      'horas', coalesce((select jsonb_agg(h -> 'hora') from jsonb_array_elements(t -> 'horas') h), '[]'::jsonb))
    || case when coalesce((t ->> 'grupo_grande')::boolean, false) then jsonb_build_object('grupo_grande', true) else '{}'::jsonb end
  ), '[]'::jsonb)
  into v_turnos
  from jsonb_array_elements(v -> 'turnos') t
  where not coalesce((t ->> 'cerrado')::boolean, false)
    and not coalesce((t ->> 'completo')::boolean, false);
  return jsonb_build_object('turnos', v_turnos);
end $$;
revoke execute on function public.reservas_disponibilidad(text, date, integer) from anon, public, authenticated;

-- ─── reservas_crear_online_v2: alta online con todos los campos ──────────
-- Devuelve {ok, id, localizador, token, estado, tipo, requiere_pago ('garantia'|'prepago'|null),
-- importe, restaurante, fecha, hora, pax, enlace, mensaje, direccion, telefono} o {error}.
create or replace function public.reservas_crear_online_v2(
  p_slug text, p_fecha date, p_hora time, p_pax integer,
  p_nombre text, p_telefono text, p_email text default null, p_notas text default null,
  p_apellidos text default null, p_idioma text default 'es', p_pais text default 'ES',
  p_zona_id uuid default null, p_etiquetas uuid[] default '{}', p_alergias text default null,
  p_experiencia_id uuid default null, p_consentimiento_marketing boolean default false,
  p_prescriptor text default null, p_respuestas jsonb default '{}', p_codigo_promo text default null,
  p_canal text default 'moduloweb', p_solicitud boolean default false, p_lista_espera_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rest public.reservas_restaurantes%rowtype;
  v_turno public.reservas_turnos%rowtype;
  v_exp public.reservas_experiencias%rowtype;
  v_cod public.reservas_codigos%rowtype;
  v_mesas uuid[];
  v_cli uuid;
  v_cli_negra boolean := false;
  v_tel text;
  v_email text;
  v_dur integer;
  v_tipo text := 'gratis';
  v_requiere text := null;
  v_importe numeric := null;
  v_estado text;
  v_max_pax integer;
  v_prescriptor uuid;
  v_solicitud boolean := false;
  v_reserva public.reservas_reservas%rowtype;
  v_loc text;
  v_i integer;
  v_etq uuid[];
  v_motivo text;
begin
  select * into v_rest from public.reservas_restaurantes where slug = p_slug and activo and online_activo;
  if not found then return jsonb_build_object('error', 'LOCAL_NO_DISPONIBLE'); end if;

  v_tel := reservas_norm_tel(p_telefono);
  if v_tel is null or length(v_tel) < 9 then return jsonb_build_object('error', 'TELEFONO_INVALIDO'); end if;
  if coalesce(btrim(p_nombre), '') = '' then return jsonb_build_object('error', 'NOMBRE_REQUERIDO'); end if;
  -- Endpoint público: límites de tamaño (relleno de la base).
  if length(coalesce(p_nombre, '')) > 120 or length(coalesce(p_apellidos, '')) > 120
     or length(coalesce(p_notas, '')) > 2000 or length(coalesce(p_alergias, '')) > 1000
     or length(coalesce(p_email, '')) > 254 or length(coalesce(p_prescriptor, '')) > 120
     or length(coalesce(p_codigo_promo, '')) > 40 or length(coalesce(p_canal, '')) > 40
     or pg_column_size(coalesce(p_respuestas, '{}'::jsonb)) > 8000 then
    return jsonb_build_object('error', 'DATOS_INVALIDOS');
  end if;
  if p_pax is null or p_pax < 1 then return jsonb_build_object('error', 'PAX_INVALIDO'); end if;
  if p_fecha < current_date or p_fecha > current_date + v_rest.antelacion_max_dias then
    return jsonb_build_object('error', 'FECHA_FUERA_DE_RANGO');
  end if;
  v_email := reservas_norm_email(p_email);
  if p_zona_id is not null and not exists (
       select 1 from public.reservas_salas s where s.id = p_zona_id and s.restaurante_id = v_rest.id and s.activa and s.reservable_online) then
    return jsonb_build_object('error', 'ZONA_INVALIDA');
  end if;

  -- Día cerrado.
  if exists (select 1 from public.reservas_cierres c where c.restaurante_id = v_rest.id and c.fecha = p_fecha and c.turno_id is null)
     or exists (select 1 from public.reservas_cupos q where q.restaurante_id = v_rest.id and q.fecha = p_fecha and q.turno_id is null and q.cerrado) then
    return jsonb_build_object('error', 'CERRADO');
  end if;

  -- Experiencia.
  if p_experiencia_id is not null then
    select * into v_exp from public.reservas_experiencias e
    where e.id = p_experiencia_id and e.restaurante_id = v_rest.id and e.activa
      and (e.fecha_desde is null or e.fecha_desde <= p_fecha)
      and (e.fecha_hasta is null or e.fecha_hasta >= p_fecha)
      and (e.dias_semana is null or extract(isodow from p_fecha)::int = any(e.dias_semana))
      and p_pax >= e.pax_min and (e.pax_max is null or p_pax <= e.pax_max);
    if not found then return jsonb_build_object('error', 'EXPERIENCIA_NO_DISPONIBLE'); end if;
  end if;

  -- Turno.
  select * into v_turno from public.reservas_turnos t
  where t.restaurante_id = v_rest.id and t.activo
    and extract(isodow from p_fecha)::int = any(t.dias_semana)
    and p_hora between t.hora_inicio and t.hora_fin
    and not exists (select 1 from public.reservas_cierres c where c.restaurante_id = v_rest.id and c.fecha = p_fecha and c.turno_id = t.id)
    and not exists (select 1 from public.reservas_cupos q where q.restaurante_id = v_rest.id and q.fecha = p_fecha and q.turno_id = t.id and q.cerrado)
    and (v_exp.id is null or v_exp.turnos is null or t.id = any(v_exp.turnos))
  order by t.hora_inicio limit 1;
  if not found then return jsonb_build_object('error', 'HORA_FUERA_DE_TURNO'); end if;

  v_max_pax := least(v_turno.max_pax_online, v_rest.max_pax_online);
  if p_pax > v_max_pax then
    if not p_solicitud then
      return jsonb_build_object('error', 'GRUPO_GRANDE', 'max_pax_online', v_max_pax,
                                'telefono', coalesce(v_rest.grupos_telefono, v_rest.telefono));
    end if;
    v_solicitud := true; -- grupo grande: solicitud pendiente de confirmación, sin mesa
  end if;
  if reservas_ts(p_fecha, p_hora, v_rest.zona_horaria) < now() + make_interval(hours => v_rest.antelacion_min_horas) then
    return jsonb_build_object('error', 'ANTELACION_INSUFICIENTE');
  end if;

  -- Candado por local+fecha: evita dobles asignaciones simultáneas (idéntico al legado).
  perform pg_advisory_xact_lock(hashtext(v_rest.id::text || p_fecha::text));

  -- Cupos del turno / del día (aforo online, total, reservas por intervalo): misma regla que
  -- disponibilidad_v2 y gestion_modificar. Una solicitud de grupo grande no cuenta el intervalo.
  v_motivo := reservas_cupo_motivo(v_rest.id, p_fecha, v_turno.id, p_pax, true,
                                   case when v_solicitud then null else p_hora end, null);
  if v_motivo is not null then
    return jsonb_build_object('error', 'SIN_DISPONIBILIDAD', 'motivo', v_motivo);
  end if;

  -- Mesa(s).
  v_dur := reservas_duracion_pax(v_rest.id, p_pax, v_turno.duracion_min);
  if not v_solicitud then
    v_mesas := reservas_mejor_mesa_v2(v_rest.id, p_fecha, p_hora, v_dur, p_pax, true, p_zona_id, true, null);
    if v_mesas is null then return jsonb_build_object('error', 'SIN_DISPONIBILIDAD'); end if;
  end if;

  -- Tipo de reserva, importe y código promocional.
  if v_exp.id is not null then
    v_tipo := 'experiencia';
    if v_exp.requiere_prepago and coalesce(v_exp.precio_pax, 0) > 0 then
      v_requiere := 'prepago'; v_importe := v_exp.precio_pax * p_pax;
    end if;
  elsif coalesce(v_rest.prepago_importe_pax, 0) > 0 then
    v_tipo := 'prepago'; v_requiere := 'prepago'; v_importe := v_rest.prepago_importe_pax * p_pax;
  elsif v_rest.tarjeta_desde_pax is not null and p_pax >= v_rest.tarjeta_desde_pax
        and coalesce(v_rest.garantia_importe_pax, 0) > 0 then
    v_tipo := 'garantia'; v_requiere := 'garantia'; v_importe := v_rest.garantia_importe_pax * p_pax;
  end if;
  -- Solicitud de grupo grande («pendiente de confirmación»): sin tarjeta ni prepago al nacer; la
  -- pedirá el restaurante al aceptar («Solicitar tarjeta» → tarjeta_pendiente). Cover tampoco
  -- combina garantía con pendiente de confirmación.
  if v_solicitud then
    v_requiere := null; v_importe := null;
    v_tipo := case when v_exp.id is not null then 'experiencia' else 'gratis' end;
  end if;
  if coalesce(btrim(p_codigo_promo), '') <> '' then
    select * into v_cod from public.reservas_codigos c
    where c.cuenta_id = v_rest.cuenta_id and upper(c.codigo) = upper(btrim(p_codigo_promo)) and c.activo
      and (c.restaurante_id is null or c.restaurante_id = v_rest.id)
      and (c.valido_desde is null or c.valido_desde <= p_fecha)
      and (c.valido_hasta is null or c.valido_hasta >= p_fecha)
      and (c.usos_max is null or c.usos < c.usos_max)
      and (c.experiencia_id is null or c.experiencia_id = p_experiencia_id);
    if not found then return jsonb_build_object('error', 'CODIGO_INVALIDO'); end if;
    if v_importe is not null then
      if v_cod.descuento_pct is not null then v_importe := round(v_importe * (1 - v_cod.descuento_pct / 100), 2); end if;
      if v_cod.descuento_importe is not null then v_importe := greatest(0, v_importe - v_cod.descuento_importe); end if;
    end if;
    -- el uso se consume después del insert (si la reserva no llega a crearse, no se gasta)
  end if;
  if v_requiere = 'prepago' and coalesce(v_importe, 0) <= 0 then v_requiere := null; end if;

  -- Cliente por teléfono DENTRO de la cuenta.
  select id, lista_negra into v_cli, v_cli_negra
  from public.reservas_clientes
  where cuenta_id = v_rest.cuenta_id and (telefono_norm = v_tel or telefono = v_tel)
  order by (telefono_norm = v_tel) desc limit 1;
  if v_cli is null then
    insert into public.reservas_clientes (cuenta_id, nombre, apellidos, telefono, email, idioma, pais, alergias,
                                          consentimiento_marketing, consentimiento_en)
    values (v_rest.cuenta_id, btrim(p_nombre), nullif(btrim(p_apellidos), ''), v_tel, v_email,
            coalesce(nullif(p_idioma, ''), 'es'), coalesce(nullif(p_pais, ''), 'ES'), nullif(btrim(p_alergias), ''),
            coalesce(p_consentimiento_marketing, false), case when p_consentimiento_marketing then now() end)
    returning id into v_cli;
  else
    if v_cli_negra then return jsonb_build_object('error', 'SIN_DISPONIBILIDAD'); end if;
    update public.reservas_clientes set
      email = coalesce(v_email, email),
      apellidos = coalesce(apellidos, nullif(btrim(p_apellidos), '')),
      idioma = coalesce(nullif(p_idioma, ''), idioma),
      pais = coalesce(nullif(p_pais, ''), pais),
      alergias = coalesce(nullif(btrim(p_alergias), ''), alergias),
      consentimiento_marketing = consentimiento_marketing or coalesce(p_consentimiento_marketing, false)
    where id = v_cli;
  end if;

  -- Prescriptor por slug de campaña o nombre.
  if coalesce(btrim(p_prescriptor), '') <> '' then
    select id into v_prescriptor from public.reservas_prescriptores p
    where p.cuenta_id = v_rest.cuenta_id and p.activo
      and (p.slug = reservas_slug(p_prescriptor) or lower(p.nombre) = lower(btrim(p_prescriptor)))
    limit 1;
  end if;

  -- Etiquetas: solo las de reserva, activas y de ESTA cuenta (el widget manda uuids libres).
  select coalesce(array_agg(e.id), '{}') into v_etq
  from public.reservas_etiquetas e
  where e.cuenta_id = v_rest.cuenta_id and e.ambito = 'reserva' and e.activa
    and e.id = any(coalesce(p_etiquetas, '{}'));

  v_estado := case
    when v_requiere is not null then 'tarjeta_pendiente'
    when v_solicitud then 'pendiente'
    when v_rest.confirmar_online_auto then 'confirmada'
    else 'pendiente' end;
  v_loc := coalesce(v_rest.prefijo_localizador, '') || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.reservas_reservas
    (cuenta_id, localizador, restaurante_id, cliente_id, turno_id, mesa_id, zona_id, fecha, hora, duracion_min, pax,
     estado, origen, canal, notas_cliente, tipo, estado_pago, importe_garantia, importe_prepago, experiencia_id,
     idioma, pais, etiquetas, prescriptor_id, alergias, consentimiento_marketing, respuestas, codigo_promo,
     notas_internas, notificar, tarjeta_solicitada_en)
  values
    (v_rest.cuenta_id, v_loc, v_rest.id, v_cli, v_turno.id, case when v_mesas is null then null else v_mesas[1] end,
     p_zona_id, p_fecha, p_hora, v_dur, p_pax,
     v_estado, 'online', coalesce(nullif(p_canal, ''), 'moduloweb'), nullif(btrim(p_notas), ''),
     v_tipo, case when v_requiere is not null then 'pendiente_tarjeta' else 'no_requerido' end,
     case when v_requiere = 'garantia' then v_importe end, case when v_requiere = 'prepago' then v_importe end,
     v_exp.id, coalesce(nullif(p_idioma, ''), 'es'), nullif(p_pais, ''), v_etq, v_prescriptor,
     nullif(btrim(p_alergias), ''), p_consentimiento_marketing, coalesce(p_respuestas, '{}'), nullif(btrim(p_codigo_promo), ''),
     case when v_solicitud then 'Solicitud de grupo grande (' || p_pax || ' pax) pendiente de confirmar por el restaurante.' end,
     true, case when v_requiere is not null then now() end)
  returning * into v_reserva;

  -- Código promocional: el uso se consume solo con la reserva ya creada.
  if v_cod.id is not null then
    update public.reservas_codigos set usos = usos + 1 where id = v_cod.id;
  end if;

  -- Mesas adicionales (combinaciones / uniones): la principal la sincroniza el trigger.
  if v_mesas is not null and cardinality(v_mesas) > 1 then
    for v_i in 2 .. cardinality(v_mesas) loop
      insert into public.reservas_reserva_mesas (cuenta_id, reserva_id, mesa_id)
      values (v_rest.cuenta_id, v_reserva.id, v_mesas[v_i]) on conflict do nothing;
    end loop;
  end if;

  -- Lista de espera convertida.
  if p_lista_espera_token is not null and reservas_token_valido(p_lista_espera_token) then
    update public.reservas_lista_espera set estado = 'convertida', reserva_id = v_reserva.id
    where token = p_lista_espera_token and restaurante_id = v_rest.id and estado in ('esperando', 'avisado');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_reserva.id,
    'localizador', v_reserva.localizador,
    'token', v_reserva.token,
    'estado', v_reserva.estado,
    'tipo', v_reserva.tipo,
    'solicitud', v_solicitud,
    'requiere_pago', v_requiere,
    'importe', v_importe,
    'restaurante', v_rest.nombre,
    'fecha', to_char(v_reserva.fecha, 'DD/MM/YYYY'),
    'hora', to_char(v_reserva.hora, 'HH24:MI'),
    'pax', v_reserva.pax,
    'duracion_min', v_reserva.duracion_min,
    'enlace', reservas_url_base(v_rest.id) || '/reserva/' || v_reserva.token,
    'mensaje', v_rest.mensaje_widget,
    'direccion', coalesce(v_rest.direccion, v_rest.ubicacion),
    'telefono', v_rest.telefono,
    'politica_cancelacion_horas', v_rest.politica_cancelacion_horas
  );
end $$;
revoke execute on function public.reservas_crear_online_v2(text, date, time, integer, text, text, text, text, text, text, text, uuid, uuid[], text, uuid, boolean, text, jsonb, text, text, boolean, text) from anon, public, authenticated;

-- ─── reservas_crear_online (v1: misma firma y misma salida, sobre la v2) ──
create or replace function public.reservas_crear_online(p_slug text, p_fecha date, p_hora time without time zone, p_pax integer, p_nombre text, p_telefono text, p_email text, p_notas text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  v := reservas_crear_online_v2(p_slug, p_fecha, p_hora, p_pax, p_nombre, p_telefono, p_email, p_notas);
  if v ? 'error' then return jsonb_build_object('error', v ->> 'error'); end if;
  return jsonb_build_object(
    'ok', true,
    'localizador', v ->> 'localizador',
    'restaurante', v ->> 'restaurante',
    'fecha', v ->> 'fecha',
    'hora', v ->> 'hora',
    'pax', (v ->> 'pax')::integer,
    'token', v ->> 'token',
    'requiere_pago', v -> 'requiere_pago',
    'importe', v -> 'importe'
  );
end $$;
revoke execute on function public.reservas_crear_online(text, date, time, integer, text, text, text, text) from anon, public, authenticated;

-- ─── reservas_gestion(token): ficha pública de la reserva ────────────────
create or replace function public.reservas_gestion(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.reservas_reservas%rowtype;
  v_rest public.reservas_restaurantes%rowtype;
  v_cli public.reservas_clientes%rowtype;
  v_ini timestamptz;
  v_activa boolean;
  v_dentro boolean;
  v_mesas text;
begin
  if not reservas_token_valido(p_token) then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  select * into v_r from public.reservas_reservas where token = p_token;
  if not found then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  select * into v_rest from public.reservas_restaurantes where id = v_r.restaurante_id;
  if v_r.cliente_id is not null then select * into v_cli from public.reservas_clientes where id = v_r.cliente_id; end if;
  v_ini := reservas_ts(v_r.fecha, v_r.hora, v_rest.zona_horaria);
  v_activa := v_r.estado in ('pendiente', 'confirmada', 'reconfirmada', 'tarjeta_pendiente', 'a_revisar') and v_ini > now();
  v_dentro := v_ini - make_interval(hours => v_rest.politica_cancelacion_horas) <= now();
  select string_agg(coalesce(m.etiqueta, m.nombre), ' + ' order by m.nombre) into v_mesas
  from public.reservas_reserva_mesas rm join public.reservas_mesas m on m.id = rm.mesa_id where rm.reserva_id = v_r.id;

  return jsonb_build_object(
    'ok', true,
    'localizador', v_r.localizador,
    'token', v_r.token,
    'estado', v_r.estado,
    'tipo', v_r.tipo,
    'estado_pago', v_r.estado_pago,
    'importe', coalesce(v_r.importe_prepago, v_r.importe_garantia),
    'fecha', to_char(v_r.fecha, 'DD/MM/YYYY'),
    'fecha_iso', to_char(v_r.fecha, 'YYYY-MM-DD'),
    'hora', to_char(v_r.hora, 'HH24:MI'),
    'duracion_min', v_r.duracion_min,
    'pax', v_r.pax,
    'idioma', v_r.idioma,
    'notas_cliente', v_r.notas_cliente,
    'alergias', v_r.alergias,
    'zona', (select s.nombre from public.reservas_salas s where s.id = v_r.zona_id),
    'experiencia', (select e.nombre from public.reservas_experiencias e where e.id = v_r.experiencia_id),
    'valoracion', v_r.valoracion,
    'reconfirmada_en', v_r.reconfirmada_en,
    'cancelada_en', v_r.cancelada_en,
    'cliente', jsonb_build_object('nombre', v_cli.nombre, 'apellidos', v_cli.apellidos,
                                  'email', v_cli.email, 'telefono', v_cli.telefono),
    'restaurante', jsonb_build_object('slug', v_rest.slug, 'nombre', v_rest.nombre,
                                      'direccion', coalesce(v_rest.direccion, v_rest.ubicacion),
                                      'telefono', v_rest.telefono, 'email', coalesce(v_rest.email_reservas, v_rest.email),
                                      'url_condiciones', v_rest.url_condiciones, 'color_marca', v_rest.color_marca,
                                      'logo_url', v_rest.logo_url, 'mensaje', v_rest.mensaje_widget,
                                      'politica_cancelacion_horas', v_rest.politica_cancelacion_horas,
                                      'url_resena_google', v_rest.url_resena_google),
    'puede_confirmar', v_activa and (v_r.estado = 'confirmada' or (v_r.estado = 'pendiente' and v_r.reconfirmada_en is null)),
    'puede_cancelar', v_activa,
    'puede_modificar', v_activa and v_r.estado <> 'tarjeta_pendiente',
    'puede_pagar', v_r.estado = 'tarjeta_pendiente' and v_ini > now(),
    'puede_valorar', v_r.estado = any(reservas_estados_visita()) and v_r.valoracion is null,
    'dentro_politica', v_dentro,
    'cargo_si_cancela', v_activa and v_dentro and v_r.estado_pago = 'garantizada' and v_r.tipo in ('garantia', 'politica_cancelacion'),
    'mesas', v_mesas
  );
end $$;
revoke execute on function public.reservas_gestion(text) from anon, public, authenticated;

-- ─── reservas_gestion_confirmar(token): el cliente reconfirma ────────────
-- Una reserva «pendiente» (sin aceptar por el restaurante) NO pasa a reconfirmada: se sella
-- reconfirmada_en (el cliente dice que viene) y el restaurante sigue teniendo que aceptarla.
create or replace function public.reservas_gestion_confirmar(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.reservas_reservas%rowtype;
  v_tz text;
begin
  if not reservas_token_valido(p_token) then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  select * into v_r from public.reservas_reservas where token = p_token;
  if not found then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  select zona_horaria into v_tz from public.reservas_restaurantes where id = v_r.restaurante_id;
  if v_r.estado = 'reconfirmada' then return jsonb_build_object('ok', true, 'estado', v_r.estado); end if;
  if v_r.estado not in ('pendiente', 'confirmada') or reservas_ts(v_r.fecha, v_r.hora, v_tz) < now() then
    return jsonb_build_object('error', 'NO_CONFIRMABLE', 'estado', v_r.estado);
  end if;
  if v_r.estado = 'pendiente' then
    update public.reservas_reservas set reconfirmada_en = coalesce(reconfirmada_en, now()) where id = v_r.id;
    return jsonb_build_object('ok', true, 'estado', 'pendiente', 'reconfirmada_en', now());
  end if;
  update public.reservas_reservas set estado = 'reconfirmada', reconfirmada_en = now() where id = v_r.id;
  return jsonb_build_object('ok', true, 'estado', 'reconfirmada');
end $$;
revoke execute on function public.reservas_gestion_confirmar(text) from anon, public, authenticated;

-- ─── reservas_gestion_cancelar(token, motivo): el cliente cancela ────────
-- Devuelve si la cancelación es tardía y si procede cargo de garantía (lo ejecuta el servidor).
create or replace function public.reservas_gestion_cancelar(p_token text, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.reservas_reservas%rowtype;
  v_rest public.reservas_restaurantes%rowtype;
  v_ini timestamptz;
  v_tardia boolean;
begin
  if not reservas_token_valido(p_token) then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  if length(coalesce(p_motivo, '')) > 1000 then return jsonb_build_object('error', 'DATOS_INVALIDOS'); end if;
  select * into v_r from public.reservas_reservas where token = p_token;
  if not found then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  select * into v_rest from public.reservas_restaurantes where id = v_r.restaurante_id;
  v_ini := reservas_ts(v_r.fecha, v_r.hora, v_rest.zona_horaria);
  if v_r.estado = 'cancelada' then return jsonb_build_object('ok', true, 'estado', 'cancelada', 'ya_cancelada', true); end if;
  if v_r.estado not in ('pendiente', 'confirmada', 'reconfirmada', 'tarjeta_pendiente', 'a_revisar') or v_ini < now() then
    return jsonb_build_object('error', 'NO_CANCELABLE', 'estado', v_r.estado);
  end if;
  v_tardia := v_ini - make_interval(hours => v_rest.politica_cancelacion_horas) <= now();
  update public.reservas_reservas
  set estado = 'cancelada', cancelada_por = 'cliente', cancelada_en = now(),
      motivo_cancelacion = nullif(btrim(p_motivo), '')
  where id = v_r.id;
  return jsonb_build_object(
    'ok', true, 'estado', 'cancelada', 'tardia', v_tardia,
    'cargo_aplicable', v_tardia and v_r.estado_pago = 'garantizada' and v_r.tipo in ('garantia', 'politica_cancelacion'),
    'importe', v_r.importe_garantia,
    'reserva_id', v_r.id);
end $$;
revoke execute on function public.reservas_gestion_cancelar(text, text) from anon, public, authenticated;

-- ─── reservas_gestion_modificar(token, fecha, hora, pax): cambio si hay hueco ──
-- Recalcula disponibilidad de verdad: turno, grupo grande, antelación, regla de tarjeta (no se
-- puede pasar de 2 a 8 pax sin garantía por el enlace público), cupos e intervalo, mesa(s).
create or replace function public.reservas_gestion_modificar(p_token text, p_fecha date, p_hora time, p_pax integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.reservas_reservas%rowtype;
  v_rest public.reservas_restaurantes%rowtype;
  v_turno public.reservas_turnos%rowtype;
  v_mesas uuid[];
  v_dur integer;
  v_i integer;
  v_motivo text;
begin
  if not reservas_token_valido(p_token) then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  select * into v_r from public.reservas_reservas where token = p_token;
  if not found then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  select * into v_rest from public.reservas_restaurantes where id = v_r.restaurante_id;
  if v_r.estado not in ('pendiente', 'confirmada', 'reconfirmada')
     or reservas_ts(v_r.fecha, v_r.hora, v_rest.zona_horaria) < now() then
    return jsonb_build_object('error', 'NO_MODIFICABLE', 'estado', v_r.estado);
  end if;
  if p_pax is null or p_pax < 1 then return jsonb_build_object('error', 'PAX_INVALIDO'); end if;
  if p_fecha < current_date or p_fecha > current_date + v_rest.antelacion_max_dias then
    return jsonb_build_object('error', 'FECHA_FUERA_DE_RANGO');
  end if;
  if v_r.estado_pago = 'pagada' and p_pax > v_r.pax then
    return jsonb_build_object('error', 'PAX_PREPAGO');
  end if;
  if p_fecha = v_r.fecha and p_hora = v_r.hora and p_pax = v_r.pax then
    return jsonb_build_object('ok', true, 'sin_cambios', true);
  end if;
  if exists (select 1 from public.reservas_cierres c where c.restaurante_id = v_rest.id and c.fecha = p_fecha and c.turno_id is null)
     or exists (select 1 from public.reservas_cupos q where q.restaurante_id = v_rest.id and q.fecha = p_fecha and q.turno_id is null and q.cerrado) then
    return jsonb_build_object('error', 'CERRADO');
  end if;

  select * into v_turno from public.reservas_turnos t
  where t.restaurante_id = v_rest.id and t.activo
    and extract(isodow from p_fecha)::int = any(t.dias_semana)
    and p_hora between t.hora_inicio and t.hora_fin
    and not exists (select 1 from public.reservas_cierres c where c.restaurante_id = v_rest.id and c.fecha = p_fecha and c.turno_id = t.id)
    and not exists (select 1 from public.reservas_cupos q where q.restaurante_id = v_rest.id and q.fecha = p_fecha and q.turno_id = t.id and q.cerrado)
  order by t.hora_inicio limit 1;
  if not found then return jsonb_build_object('error', 'HORA_FUERA_DE_TURNO'); end if;
  if p_pax > least(v_turno.max_pax_online, v_rest.max_pax_online) then
    return jsonb_build_object('error', 'GRUPO_GRANDE', 'telefono', coalesce(v_rest.grupos_telefono, v_rest.telefono));
  end if;
  if reservas_ts(p_fecha, p_hora, v_rest.zona_horaria) < now() + make_interval(hours => v_rest.antelacion_min_horas) then
    return jsonb_build_object('error', 'ANTELACION_INSUFICIENTE');
  end if;
  -- Regla de tarjeta: si con los nuevos pax hace falta garantía y la reserva no la tiene, por aquí no.
  if v_rest.tarjeta_desde_pax is not null and p_pax >= v_rest.tarjeta_desde_pax
     and coalesce(v_rest.garantia_importe_pax, 0) > 0 and v_r.estado_pago = 'no_requerido' then
    return jsonb_build_object('error', 'REQUIERE_TARJETA', 'telefono', coalesce(v_rest.grupos_telefono, v_rest.telefono));
  end if;

  perform pg_advisory_xact_lock(hashtext(v_rest.id::text || p_fecha::text));
  -- Cupos e intervalo (excluyendo la propia reserva), misma regla que crear_online_v2.
  v_motivo := reservas_cupo_motivo(v_rest.id, p_fecha, v_turno.id, p_pax, v_r.origen = 'online', p_hora, v_r.id);
  if v_motivo is not null then
    return jsonb_build_object('error', 'SIN_DISPONIBILIDAD', 'motivo', v_motivo);
  end if;
  v_dur := reservas_duracion_pax(v_rest.id, p_pax, v_turno.duracion_min);
  v_mesas := reservas_mejor_mesa_v2(v_rest.id, p_fecha, p_hora, v_dur, p_pax, true, v_r.zona_id, true, v_r.id);
  if v_mesas is null then return jsonb_build_object('error', 'SIN_DISPONIBILIDAD'); end if;

  -- Mesas: fuera las anteriores (la principal la cambia el trigger de sincronía), dentro las nuevas.
  delete from public.reservas_reserva_mesas where reserva_id = v_r.id and mesa_id <> v_mesas[1];
  update public.reservas_reservas
  set fecha = p_fecha, hora = p_hora, pax = p_pax, turno_id = v_turno.id, duracion_min = v_dur, mesa_id = v_mesas[1],
      importe_garantia = case when importe_garantia is not null and v_rest.garantia_importe_pax is not null
                              then v_rest.garantia_importe_pax * p_pax else importe_garantia end
  where id = v_r.id;
  if cardinality(v_mesas) > 1 then
    for v_i in 2 .. cardinality(v_mesas) loop
      insert into public.reservas_reserva_mesas (cuenta_id, reserva_id, mesa_id)
      values (v_r.cuenta_id, v_r.id, v_mesas[v_i]) on conflict do nothing;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'fecha', to_char(p_fecha, 'DD/MM/YYYY'), 'hora', to_char(p_hora, 'HH24:MI'), 'pax', p_pax);
end $$;
revoke execute on function public.reservas_gestion_modificar(text, date, time, integer) from anon, public, authenticated;

-- ─── reservas_gestion_valorar(token, valoracion, comentario, detalle) ────
-- Una sola vez: con la valoración puesta no se puede reescribir (YA_VALORADA).
create or replace function public.reservas_gestion_valorar(p_token text, p_valoracion integer, p_comentario text default null, p_detalle jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.reservas_reservas%rowtype;
  v_url text;
begin
  if not reservas_token_valido(p_token) then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  if length(coalesce(p_comentario, '')) > 2000 or pg_column_size(coalesce(p_detalle, '{}'::jsonb)) > 2000 then
    return jsonb_build_object('error', 'DATOS_INVALIDOS');
  end if;
  select * into v_r from public.reservas_reservas where token = p_token;
  if not found then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  if p_valoracion is null or p_valoracion not between 1 and 5 then return jsonb_build_object('error', 'VALORACION_INVALIDA'); end if;
  if v_r.estado <> all(reservas_estados_visita()) then return jsonb_build_object('error', 'NO_VALORABLE', 'estado', v_r.estado); end if;
  if v_r.valoracion is not null then return jsonb_build_object('error', 'YA_VALORADA'); end if;
  update public.reservas_reservas
  set valoracion = p_valoracion, valoracion_comentario = nullif(btrim(p_comentario), ''),
      valoracion_detalle = p_detalle, valoracion_en = now()
  where id = v_r.id;
  select url_resena_google into v_url from public.reservas_restaurantes where id = v_r.restaurante_id;
  return jsonb_build_object('ok', true, 'url_resena', case when p_valoracion >= 4 then v_url end);
end $$;
revoke execute on function public.reservas_gestion_valorar(text, integer, text, jsonb) from anon, public, authenticated;

-- ─── reservas_apuntar_lista_espera (v1 recreada: misma firma) + v2 ───────
create or replace function public.reservas_apuntar_lista_espera_v2(
  p_slug text, p_fecha date, p_nombre text, p_telefono text, p_pax integer, p_notas text default null,
  p_hora time default null, p_email text default null, p_zona_id uuid default null, p_idioma text default 'es')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rest public.reservas_restaurantes%rowtype;
  v_tel text;
  v_cli uuid;
  v_turno uuid;
  v_id uuid;
  v_token text;
begin
  select * into v_rest from public.reservas_restaurantes where slug = p_slug and activo;
  if not found then return jsonb_build_object('error', 'LOCAL_NO_DISPONIBLE'); end if;
  v_tel := reservas_norm_tel(p_telefono);
  if v_tel is null or length(v_tel) < 9 then return jsonb_build_object('error', 'TELEFONO_INVALIDO'); end if;
  if coalesce(btrim(p_nombre), '') = '' then return jsonb_build_object('error', 'NOMBRE_REQUERIDO'); end if;
  if length(coalesce(p_nombre, '')) > 120 or length(coalesce(p_notas, '')) > 1000 or length(coalesce(p_email, '')) > 254 then
    return jsonb_build_object('error', 'DATOS_INVALIDOS');
  end if;
  if p_fecha < current_date then return jsonb_build_object('error', 'FECHA_FUERA_DE_RANGO'); end if;
  select id into v_cli from public.reservas_clientes where cuenta_id = v_rest.cuenta_id and (telefono_norm = v_tel or telefono = v_tel) limit 1;
  if p_hora is not null then
    select t.id into v_turno from public.reservas_turnos t
    where t.restaurante_id = v_rest.id and t.activo and p_hora between t.hora_inicio and t.hora_fin
    order by t.hora_inicio limit 1;
  end if;
  insert into public.reservas_lista_espera
    (cuenta_id, restaurante_id, fecha, nombre, telefono, pax, notas, hora_preferida, turno_id, zona_id, email, idioma, cliente_id)
  values
    (v_rest.cuenta_id, v_rest.id, p_fecha, btrim(p_nombre), v_tel, greatest(coalesce(p_pax, 1), 1), nullif(btrim(p_notas), ''),
     p_hora, v_turno, p_zona_id, reservas_norm_email(p_email), coalesce(nullif(p_idioma, ''), 'es'), v_cli)
  returning id, token into v_id, v_token;
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
end $$;
revoke execute on function public.reservas_apuntar_lista_espera_v2(text, date, text, text, integer, text, time, text, uuid, text) from anon, public, authenticated;

create or replace function public.reservas_apuntar_lista_espera(p_slug text, p_fecha date, p_nombre text, p_telefono text, p_pax integer, p_notas text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  v := reservas_apuntar_lista_espera_v2(p_slug, p_fecha, p_nombre, p_telefono, p_pax, p_notas);
  if v ? 'error' then return jsonb_build_object('error', v ->> 'error'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.reservas_apuntar_lista_espera(text, date, text, text, integer, text) from anon, public, authenticated;

-- ─── reservas_cancelar (legado localizador + teléfono: misma firma y salida) ──
-- Sigue viva para el widget actual. Ahora admite «reconfirmada» y sella cancelada_por =
-- 'cliente' (antes, al llamarse sin sesión, el trigger lo dejaba en 'sistema' y las
-- estadísticas perdían la cancelación del cliente).
create or replace function public.reservas_cancelar(p_localizador text, p_telefono text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_localizador), '') = '' or length(p_localizador) > 20 then
    return jsonb_build_object('error', 'NO_CANCELABLE');
  end if;
  select r.id into v_id
  from public.reservas_reservas r
  join public.reservas_clientes c on c.id = r.cliente_id
  where upper(r.localizador) = upper(btrim(p_localizador))
    and coalesce(c.telefono_norm, c.telefono) = reservas_norm_tel(p_telefono)
    and r.estado in ('pendiente', 'confirmada', 'reconfirmada')
    and r.fecha >= current_date
  limit 1;
  if not found then return jsonb_build_object('error', 'NO_CANCELABLE'); end if;
  update public.reservas_reservas
  set estado = 'cancelada', cancelada_por = 'cliente', cancelada_en = now()
  where id = v_id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.reservas_cancelar(text, text) from anon, public, authenticated;

-- ─── reservas_lista_espera_avisar(id, hora): «hay mesa» con enlace que reserva ──
-- La llama el panel (sesión): security invoker, RLS de la cuenta.
create or replace function public.reservas_lista_espera_avisar(p_id uuid, p_hora time)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_le public.reservas_lista_espera%rowtype;
  v_rest public.reservas_restaurantes%rowtype;
  v_vars jsonb;
  v_pl record;
  v_canal text;
  v_dest text;
  v_n integer := 0;
  v_enlace text;
begin
  select * into v_le from public.reservas_lista_espera where id = p_id;
  if not found then return jsonb_build_object('error', 'NO_ENCONTRADA'); end if;
  if v_le.estado not in ('esperando', 'avisado') then return jsonb_build_object('error', 'ESTADO_INVALIDO', 'estado', v_le.estado); end if;
  select * into v_rest from public.reservas_restaurantes where id = v_le.restaurante_id;
  v_enlace := reservas_url_base(v_rest.id) || '/reservar-mesa/' || v_rest.slug
              || '?fecha=' || to_char(v_le.fecha, 'YYYY-MM-DD') || '&hora=' || to_char(p_hora, 'HH24:MI')
              || '&pax=' || v_le.pax || '&espera=' || v_le.token;
  v_vars := jsonb_build_object(
    'nombre', v_le.nombre, 'restaurante', v_rest.nombre,
    'fecha', to_char(v_le.fecha, 'DD/MM/YYYY'), 'hora', to_char(p_hora, 'HH24:MI'), 'pax', v_le.pax::text,
    'localizador', '', 'enlace', v_enlace, 'enlace_cancelar', '', 'enlace_confirmar', '',
    'direccion', coalesce(v_rest.direccion, v_rest.ubicacion, ''), 'telefono', coalesce(v_rest.telefono, ''), 'mensaje', '');

  foreach v_canal in array array['email', 'sms', 'whatsapp'] loop
    if v_canal = 'email' then
      if not v_rest.envio_email then continue; end if;
      v_dest := reservas_norm_email(v_le.email);
    elsif v_canal = 'sms' then
      if not v_rest.envio_sms then continue; end if;
      v_dest := reservas_norm_tel(v_le.telefono);
    else
      if not v_rest.envio_whatsapp then continue; end if;
      v_dest := reservas_norm_tel(v_le.telefono);
    end if;
    if v_dest is null then continue; end if;
    select p.* into v_pl from public.reservas_plantillas p
    where p.cuenta_id = v_le.cuenta_id and p.activa and p.canal = v_canal and p.tipo = 'lista_espera'
      and (p.restaurante_id = v_rest.id or p.restaurante_id is null)
      and p.idioma in (coalesce(v_le.idioma, 'es'), 'es')
    order by (p.restaurante_id is not null) desc, (p.idioma = coalesce(v_le.idioma, 'es')) desc
    limit 1;
    if not found then continue; end if;
    insert into public.reservas_mensajes
      (cuenta_id, restaurante_id, lista_espera_id, cliente_id, canal, tipo, destinatario, asunto, cuerpo, creado_por)
    values
      (v_le.cuenta_id, v_rest.id, v_le.id, v_le.cliente_id, v_canal, 'lista_espera', v_dest,
       nullif(reservas_renderizar(v_pl.asunto, v_vars), ''), reservas_renderizar(v_pl.cuerpo, v_vars), auth.uid());
    v_n := v_n + 1;
  end loop;

  update public.reservas_lista_espera set estado = 'avisado', avisado_en = now(), hora_preferida = coalesce(hora_preferida, p_hora)
  where id = v_le.id;
  return jsonb_build_object('ok', true, 'encolados', v_n, 'enlace', v_enlace);
end $$;
revoke execute on function public.reservas_lista_espera_avisar(uuid, time) from anon, public;
grant execute on function public.reservas_lista_espera_avisar(uuid, time) to authenticated;

-- ─── reservas_ocupacion_mes: por día y turno (vista Mes) ─────────────────
create or replace function public.reservas_ocupacion_mes(p_restaurante uuid, p_desde date, p_hasta date)
returns table (
  fecha date, turno_id uuid, turno text, reservas integer, pax integer, aforo integer,
  mesas_ocupadas integer, mesas_total integer, cerrado boolean, max_pax_online integer, nota text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with dias as (
    select d::date as fecha from generate_series(p_desde::timestamp, least(p_hasta, p_desde + 92)::timestamp, interval '1 day') d
  ),
  mesas as (
    select count(*)::int as total, coalesce(sum(m.cap_max), 0)::int as aforo
    from public.reservas_mesas m join public.reservas_salas s on s.id = m.sala_id
    where s.restaurante_id = p_restaurante and s.activa and m.activa
  ),
  dia_cerrado as (
    select c.fecha from public.reservas_cierres c where c.restaurante_id = p_restaurante and c.turno_id is null
    union
    select q.fecha from public.reservas_cupos q where q.restaurante_id = p_restaurante and q.turno_id is null and q.cerrado
  )
  select
    d.fecha,
    t.id,
    t.nombre,
    agg.reservas,
    agg.pax,
    (select aforo from mesas),
    agg.mesas_ocupadas,
    (select total from mesas),
    (exists (select 1 from dia_cerrado dc where dc.fecha = d.fecha)
      or exists (select 1 from public.reservas_cierres c where c.restaurante_id = p_restaurante and c.fecha = d.fecha and c.turno_id = t.id)
      or coalesce(q.cerrado, false)),
    q.max_pax_online,
    coalesce(q.nota, (select q2.nota from public.reservas_cupos q2 where q2.restaurante_id = p_restaurante and q2.fecha = d.fecha and q2.turno_id is null))
  from dias d
  join public.reservas_turnos t on t.restaurante_id = p_restaurante and t.activo
    and extract(isodow from d.fecha)::int = any(t.dias_semana)
  left join public.reservas_cupos q on q.restaurante_id = p_restaurante and q.fecha = d.fecha and q.turno_id = t.id
  left join lateral (
    select count(*)::int as reservas,
           coalesce(sum(r.pax), 0)::int as pax,
           (select count(distinct rm.mesa_id)::int
            from public.reservas_reserva_mesas rm
            join public.reservas_reservas r2 on r2.id = rm.reserva_id
            where r2.restaurante_id = p_restaurante and r2.fecha = d.fecha
              and r2.estado = any(reservas_estados_activos() || reservas_estados_visita())
              and (r2.turno_id = t.id or (r2.turno_id is null and r2.hora between t.hora_inicio and t.hora_fin))) as mesas_ocupadas
    from public.reservas_reservas r
    where r.restaurante_id = p_restaurante and r.fecha = d.fecha
      and r.estado = any(reservas_estados_activos() || reservas_estados_visita())
      and (r.turno_id = t.id or (r.turno_id is null and r.hora between t.hora_inicio and t.hora_fin))
  ) agg on true
  order by d.fecha, t.hora_inicio
$$;
revoke execute on function public.reservas_ocupacion_mes(uuid, date, date) from anon, public;
grant execute on function public.reservas_ocupacion_mes(uuid, date, date) to authenticated;

-- ─── reservas_estadisticas(restaurante null, desde, hasta) → json de cuadro de mando ──
-- security invoker: RLS limita a la cuenta. Ocupación % = pax atendidos / (Σ aforo × turnos × días).
-- «Asistencia presunta»: una reserva pasada que se quedó en pendiente/confirmada/reconfirmada
-- (locales que no marcan llegadas) cuenta como visita en no_show_pct y ocupacion_pct, nunca como
-- no-show (como hace Cover con «Confirmadas»); se devuelve aparte en sin_cerrar.
create or replace function public.reservas_estadisticas(p_restaurante uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_dias integer;
  v_cap numeric;
  v_tot jsonb;
  v_dia jsonb;
  v_semana jsonb;
  v_turno jsonb;
  v_canales jsonb;
  v_origenes jsonb;
  v_presc jsonb;
  v_estados jsonb;
  v_nuevos jsonb;
  v_usuarios jsonb;
  v_horas jsonb;
begin
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    return jsonb_build_object('error', 'RANGO_INVALIDO');
  end if;
  v_dias := p_hasta - p_desde + 1;

  -- Capacidad diaria: Σ por restaurante (aforo activo × turnos activos).
  select coalesce(sum(a.aforo * a.turnos), 0) into v_cap
  from (
    select rr.id,
      (select coalesce(sum(m.cap_max), 0) from public.reservas_mesas m join public.reservas_salas s on s.id = m.sala_id
        where s.restaurante_id = rr.id and s.activa and m.activa) as aforo,
      (select count(*) from public.reservas_turnos t where t.restaurante_id = rr.id and t.activo) as turnos
    from public.reservas_restaurantes rr
    where rr.activo and (p_restaurante is null or rr.id = p_restaurante)
  ) a;

  select jsonb_build_object(
    'reservas', count(*),
    'pax', coalesce(sum(r.pax), 0),
    'reservas_atendidas', count(*) filter (where r.estado = any(reservas_estados_visita())),
    'pax_atendidos', coalesce(sum(r.pax) filter (where r.estado = any(reservas_estados_visita())), 0),
    'reservas_vivas', count(*) filter (where r.estado = any(reservas_estados_activos())),
    'pax_vivos', coalesce(sum(r.pax) filter (where r.estado = any(reservas_estados_activos())), 0),
    'no_shows', count(*) filter (where r.estado = 'no_show'),
    'sin_cerrar', count(*) filter (where r.estado in ('pendiente', 'confirmada', 'reconfirmada', 'a_revisar') and r.fecha < current_date),
    'no_show_pct', round(100.0 * count(*) filter (where r.estado = 'no_show')
      / nullif(count(*) filter (where r.estado = any(reservas_estados_visita()) or r.estado = 'no_show'
                                   or (r.estado in ('pendiente', 'confirmada', 'reconfirmada') and r.fecha < current_date)), 0), 1),
    'canceladas', count(*) filter (where r.estado = 'cancelada'),
    'canceladas_pct', round(100.0 * count(*) filter (where r.estado = 'cancelada') / nullif(count(*), 0), 1),
    'canceladas_cliente', count(*) filter (where r.estado = 'cancelada' and r.cancelada_por = 'cliente'),
    'canceladas_restaurante', count(*) filter (where r.estado = 'cancelada' and r.cancelada_por = 'restaurante'),
    'canceladas_tardias', count(*) filter (where r.estado = 'cancelada' and r.cancelada_en is not null
      and r.cancelada_en > reservas_ts(r.fecha, r.hora, rr.zona_horaria) - make_interval(hours => rr.politica_cancelacion_horas)),
    'pax_medio', round(avg(r.pax) filter (where r.estado = any(reservas_estados_visita())), 2),
    'antelacion_media_horas', round(avg(extract(epoch from (reservas_ts(r.fecha, r.hora, rr.zona_horaria) - r.creado_en)) / 3600.0)
      filter (where r.origen = 'online' and r.creado_en < reservas_ts(r.fecha, r.hora, rr.zona_horaria)), 1),
    'ocupacion_pct', round(100.0 * coalesce(sum(r.pax) filter (where r.estado = any(reservas_estados_visita())
                                   or (r.estado in ('pendiente', 'confirmada', 'reconfirmada') and r.fecha < current_date)), 0)
      / nullif(v_cap * v_dias, 0), 1),
    'capacidad_periodo', v_cap * v_dias,
    'valoraciones', count(r.valoracion),
    'valoracion_media', round(avg(r.valoracion), 2),
    'nps', round(100.0 * (count(*) filter (where (r.valoracion_detalle ->> 'nps')::numeric >= 9)
                          - count(*) filter (where (r.valoracion_detalle ->> 'nps')::numeric <= 6))
      / nullif(count(*) filter (where r.valoracion_detalle ? 'nps'), 0), 0),
    'con_garantia', count(*) filter (where r.tipo in ('garantia', 'politica_cancelacion')),
    'con_prepago', count(*) filter (where r.tipo in ('prepago', 'experiencia')),
    'cobros_noshow', count(*) filter (where r.estado_pago = 'cobrado_noshow')
  ) into v_tot
  from public.reservas_reservas r
  join public.reservas_restaurantes rr on rr.id = r.restaurante_id
  where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta;

  select coalesce(jsonb_agg(x order by x.fecha), '[]'::jsonb) into v_dia
  from (
    select r.fecha,
      count(*) filter (where r.estado <> 'cancelada') as reservas,
      coalesce(sum(r.pax) filter (where r.estado <> 'cancelada' and r.estado <> 'no_show'), 0) as pax,
      count(*) filter (where r.estado = 'no_show') as no_shows,
      count(*) filter (where r.estado = 'cancelada') as canceladas,
      round(100.0 * coalesce(sum(r.pax) filter (where r.estado = any(reservas_estados_visita())
                               or (r.estado in ('pendiente', 'confirmada', 'reconfirmada') and r.fecha < current_date)), 0)
        / nullif(v_cap, 0), 1) as ocupacion_pct
    from public.reservas_reservas r
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
    group by r.fecha
  ) x;

  select coalesce(jsonb_agg(x order by x.semana), '[]'::jsonb) into v_semana
  from (
    select date_trunc('week', r.fecha)::date as semana,
      count(*) filter (where r.estado <> 'cancelada') as reservas,
      coalesce(sum(r.pax) filter (where r.estado = any(reservas_estados_visita()) or r.estado = any(reservas_estados_activos())), 0) as pax,
      count(*) filter (where r.estado = 'no_show') as no_shows,
      round(100.0 * coalesce(sum(r.pax) filter (where r.estado = any(reservas_estados_visita())
                               or (r.estado in ('pendiente', 'confirmada', 'reconfirmada') and r.fecha < current_date)), 0)
        / nullif(v_cap * count(distinct r.fecha), 0), 1) as ocupacion_pct
    from public.reservas_reservas r
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
    group by 1
  ) x;

  select coalesce(jsonb_agg(x order by x.restaurante, x.hora_inicio), '[]'::jsonb) into v_turno
  from (
    select rr.nombre as restaurante, t.id as turno_id, t.nombre as turno, t.hora_inicio,
      count(r.id) filter (where r.estado <> 'cancelada') as reservas,
      coalesce(sum(r.pax) filter (where r.estado = any(reservas_estados_visita()) or r.estado = any(reservas_estados_activos())), 0) as pax,
      count(r.id) filter (where r.estado = 'no_show') as no_shows
    from public.reservas_turnos t
    join public.reservas_restaurantes rr on rr.id = t.restaurante_id
    left join public.reservas_reservas r on r.restaurante_id = t.restaurante_id and r.fecha between p_desde and p_hasta
      and (r.turno_id = t.id or (r.turno_id is null and r.hora between t.hora_inicio and t.hora_fin))
    where (p_restaurante is null or t.restaurante_id = p_restaurante) and t.activo
    group by rr.nombre, t.id, t.nombre, t.hora_inicio
  ) x;

  select coalesce(jsonb_agg(x order by x.reservas desc), '[]'::jsonb) into v_horas
  from (
    select to_char(r.hora, 'HH24:MI') as hora, count(*) as reservas, coalesce(sum(r.pax), 0) as pax
    from public.reservas_reservas r
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
      and r.estado <> 'cancelada'
    group by r.hora
  ) x;

  select coalesce(jsonb_agg(x order by x.reservas desc), '[]'::jsonb) into v_canales
  from (
    select coalesce(r.canal, r.origen) as canal, count(*) as reservas, coalesce(sum(r.pax), 0) as pax,
      count(*) filter (where r.estado = 'no_show') as no_shows, count(*) filter (where r.estado = 'cancelada') as canceladas
    from public.reservas_reservas r
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
    group by 1
  ) x;

  select coalesce(jsonb_agg(x order by x.reservas desc), '[]'::jsonb) into v_origenes
  from (
    select r.origen, count(*) as reservas, coalesce(sum(r.pax), 0) as pax
    from public.reservas_reservas r
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
    group by r.origen
  ) x;

  select coalesce(jsonb_agg(x order by x.reservas desc), '[]'::jsonb) into v_presc
  from (
    select p.nombre as prescriptor, p.tipo, count(*) as reservas, coalesce(sum(r.pax), 0) as pax
    from public.reservas_reservas r
    join public.reservas_prescriptores p on p.id = r.prescriptor_id
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
      and r.estado <> 'cancelada'
    group by p.nombre, p.tipo
    order by 3 desc
    limit 15
  ) x;

  select coalesce(jsonb_agg(x order by x.reservas desc), '[]'::jsonb) into v_estados
  from (
    select r.estado, count(*) as reservas, coalesce(sum(r.pax), 0) as pax
    from public.reservas_reservas r
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
    group by r.estado
  ) x;

  select jsonb_build_object(
    'nuevos', count(*) filter (where x.primera_en_rango = y.primera),
    'recurrentes', count(*) filter (where x.primera_en_rango > y.primera),
    'clientes', count(*)
  ) into v_nuevos
  from (
    select r.cliente_id, min(r.fecha) as primera_en_rango
    from public.reservas_reservas r
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
      and r.estado = any(reservas_estados_visita()) and r.cliente_id is not null
    group by r.cliente_id
  ) x
  join lateral (
    select min(r2.fecha) as primera from public.reservas_reservas r2
    where r2.cliente_id = x.cliente_id and r2.estado = any(reservas_estados_visita())
  ) y on true;

  select coalesce(jsonb_agg(x order by x.reservas desc), '[]'::jsonb) into v_usuarios
  from (
    select coalesce(pf.nombre, pf.correo, 'sin usuario') as usuario, count(*) as reservas, coalesce(sum(r.pax), 0) as pax
    from public.reservas_reservas r
    left join public.perfiles pf on pf.id = coalesce(r.anotado_por, r.creado_por)
    where (p_restaurante is null or r.restaurante_id = p_restaurante) and r.fecha between p_desde and p_hasta
      and r.origen <> 'online'
    group by 1
  ) x;

  return jsonb_build_object(
    'desde', to_char(p_desde, 'YYYY-MM-DD'),
    'hasta', to_char(p_hasta, 'YYYY-MM-DD'),
    'dias', v_dias,
    'totales', v_tot,
    'por_dia', v_dia,
    'por_semana', v_semana,
    'por_turno', v_turno,
    'por_hora', v_horas,
    'por_estado', v_estados,
    'canales', v_canales,
    'origenes', v_origenes,
    'prescriptores', v_presc,
    'clientes', v_nuevos,
    'usuarios', v_usuarios
  );
end $$;
revoke execute on function public.reservas_estadisticas(uuid, date, date) from anon, public;
grant execute on function public.reservas_estadisticas(uuid, date, date) to authenticated;

-- ─── reservas_tracking(restaurante null, desde, hasta): tabla plana para exportar ──
create or replace function public.reservas_tracking(p_restaurante uuid, p_desde date, p_hasta date)
returns table (
  reserva_id uuid, localizador text, cover_id text, restaurante text, fecha date, hora time, duracion_min integer,
  pax integer, pax_llegados integer, estado text, tipo text, estado_pago text, importe_garantia numeric,
  importe_prepago numeric, origen text, canal text, cliente_id uuid, cliente_nombre text, cliente_apellidos text,
  telefono text, email text, idioma text, pais text, zona text, mesas text, camarero text, prescriptor text,
  empresa text, referencia text, etiquetas text, alergias text, notas_cliente text, notas_internas text,
  anotado_por text, experiencia text, codigo_promo text, consentimiento_marketing boolean,
  creado_en timestamptz, actualizado_en timestamptz, llegada_en timestamptz, sentada_en timestamptz,
  salida_en timestamptz, reconfirmada_en timestamptz, cancelada_en timestamptz, cancelada_por text,
  motivo_cancelacion text, valoracion integer, valoracion_comentario text, recordatorio_enviado_en timestamptz,
  mensajes_enviados integer, riesgo_no_show numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    r.id, r.localizador, r.cover_id, rr.nombre, r.fecha, r.hora, r.duracion_min,
    r.pax, r.pax_llegados, r.estado, r.tipo, r.estado_pago, r.importe_garantia,
    r.importe_prepago, r.origen, r.canal, c.id, c.nombre, c.apellidos,
    c.telefono, c.email, r.idioma, coalesce(r.pais, c.pais),
    (select s.nombre from public.reservas_salas s where s.id = coalesce(r.zona_id, (select m0.sala_id from public.reservas_mesas m0 where m0.id = r.mesa_id))),
    (select string_agg(coalesce(m.etiqueta, m.nombre), ' + ' order by m.nombre)
       from public.reservas_reserva_mesas rm join public.reservas_mesas m on m.id = rm.mesa_id where rm.reserva_id = r.id),
    (select cm.nombre from public.reservas_camareros cm where cm.id = r.camarero_id),
    (select p.nombre from public.reservas_prescriptores p where p.id = r.prescriptor_id),
    coalesce(r.empresa, c.empresa), r.referencia,
    (select string_agg(e.nombre, ', ' order by e.orden) from public.reservas_etiquetas e where e.id = any(r.etiquetas)),
    coalesce(r.alergias, c.alergias), r.notas_cliente, r.notas_internas,
    (select coalesce(pf.nombre, pf.correo) from public.perfiles pf where pf.id = coalesce(r.anotado_por, r.creado_por)),
    (select e.nombre from public.reservas_experiencias e where e.id = r.experiencia_id),
    r.codigo_promo, coalesce(r.consentimiento_marketing, c.consentimiento_marketing),
    r.creado_en, r.actualizado_en, r.llegada_en, r.sentada_en,
    r.salida_en, r.reconfirmada_en, r.cancelada_en, r.cancelada_por,
    r.motivo_cancelacion, r.valoracion, r.valoracion_comentario, r.recordatorio_enviado_en,
    (select count(*)::int from public.reservas_mensajes m where m.reserva_id = r.id and m.estado in ('enviado', 'entregado', 'abierto')),
    (select st.riesgo_no_show from public.reservas_clientes_stats st where st.cliente_id = c.id)
  from public.reservas_reservas r
  join public.reservas_restaurantes rr on rr.id = r.restaurante_id
  left join public.reservas_clientes c on c.id = r.cliente_id
  where (p_restaurante is null or r.restaurante_id = p_restaurante)
    and r.fecha between p_desde and p_hasta
  order by r.fecha, r.hora, rr.nombre, r.localizador
$$;
revoke execute on function public.reservas_tracking(uuid, date, date) from anon, public;
grant execute on function public.reservas_tracking(uuid, date, date) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.8 CRON (las llama /api/cron/reservas-mensajes con la service key; solo marcan,
--     el cobro y los envíos los decide el servidor). Sin grant a authenticated.
-- ═══════════════════════════════════════════════════════════════════════════

-- Confirmadas/pendientes que llevan liberar_tras_min sin llegada → a_revisar.
-- Solo en restaurantes con noshow_automatico (los que marcan llegadas en el panel).
create or replace function public.reservas_marcar_a_revisar()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.reservas_reservas r
  set estado = 'a_revisar'
  from public.reservas_restaurantes rr
  where rr.id = r.restaurante_id
    and rr.noshow_automatico
    and r.estado in ('pendiente', 'confirmada', 'reconfirmada')
    and r.llegada_en is null
    and r.fecha between current_date - 1 and current_date
    and reservas_ts(r.fecha, r.hora, rr.zona_horaria) + make_interval(mins => rr.liberar_tras_min) < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.reservas_marcar_a_revisar() from anon, public, authenticated;

-- Al cierre del turno (fin_servicio o hora_fin + duración, +30 min) sin llegada → no_show.
-- Devuelve las marcadas y si procede cargo de garantía (cobrar = política del restaurante).
-- Solo con noshow_automatico; una solicitud de grupo grande que el restaurante nunca contestó
-- (pendiente, online, sin mesa) no es un no-show del cliente.
create or replace function public.reservas_noshow_automatico()
returns table (reserva_id uuid, cuenta_id uuid, restaurante_id uuid, tipo text, estado_pago text, importe numeric, cobrar boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with cand as (
    select r.id
    from public.reservas_reservas r
    join public.reservas_restaurantes rr on rr.id = r.restaurante_id
    left join public.reservas_turnos t on t.id = r.turno_id
    where r.estado in ('pendiente', 'confirmada', 'reconfirmada', 'a_revisar')
      and rr.noshow_automatico
      and not (r.estado = 'pendiente' and r.mesa_id is null and r.origen = 'online')
      and r.llegada_en is null
      and r.fecha between current_date - 2 and current_date
      and now() > greatest(
            reservas_ts(r.fecha, r.hora, rr.zona_horaria) + make_interval(mins => coalesce(r.duracion_min, 120)),
            case when t.id is not null
                 then reservas_ts(r.fecha, coalesce(t.fin_servicio, t.hora_fin), rr.zona_horaria)
                      + case when t.fin_servicio is null then make_interval(mins => t.duracion_min) else interval '0' end
                 else '-infinity'::timestamptz end
          ) + interval '30 minutes'
  ),
  upd as (
    update public.reservas_reservas r
    set estado = 'no_show'
    from cand
    where r.id = cand.id
    returning r.id, r.cuenta_id, r.restaurante_id, r.tipo, r.estado_pago, r.importe_garantia
  )
  select u.id, u.cuenta_id, u.restaurante_id, u.tipo, u.estado_pago, u.importe_garantia,
         (rr.cobro_noshow_automatico and u.estado_pago = 'garantizada'
          and u.tipo in ('garantia', 'politica_cancelacion') and coalesce(u.importe_garantia, 0) > 0)
  from upd u
  join public.reservas_restaurantes rr on rr.id = u.restaurante_id;
end $$;
revoke execute on function public.reservas_noshow_automatico() from anon, public, authenticated;

-- tarjeta_pendiente que supera tarjeta_caduca_min → cancelada por el sistema (libera la mesa).
-- Cuenta desde tarjeta_solicitada_en (alta online o «Solicitar tarjeta» del panel), no desde
-- creado_en: una reserva antigua a la que se le pide tarjeta no caduca en la siguiente pasada.
create or replace function public.reservas_caducar_tarjeta_pendiente()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.reservas_reservas r
  set estado = 'cancelada', cancelada_por = 'sistema', cancelada_en = now(),
      motivo_cancelacion = 'Tarjeta no introducida a tiempo'
  from public.reservas_restaurantes rr
  where rr.id = r.restaurante_id
    and r.estado = 'tarjeta_pendiente'
    and coalesce(r.tarjeta_solicitada_en, r.creado_en) + make_interval(mins => rr.tarjeta_caduca_min) < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.reservas_caducar_tarjeta_pendiente() from anon, public, authenticated;

-- Autotags: aplica las etiquetas automáticas a los clientes que cumplen la condición.
create or replace function public.reservas_aplicar_autotags()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a record;
  v_n integer := 0;
  v_k integer;
begin
  for v_a in select * from public.reservas_autotags where activa loop
    update public.reservas_clientes c
    set etiquetas = c.etiquetas || v_a.etiqueta_id
    from (
      select r.cliente_id, count(*) as n
      from public.reservas_reservas r
      where r.cuenta_id = v_a.cuenta_id and r.cliente_id is not null
        and r.fecha >= current_date - v_a.periodo_dias
        and case v_a.condicion
              when 'no_show' then r.estado = 'no_show'
              when 'cancelar' then r.estado = 'cancelada'
              else r.estado = any(reservas_estados_visita())
            end
      group by r.cliente_id
    ) x
    where c.id = x.cliente_id and c.cuenta_id = v_a.cuenta_id
      and not (v_a.etiqueta_id = any(c.etiquetas))
      and case v_a.operador
            when '>=' then x.n >= v_a.n
            when '=' then x.n = v_a.n
            else x.n <= v_a.n
          end;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end $$;
revoke execute on function public.reservas_aplicar_autotags() from anon, public, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (para el orquestador; solo lectura)
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Tablas nuevas (esperadas 19):
--    select count(*) from information_schema.tables where table_schema = 'public' and table_name in (
--      'reservas_plano_objetos','reservas_cupos','reservas_bloqueos','reservas_notas_dia','reservas_etiquetas',
--      'reservas_prescriptores','reservas_experiencias','reservas_mesas_combinaciones','reservas_camareros',
--      'reservas_mesas_camarero_dia','reservas_preguntas','reservas_codigos','reservas_autotags',
--      'reservas_permisos_perfil','reservas_reservas_historial','reservas_plantillas','reservas_mensajes',
--      'reservas_pagos','reservas_clientes_stats');
-- 2) Seeds Bonita: etiquetas 46 (20 reserva / 12 cliente / 14 alergeno), prescriptores 23 (20 hotel + 3 canal),
--    plantillas 72 (12 tipos × 3 canales × 2 idiomas); bar-tamarindos con noshow_automatico = false:
--    select (select count(*) from reservas_etiquetas where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd') as etiquetas,
--           (select count(*) from reservas_prescriptores where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd') as prescriptores,
--           (select count(*) from reservas_plantillas where cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and restaurante_id is null) as plantillas;
--    select ambito, count(*) from reservas_etiquetas group by 1 order by 1;  -- alergeno 14 / cliente 12 / reserva 20
-- 3) Token: 0 reservas sin token y 26.339 (o el total actual) distintos; cada mesa con ancho/alto;
--    4 restaurantes con duracion_por_pax y mensaje_widget:
--    select count(*) filter (where token is null) as sin_token, count(distinct token) as distintos, count(*) as total from reservas_reservas;
--    select count(*) from reservas_mesas where ancho is null or alto is null;               -- 0
--    select count(*) from reservas_restaurantes where duracion_por_pax is null or mensaje_widget is null;  -- 0
-- 4) Check de estado ampliado (13 valores) y estados actuales intactos:
--    select pg_get_constraintdef(oid) from pg_constraint where conname = 'reservas_reservas_estado_check';
--    select estado, count(*) from reservas_reservas group by 1 order by 2 desc;
--    -- sentada 10369 / terminada 8595 / cancelada 5325 / no_show 1075 / confirmada 966 / pendiente 9 (a 01-10-2026)
-- 5) Triggers de reservas_reservas (esperados 6: touch, sync_mesa, email_ins, email_upd, sellar, log):
--    select tgname from pg_trigger where tgrelid = 'public.reservas_reservas'::regclass and not tgisinternal order by 1;
--    select count(*) from reservas_reservas_historial;  -- 0 justo tras la migración (no se genera historial del backfill)
-- 6) Funciones v1 intactas (misma firma) y v2 nuevas:
--    select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname in (
--      'reservas_disponibilidad','reservas_disponibilidad_v2','reservas_crear_online','reservas_crear_online_v2',
--      'reservas_mejor_mesa','reservas_mejor_mesa_v2','reservas_mesas_libres','reservas_mesas_libres_v2',
--      'reservas_gestion','reservas_gestion_cancelar','reservas_gestion_confirmar','reservas_gestion_modificar',
--      'reservas_gestion_valorar','reservas_programar_mensajes','reservas_mensaje_encolar','reservas_estadisticas',
--      'reservas_tracking','reservas_ocupacion_mes','reservas_marcar_a_revisar','reservas_noshow_automatico',
--      'reservas_caducar_tarjeta_pendiente','reservas_aplicar_autotags','reservas_fusionar_clientes',
--      'reservas_lista_espera_avisar','reservas_apuntar_lista_espera','reservas_apuntar_lista_espera_v2',
--      'reservas_cupo_motivo','reservas_token_valido','reservas_cancelar')
--    order by 1;
--    -- y ninguna función reservas_* de servidor/cron ejecutable por authenticated (esperado 0 filas):
--    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('reservas_mensaje_encolar','reservas_disponibilidad','reservas_disponibilidad_v2',
--      'reservas_crear_online','reservas_crear_online_v2','reservas_gestion','reservas_gestion_confirmar','reservas_gestion_cancelar',
--      'reservas_gestion_modificar','reservas_gestion_valorar','reservas_apuntar_lista_espera','reservas_apuntar_lista_espera_v2',
--      'reservas_cancelar','reservas_marcar_a_revisar','reservas_noshow_automatico','reservas_caducar_tarjeta_pendiente','reservas_aplicar_autotags')
--      and has_function_privilege('authenticated', p.oid, 'execute');
--    -- y ninguna tabla reservas_* con TRUNCATE/REFERENCES/TRIGGER para authenticated ni nada para anon (esperado 0 filas):
--    select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name like 'reservas\_%' and table_name <> 'reservas_clientes_stats'
--      and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')));
-- 7) Disponibilidad v1 (misma forma que antes: horas como strings) y v2 (objetos con plazas):
--    select reservas_disponibilidad('binifadet', current_date + 3, 2);
--    select reservas_disponibilidad_v2('binifadet', current_date + 3, 2, null, null);
--    select reservas_disponibilidad_v2('binifadet', current_date + 3, 8, null, null);  -- horas con plazas 1 (uniones), no «completo»
--    select reservas_mesa_ocupada(m.id, current_date + 3, '22:30', 150) from reservas_mesas m limit 1;  -- no da la vuelta a medianoche
--    select reservas_duracion_pax('f876b0d6-6495-456b-aa84-c144c50af0a3', 2, 120);  -- 90
--    select reservas_duracion_pax('f876b0d6-6495-456b-aa84-c144c50af0a3', 10, 120); -- 180
-- 8) Vista de stats y riesgo (0–1):
--    select count(*), max(riesgo_no_show), count(*) filter (where riesgo_no_show > 0.5) from reservas_clientes_stats;
-- 9) Privilegios: historial y pagos solo lectura para authenticated (esperado 0 filas):
--    select table_name, privilege_type from information_schema.role_table_grants
--    where grantee = 'authenticated' and table_name in ('reservas_reservas_historial', 'reservas_pagos')
--      and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
--    -- y anon sin nada en las tablas nuevas:
--    select table_name from information_schema.role_table_grants where grantee = 'anon' and table_name in
--      ('reservas_mensajes','reservas_pagos','reservas_plantillas','reservas_cupos','reservas_etiquetas');
-- 10) Mensajería (prueba con transacción que se revierte):
--    begin;
--      select reservas_crear_online_v2('binifadet', current_date + 3, '13:30', 2, 'Prueba', '600000000', 'prueba@example.com', null);
--      select canal, tipo, estado, programado_para, destinatario from reservas_mensajes order by programado_para;
--      -- esperado: confirmacion (ahora) y recordatorio (−24 h) por email; sin valoracion (se encola al
--      -- marcar llegada/sentada; en bar-tamarindos, noshow_automatico = false, al confirmarla);
--      -- sin reconfirmación (gratis y < 6 pax); sin filas en reservas_emails_salientes.
--      update reservas_reservas set estado = 'confirmada' where localizador = (select localizador from reservas_reservas order by creado_en desc limit 1);
--      select canal, tipo, estado from reservas_mensajes order by creado_en;  -- la 'confirmacion' pasa a cancelado y aparece 'confirmada'
--      select count(*) from reservas_emails_salientes where creado_en > now() - interval '1 minute';  -- 0
--    rollback;
--    -- Una reserva de panel sin notificar no encola nada:
--    begin;
--      insert into reservas_reservas (cuenta_id, localizador, restaurante_id, fecha, hora, pax, estado, origen)
--      values ('082c5366-d9ae-49b9-a8b8-8caad73985bd', 'PRUEBA1', 'f876b0d6-6495-456b-aa84-c144c50af0a3', current_date + 3, '13:30', 2, 'confirmada', 'panel');
--      select count(*) from reservas_mensajes where reserva_id = (select id from reservas_reservas where localizador = 'PRUEBA1');  -- 0
--    rollback;
-- 11) Cron (no deben fallar; devuelven 0 si no hay nada que marcar):
--    select reservas_marcar_a_revisar(), reservas_caducar_tarjeta_pendiente(), reservas_aplicar_autotags();
--    select * from reservas_noshow_automatico();
