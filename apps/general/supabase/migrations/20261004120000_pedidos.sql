-- Pedidos a proveedores (04-10-2026): pedido por voz/texto/catálogo, catálogo de proveedor con
-- sus códigos, aprendizaje de alias y cotejo pedido ↔ albarán ↔ factura.
--
-- Contrato: docs/pedidos-plan.md (§1). Lo que dice la base hoy (consultado el 04-10-2026) y que
-- condiciona el diseño:
--   * compras_doc.tipo solo vale 'albaran' (4.397) o 'factura' (2.522).
--   * Las LÍNEAS (compras_linea) están solo en albaranes: 0 facturas con líneas. Los albaranes
--     NO tienen reparto (4 de 4.397, ninguno con centro de coste) pero SIEMPRE traen canal
--     (= nombre del centro en mayúsculas). El reparto (compras_doc_reparto.centro_coste) está en
--     las facturas.
--   * compras_doc.factura_id está vacío en todos los documentos; el enlace albarán → factura
--     vive en compras_doc.albaranes_detectados de la factura ([{num_albaran, fecha, importe}]),
--     que casa con compras_doc.num_documento del albarán (mejor normalizando: 1.485 vs 1.408).
--   * compras_centro_coste (codigo, canal) no tiene centro_id: se llega a centros.id por nombre
--     normalizado dentro de la misma cuenta (pedidos_norm(centros.nombre) = pedidos_norm(canal));
--     los 8 centros de coste casan 1:1 con los 8 centros de Bonita.
--   * compras_producto ya tiene UNIQUE (proveedor_id, ref_proveedor) (distingue mayúsculas) y hay
--     1 grupo duplicado por lower(ref_proveedor) (DISTNURA «Si41487» SALSA TAHINA 1KG, 0 usos /
--     «SI41487» CEXAC ACEITE, 8 usos): el índice único por lower() se crea solo si no hay
--     duplicados al aplicar (bloque DO); si los hay, índice normal + NOTICE. ANTES DE APLICAR,
--     el chat debería corregir la ref de la tahina (a null o a su código real) para que salga el
--     único (el importador de catálogo hace upsert por lower(ref_proveedor)). Si se reaplica ya
--     sin duplicados, el DO borra el índice normal y deja solo el único.
--   * compras_concil_confirmada (factura_id, albaran_id, num_albaran; la escribe Compras a mano,
--     34 pares hoy, sin cuenta_id y RLS «todo») es el enlace albarán → factura confirmado: el
--     cotejo y las sugerencias la leen (siempre con factura y albarán ya filtrados por cuenta),
--     igual que compras_doc.factura_id (vacío hoy, enlace previsto).
--   * Ya existen clave_producto(text) (normalizador de nombres de producto que usa Compras para
--     enlazar líneas) y norm_nom(text) (quita sufijos societarios: no sirve para frases). Se usa
--     clave_producto para casar por nombre y una función nueva pedidos_norm para frases.
--
-- Reglas:
--   * SOLO ADITIVA e idempotente: columnas nuevas con «add column if not exists», tablas con
--     «create table if not exists», políticas con drop + create, seeds con on conflict.
--   * RLS en toda tabla nueva: cuenta_id = (select cuenta_actual()) or (select es_operador()).
--     Nada para anon. Los default privileges del proyecto dan TRUNCATE/REFERENCES/TRIGGER/
--     MAINTAIN (PG17) a authenticated y EXECUTE a anon/authenticated en funciones nuevas: se
--     revocan.
--   * Coherencia de cuenta en la escritura (las FK se saltan la RLS): la WITH CHECK exige que
--     centro, proveedor, producto y documentos referenciados sean de la MISMA cuenta que la fila
--     (patrón de reservas_mensajes). Las funciones filtran además por cuenta al leer documentos
--     y productos referenciados (filas antiguas y operador).
--   * Auditoría: creado_por/creado_en/enviado_por/enviado_en los fija el trigger con auth.uid()
--     y now() cuando hay sesión (el cliente no los puede falsear). Con service role / postgres
--     (auth.uid() null) se respetan los que vengan.
--   * Resultado del cotejo (cotejo_estado/detalle/cotejado_en del pedido; cantidad_/precio_
--     albaran/factura y estado_cotejo de la línea) solo lo escribe pedidos_cotejar() (marca de
--     transacción pedidos.cotejando). Con sesión, fuera de ella, se conservan los valores; en la
--     línea solo se permite la marca manual «sustituido» (y quitarla).
--   * Funciones con set search_path = public, pg_temp; security invoker salvo el numerador de
--     pedidos (security definer: el contador no lo puede tocar nadie desde el panel).
--   * check_function_bodies = on: las funciones language sql se crean DESPUÉS de las columnas y
--     tablas que citan.
--   * Seeds con cuenta_id explícito de Bonita (082c5366-d9ae-49b9-a8b8-8caad73985bd).
--
-- Orden del fichero:
--   0. helpers: pedidos_norm, pedidos_norm_num, pedidos_unidad_norm
--   1. compras_proveedor (+columnas de pedido)
--   2. compras_producto (+columnas de catálogo, índices)
--   3. compras_pedido + numerador por cuenta y año + triggers (número, sello, envío, cotejo)
--   4. compras_pedido_linea + triggers (cuenta desde el pedido, protección del cotejo, total)
--   5. compras_pedido_alias + trigger frase_norm/creado_por + pedidos_aprender_alias
--   6. compras_catalogo_import + trigger de sello (creado_por/creado_en)
--   7. funciones: pedidos_catalogo_centro, pedidos_sugerir_documentos, pedidos_cotejo_casar,
--      pedidos_cotejar
--   8. seeds: módulo 'pedidos' y contratación para Bonita
--   VERIFICACIÓN (comentarios con selects)

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

-- Frase normalizada: minúsculas, sin acentos (castellano y catalán, «l·l» → «ll»), sin signos,
-- espacios simples. Vacío → null.
create or replace function public.pedidos_norm(t text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(
    translate(lower(coalesce(t, '')),
              'áàäâãéèëêíìïîóòöôõúùüûñç·',
              'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', ' ', 'g')), '')
$$;
revoke execute on function public.pedidos_norm(text) from anon, public;
grant execute on function public.pedidos_norm(text) to authenticated;

-- Número de documento normalizado para casar albaranes: solo letras/dígitos, mayúsculas, sin
-- ceros a la izquierda («04/118» → «4118», «155.340» → «155340»).
create or replace function public.pedidos_norm_num(t text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select nullif(ltrim(regexp_replace(upper(coalesce(t, '')), '[^A-Z0-9]', '', 'g'), '0'), '')
$$;
revoke execute on function public.pedidos_norm_num(text) from anon, public;
grant execute on function public.pedidos_norm_num(text) to authenticated;

-- Unidad canónica (castellano y catalán, singular/plural, abreviaturas). Lo desconocido se
-- devuelve normalizado tal cual.
create or replace function public.pedidos_unidad_norm(t text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when s.x is null then null
    when s.x in ('u', 'ud', 'uds', 'un', 'und', 'unidad', 'unidades', 'unitat', 'unitats', 'pieza', 'piezas', 'pza', 'pzas', 'peca', 'peces') then 'unidad'
    when s.x in ('kg', 'kgs', 'kilo', 'kilos', 'quilo', 'quilos', 'kilogramo', 'kilogramos', 'quilogram', 'quilograms') then 'kg'
    when s.x in ('g', 'gr', 'grs', 'gramo', 'gramos', 'gram', 'grams') then 'g'
    when s.x in ('l', 'lt', 'lts', 'litro', 'litros', 'litre', 'litres') then 'litro'
    when s.x in ('caja', 'cajas', 'caixa', 'caixes', 'cj', 'cja', 'cjs') then 'caja'
    when s.x in ('paquete', 'paquetes', 'paq', 'pack', 'packs', 'paquet', 'paquets') then 'paquete'
    when s.x in ('docena', 'docenas', 'dotzena', 'dotzenes', 'dz', 'doc') then 'docena'
    when s.x in ('saco', 'sacos', 'sac', 'sacs') then 'saco'
    when s.x in ('garrafa', 'garrafas', 'garrafes') then 'garrafa'
    when s.x in ('botella', 'botellas', 'ampolla', 'ampolles', 'bot') then 'botella'
    when s.x in ('bandeja', 'bandejas', 'safata', 'safates') then 'bandeja'
    when s.x in ('lata', 'latas', 'llauna', 'llaunes') then 'lata'
    when s.x in ('barril', 'barriles', 'barrils') then 'barril'
    else s.x
  end
  from (select public.pedidos_norm(t) as x) s
$$;
revoke execute on function public.pedidos_unidad_norm(text) from anon, public;
grant execute on function public.pedidos_unidad_norm(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PROVEEDOR: datos de pedido
-- ═══════════════════════════════════════════════════════════════════════════
-- (compras_proveedor.alias ya existe: es texto libre de Compras y no se toca.)
alter table public.compras_proveedor
  add column if not exists pedido_canal text not null default 'email'
    constraint compras_proveedor_pedido_canal_chk check (pedido_canal in ('email', 'whatsapp', 'telefono', 'portal')),
  add column if not exists pedido_email            text null,
  add column if not exists pedido_whatsapp         text null,
  add column if not exists pedido_telefono         text null,
  add column if not exists pedido_minimo           numeric null
    constraint compras_proveedor_pedido_minimo_chk check (pedido_minimo is null or pedido_minimo >= 0),
  add column if not exists pedido_dias_reparto     integer[] null
    constraint compras_proveedor_pedido_dias_chk check (pedido_dias_reparto is null or pedido_dias_reparto <@ array[1, 2, 3, 4, 5, 6, 7]),
  add column if not exists pedido_hora_corte       time null,
  add column if not exists pedido_notas            text null,
  add column if not exists albaranes_por_email     boolean not null default false,
  add column if not exists catalogo_actualizado_en timestamptz null,
  add column if not exists pedible                 boolean not null default true;

comment on column public.compras_proveedor.pedido_canal is 'Canal de envío de pedidos: email | whatsapp | telefono | portal.';
comment on column public.compras_proveedor.pedido_email is 'Email al que se envían los pedidos (puede diferir del de facturación).';
comment on column public.compras_proveedor.pedido_whatsapp is 'Teléfono WhatsApp para pedidos (formato internacional, sin +, para wa.me).';
comment on column public.compras_proveedor.pedido_minimo is 'Importe mínimo de pedido (sin IVA). Aviso, no bloqueo.';
comment on column public.compras_proveedor.pedido_dias_reparto is 'Días de reparto ISO (1 = lunes … 7 = domingo).';
comment on column public.compras_proveedor.pedido_hora_corte is 'Hora límite (Europe/Madrid) para que el pedido entre en el siguiente reparto.';
comment on column public.compras_proveedor.albaranes_por_email is 'true = el proveedor ya envía los albaranes en PDF por email (entran por la ingesta de correo de Compras).';
comment on column public.compras_proveedor.catalogo_actualizado_en is 'Última importación del catálogo completo del proveedor.';
comment on column public.compras_proveedor.pedible is 'false = no aparece en Pedidos (servicios, suministros, etc.).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. PRODUCTO: datos de catálogo
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.compras_producto
  add column if not exists unidad           text null,
  add column if not exists formato          text null,
  add column if not exists unidades_formato numeric null
    constraint compras_producto_unidades_formato_chk check (unidades_formato is null or unidades_formato > 0),
  add column if not exists precio_catalogo  numeric null
    constraint compras_producto_precio_catalogo_chk check (precio_catalogo is null or precio_catalogo >= 0),
  add column if not exists categoria        text null,
  add column if not exists codigo_barras    text null,
  add column if not exists alias            text[] not null default '{}'::text[],
  add column if not exists activo           boolean not null default true,
  add column if not exists pedible          boolean not null default true,
  add column if not exists origen           text not null default 'factura'
    constraint compras_producto_origen_chk check (origen in ('factura', 'catalogo', 'manual')),
  add column if not exists catalogo_en      timestamptz null;

comment on column public.compras_producto.unidad is 'Unidad en la que vende/factura el proveedor (caja, kg, unidad, litro, paquete, docena, saco, garrafa, botella, bandeja…). Ver pedidos_unidad_norm().';
comment on column public.compras_producto.formato is 'Formato comercial en texto: «caja 20 u», «saco 25 kg».';
comment on column public.compras_producto.unidades_formato is 'Unidades base por formato (20 en «caja 20 u»): sirve para convertir al cotejar.';
comment on column public.compras_producto.precio_catalogo is 'Precio de la última tarifa importada (sin IVA, por «unidad»). ultimo_precio sigue siendo el de la última línea de albarán/factura.';
comment on column public.compras_producto.alias is 'Otros nombres con los que se pide (manuales o del catálogo). Los aprendidos de pedidos viven en compras_pedido_alias.';
comment on column public.compras_producto.origen is 'De dónde salió el producto: factura (OCR de Compras, por defecto) | catalogo (importación) | manual.';
comment on column public.compras_producto.catalogo_en is 'Cuándo lo tocó por última vez una importación de catálogo.';

-- Índice por (cuenta, proveedor, lower(ref)): único solo si hoy no hay duplicados.
do $$
begin
  if exists (
    select 1 from public.compras_producto
    where ref_proveedor is not null
    group by cuenta_id, proveedor_id, lower(ref_proveedor)
    having count(*) > 1
  ) then
    raise notice 'compras_producto: hay referencias duplicadas por proveedor sin distinguir mayúsculas; se crea índice NO único idx_compras_producto_ref_lower. Revisar con la consulta de VERIFICACIÓN 2.';
    execute 'create index if not exists idx_compras_producto_ref_lower on public.compras_producto (cuenta_id, proveedor_id, lower(ref_proveedor)) where ref_proveedor is not null';
  else
    execute 'create unique index if not exists compras_producto_ref_lower_ux on public.compras_producto (cuenta_id, proveedor_id, lower(ref_proveedor)) where ref_proveedor is not null';
    -- si una aplicación anterior dejó el normal (había duplicados), sobra
    execute 'drop index if exists public.idx_compras_producto_ref_lower';
  end if;
end $$;

create index if not exists idx_compras_producto_nombre_trgm on public.compras_producto using gin (nombre gin_trgm_ops);
create index if not exists idx_compras_producto_codigo_barras on public.compras_producto (codigo_barras) where codigo_barras is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. PEDIDOS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.compras_pedido (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null default cuenta_actual() references public.cuentas(id),
  numero          text not null default '',   -- lo sobrescribe SIEMPRE el trigger (el default es para los tipos de TS)
  centro_id       uuid not null references public.centros(id),
  proveedor_id    uuid null references public.compras_proveedor(id),
  estado          text not null default 'borrador'
    constraint compras_pedido_estado_chk check (estado in ('borrador', 'enviado', 'confirmado', 'recibido_parcial', 'recibido', 'cancelado')),
  fecha_entrega   date null,
  notas           text null,
  origen          text not null default 'catalogo'
    constraint compras_pedido_origen_chk check (origen in ('voz', 'texto', 'catalogo', 'mixto')),
  transcripcion   text null,
  interpretacion  jsonb null,
  idioma          text null,
  creado_por      uuid null default auth.uid(),
  enviado_por     uuid null,
  enviado_en      timestamptz null,
  canal_envio     text null
    constraint compras_pedido_canal_envio_chk check (canal_envio is null or canal_envio in ('email', 'whatsapp', 'telefono', 'portal')),
  total_estimado  numeric null,
  albaran_doc_id  uuid null references public.compras_doc(id) on delete set null,
  factura_doc_id  uuid null references public.compras_doc(id) on delete set null,
  cotejo_estado   text not null default 'pendiente'
    constraint compras_pedido_cotejo_estado_chk check (cotejo_estado in ('pendiente', 'ok', 'diferencias', 'sin_documentos')),
  cotejo_detalle  jsonb null,
  cotejado_en     timestamptz null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint compras_pedido_numero_ux unique (cuenta_id, numero),
  -- un borrador puede no tener proveedor todavía (líneas «sin identificar»); enviado en adelante, sí
  constraint compras_pedido_proveedor_chk check (proveedor_id is not null or estado in ('borrador', 'cancelado'))
);
comment on table public.compras_pedido is 'Pedido a un proveedor para un centro. Número P-AAAA-NNNN por cuenta y año (trigger). Cotejo con albarán/factura vía pedidos_cotejar() (único que escribe cotejo_*). LIMITACIÓN v1: un solo albaran_doc_id por pedido; una entrega parcial completada con un segundo albarán no se puede vincular (sus líneas quedan «falta»): marcar recibido_parcial/recibido a mano. Iteración futura: albaran_doc_ids uuid[].';
comment on column public.compras_pedido.interpretacion is 'Salida cruda de la IA (líneas, alternativas, dudas) para auditoría y aprendizaje.';
comment on column public.compras_pedido.idioma is 'Idioma del dictado: es | ca.';
comment on column public.compras_pedido.total_estimado is 'Σ cantidad × precio_estimado de las líneas (lo mantiene un trigger de compras_pedido_linea).';
comment on column public.compras_pedido.cotejo_detalle is 'Resultado de pedidos_cotejar(): documentos, resumen, líneas, sobras, diferencias de precio y avisos.';

create index if not exists idx_compras_pedido_cuenta_estado on public.compras_pedido (cuenta_id, estado, creado_en desc);
create index if not exists idx_compras_pedido_centro on public.compras_pedido (centro_id, creado_en desc);
create index if not exists idx_compras_pedido_proveedor on public.compras_pedido (proveedor_id, fecha_entrega);
create index if not exists idx_compras_pedido_albaran on public.compras_pedido (albaran_doc_id) where albaran_doc_id is not null;
create index if not exists idx_compras_pedido_factura on public.compras_pedido (factura_doc_id) where factura_doc_id is not null;

alter table public.compras_pedido enable row level security;
revoke all on public.compras_pedido from anon;
grant select, insert, update, delete on public.compras_pedido to authenticated;
revoke truncate, references, trigger, maintain on public.compras_pedido from authenticated;
-- Escritura: además de la cuenta, centro, proveedor y documentos tienen que ser de esa misma
-- cuenta (las FK no miran la RLS).
drop policy if exists compras_pedido_acceso on public.compras_pedido;
create policy compras_pedido_acceso on public.compras_pedido
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (
    (cuenta_id = (select cuenta_actual()) or (select es_operador()))
    and exists (select 1 from public.centros c where c.id = compras_pedido.centro_id and c.cuenta_id = compras_pedido.cuenta_id)
    and (compras_pedido.proveedor_id is null or exists (select 1 from public.compras_proveedor v where v.id = compras_pedido.proveedor_id and v.cuenta_id = compras_pedido.cuenta_id))
    and (compras_pedido.albaran_doc_id is null or exists (select 1 from public.compras_doc d where d.id = compras_pedido.albaran_doc_id and d.cuenta_id = compras_pedido.cuenta_id))
    and (compras_pedido.factura_doc_id is null or exists (select 1 from public.compras_doc d where d.id = compras_pedido.factura_doc_id and d.cuenta_id = compras_pedido.cuenta_id))
  );

-- ─── numerador por cuenta y año ──────────────────────────────────────────
create table if not exists public.compras_pedido_numerador (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  anio      integer not null,
  ultimo    integer not null default 0,
  primary key (cuenta_id, anio)
);
comment on table public.compras_pedido_numerador is 'Último número de pedido por cuenta y año. Solo lo escribe compras_pedido_numerar() (security definer).';
alter table public.compras_pedido_numerador enable row level security;
revoke all on public.compras_pedido_numerador from anon, authenticated;
grant select on public.compras_pedido_numerador to authenticated;
drop policy if exists compras_pedido_numerador_lectura on public.compras_pedido_numerador;
create policy compras_pedido_numerador_lectura on public.compras_pedido_numerador
  for select to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()));

-- Asigna el número SIEMPRE (ignora el que venga del cliente). Security definer porque el
-- contador no es escribible desde el panel. Cinturón propio: con sesión, solo la cuenta del
-- usuario (o operador); además la RLS de compras_pedido (WITH CHECK, que se evalúa después de
-- los BEFORE triggers) rechazaría la fila y el incremento se desharía con la transacción.
-- Con sesión, creado_en = now() aquí mismo (este trigger va antes que «tocar» por orden
-- alfabético), para que un creado_en falso no dé un número de otro año.
create or replace function public.compras_pedido_numerar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anio integer;
  v_n    integer;
begin
  if new.cuenta_id is null then
    raise exception 'Pedido sin cuenta';
  end if;
  if auth.uid() is not null then
    if not coalesce(new.cuenta_id = cuenta_actual() or es_operador(), false) then
      raise exception 'Cuenta no permitida';
    end if;
    new.creado_en := now();
  end if;
  v_anio := extract(year from (coalesce(new.creado_en, now()) at time zone 'Europe/Madrid'))::integer;
  insert into public.compras_pedido_numerador as n (cuenta_id, anio, ultimo)
  values (new.cuenta_id, v_anio, 1)
  on conflict (cuenta_id, anio) do update set ultimo = n.ultimo + 1
  returning n.ultimo into v_n;
  new.numero := 'P-' || v_anio::text || '-' || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;
  return new;
end $$;
revoke all on function public.compras_pedido_numerar() from public, anon, authenticated;

drop trigger if exists trg_compras_pedido_numerar on public.compras_pedido;
create trigger trg_compras_pedido_numerar
  before insert on public.compras_pedido
  for each row execute function public.compras_pedido_numerar();

-- Sello:
--   * actualizado_en; numero, cuenta_id, creado_en y creado_por inmutables en UPDATE;
--   * con sesión: creado_por = auth.uid() y creado_en = now() en INSERT;
--   * enviado_en/por: se fijan (now(), auth.uid()) la primera vez que el pedido pasa a un estado
--     de envío (enviado, confirmado, recibido_parcial, recibido); después no se tocan. Con sesión
--     el cliente no los puede escribir;
--   * cotejo_*: con sesión y fuera de pedidos_cotejar() se conservan (INSERT: pendiente, vacío);
--     si cambian los documentos vinculados, el cotejo vuelve a «pendiente» (o «sin_documentos»).
create or replace function public.compras_pedido_tocar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_cotejando boolean := coalesce(current_setting('pedidos.cotejando', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(v_uid, new.creado_por);
    if v_uid is not null then
      new.creado_en := now();
      if not v_cotejando then
        new.cotejo_estado := 'pendiente';
        new.cotejo_detalle := null;
        new.cotejado_en := null;
      end if;
    end if;
  else
    new.actualizado_en := now();
    new.numero := old.numero;
    new.cuenta_id := old.cuenta_id;
    new.creado_en := old.creado_en;
    new.creado_por := old.creado_por;
    if not v_cotejando then
      if v_uid is not null then
        new.cotejo_estado := old.cotejo_estado;
        new.cotejo_detalle := old.cotejo_detalle;
        new.cotejado_en := old.cotejado_en;
      end if;
      if new.albaran_doc_id is distinct from old.albaran_doc_id or new.factura_doc_id is distinct from old.factura_doc_id then
        new.cotejo_estado := case when new.albaran_doc_id is null and new.factura_doc_id is null then 'sin_documentos' else 'pendiente' end;
      end if;
    end if;
  end if;

  if new.estado in ('enviado', 'confirmado', 'recibido_parcial', 'recibido')
     and (tg_op = 'INSERT' or old.enviado_en is null) then
    if v_uid is not null then
      new.enviado_en := now();
      new.enviado_por := v_uid;
    else
      new.enviado_en := coalesce(new.enviado_en, now());
    end if;
  elsif tg_op = 'UPDATE' then
    if v_uid is not null then
      new.enviado_en := old.enviado_en;
      new.enviado_por := old.enviado_por;
    end if;
  elsif v_uid is not null then
    new.enviado_en := null;
    new.enviado_por := null;
  end if;
  return new;
end $$;
revoke all on function public.compras_pedido_tocar() from public, anon, authenticated;

drop trigger if exists trg_compras_pedido_tocar on public.compras_pedido;
create trigger trg_compras_pedido_tocar
  before insert or update on public.compras_pedido
  for each row execute function public.compras_pedido_tocar();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LÍNEAS DE PEDIDO
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.compras_pedido_linea (
  id               uuid primary key default gen_random_uuid(),
  cuenta_id        uuid not null default cuenta_actual() references public.cuentas(id),
  pedido_id        uuid not null references public.compras_pedido(id) on delete cascade,
  producto_id      uuid null references public.compras_producto(id) on delete set null,
  texto_original   text null,
  descripcion      text null,
  cantidad         numeric not null constraint compras_pedido_linea_cantidad_chk check (cantidad > 0),
  unidad           text null,
  precio_estimado  numeric null,
  confianza        numeric null constraint compras_pedido_linea_confianza_chk check (confianza is null or (confianza >= 0 and confianza <= 1)),
  nota             text null,
  orden            integer not null default 0,
  cantidad_albaran numeric null,
  precio_albaran   numeric null,
  cantidad_factura numeric null,
  precio_factura   numeric null,
  estado_cotejo    text null
    constraint compras_pedido_linea_estado_cotejo_chk check (estado_cotejo is null or estado_cotejo in ('ok', 'falta', 'sobra', 'cantidad', 'precio', 'sustituido', 'sin_dato')),
  creado_en        timestamptz not null default now(),
  constraint compras_pedido_linea_algo_chk check (producto_id is not null or coalesce(nullif(btrim(descripcion), ''), nullif(btrim(texto_original), '')) is not null)
);
comment on table public.compras_pedido_linea is 'Líneas del pedido. producto_id null = «sin identificar» (se pide por descripcion). Conviene que la app fusione las líneas del mismo producto y unidad antes de guardar; si no, pedidos_cotejar() las coteja juntas (suma) y todas reciben el mismo estado. Los campos cantidad_/precio_albaran/factura y estado_cotejo los escribe solo pedidos_cotejar() (a mano solo la marca «sustituido»).';
comment on column public.compras_pedido_linea.confianza is 'Confianza de la IA (0-1) al identificar el producto.';
comment on column public.compras_pedido_linea.estado_cotejo is 'ok | falta | cantidad | precio | sustituido (marca manual, el cotejo la respeta si no encuentra el producto) | sin_dato. «sobra» se usa en cotejo_detalle para líneas del documento que no están en el pedido.';

create index if not exists idx_compras_pedido_linea_pedido on public.compras_pedido_linea (pedido_id, orden);
create index if not exists idx_compras_pedido_linea_producto on public.compras_pedido_linea (producto_id) where producto_id is not null;
create index if not exists idx_compras_pedido_linea_cuenta on public.compras_pedido_linea (cuenta_id);

alter table public.compras_pedido_linea enable row level security;
revoke all on public.compras_pedido_linea from anon;
grant select, insert, update, delete on public.compras_pedido_linea to authenticated;
revoke truncate, references, trigger, maintain on public.compras_pedido_linea from authenticated;
-- Escritura: el producto tiene que ser de la misma cuenta (el pedido ya lo cubre el trigger
-- compras_pedido_linea_cuenta, que copia la cuenta del pedido).
drop policy if exists compras_pedido_linea_acceso on public.compras_pedido_linea;
create policy compras_pedido_linea_acceso on public.compras_pedido_linea
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (
    (cuenta_id = (select cuenta_actual()) or (select es_operador()))
    and (compras_pedido_linea.producto_id is null or exists (select 1 from public.compras_producto pr where pr.id = compras_pedido_linea.producto_id and pr.cuenta_id = compras_pedido_linea.cuenta_id))
  );

-- La línea hereda la cuenta de su pedido (invoker: si el pedido no es visible, error). Evita
-- colgar líneas propias de un pedido ajeno.
create or replace function public.compras_pedido_linea_cuenta()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cuenta uuid;
begin
  select p.cuenta_id into v_cuenta from public.compras_pedido p where p.id = new.pedido_id;
  if v_cuenta is null then
    raise exception 'Pedido no encontrado';
  end if;
  new.cuenta_id := v_cuenta;
  return new;
end $$;
revoke all on function public.compras_pedido_linea_cuenta() from public, anon, authenticated;

drop trigger if exists trg_compras_pedido_linea_cuenta on public.compras_pedido_linea;
create trigger trg_compras_pedido_linea_cuenta
  before insert or update of pedido_id, cuenta_id on public.compras_pedido_linea
  for each row execute function public.compras_pedido_linea_cuenta();

-- Campos de cotejo de la línea: solo los escribe pedidos_cotejar() (marca pedidos.cotejando).
-- Con sesión y fuera de ella: en INSERT nacen vacíos; en UPDATE se conservan, salvo la marca
-- manual estado_cotejo = 'sustituido' (y quitarla: 'sustituido' → null).
create or replace function public.compras_pedido_linea_cotejo_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or coalesce(current_setting('pedidos.cotejando', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.cantidad_albaran := null;
    new.precio_albaran := null;
    new.cantidad_factura := null;
    new.precio_factura := null;
    if new.estado_cotejo is distinct from 'sustituido' then
      new.estado_cotejo := null;
    end if;
  else
    new.cantidad_albaran := old.cantidad_albaran;
    new.precio_albaran := old.precio_albaran;
    new.cantidad_factura := old.cantidad_factura;
    new.precio_factura := old.precio_factura;
    if new.estado_cotejo is distinct from old.estado_cotejo
       and not (new.estado_cotejo = 'sustituido' or (old.estado_cotejo = 'sustituido' and new.estado_cotejo is null)) then
      new.estado_cotejo := old.estado_cotejo;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.compras_pedido_linea_cotejo_proteger() from public, anon, authenticated;

drop trigger if exists trg_compras_pedido_linea_cotejo on public.compras_pedido_linea;
create trigger trg_compras_pedido_linea_cotejo
  before insert or update on public.compras_pedido_linea
  for each row execute function public.compras_pedido_linea_cotejo_proteger();

-- total_estimado del pedido = Σ cantidad × precio_estimado (solo si cambia algo que lo afecte).
create or replace function public.compras_pedido_linea_total()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.compras_pedido p
       set total_estimado = (select round(sum(l.cantidad * l.precio_estimado), 2)
                               from public.compras_pedido_linea l where l.pedido_id = p.id)
     where p.id = old.pedido_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.pedido_id is distinct from old.pedido_id) then
    update public.compras_pedido p
       set total_estimado = (select round(sum(l.cantidad * l.precio_estimado), 2)
                               from public.compras_pedido_linea l where l.pedido_id = p.id)
     where p.id = new.pedido_id;
  end if;
  return null;
end $$;
revoke all on function public.compras_pedido_linea_total() from public, anon, authenticated;

drop trigger if exists trg_compras_pedido_linea_total on public.compras_pedido_linea;
create trigger trg_compras_pedido_linea_total
  after insert or delete or update of cantidad, precio_estimado, pedido_id on public.compras_pedido_linea
  for each row execute function public.compras_pedido_linea_total();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. ALIAS APRENDIDOS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.compras_pedido_alias (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null default cuenta_actual() references public.cuentas(id),
  centro_id    uuid null references public.centros(id) on delete set null,
  proveedor_id uuid null references public.compras_proveedor(id) on delete set null,
  frase        text not null,
  frase_norm   text not null,
  producto_id  uuid not null references public.compras_producto(id) on delete cascade,
  unidad       text null,
  idioma       text null,
  usos         integer not null default 1,
  creado_por   uuid null default auth.uid(),
  creado_en    timestamptz not null default now(),
  ultimo_uso   timestamptz not null default now(),
  constraint compras_pedido_alias_ux unique (cuenta_id, frase_norm, producto_id)
);
comment on table public.compras_pedido_alias is 'Aprendizaje: frase del empleado → producto (y unidad). Va en el contexto de la IA con prioridad. Alta/uso con pedidos_aprender_alias().';
comment on column public.compras_pedido_alias.frase_norm is 'pedidos_norm(frase); lo rellena un trigger.';

create index if not exists idx_compras_pedido_alias_frase on public.compras_pedido_alias (cuenta_id, frase_norm);
create index if not exists idx_compras_pedido_alias_producto on public.compras_pedido_alias (producto_id);
create index if not exists idx_compras_pedido_alias_centro on public.compras_pedido_alias (centro_id) where centro_id is not null;

alter table public.compras_pedido_alias enable row level security;
revoke all on public.compras_pedido_alias from anon;
grant select, insert, update, delete on public.compras_pedido_alias to authenticated;
revoke truncate, references, trigger, maintain on public.compras_pedido_alias from authenticated;
-- Escritura: producto, centro y proveedor de la misma cuenta que el alias.
drop policy if exists compras_pedido_alias_acceso on public.compras_pedido_alias;
create policy compras_pedido_alias_acceso on public.compras_pedido_alias
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (
    (cuenta_id = (select cuenta_actual()) or (select es_operador()))
    and exists (select 1 from public.compras_producto pr where pr.id = compras_pedido_alias.producto_id and pr.cuenta_id = compras_pedido_alias.cuenta_id)
    and (compras_pedido_alias.centro_id is null or exists (select 1 from public.centros c where c.id = compras_pedido_alias.centro_id and c.cuenta_id = compras_pedido_alias.cuenta_id))
    and (compras_pedido_alias.proveedor_id is null or exists (select 1 from public.compras_proveedor v where v.id = compras_pedido_alias.proveedor_id and v.cuenta_id = compras_pedido_alias.cuenta_id))
  );

-- frase_norm siempre derivada; creado_por/creado_en los fija el servidor (con sesión) y no
-- cambian en UPDATE.
create or replace function public.compras_pedido_alias_norm()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.frase := btrim(new.frase);
  new.frase_norm := public.pedidos_norm(new.frase);
  if new.frase_norm is null then
    raise exception 'La frase del alias está vacía';
  end if;
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    if auth.uid() is not null then
      new.creado_en := now();
    end if;
  else
    new.creado_por := old.creado_por;
    new.creado_en := old.creado_en;
  end if;
  return new;
end $$;
revoke all on function public.compras_pedido_alias_norm() from public, anon, authenticated;

drop trigger if exists trg_compras_pedido_alias_norm on public.compras_pedido_alias;
create trigger trg_compras_pedido_alias_norm
  before insert or update on public.compras_pedido_alias
  for each row execute function public.compras_pedido_alias_norm();

-- Alta o refuerzo de un alias (usos + 1). La cuenta es la del producto (operadores incluidos).
create or replace function public.pedidos_aprender_alias(
  p_frase text,
  p_producto uuid,
  p_unidad text default null,
  p_centro uuid default null,
  p_idioma text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cuenta uuid;
  v_prov   uuid;
  v_id     uuid;
begin
  if public.pedidos_norm(p_frase) is null then
    raise exception 'Frase vacía';
  end if;
  select pr.cuenta_id, pr.proveedor_id into v_cuenta, v_prov from public.compras_producto pr where pr.id = p_producto;
  if v_cuenta is null then
    raise exception 'Producto no encontrado';
  end if;
  if p_centro is not null and not exists (select 1 from public.centros c where c.id = p_centro and c.cuenta_id = v_cuenta) then
    raise exception 'El centro no es de la cuenta del producto';
  end if;
  insert into public.compras_pedido_alias as a (cuenta_id, centro_id, proveedor_id, frase, frase_norm, producto_id, unidad, idioma)
  values (v_cuenta, p_centro, v_prov, p_frase, public.pedidos_norm(p_frase), p_producto, nullif(btrim(p_unidad), ''), p_idioma)
  on conflict (cuenta_id, frase_norm, producto_id) do update
    set usos = a.usos + 1,
        ultimo_uso = now(),
        unidad = coalesce(excluded.unidad, a.unidad),
        idioma = coalesce(excluded.idioma, a.idioma)
  returning a.id into v_id;
  return v_id;
end $$;
revoke execute on function public.pedidos_aprender_alias(text, uuid, text, uuid, text) from anon, public;
grant execute on function public.pedidos_aprender_alias(text, uuid, text, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. IMPORTACIONES DE CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.compras_catalogo_import (
  id            uuid primary key default gen_random_uuid(),
  cuenta_id     uuid not null default cuenta_actual() references public.cuentas(id),
  proveedor_id  uuid not null references public.compras_proveedor(id) on delete cascade,
  archivo       text null,
  filas         integer not null default 0,
  creados       integer not null default 0,
  actualizados  integer not null default 0,
  errores       integer not null default 0,
  detalle       jsonb null,
  creado_por    uuid null default auth.uid(),
  creado_en     timestamptz not null default now()
);
comment on table public.compras_catalogo_import is 'Registro de cada importación de catálogo (CSV/XLSX) de un proveedor: mapeo de columnas, filas con error, etc. en detalle.';

create index if not exists idx_compras_catalogo_import_prov on public.compras_catalogo_import (proveedor_id, creado_en desc);
create index if not exists idx_compras_catalogo_import_cuenta on public.compras_catalogo_import (cuenta_id);

alter table public.compras_catalogo_import enable row level security;
revoke all on public.compras_catalogo_import from anon;
grant select, insert, update, delete on public.compras_catalogo_import to authenticated;
revoke truncate, references, trigger, maintain on public.compras_catalogo_import from authenticated;
-- Escritura: el proveedor tiene que ser de la misma cuenta.
drop policy if exists compras_catalogo_import_acceso on public.compras_catalogo_import;
create policy compras_catalogo_import_acceso on public.compras_catalogo_import
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (
    (cuenta_id = (select cuenta_actual()) or (select es_operador()))
    and exists (select 1 from public.compras_proveedor v where v.id = compras_catalogo_import.proveedor_id and v.cuenta_id = compras_catalogo_import.cuenta_id)
  );

-- creado_por/creado_en los fija el servidor (con sesión) y no cambian en UPDATE.
create or replace function public.compras_catalogo_import_sellar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    if auth.uid() is not null then
      new.creado_en := now();
    end if;
  else
    new.creado_por := old.creado_por;
    new.creado_en := old.creado_en;
  end if;
  return new;
end $$;
revoke all on function public.compras_catalogo_import_sellar() from public, anon, authenticated;

drop trigger if exists trg_compras_catalogo_import_sellar on public.compras_catalogo_import;
create trigger trg_compras_catalogo_import_sellar
  before insert or update on public.compras_catalogo_import
  for each row execute function public.compras_catalogo_import_sellar();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. FUNCIONES
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── pedidos_catalogo_centro ─────────────────────────────────────────────
-- Productos pedibles (producto activo y pedible, proveedor pedible) con su frecuencia de compra
-- en el centro durante los últimos p_dias. Centro de cada documento, por este orden:
--   1) reparto de la factura (compras_doc_reparto.centro_coste → compras_centro_coste.canal →
--      centros por nombre normalizado);
--   2) si no tiene reparto, el canal del documento (los albaranes, que son los que traen las
--      líneas, siempre lo traen);
--   3) si no hay ni reparto ni canal reconocible, el documento cuenta para todos los centros.
-- Para no contar dos veces, las líneas de una factura solo cuentan si la factura no agrupa
-- albaranes (albaranes_detectados vacío). Con p_proveedor también salen los productos de ese
-- proveedor nunca comprados en el centro (veces = 0, al final): lista del pedido por catálogo.
create or replace function public.pedidos_catalogo_centro(p_centro uuid, p_proveedor uuid default null, p_dias integer default 365)
returns table (
  producto_id      uuid,
  proveedor_id     uuid,
  proveedor_nombre text,
  nombre           text,
  ref_proveedor    text,
  codigo_interno   text,
  unidad           text,
  formato          text,
  unidades_formato numeric,
  categoria        text,
  precio_catalogo  numeric,
  veces            integer,
  cantidad_total   numeric,
  ultima_cantidad  numeric,
  ultimo_precio    numeric,
  ultima_fecha     date,
  alias            text[]
)
language sql
stable
set search_path = public, pg_temp
as $$
  with obj as (
    select c.id, c.cuenta_id from public.centros c where c.id = p_centro
  ),
  cen as (
    select c.id, public.pedidos_norm(c.nombre) as n
    from public.centros c join obj on obj.cuenta_id = c.cuenta_id
  ),
  canal_centro as (
    select x.canal, cen.id as centro_id
    from (select distinct d.canal from public.compras_doc d join obj on obj.cuenta_id = d.cuenta_id where d.canal is not null) x
    join cen on cen.n = public.pedidos_norm(x.canal)
  ),
  cc_centro as (
    select cc.codigo, cen.id as centro_id
    from public.compras_centro_coste cc
    join obj on obj.cuenta_id = cc.cuenta_id
    join cen on cen.n = public.pedidos_norm(cc.canal)
  ),
  docs as (
    select d.id, d.fecha
    from public.compras_doc d
    join obj on obj.cuenta_id = d.cuenta_id
    where d.fecha >= current_date - greatest(coalesce(p_dias, 365), 1)
      and (p_proveedor is null or d.proveedor_id = p_proveedor)
      and (d.tipo = 'albaran'
           or coalesce(case when jsonb_typeof(d.albaranes_detectados) = 'array' then jsonb_array_length(d.albaranes_detectados) end, 0) = 0)
      and case
            when exists (select 1 from public.compras_doc_reparto r join cc_centro x on x.codigo = r.centro_coste where r.doc_id = d.id)
              then exists (select 1 from public.compras_doc_reparto r join cc_centro x on x.codigo = r.centro_coste
                           where r.doc_id = d.id and x.centro_id = p_centro)
            when exists (select 1 from canal_centro k where k.canal = d.canal)
              then exists (select 1 from canal_centro k where k.canal = d.canal and k.centro_id = p_centro)
            else true
          end
  ),
  lin as (
    select cl.producto_id, cl.cantidad, cl.precio_unit, cl.created_at, d.id as doc_id, d.fecha
    from public.compras_linea cl
    join docs d on d.id = cl.doc_id
    where cl.producto_id is not null and cl.cantidad > 0
  ),
  agg as (
    select lin.producto_id, count(distinct lin.doc_id)::integer as veces, sum(lin.cantidad) as cantidad_total, max(lin.fecha) as ultima_fecha
    from lin group by lin.producto_id
  ),
  ult as (
    select distinct on (lin.producto_id) lin.producto_id, lin.cantidad, lin.precio_unit
    from lin
    order by lin.producto_id, lin.fecha desc, lin.created_at desc
  )
  select pr.id, pr.proveedor_id, pv.nombre, pr.nombre, pr.ref_proveedor, pr.codigo_interno,
         pr.unidad, pr.formato, pr.unidades_formato, pr.categoria, pr.precio_catalogo,
         coalesce(a.veces, 0), coalesce(a.cantidad_total, 0), u.cantidad,
         coalesce(u.precio_unit, pr.ultimo_precio), a.ultima_fecha, pr.alias
  from public.compras_producto pr
  join obj on obj.cuenta_id = pr.cuenta_id
  join public.compras_proveedor pv on pv.id = pr.proveedor_id
  left join agg a on a.producto_id = pr.id
  left join ult u on u.producto_id = pr.id
  where pr.activo and pr.pedible and pv.pedible
    and (p_proveedor is null or pr.proveedor_id = p_proveedor)
    and (a.producto_id is not null or p_proveedor is not null)
  order by coalesce(a.veces, 0) desc, a.ultima_fecha desc nulls last, pr.nombre
$$;
revoke execute on function public.pedidos_catalogo_centro(uuid, uuid, integer) from anon, public;
grant execute on function public.pedidos_catalogo_centro(uuid, uuid, integer) to authenticated;

-- ─── pedidos_sugerir_documentos ──────────────────────────────────────────
-- Albaranes y facturas del proveedor del pedido entre fecha_entrega − 3 y + 10 días (sin fecha
-- de entrega: fecha de envío o de creación), que no sean ya los vinculados, con puntuación 0-100:
--   * con líneas: 55 × (productos del pedido encontrados / líneas del pedido)
--                 + 15 × (líneas del documento que casan / líneas del documento)
--                 + 15 × cercanía de fecha + 15 si es del mismo centro;
--   * sin líneas (facturas hoy): 25 × cercanía + 15 mismo centro + 30 × cercanía del importe
--     (base) al total estimado;
--   * factura que recoge el albarán ya vinculado (albaranes_detectados, conciliación manual
--     compras_concil_confirmada o compras_doc.factura_id): 90-100, y se busca hasta 60 días
--     después (las facturas mensuales llegan tarde).
-- Centro, albarán vinculado y productos se leen filtrando por la cuenta del pedido.
-- Albaranes vinculados a OTRO pedido: fuera. Facturas vinculadas a otro pedido: sí salen (una
-- factura agrupa varios albaranes/pedidos) con «vinculado_a».
create or replace function public.pedidos_sugerir_documentos(p_pedido uuid)
returns table (
  doc_id          uuid,
  tipo            text,
  fecha           date,
  num_documento   text,
  total           numeric,
  canal           text,
  mismo_centro    boolean,
  n_lineas        integer,
  n_coinciden     integer,
  incluye_albaran boolean,
  puntuacion      numeric,
  motivo          text,
  vinculado_a     text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with p as (
    select pe.id, pe.cuenta_id, pe.proveedor_id, pe.albaran_doc_id, pe.factura_doc_id, pe.total_estimado,
           coalesce(pe.fecha_entrega,
                    (pe.enviado_en at time zone 'Europe/Madrid')::date,
                    (pe.creado_en at time zone 'Europe/Madrid')::date) as f,
           (select public.pedidos_norm(c.nombre) from public.centros c where c.id = pe.centro_id and c.cuenta_id = pe.cuenta_id) as centro_n,
           (select d.id from public.compras_doc d where d.id = pe.albaran_doc_id and d.cuenta_id = pe.cuenta_id) as alb_id,
           (select public.pedidos_norm_num(d.num_documento) from public.compras_doc d where d.id = pe.albaran_doc_id and d.cuenta_id = pe.cuenta_id) as alb_num
    from public.compras_pedido pe
    where pe.id = p_pedido and pe.proveedor_id is not null
  ),
  pl as (
    select l.producto_id,
           nullif(lower(btrim(pr.ref_proveedor)), '') as ref,
           case when length(public.clave_producto(coalesce(pr.nombre, l.descripcion, l.texto_original))) >= 4
                then public.clave_producto(coalesce(pr.nombre, l.descripcion, l.texto_original)) end as clave
    from public.compras_pedido_linea l
    join p on p.id = l.pedido_id
    left join public.compras_producto pr on pr.id = l.producto_id and pr.cuenta_id = p.cuenta_id
  ),
  n_pl as (
    select count(*)::integer as n from pl
  ),
  cand as (
    select d.id, d.tipo, d.fecha, d.num_documento, d.total, d.base, d.canal,
           abs(d.fecha - p.f) as dias,
           coalesce(p.centro_n is not null and (
              public.pedidos_norm(d.canal) = p.centro_n
              or exists (select 1 from public.compras_doc_reparto r
                         join public.compras_centro_coste cc on cc.codigo = r.centro_coste
                         where r.doc_id = d.id and public.pedidos_norm(cc.canal) = p.centro_n)), false) as mismo_centro,
           -- la factura recoge el albarán vinculado: por albaranes_detectados, por la conciliación
           -- manual de Compras (compras_concil_confirmada) o por compras_doc.factura_id
           coalesce(p.alb_id is not null and d.tipo = 'factura' and (
              (p.alb_num is not null and exists (
                 select 1 from jsonb_array_elements(case when jsonb_typeof(d.albaranes_detectados) = 'array'
                                                         then d.albaranes_detectados else '[]'::jsonb end) e
                 where public.pedidos_norm_num(e ->> 'num_albaran') = p.alb_num))
              or exists (select 1 from public.compras_concil_confirmada cc where cc.factura_id = d.id and cc.albaran_id = p.alb_id)
              or exists (select 1 from public.compras_doc a where a.id = p.alb_id and a.factura_id = d.id)), false) as incluye_albaran,
           (select string_agg(o.numero, ', ' order by o.numero) from public.compras_pedido o
             where o.id <> p.id and o.cuenta_id = p.cuenta_id and (o.albaran_doc_id = d.id or o.factura_doc_id = d.id)) as vinculado_a
    from public.compras_doc d
    join p on d.cuenta_id = p.cuenta_id and d.proveedor_id = p.proveedor_id
    where d.id is distinct from p.albaran_doc_id
      and d.id is distinct from p.factura_doc_id
      and d.fecha between p.f - 3 and p.f + 60
  ),
  filtrados as (
    select c.* from cand c cross join p
    where (c.fecha between p.f - 3 and p.f + 10 or c.incluye_albaran)
      and not (c.tipo = 'albaran' and c.vinculado_a is not null)
  ),
  stats as (
    select c.id,
           (select count(*)::integer from public.compras_linea cl where cl.doc_id = c.id) as n_lineas,
           (select count(*)::integer from pl where exists (
              select 1 from public.compras_linea cl
              left join public.compras_producto cp on cp.id = cl.producto_id and cp.cuenta_id = cl.cuenta_id
              where cl.doc_id = c.id and (
                (pl.producto_id is not null and cl.producto_id = pl.producto_id)
                or (pl.ref is not null and lower(btrim(coalesce(nullif(btrim(cl.id_producto), ''), cp.ref_proveedor))) = pl.ref)
                or (pl.clave is not null and public.clave_producto(coalesce(cl.producto, cp.nombre)) = pl.clave)))) as n_coinciden
    from filtrados c
  )
  select c.id, c.tipo, c.fecha, c.num_documento, c.total, c.canal, c.mismo_centro,
         s.n_lineas, s.n_coinciden, c.incluye_albaran,
         round(case
           when c.incluye_albaran then 90 + 10 * (1 - least(c.dias, 60) / 60.0)
           when s.n_lineas > 0 then
             55 * s.n_coinciden::numeric / greatest(n_pl.n, 1)
             + 15 * s.n_coinciden::numeric / greatest(s.n_lineas, 1)
             + 15 * (1 - least(c.dias, 10) / 10.0)
             + case when c.mismo_centro then 15 else 0 end
           else
             25 * (1 - least(c.dias, 10) / 10.0)
             + case when c.mismo_centro then 15 else 0 end
             + case when coalesce(p.total_estimado, 0) > 0 and coalesce(c.base, c.total) is not null
                    then 30 * (1 - least(abs(coalesce(c.base, c.total) - p.total_estimado) / p.total_estimado, 1))
                    else 0 end
         end, 1) as puntuacion,
         concat_ws(' · ',
           case when c.incluye_albaran then 'la factura recoge el albarán vinculado' end,
           case when s.n_lineas > 0 then s.n_coinciden || ' de ' || n_pl.n || ' productos del pedido' else 'sin líneas leídas' end,
           case when c.mismo_centro then 'mismo centro' end,
           case when c.dias = 0 then 'misma fecha' when c.dias = 1 then '1 día de diferencia' else c.dias || ' días de diferencia' end,
           case when c.vinculado_a is not null then 'ya en ' || c.vinculado_a end) as motivo,
         c.vinculado_a
  from filtrados c
  join stats s on s.id = c.id
  cross join n_pl
  cross join p
  order by puntuacion desc, c.dias, c.fecha desc
  limit 30
$$;
revoke execute on function public.pedidos_sugerir_documentos(uuid) from anon, public;
grant execute on function public.pedidos_sugerir_documentos(uuid) to authenticated;

-- ─── pedidos_cotejo_casar (interna de pedidos_cotejar) ───────────────────
-- Busca en las líneas de un documento (sin usar las ya casadas) las que corresponden a una línea
-- de pedido: 1) mismo producto_id; 2) misma referencia del proveedor (id_producto de la línea o
-- ref_proveedor de su producto, sin distinguir mayúsculas); 3) mismo clave_producto del nombre.
-- Agrega si hay varias (suma de cantidades, precio medio ponderado).
create or replace function public.pedidos_cotejo_casar(p_doc uuid, p_usadas uuid[], p_producto uuid, p_ref text, p_clave text)
returns table (ids uuid[], cantidad numeric, precio numeric, importe numeric, metodo text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if p_producto is not null then
    return query
      select array_agg(cl.id),
             sum(cl.cantidad),
             case when coalesce(sum(cl.cantidad) filter (where cl.precio_unit is not null), 0) <> 0
                  then sum(cl.cantidad * cl.precio_unit) filter (where cl.precio_unit is not null)
                       / sum(cl.cantidad) filter (where cl.precio_unit is not null)
                  else avg(cl.precio_unit) end,
             sum(coalesce(cl.importe, cl.cantidad * cl.precio_unit)),
             'producto'::text
      from public.compras_linea cl
      where cl.doc_id = p_doc and not (cl.id = any (coalesce(p_usadas, '{}'::uuid[])))
        and cl.producto_id = p_producto
      having count(*) > 0;
    if found then return; end if;
  end if;

  if nullif(btrim(p_ref), '') is not null then
    return query
      select array_agg(cl.id),
             sum(cl.cantidad),
             case when coalesce(sum(cl.cantidad) filter (where cl.precio_unit is not null), 0) <> 0
                  then sum(cl.cantidad * cl.precio_unit) filter (where cl.precio_unit is not null)
                       / sum(cl.cantidad) filter (where cl.precio_unit is not null)
                  else avg(cl.precio_unit) end,
             sum(coalesce(cl.importe, cl.cantidad * cl.precio_unit)),
             'referencia'::text
      from public.compras_linea cl
      left join public.compras_producto cp on cp.id = cl.producto_id and cp.cuenta_id = cl.cuenta_id
      where cl.doc_id = p_doc and not (cl.id = any (coalesce(p_usadas, '{}'::uuid[])))
        and lower(btrim(coalesce(nullif(btrim(cl.id_producto), ''), cp.ref_proveedor))) = lower(btrim(p_ref))
      having count(*) > 0;
    if found then return; end if;
  end if;

  if length(coalesce(p_clave, '')) >= 4 then
    return query
      select array_agg(cl.id),
             sum(cl.cantidad),
             case when coalesce(sum(cl.cantidad) filter (where cl.precio_unit is not null), 0) <> 0
                  then sum(cl.cantidad * cl.precio_unit) filter (where cl.precio_unit is not null)
                       / sum(cl.cantidad) filter (where cl.precio_unit is not null)
                  else avg(cl.precio_unit) end,
             sum(coalesce(cl.importe, cl.cantidad * cl.precio_unit)),
             'nombre'::text
      from public.compras_linea cl
      left join public.compras_producto cp on cp.id = cl.producto_id and cp.cuenta_id = cl.cuenta_id
      where cl.doc_id = p_doc and not (cl.id = any (coalesce(p_usadas, '{}'::uuid[])))
        and public.clave_producto(coalesce(cl.producto, cp.nombre)) = p_clave
      having count(*) > 0;
  end if;
  return;
end $$;
revoke execute on function public.pedidos_cotejo_casar(uuid, uuid[], uuid, text, text) from anon, public;
grant execute on function public.pedidos_cotejo_casar(uuid, uuid[], uuid, text, text) to authenticated;

-- ─── pedidos_cotejar ─────────────────────────────────────────────────────
-- Compara las líneas del pedido con las del albarán y la factura vinculados y guarda el resultado
-- (campos de cotejo de cada línea + cotejo_estado/cotejo_detalle/cotejado_en del pedido). Es lo
-- ÚNICO que escribe esos campos: activa la marca de transacción pedidos.cotejando, que miran los
-- triggers compras_pedido_tocar y compras_pedido_linea_cotejo_proteger.
-- Reglas:
--   * Documentos y productos se leen filtrando por la cuenta del pedido.
--   * Documento de referencia: el albarán si tiene líneas; si no, la factura si tiene líneas.
--   * Líneas del pedido con el mismo producto y unidad se cotejan JUNTAS (suma de cantidades;
--     la primera casa las líneas del documento y las demás heredan su resultado y estado).
--   * Línea no encontrada en la referencia → «falta» (salvo que estuviera marcada «sustituido»
--     a mano, que se respeta). Encontrada pero con cantidad sin leer → «sin_dato».
--   * Cantidad exacta (3 decimales). Si la unidad del pedido y la del producto son distintas
--     (pedidos_unidad_norm), se intenta convertir con unidades_formato (× o ÷); si no cuadra
--     ninguna conversión NO se compara cantidad ni precio y se anota en la línea. Si el producto
--     no tiene unidad (lo normal hoy) y la cantidad difiere, se anota «unidad del producto sin
--     definir» (resumen.n_unidad_desconocida) para que la pantalla lo distinga.
--   * Precio: tolerancia ±2 % sobre precio_estimado; la diferencia se valora en importe
--     (precio documento − estimado) × cantidad del documento.
--   * Con albarán y factura con líneas: además, factura contra albarán (cantidad exacta, precio
--     ±2 %).
--   * Líneas del documento que no están en el pedido (cantidad ≠ 0) → «sobras» en el detalle.
--     Si la factura agrupa varios albaranes, sus sobras no se listan (serían de otras entregas).
--   * Factura y albarán vinculados: la factura recoge el albarán si lo dice la conciliación
--     manual de Compras (compras_concil_confirmada), compras_doc.factura_id o su
--     albaranes_detectados (por num_documento del albarán o el num_albaran conciliado); con
--     albaranes_detectados se comprueba además que el importe declarado cuadre (±2 %). Si la
--     factura no detalla albaranes y no hay conciliación: aviso (no se puede confirmar), sin
--     marcar diferencias.
--   * Solo factura (sin albarán) y sin líneas: se compara su base/total con total_estimado
--     (±2 %, solo si no agrupa varios albaranes) y se avisa si no cuadra; el estado queda
--     «pendiente» (no hay producto a producto).
--   * cotejo_estado: sin_documentos (nada vinculado) | pendiente (ningún documento con líneas
--     y nada que contradiga) | ok | diferencias.
create or replace function public.pedidos_cotejar(p_pedido uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_tol constant numeric := 0.02;
  v_ped public.compras_pedido%rowtype;
  -- albarán
  v_alb_id uuid; v_alb_num text; v_alb_fecha date; v_alb_total numeric; v_alb_base numeric; v_alb_prov uuid; v_alb_tipo text;
  v_alb_lineas boolean := false;
  v_alb_num_conc text;
  -- factura
  v_fac_id uuid; v_fac_num text; v_fac_fecha date; v_fac_total numeric; v_fac_base numeric; v_fac_prov uuid; v_fac_tipo text;
  v_fac_det jsonb; v_fac_n_alb integer := 0;
  v_fac_lineas boolean := false;
  v_fac_incluye boolean; v_fac_encontrado boolean; v_fac_imp_alb numeric; v_fac_cuadra boolean;
  v_fac_sin_detalle boolean := false; v_fac_cuadra_alb boolean; v_fac_cuadra_ped boolean;
  -- bucle
  l record;
  v_usadas_alb uuid[] := '{}'::uuid[];
  v_usadas_fac uuid[] := '{}'::uuid[];
  a_ids uuid[]; a_cant numeric; a_precio numeric; a_imp numeric; a_met text;
  f_ids uuid[]; f_cant numeric; f_precio numeric; f_imp numeric; f_met text;
  r_doc text; r_ids uuid[]; r_cant numeric; r_precio numeric;
  k numeric; v_cmp boolean; v_precio_eq numeric; v_dif numeric; v_cant_ped numeric;
  v_estado text; v_notas text[];
  v_grupos jsonb := '{}'::jsonb; v_g jsonb;
  -- acumulados
  v_lineas jsonb := '[]'::jsonb;
  v_difs jsonb := '[]'::jsonb;
  v_sobras jsonb := '[]'::jsonb;
  v_sobras_fac jsonb := '[]'::jsonb;
  v_avisos text[] := '{}'::text[];
  n_lin integer := 0; n_ok integer := 0; n_falta integer := 0; n_cant integer := 0; n_precio integer := 0;
  n_sust integer := 0; n_sin integer := 0; n_unid integer := 0; n_unid_desc integer := 0; n_dif_fac integer := 0;
  n_agrup integer := 0;
  n_dif_precio integer := 0; imp_dif_precio numeric := 0;
  n_sobras integer := 0; imp_sobras numeric := 0; n_sobras_fac integer := 0; imp_sobras_fac numeric := 0;
  v_imp_alb numeric; v_imp_fac numeric;
  v_estado_ped text; v_motivo text; v_resumen jsonb; v_det jsonb;
begin
  -- marca de transacción: los triggers dejan escribir los campos de cotejo
  perform set_config('pedidos.cotejando', '1', true);

  select * into v_ped from public.compras_pedido where id = p_pedido for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;

  -- documentos vinculados (solo de la cuenta del pedido)
  if v_ped.albaran_doc_id is not null then
    select d.id, d.num_documento, d.fecha, d.total, d.base, d.proveedor_id, d.tipo
      into v_alb_id, v_alb_num, v_alb_fecha, v_alb_total, v_alb_base, v_alb_prov, v_alb_tipo
      from public.compras_doc d where d.id = v_ped.albaran_doc_id and d.cuenta_id = v_ped.cuenta_id;
    if v_alb_id is null then
      v_avisos := v_avisos || 'El albarán vinculado no se puede leer'::text;
    else
      v_alb_lineas := exists (select 1 from public.compras_linea cl where cl.doc_id = v_alb_id);
      if v_alb_tipo <> 'albaran' then v_avisos := v_avisos || 'El documento vinculado como albarán es una factura'::text; end if;
      if v_alb_prov is distinct from v_ped.proveedor_id then v_avisos := v_avisos || 'El albarán es de otro proveedor'::text; end if;
      if not v_alb_lineas then v_avisos := v_avisos || 'El albarán no tiene líneas leídas'::text; end if;
    end if;
  end if;

  if v_ped.factura_doc_id is not null then
    select d.id, d.num_documento, d.fecha, d.total, d.base, d.proveedor_id, d.tipo, d.albaranes_detectados
      into v_fac_id, v_fac_num, v_fac_fecha, v_fac_total, v_fac_base, v_fac_prov, v_fac_tipo, v_fac_det
      from public.compras_doc d where d.id = v_ped.factura_doc_id and d.cuenta_id = v_ped.cuenta_id;
    if v_fac_id is null then
      v_avisos := v_avisos || 'La factura vinculada no se puede leer'::text;
    else
      v_fac_lineas := exists (select 1 from public.compras_linea cl where cl.doc_id = v_fac_id);
      v_fac_n_alb := coalesce(case when jsonb_typeof(v_fac_det) = 'array' then jsonb_array_length(v_fac_det) end, 0);
      if v_fac_tipo <> 'factura' then v_avisos := v_avisos || 'El documento vinculado como factura es un albarán'::text; end if;
      if v_fac_prov is distinct from v_ped.proveedor_id then v_avisos := v_avisos || 'La factura es de otro proveedor'::text; end if;
    end if;
  end if;

  -- nada vinculado
  if v_alb_id is null and v_fac_id is null then
    update public.compras_pedido_linea
       set cantidad_albaran = null, precio_albaran = null, cantidad_factura = null, precio_factura = null,
           estado_cotejo = case when estado_cotejo = 'sustituido' then 'sustituido' else 'sin_dato' end
     where pedido_id = p_pedido;
    v_det := jsonb_build_object(
      'version', 1,
      'cotejado_en', now(),
      'motivo', 'Sin albarán ni factura vinculados',
      'avisos', to_jsonb(v_avisos),
      'resumen', jsonb_build_object('n_lineas', (select count(*) from public.compras_pedido_linea where pedido_id = p_pedido)));
    update public.compras_pedido
       set cotejo_estado = 'sin_documentos', cotejo_detalle = v_det, cotejado_en = now()
     where id = p_pedido;
    perform set_config('pedidos.cotejando', '', true);
    return v_det;
  end if;

  r_doc := case when v_alb_lineas then 'albaran' when v_fac_lineas then 'factura' end;

  for l in
    select q.*
    from (
      select pl.id, pl.producto_id, pl.cantidad, pl.unidad, pl.precio_estimado, pl.estado_cotejo, pl.orden, pl.creado_en,
             coalesce(pr.nombre, pl.descripcion, pl.texto_original) as nombre,
             nullif(lower(btrim(pr.ref_proveedor)), '') as ref,
             public.clave_producto(coalesce(pr.nombre, pl.descripcion, pl.texto_original)) as clave,
             public.pedidos_unidad_norm(pl.unidad) as u_ped,
             public.pedidos_unidad_norm(pr.unidad) as u_prod,
             pr.unidades_formato as uf,
             coalesce(pl.producto_id::text, pl.id::text) || '|' || coalesce(public.pedidos_unidad_norm(pl.unidad), '') as grupo,
             sum(pl.cantidad) over w as cant_grupo,
             count(*) over w as n_grupo,
             row_number() over (w order by pl.orden, pl.creado_en, pl.id) as rn_grupo
      from public.compras_pedido_linea pl
      left join public.compras_producto pr on pr.id = pl.producto_id and pr.cuenta_id = v_ped.cuenta_id
      where pl.pedido_id = p_pedido
      window w as (partition by coalesce(pl.producto_id::text, pl.id::text) || '|' || coalesce(public.pedidos_unidad_norm(pl.unidad), ''))
    ) q
    order by q.orden, q.creado_en, q.id
  loop
    n_lin := n_lin + 1;
    a_ids := null; a_cant := null; a_precio := null; a_imp := null; a_met := null;
    f_ids := null; f_cant := null; f_precio := null; f_imp := null; f_met := null;
    v_notas := '{}'::text[];

    if l.rn_grupo > 1 then
      -- mismo producto y unidad que una línea anterior del pedido: hereda su resultado
      n_agrup := n_agrup + 1;
      v_g := v_grupos -> l.grupo;
      a_cant := (v_g ->> 'a_cant')::numeric; a_precio := (v_g ->> 'a_precio')::numeric;
      f_cant := (v_g ->> 'f_cant')::numeric; f_precio := (v_g ->> 'f_precio')::numeric;
      v_estado := coalesce(v_g ->> 'estado', 'sin_dato');
      if v_estado = 'falta' and l.estado_cotejo = 'sustituido' then v_estado := 'sustituido'; end if;
      v_notas := v_notas || format('Mismo producto que otra línea del pedido: se cotejan juntas (pedido total %s)', trim_scale(l.cant_grupo));
    else
      v_cant_ped := l.cant_grupo;
      if l.n_grupo > 1 then
        v_notas := v_notas || format('Producto pedido en %s líneas: se coteja la suma (%s)', l.n_grupo, trim_scale(l.cant_grupo));
      end if;

      if v_alb_lineas then
        select m.ids, m.cantidad, m.precio, m.importe, m.metodo
          into a_ids, a_cant, a_precio, a_imp, a_met
          from public.pedidos_cotejo_casar(v_alb_id, v_usadas_alb, l.producto_id, l.ref, l.clave) m;
        if a_ids is not null then v_usadas_alb := v_usadas_alb || a_ids; end if;
      end if;
      if v_fac_lineas then
        select m.ids, m.cantidad, m.precio, m.importe, m.metodo
          into f_ids, f_cant, f_precio, f_imp, f_met
          from public.pedidos_cotejo_casar(v_fac_id, v_usadas_fac, l.producto_id, l.ref, l.clave) m;
        if f_ids is not null then v_usadas_fac := v_usadas_fac || f_ids; end if;
      end if;

      if r_doc is null then
        v_estado := case when l.estado_cotejo = 'sustituido' then 'sustituido' else 'sin_dato' end;
      else
        r_ids := case when r_doc = 'albaran' then a_ids else f_ids end;
        r_cant := case when r_doc = 'albaran' then a_cant else f_cant end;
        r_precio := case when r_doc = 'albaran' then a_precio else f_precio end;

        if r_ids is null then
          v_estado := case when l.estado_cotejo = 'sustituido' then 'sustituido' else 'falta' end;
        elsif r_cant is null then
          v_estado := case when l.estado_cotejo = 'sustituido' then 'sustituido' else 'sin_dato' end;
          v_notas := v_notas || 'Cantidad no leída en el documento'::text;
        else
          -- unidades y factor k = unidades del documento por unidad del pedido
          k := 1; v_cmp := true;
          if l.u_ped is not null and l.u_prod is not null and l.u_ped <> l.u_prod then
            n_unid := n_unid + 1;
            if round(r_cant, 3) = round(v_cant_ped, 3) then
              v_notas := v_notas || format('Unidades distintas (pedido en %s, producto en %s) pero misma cantidad', l.u_ped, l.u_prod);
            elsif coalesce(l.uf, 0) > 0 and round(r_cant, 3) = round(v_cant_ped * l.uf, 3) then
              k := l.uf;
              v_notas := v_notas || format('Unidades distintas (pedido en %s, producto en %s): equivale a ×%s', l.u_ped, l.u_prod, trim_scale(l.uf));
            elsif coalesce(l.uf, 0) > 0 and round(r_cant, 3) = round(v_cant_ped / l.uf, 3) then
              k := 1 / l.uf;
              v_notas := v_notas || format('Unidades distintas (pedido en %s, producto en %s): equivale a ÷%s', l.u_ped, l.u_prod, trim_scale(l.uf));
            else
              k := null; v_cmp := false;
              v_notas := v_notas || format('Unidades distintas (pedido %s %s, documento %s %s): no se comparan cantidad ni precio',
                                           trim_scale(v_cant_ped), l.u_ped, trim_scale(r_cant), l.u_prod);
            end if;
          elsif l.u_ped is not null and l.u_prod is null and round(r_cant, 3) <> round(v_cant_ped, 3) then
            n_unid_desc := n_unid_desc + 1;
            v_notas := v_notas || format('Unidad del producto sin definir (pedido en %s): revisar si la diferencia es de unidades', l.u_ped);
          end if;

          v_estado := 'ok';
          if v_cmp and round(r_cant, 3) <> round(v_cant_ped * k, 3) then
            v_estado := 'cantidad';
            v_notas := v_notas || format('Pedido %s, %s %s', trim_scale(v_cant_ped), case when r_doc = 'albaran' then 'albarán' else 'factura' end, trim_scale(r_cant));
          end if;

          -- precio contra el estimado
          if k is not null and coalesce(l.precio_estimado, 0) > 0 and r_precio is not null then
            v_precio_eq := r_precio * k;
            if abs(v_precio_eq - l.precio_estimado) > c_tol * l.precio_estimado then
              v_dif := round((v_precio_eq - l.precio_estimado) * (r_cant / k), 2);
              if v_estado = 'ok' then v_estado := 'precio'; end if;
              n_dif_precio := n_dif_precio + 1;
              imp_dif_precio := imp_dif_precio + v_dif;
              v_difs := v_difs || jsonb_build_array(jsonb_build_object(
                'linea_id', l.id, 'producto_id', l.producto_id, 'nombre', l.nombre,
                'comparacion', 'pedido_' || r_doc,
                'precio_esperado', l.precio_estimado, 'precio_documento', round(v_precio_eq, 4),
                'diferencia_pct', round((v_precio_eq - l.precio_estimado) / l.precio_estimado * 100, 1),
                'importe', v_dif));
            end if;
          end if;

          -- factura contra albarán (ambos con líneas)
          if v_alb_lineas and v_fac_lineas then
            if f_cant is null then
              n_dif_fac := n_dif_fac + 1;
              v_notas := v_notas || 'Entregado pero no aparece en la factura'::text;
            else
              if round(f_cant, 3) <> round(a_cant, 3) then
                n_dif_fac := n_dif_fac + 1;
                if v_estado = 'ok' then v_estado := 'cantidad'; end if;
                v_notas := v_notas || format('Factura %s, albarán %s', trim_scale(f_cant), trim_scale(a_cant));
              end if;
              if a_precio is not null and f_precio is not null and a_precio > 0
                 and abs(f_precio - a_precio) > c_tol * a_precio then
                v_dif := round((f_precio - a_precio) * f_cant, 2);
                if v_estado = 'ok' then v_estado := 'precio'; end if;
                n_dif_precio := n_dif_precio + 1;
                imp_dif_precio := imp_dif_precio + v_dif;
                v_difs := v_difs || jsonb_build_array(jsonb_build_object(
                  'linea_id', l.id, 'producto_id', l.producto_id, 'nombre', l.nombre,
                  'comparacion', 'albaran_factura',
                  'precio_esperado', round(a_precio, 4), 'precio_documento', round(f_precio, 4),
                  'diferencia_pct', round((f_precio - a_precio) / a_precio * 100, 1),
                  'importe', v_dif));
              end if;
            end if;
          end if;
        end if;
      end if;

      if l.n_grupo > 1 then
        v_grupos := v_grupos || jsonb_build_object(l.grupo, jsonb_build_object(
          'estado', v_estado, 'a_cant', a_cant, 'a_precio', a_precio, 'f_cant', f_cant, 'f_precio', f_precio));
      end if;
    end if;

    case v_estado
      when 'ok' then n_ok := n_ok + 1;
      when 'falta' then n_falta := n_falta + 1;
      when 'cantidad' then n_cant := n_cant + 1;
      when 'precio' then n_precio := n_precio + 1;
      when 'sustituido' then n_sust := n_sust + 1;
      else n_sin := n_sin + 1;
    end case;

    update public.compras_pedido_linea
       set cantidad_albaran = a_cant,
           precio_albaran = round(a_precio, 4),
           cantidad_factura = f_cant,
           precio_factura = round(f_precio, 4),
           estado_cotejo = v_estado
     where id = l.id;

    v_lineas := v_lineas || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'linea_id', l.id,
      'producto_id', l.producto_id,
      'nombre', l.nombre,
      'estado', v_estado,
      'pedido', jsonb_build_object('cantidad', l.cantidad, 'unidad', l.unidad, 'precio', l.precio_estimado),
      'agrupada', case when l.n_grupo > 1 then jsonb_build_object('n_lineas', l.n_grupo, 'cantidad_total', l.cant_grupo, 'principal', l.rn_grupo = 1) end,
      'albaran', case when a_ids is not null or a_cant is not null then jsonb_build_object(
                   'cantidad', a_cant, 'precio', round(a_precio, 4), 'importe', round(a_imp, 2),
                   'casado_por', a_met, 'n_lineas', cardinality(a_ids)) end,
      'factura', case when f_ids is not null or f_cant is not null then jsonb_build_object(
                   'cantidad', f_cant, 'precio', round(f_precio, 4), 'importe', round(f_imp, 2),
                   'casado_por', f_met, 'n_lineas', cardinality(f_ids)) end,
      'notas', case when cardinality(v_notas) > 0 then to_jsonb(v_notas) end)));
  end loop;

  -- sobras: líneas del documento que no están en el pedido
  if v_alb_lineas then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'doc', 'albaran', 'linea_id', cl.id, 'producto_id', cl.producto_id,
             'ref', coalesce(nullif(btrim(cl.id_producto), ''), cp.ref_proveedor),
             'producto', coalesce(cl.producto, cp.nombre),
             'cantidad', cl.cantidad, 'precio_unit', cl.precio_unit,
             'importe', round(coalesce(cl.importe, cl.cantidad * cl.precio_unit), 2))) order by cl.created_at, cl.id), '[]'::jsonb),
           count(*), coalesce(round(sum(coalesce(cl.importe, cl.cantidad * cl.precio_unit)), 2), 0)
      into v_sobras, n_sobras, imp_sobras
      from public.compras_linea cl
      left join public.compras_producto cp on cp.id = cl.producto_id and cp.cuenta_id = cl.cuenta_id
     where cl.doc_id = v_alb_id and not (cl.id = any (v_usadas_alb)) and coalesce(cl.cantidad, 0) <> 0;
    select round(sum(coalesce(cl.importe, cl.cantidad * cl.precio_unit)), 2) into v_imp_alb
      from public.compras_linea cl where cl.doc_id = v_alb_id;
  else
    v_imp_alb := coalesce(v_alb_base, v_alb_total);
  end if;

  if v_fac_lineas then
    if v_fac_n_alb > 1 then
      v_avisos := v_avisos || format('La factura agrupa %s albaranes: no se listan sus sobras', v_fac_n_alb);
    else
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'doc', 'factura', 'linea_id', cl.id, 'producto_id', cl.producto_id,
               'ref', coalesce(nullif(btrim(cl.id_producto), ''), cp.ref_proveedor),
               'producto', coalesce(cl.producto, cp.nombre),
               'cantidad', cl.cantidad, 'precio_unit', cl.precio_unit,
               'importe', round(coalesce(cl.importe, cl.cantidad * cl.precio_unit), 2))) order by cl.created_at, cl.id), '[]'::jsonb),
             count(*), coalesce(round(sum(coalesce(cl.importe, cl.cantidad * cl.precio_unit)), 2), 0)
        into v_sobras_fac, n_sobras_fac, imp_sobras_fac
        from public.compras_linea cl
        left join public.compras_producto cp on cp.id = cl.producto_id and cp.cuenta_id = cl.cuenta_id
       where cl.doc_id = v_fac_id and not (cl.id = any (v_usadas_fac)) and coalesce(cl.cantidad, 0) <> 0;
    end if;
  end if;
  v_imp_fac := coalesce(v_fac_base, v_fac_total);

  -- factura a nivel de documento: ¿recoge el albarán vinculado y cuadra su importe?
  if v_fac_id is not null and v_alb_id is not null then
    -- 1) conciliación manual de Compras (ambos ids ya son de la cuenta del pedido) o enlace directo
    select true, cc.num_albaran
      into v_fac_incluye, v_alb_num_conc
      from public.compras_concil_confirmada cc
     where cc.factura_id = v_fac_id and cc.albaran_id = v_alb_id
     limit 1;
    v_fac_incluye := coalesce(v_fac_incluye, false)
      or exists (select 1 from public.compras_doc a where a.id = v_alb_id and a.factura_id = v_fac_id);
    -- 2) albaranes_detectados de la factura (por número del albarán o el conciliado), con importe
    if v_fac_n_alb > 0 and coalesce(public.pedidos_norm_num(v_alb_num), public.pedidos_norm_num(v_alb_num_conc)) is not null then
      select true,
             case when (e ->> 'importe') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e ->> 'importe')::numeric end
        into v_fac_encontrado, v_fac_imp_alb
        from jsonb_array_elements(v_fac_det) e
       where public.pedidos_norm_num(e ->> 'num_albaran') in (public.pedidos_norm_num(v_alb_num), public.pedidos_norm_num(v_alb_num_conc))
       limit 1;
      v_fac_incluye := v_fac_incluye or coalesce(v_fac_encontrado, false);
      if v_fac_imp_alb is not null and coalesce(v_alb_base, v_alb_total) is not null then
        v_fac_cuadra := (v_alb_base is not null and abs(v_fac_imp_alb - v_alb_base) <= greatest(c_tol * abs(v_alb_base), 0.05))
                     or (v_alb_total is not null and abs(v_fac_imp_alb - v_alb_total) <= greatest(c_tol * abs(v_alb_total), 0.05));
      end if;
    end if;

    if v_fac_incluye then
      if v_fac_cuadra is false then
        v_avisos := v_avisos || format('La factura declara %s para el albarán y el albarán suma %s',
                                       trim_scale(v_fac_imp_alb), trim_scale(coalesce(v_alb_base, v_alb_total)));
      end if;
    elsif v_fac_n_alb = 0 then
      -- la factura no detalla albaranes: no se puede confirmar ni negar (no marca diferencias)
      v_fac_incluye := null;
      v_fac_sin_detalle := true;
      if v_imp_fac is not null and coalesce(v_alb_base, v_alb_total) is not null then
        v_fac_cuadra_alb := (v_alb_base is not null and v_fac_base is not null and abs(v_fac_base - v_alb_base) <= greatest(c_tol * abs(v_alb_base), 0.05))
                         or (v_alb_total is not null and v_fac_total is not null and abs(v_fac_total - v_alb_total) <= greatest(c_tol * abs(v_alb_total), 0.05));
      end if;
      if v_fac_cuadra_alb then
        v_avisos := v_avisos || 'La factura no detalla albaranes; su importe coincide con el del albarán (factura de una sola entrega)'::text;
      else
        v_avisos := v_avisos || 'La factura no detalla albaranes: no se puede confirmar que recoja este'::text;
      end if;
    elsif coalesce(public.pedidos_norm_num(v_alb_num), public.pedidos_norm_num(v_alb_num_conc)) is null then
      -- el albarán no tiene número legible: tampoco se puede confirmar ni negar
      v_fac_incluye := null;
      v_avisos := v_avisos || 'El albarán no tiene número leído: no se puede confirmar que la factura lo recoja'::text;
    else
      v_avisos := v_avisos || 'La factura no recoge el albarán vinculado'::text;
    end if;
  end if;

  -- solo factura, sin líneas: su importe contra el total estimado del pedido
  if v_alb_id is null and v_fac_id is not null and not v_fac_lineas and v_fac_n_alb <= 1
     and coalesce(v_ped.total_estimado, 0) > 0 and v_imp_fac is not null then
    v_fac_cuadra_ped := abs(v_imp_fac - v_ped.total_estimado) <= c_tol * v_ped.total_estimado;
    if not v_fac_cuadra_ped then
      v_avisos := v_avisos || format('La factura (%s) no cuadra con el total estimado del pedido (%s)',
                                     trim_scale(v_imp_fac), trim_scale(v_ped.total_estimado));
    end if;
  end if;

  -- estado del pedido
  if r_doc is null then
    if v_fac_incluye is false or v_fac_cuadra is false then
      v_estado_ped := 'diferencias';
    else
      v_estado_ped := 'pendiente';
      v_motivo := 'Los documentos vinculados no tienen líneas leídas: no se puede cotejar producto a producto';
    end if;
  elsif n_falta + n_cant + n_precio + n_sust + n_sobras + n_sobras_fac + n_dif_fac > 0
        or v_fac_incluye is false or v_fac_cuadra is false then
    v_estado_ped := 'diferencias';
  else
    v_estado_ped := 'ok';
  end if;

  v_resumen := jsonb_build_object(
    'n_lineas', n_lin,
    'n_ok', n_ok,
    'n_faltas', n_falta,
    'n_cantidad', n_cant,
    'n_precio', n_precio,
    'n_sustituidos', n_sust,
    'n_sin_dato', n_sin,
    'n_lineas_agrupadas', n_agrup,
    'n_sobras', n_sobras,
    'importe_sobras', imp_sobras,
    'n_sobras_factura', n_sobras_fac,
    'importe_sobras_factura', imp_sobras_fac,
    'n_diferencias_precio', n_dif_precio,
    'importe_diferencias_precio', round(imp_dif_precio, 2),
    'n_diferencias_factura', n_dif_fac,
    'n_unidades_distintas', n_unid,
    'n_unidad_desconocida', n_unid_desc,
    'importe_pedido', v_ped.total_estimado,
    'importe_albaran', v_imp_alb,
    'importe_factura', v_imp_fac);

  v_det := jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'cotejado_en', now(),
    'tolerancia_precio', c_tol,
    'referencia', r_doc,
    'motivo', v_motivo,
    'documentos', jsonb_build_object(
      'albaran', case when v_alb_id is not null then jsonb_build_object(
                   'id', v_alb_id, 'num', v_alb_num, 'fecha', v_alb_fecha, 'base', v_alb_base, 'total', v_alb_total,
                   'tiene_lineas', v_alb_lineas, 'num_conciliado', v_alb_num_conc) end,
      'factura', case when v_fac_id is not null then jsonb_build_object(
                   'id', v_fac_id, 'num', v_fac_num, 'fecha', v_fac_fecha, 'base', v_fac_base, 'total', v_fac_total,
                   'tiene_lineas', v_fac_lineas, 'albaranes_que_agrupa', v_fac_n_alb,
                   'incluye_albaran', v_fac_incluye, 'sin_detalle_albaranes', v_fac_sin_detalle,
                   'importe_albaran_en_factura', v_fac_imp_alb,
                   'cuadra_importe', v_fac_cuadra, 'cuadra_con_albaran', v_fac_cuadra_alb,
                   'cuadra_con_pedido', v_fac_cuadra_ped) end),
    'resumen', v_resumen,
    'lineas', v_lineas,
    'sobras', v_sobras || v_sobras_fac,
    'diferencias_precio', v_difs,
    'avisos', case when cardinality(v_avisos) > 0 then to_jsonb(v_avisos) end));

  update public.compras_pedido
     set cotejo_estado = v_estado_ped, cotejo_detalle = v_det, cotejado_en = now()
   where id = p_pedido;

  perform set_config('pedidos.cotejando', '', true);
  return v_det;
end $$;
revoke execute on function public.pedidos_cotejar(uuid) from anon, public;
grant execute on function public.pedidos_cotejar(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. SEEDS
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.modulos (id, nombre, area, madurez)
  values ('pedidos', 'Pedidos', 'Operaciones', 'beta')
  on conflict (id) do nothing;
insert into public.modulos_contratados (cuenta_id, modulo_id, activo)
  values ('082c5366-d9ae-49b9-a8b8-8caad73985bd', 'pedidos', true)
  on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (selects para el orquestador; nada de esto se ejecuta)
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Columnas nuevas (11 en proveedor, 11 en producto) y defaults:
--    select table_name, column_name, data_type, column_default from information_schema.columns
--    where table_schema = 'public' and (
--      (table_name = 'compras_proveedor' and column_name in ('pedido_canal','pedido_email','pedido_whatsapp','pedido_telefono',
--        'pedido_minimo','pedido_dias_reparto','pedido_hora_corte','pedido_notas','albaranes_por_email','catalogo_actualizado_en','pedible'))
--      or (table_name = 'compras_producto' and column_name in ('unidad','formato','unidades_formato','precio_catalogo','categoria',
--        'codigo_barras','alias','activo','pedible','origen','catalogo_en')))
--    order by 1, 2;   -- 22 filas
--    select pedido_canal, pedible, albaranes_por_email, count(*) from compras_proveedor group by 1,2,3;  -- email/true/false 265
--    select origen, activo, pedible, count(*) from compras_producto group by 1,2,3;                      -- factura/true/true 2166
-- 2) Índice por lower(ref): hoy (04-10) se espera el NO único por el duplicado de DISTNURA:
--    select indexname, indexdef from pg_indexes where tablename = 'compras_producto'
--      and indexname in ('idx_compras_producto_ref_lower', 'compras_producto_ref_lower_ux');
--    select cuenta_id, proveedor_id, lower(ref_proveedor), array_agg(ref_proveedor), array_agg(nombre)
--    from compras_producto where ref_proveedor is not null group by 1,2,3 having count(*) > 1;
-- 3) Tablas nuevas con RLS y políticas:
--    select relname, relrowsecurity from pg_class where relname in ('compras_pedido','compras_pedido_linea','compras_pedido_alias',
--      'compras_catalogo_import','compras_pedido_numerador');                                         -- 5 × true
--    select tablename, policyname, cmd from pg_policies where tablename like 'compras_pedido%' or tablename = 'compras_catalogo_import';
-- 4) Privilegios: nada para anon, ni TRUNCATE/REFERENCES/TRIGGER/MAINTAIN para authenticated, numerador solo SELECT (esperado 0 filas):
--    select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('compras_pedido','compras_pedido_linea','compras_pedido_alias','compras_catalogo_import','compras_pedido_numerador')
--      and (grantee = 'anon'
--           or (grantee = 'authenticated' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
--           or (grantee = 'authenticated' and table_name = 'compras_pedido_numerador' and privilege_type <> 'SELECT'));
--    -- (por si information_schema no lista MAINTAIN en esta versión; esperado 5 × false):
--    select c.relname, has_table_privilege('authenticated', c.oid, 'MAINTAIN') from pg_class c
--    where c.relnamespace = 'public'::regnamespace and c.relname in ('compras_pedido','compras_pedido_linea','compras_pedido_alias',
--      'compras_catalogo_import','compras_pedido_numerador');
--    -- funciones: ninguna ejecutable por anon; las de trigger tampoco por authenticated (esperado 0 filas):
--    select p.proname, r.rolname from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
--    where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('pedidos_norm','pedidos_norm_num','pedidos_unidad_norm','pedidos_aprender_alias','pedidos_catalogo_centro',
--        'pedidos_sugerir_documentos','pedidos_cotejo_casar','pedidos_cotejar','compras_pedido_numerar','compras_pedido_tocar',
--        'compras_pedido_linea_cuenta','compras_pedido_linea_total','compras_pedido_alias_norm',
--        'compras_pedido_linea_cotejo_proteger','compras_catalogo_import_sellar')
--      and has_function_privilege(r.rolname, p.oid, 'execute')
--      and (r.rolname = 'anon' or p.proname like 'compras_pedido%' or p.proname like 'compras_catalogo%');
--    -- políticas con coherencia de cuenta (with_check debe citar centros/compras_proveedor/compras_doc/compras_producto):
--    select tablename, policyname, with_check from pg_policies
--    where tablename in ('compras_pedido','compras_pedido_linea','compras_pedido_alias','compras_catalogo_import');
-- 5) Triggers (esperados: numerar, tocar | linea_cotejo, linea_cuenta, linea_total | alias_norm | import_sellar):
--    select tgrelid::regclass, tgname from pg_trigger where not tgisinternal
--      and tgrelid in ('public.compras_pedido'::regclass, 'public.compras_pedido_linea'::regclass, 'public.compras_pedido_alias'::regclass,
--                      'public.compras_catalogo_import'::regclass)
--    order by 1, 2;
-- 6) Seeds:
--    select * from modulos where id = 'pedidos';                                                       -- Pedidos / Operaciones / beta
--    select * from modulos_contratados where modulo_id = 'pedidos';                                    -- Bonita, activo
-- 7) Helpers:
--    select pedidos_norm('Una caixa de PA BLANC, ¡per demà!'), pedidos_norm('Col·liflor'), pedidos_norm_num('04/118'),
--           pedidos_unidad_norm('Caixes'), pedidos_unidad_norm('quilos'), pedidos_unidad_norm('dotzena');
--    -- 'una caixa de pa blanc per dema' | 'colliflor' | '4118' | 'caja' | 'kg' | 'docena'
-- 8) Catálogo por centro (como postgres cuenta_actual() es null, pero la función es invoker y como
--    owner no hay RLS: sirve para mirar datos). Tamarindos Restaurante de Bonita:
--    select * from pedidos_catalogo_centro('fb9e4af7-e50d-4617-b5e7-2de795faa894') limit 20;   -- o el id de Bonita que toque
--    select c.nombre, (select count(*) from pedidos_catalogo_centro(c.id)) from centros c
--    where c.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' order by 1;                  -- Estructura/Bodega ~0, cocinas > 0
-- 9) Numeración, total, sugerencias y cotejo (transacción que se revierte; con un albarán real):
--    begin;
--      with alb as (select d.id, d.proveedor_id, d.canal, d.fecha from compras_doc d
--                   where d.tipo = 'albaran' and d.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
--                     and exists (select 1 from compras_linea l where l.doc_id = d.id) order by d.fecha desc limit 1),
--           cen as (select c.id from centros c, alb where c.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd'
--                   and pedidos_norm(c.nombre) = pedidos_norm(alb.canal))
--      insert into compras_pedido (cuenta_id, centro_id, proveedor_id, estado, fecha_entrega, origen)
--      select '082c5366-d9ae-49b9-a8b8-8caad73985bd', cen.id, alb.proveedor_id, 'enviado', alb.fecha, 'texto' from alb, cen
--      returning id, numero, enviado_en;                                       -- numero P-2026-0001, enviado_en relleno
--      -- líneas = las del albarán, con la primera cantidad +1 y el precio de la segunda +10 %:
--      insert into compras_pedido_linea (pedido_id, producto_id, cantidad, precio_estimado, orden)
--      select (select id from compras_pedido order by creado_en desc limit 1), l.producto_id,
--             case when row_number() over (order by l.created_at) = 1 then l.cantidad + 1 else l.cantidad end,
--             case when row_number() over (order by l.created_at) = 2 then round(l.precio_unit * 1.1, 4) else l.precio_unit end,
--             row_number() over (order by l.created_at)
--      from compras_linea l where l.doc_id = (select d.id from compras_doc d where d.tipo = 'albaran'
--        and d.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd' and exists (select 1 from compras_linea x where x.doc_id = d.id)
--        order by d.fecha desc limit 1) and l.cantidad > 0 and l.producto_id is not null;
--      select numero, total_estimado from compras_pedido order by creado_en desc limit 1;     -- total = Σ cantidad × precio
--      select * from pedidos_sugerir_documentos((select id from compras_pedido order by creado_en desc limit 1));
--      -- el albarán de origen arriba con puntuación ~100 y «N de N productos del pedido»
--      update compras_pedido set albaran_doc_id = (select doc_id from pedidos_sugerir_documentos(id) where tipo = 'albaran' limit 1)
--      where id = (select id from compras_pedido order by creado_en desc limit 1);
--      select pedidos_cotejar((select id from compras_pedido order by creado_en desc limit 1)) -> 'resumen';
--      -- n_cantidad 1 (la primera), n_precio 1 (la segunda, ~ −9 % sobre el estimado), n_faltas 0, n_sobras 0
--      select orden, cantidad, cantidad_albaran, precio_estimado, precio_albaran, estado_cotejo
--      from compras_pedido_linea where pedido_id = (select id from compras_pedido order by creado_en desc limit 1) order by orden;
--      select cotejo_estado from compras_pedido order by creado_en desc limit 1;              -- diferencias
--      select pedidos_aprender_alias('una caixa de pa blanc', (select producto_id from compras_pedido_linea limit 1), 'caja');
--      select pedidos_aprender_alias('Una caixa de pa blanc!', (select producto_id from compras_pedido_linea limit 1));
--      select frase_norm, usos, unidad from compras_pedido_alias;                              -- 1 fila, usos 2, unidad caja
--    rollback;
--    -- OJO: el rollback deshace también el numerador (P-2026-0001 vuelve a quedar libre).
-- 10) Plan del catálogo (debería ir en < 300 ms con 18.6k líneas):
--    explain analyze select * from pedidos_catalogo_centro('fb9e4af7-e50d-4617-b5e7-2de795faa894');
-- 11) Seguridad con sesión simulada (transacción que se revierte). <UID_A> = perfil NO operador de
--    Bonita; <CENTRO_B>/<PROV_B>/<DOC_B>/<PROD_B> = ids de OTRA cuenta (consultarlos antes como postgres):
--    begin;
--      set local role authenticated;
--      select set_config('request.jwt.claims', json_build_object('sub', '<UID_A>', 'role', 'authenticated')::text, true);
--      select cuenta_actual(), es_operador();                                   -- Bonita, false
--      -- a) centro ajeno → ERROR new row violates row-level security policy
--      insert into compras_pedido (centro_id) values ('<CENTRO_B>');
--    rollback;
--    -- repetir (cada una en su begin/rollback) con un centro de Bonita y: proveedor_id = '<PROV_B>',
--    -- albaran_doc_id = '<DOC_B>' → ERROR RLS; línea con producto_id = '<PROD_B>' → ERROR RLS;
--    -- pedidos_aprender_alias('x', <producto de Bonita>, null, '<CENTRO_B>') → 'El centro no es de la cuenta del producto'.
--    -- b) auditoría y cotejo no falsificables (con un centro de Bonita):
--    --   insert into compras_pedido (centro_id, creado_por, creado_en, cotejo_estado, estado, proveedor_id, enviado_por, enviado_en)
--    --   values ('<CENTRO_A>', gen_random_uuid(), '1999-01-01', 'ok', 'enviado', '<PROV_A>', gen_random_uuid(), '1999-01-01')
--    --   returning numero, creado_por, creado_en, cotejo_estado, enviado_por, enviado_en;
--    --   -- P-2026-…, <UID_A>, now(), pendiente, <UID_A>, now()
--    --   update compras_pedido set cotejo_estado = 'ok', albaran_doc_id = '<DOC_A>' where id = …
--    --   returning cotejo_estado;                                                -- pendiente (no 'ok')
--    --   update compras_pedido_linea set estado_cotejo = 'ok', cantidad_albaran = 99 where …
--    --   returning estado_cotejo, cantidad_albaran;                              -- sin cambios
--    --   update compras_pedido_linea set estado_cotejo = 'sustituido' where … returning estado_cotejo;  -- sustituido
