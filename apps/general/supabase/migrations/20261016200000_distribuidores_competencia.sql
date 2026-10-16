-- Distribuidores (16-10-2026, noche): comparativa con la competencia. Al preparar un presupuesto se
-- puede indicar, módulo a módulo, con quién lo tiene contratado hoy el cliente (del estudio de precios
-- de la competencia de octubre de 2026, o a mano) y el presupuesto saca la comparativa y el ahorro anual.
--
-- Aditiva e idempotente. Mismas reglas de RLS que dist_precios.

-- ═══ 1. Estudio de la competencia (pestaña Competencia) ═══
create table if not exists public.dist_competencia (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null default cuenta_actual() references public.cuentas(id) on delete cascade,
  orden       integer not null default 0,
  categoria   text not null,                     -- TPV, Reservas, Visitas, Mensajería, Compras, Personal, Contabilidad, CRM, Pago QR, Web…
  proveedor   text not null,
  plan        text not null default '',
  precio      numeric null,                      -- €/mes sin IVA, en la unidad de «base»
  base        text not null default 'local'
    constraint dist_competencia_base_chk check (base in ('local', 'empleado', 'usuario', 'comision', 'pago_unico')),
  unidad      text null,                         -- texto: «por local», «por empleado», «comisión 1,5 %»…
  incluye     text null,
  extras      text null,
  fiabilidad  text null,                         -- Oficial, Comparador, Estimación
  fuente      text null,                         -- URL
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.dist_competencia is 'Precios de la competencia por categoría (estudio oct. 2026, editable). base: local = cuota fija por local/cuenta; empleado/usuario = se multiplica; comision/pago_unico = sin cuota mensual comparable.';
create index if not exists idx_dist_competencia_cuenta on public.dist_competencia (cuenta_id, categoria, orden);

alter table public.dist_competencia enable row level security;
revoke all on public.dist_competencia from anon;
grant select, insert, update, delete on public.dist_competencia to authenticated;
revoke truncate, references, trigger, maintain on public.dist_competencia from authenticated;
drop policy if exists dist_competencia_acceso on public.dist_competencia;
create policy dist_competencia_acceso on public.dist_competencia
  for all to authenticated
  using (cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (cuenta_id = (select cuenta_actual()) or (select es_operador()));

drop trigger if exists dist_competencia_tocar on public.dist_competencia;
create trigger dist_competencia_tocar
  before update on public.dist_competencia
  for each row execute function public.dist_precios_tocar();

-- ═══ 2. Lista de precios: con qué categoría del estudio se compara cada línea ═══
alter table public.dist_precios add column if not exists categoria text null;
comment on column public.dist_precios.categoria is 'Categoría de dist_competencia con la que se compara esta línea (null = sin comparativa).';
update public.dist_precios set categoria = case modulo
    when 'TPV' then 'TPV' when 'Reservas' then 'Reservas' when 'Compras' then 'Compras'
    when 'Contabilidad' then 'Contabilidad' when 'RRHH' then 'Personal' when 'Agentes' then 'Mensajería'
    when 'Clientes' then 'CRM' when 'Web' then 'Web' else null end
  where categoria is null;

-- ═══ 3. Presupuesto: cómo se cuenta la competencia y el ahorro resultante ═══
alter table public.dist_presupuestos
  add column if not exists comp_meses text not null default 'todo',
  add column if not exists ahorro_anual numeric null;
alter table public.dist_presupuestos drop constraint if exists dist_presupuestos_comp_meses_chk;
alter table public.dist_presupuestos add constraint dist_presupuestos_comp_meses_chk check (comp_meses in ('todo', 'apertura'));
comment on column public.dist_presupuestos.comp_meses is 'Meses que se cuentan a la competencia en la comparativa: todo (12 meses, lo normal en SaaS) o apertura (solo los meses de apertura del cliente).';
comment on column public.dist_presupuestos.ahorro_anual is 'Σ (lo que paga hoy − Jano) de las líneas con competidor, al año. Lo calcula el panel. null = sin comparativa.';
comment on column public.dist_presupuestos.lineas is 'Copia de las líneas elegidas: [{precio_id, orden, modulo, plan, contenido, tipo, precio, precio_lista, cantidad, meses:[1..12], comp:{competencia_id, proveedor, plan, precio_mes, base, nota} | null}].';

-- ═══ 4. Semilla: hoja «Detalle» del estudio (104 planes), solo si la cuenta no tiene ninguna ═══
insert into public.dist_competencia (cuenta_id, orden, categoria, proveedor, plan, precio, base, unidad, incluye, extras, fiabilidad, fuente)
select '082c5366-d9ae-49b9-a8b8-8caad73985bd', v.orden, v.categoria, v.proveedor, v.plan, v.precio, coalesce(nullif(v.base, ''), 'local'), v.unidad, v.incluye, v.extras, v.fiabilidad, v.fuente
from (values
  (10, 'TPV', 'Ágora', 'Básico monopuesto', 34.0, 'local', 'por licencia/terminal', 'TPV hostelería, 1 puesto', 'Instalación 300–1.000 €; venta por distribuidor', 'Estimación', 'https://www.last.app/last-lessons/ranking-los-mejores-software-tpv-para-restaurante-2026'),
  (20, 'TPV', 'Ágora', 'Profesional', 90.0, 'local', 'por licencia', 'Multipuesto completo', 'Otro comparador: 150–400 €/local con implantación 500–3.000 €', 'Estimación', 'https://desarrollosoftware.es/blog/software-hosteleria-restaurantes-espana-guia-precios-2026/'),
  (30, 'TPV', 'Hiopos (ICG)', 'No publicado', 175.0, 'local', 'por local (estimado)', 'TPV + tablets + backoffice HiOffice', 'Reseña: >700 €/mes para 4 locales; hardware y licencias por distribuidor', 'Estimación', 'https://www.capterra.co.uk/software/189231/hiopos'),
  (40, 'TPV', 'Glop', 'Pro (licencia)', 449.0, 'pago_unico', 'pago único licencia', 'Software TPV hostelería', 'Pack con hardware 799 €; mantenimiento 150–400 €/año; módulos aparte (comandero, KDS)', 'Comparador', 'https://ventatpv.com/content/46--los-mejores-software-tpv-en-espana-precios-y-comparativa-2025'),
  (50, 'TPV', 'Cegid Revo', 'One', 30.0, 'local', 'por licencia/mes', 'TPV en iPad', 'Puesta en marcha 400–900 €; add-ons de pago', 'Comparador', 'https://www.last.app/last-lessons/ranking-los-mejores-software-tpv-para-restaurante-2026'),
  (60, 'TPV', 'Cegid Revo', 'Pro', 99.0, 'local', 'por licencia/mes', 'Versión completa', 'Igual que One', 'Comparador', 'https://www.last.app/last-lessons/ranking-los-mejores-software-tpv-para-restaurante-2026'),
  (70, 'TPV', 'Last.app', 'Starter', 50.0, 'local', 'por local (pago anual)', '2 licencias, 100 pedidos delivery, QR, reservas básicas', 'Alta 500 €; KDS +35 €; QR 1,5 %; tienda online 4 % + 0,20 €', 'Oficial', 'https://www.last.app/en/pricing'),
  (80, 'TPV', 'Last.app', 'Growth', 95.0, 'local', 'por local (pago anual)', '4 licencias, stock, 6 integraciones', 'Alta 500 €; KDS +35 €', 'Oficial', 'https://www.last.app/en/pricing'),
  (90, 'TPV', 'Last.app', 'Unlimited', 175.0, 'local', 'por local (pago anual)', 'Todo ilimitado', 'Alta 500 €; KDS +35 €', 'Oficial', 'https://www.last.app/en/pricing'),
  (100, 'TPV', 'Qamarero', 'Basic', 119.0, 'local', 'por local', 'TPV, comanderos, carta QR, pedir y pagar, KDS', 'Implantación 200 €; pasarela Monei aparte; -17 % anual', 'Oficial', 'https://www.qamarero.com/precios/'),
  (110, 'TPV', 'Qamarero', 'Pack Duo', 199.0, 'local', 'por local', 'Basic + 1 bloque (CRM/reservas, delivery o stock/turnos)', 'Implantación 200–500 €', 'Oficial', 'https://www.qamarero.com/precios/'),
  (120, 'TPV', 'Qamarero', 'Total', 249.0, 'local', 'por local', 'Todos los bloques', 'Implantación 500 €', 'Oficial', 'https://www.qamarero.com/precios/'),
  (130, 'TPV', 'Lightspeed', 'Basic', 89.0, 'local', 'por local, 1 terminal', 'TPV, cocina, pagos integrados', 'Terminal extra 49 €; add-ons de pago', 'Oficial', 'https://lightspeedhq.com/es/tpv/restaurant/precios'),
  (140, 'TPV', 'Lightspeed', 'Core', 159.0, 'local', 'por local, 2 terminales', '+ QR, inventario, fidelización', 'Terminal extra 49 €', 'Oficial', 'https://lightspeedhq.com/es/tpv/restaurant/precios'),
  (150, 'TPV', 'Lightspeed', 'Pro', 249.0, 'local', 'por local, 3 terminales', '+ delivery, click & collect', 'Terminal extra 49 €', 'Oficial', 'https://lightspeedhq.com/es/tpv/restaurant/precios'),
  (160, 'TPV', 'SumUp POS', 'Gratis', 0.0, 'comision', 'comisión 1,49 %', 'TPV básico', 'Dispositivo 399 €; 0,75 % con Pagos Plus (19 €/mes)', 'Oficial', 'https://www.sumup.com/es-es/precios/?lang=es'),
  (170, 'TPV', 'SumUp POS', 'Plus', 49.0, 'local', 'por local', 'Funciones hostelería, plano, comandas', 'Mismas comisiones y hardware', 'Oficial', 'https://www.sumup.com/es-es/precios/?lang=es'),
  (180, 'TPV', 'Square', 'Gratuito', 0.0, 'comision', 'comisión 1,25 % + 0,05 €', 'Pedidos, mesas, caja', 'KDS 15 €/disp.; hardware aparte', 'Oficial', 'https://squareup.com/es/es/point-of-sale/restaurants/pricing'),
  (190, 'TPV', 'Square', 'Plus', 59.0, 'local', 'por punto de venta', 'Informes, KDS ilimitado, Scan to Pay', 'Mismas comisiones', 'Oficial', 'https://squareup.com/es/es/point-of-sale/restaurants/pricing'),
  (200, 'TPV', 'Camarero10', 'Estándar', 39.9, 'local', 'coste base', 'TPV + comandero', 'Presupuesto global', 'Comparador', 'https://www.capterra.es/software/1023795/camarero10'),
  (210, 'TPV', 'Foodeo', 'Basic', 34.9, 'local', 'por usuario/mes', 'Comandas, ventas, stock', '—', 'Comparador', 'https://www.capterra.com/p/10035154/Foodeo/'),
  (220, 'TPV', 'Foodeo', 'Unlimited', 99.9, 'local', 'no aclarado', '+ pedidos web y reparto', '—', 'Comparador', 'https://www.capterra.com/p/10035154/Foodeo/'),
  (230, 'TPV', 'Numier', 'No publicado', null, 'local', 'pago único o SaaS', 'TPV táctil', 'Solo presupuesto', '—', 'https://www.softwaredoit.es/numier/numier.html'),
  (240, 'Reservas', 'CoverManager', 'CoverOnTheGo', 39.0, 'local', 'por local', 'Colas, CRM, encuestas, valoraciones', 'SMS 0,15 €', 'Oficial', 'https://www.covermanager.com/wp-content/uploads/sites/2/2025/06/CoverManager_Pricing_2025.pdf'),
  (250, 'Reservas', 'CoverManager', 'Tramo 2', 99.0, 'local', 'por local', 'Prepagos, mapa de mesas, integraciones TPV', 'Pasarela 1 % + 0,20 € (+10 %)', 'Oficial', 'https://www.covermanager.com/wp-content/uploads/sites/2/2025/06/CoverManager_Pricing_2025.pdf'),
  (260, 'Reservas', 'CoverManager', 'Tramo 3', 199.0, 'local', 'por local', 'Gestión avanzada, usuarios ilimitados, API', 'Ídem', 'Oficial', 'https://www.covermanager.com/wp-content/uploads/sites/2/2025/06/CoverManager_Pricing_2025.pdf'),
  (270, 'Reservas', 'CoverManager', 'Tramo 4', 349.0, 'local', 'por local', 'Precios dinámicos y todo lo anterior', 'Ídem', 'Oficial', 'https://www.covermanager.com/wp-content/uploads/sites/2/2025/06/CoverManager_Pricing_2025.pdf'),
  (280, 'Reservas', 'CoverManager', 'CoverChannels', 0.0, 'comision', 'comisión 1–5 % por comensal', 'Reservas desde Google, Instagram, marketplaces', 'Gratis hasta 8.000 comensales/mes', 'Oficial', 'https://www.covermanager.com/wp-content/uploads/sites/2/2025/06/CoverManager_Pricing_2025.pdf'),
  (290, 'Reservas', 'TheFork Manager', 'Pro (estimado)', 140.0, 'local', 'por local (75–200)', 'Reservas, mesas, CRM, marketing', '+ 2–2,50 € por comensal que llega de su red', 'Comparador', 'https://eatsqr.com/es/blog/thefork-comisiones/'),
  (300, 'Reservas', 'Zenchef', 'Desde', 129.0, 'local', 'por local (129–249)', 'Web, reservas, CRM, SMS; sin comisión', 'Permanencia 12 meses; mismo grupo que CoverManager', 'Comparador', 'https://www.lafabriquedunet.fr/logiciel/zenchef'),
  (310, 'Reservas', 'Restoo', 'Desde', 39.0, 'local', 'por local (39–249)', 'Reservas sin comisión', '—', 'Comparador', 'https://www.capterra.es/software/1083290/Restoo'),
  (320, 'Reservas', 'SevenRooms', 'Starter (estimado)', 430.0, 'local', 'por local, contrato anual', 'Reservas + CRM enterprise', 'WhatsApp ~86 €/mes', 'Estimación', 'https://gappsy.com/tools/sevenrooms/'),
  (330, 'Reservas', 'MesaBot', 'Starter', 89.0, 'local', 'por local', 'Reservas con WhatsApp', 'Pack voz +59 € (150 min)', 'Oficial (blog propio)', 'https://mesabot.es/covermanager-vs-thefork'),
  (340, 'Visitas', 'Bookeo', 'Tours & Activities', 34.0, 'local', 'por cuenta', 'Calendario, pagos online, widget', 'SMS aparte', 'Comparador', 'https://www.capterra.com/p/117299/Bookeo/pricing/'),
  (350, 'Visitas', 'TuriTop', 'Plan único', 99.0, 'local', 'por cuenta', 'Todo, channel manager', '1,5 % por reserva + pasarela', 'Comparador', 'https://www.capterra.es/software/153897/turitop'),
  (360, 'Visitas', 'Regiondo', 'Starter', 49.0, 'local', 'por cuenta (2 usuarios)', 'Reservas, tickets', '~0,48 €/ticket + 3 % por reserva', 'Comparador', 'https://trusted.de/regiondo-pro-kosten'),
  (370, 'Visitas', 'Regiondo', 'Advanced', 99.0, 'local', 'por cuenta', '+ channel manager', 'Ídem', 'Comparador', 'https://trusted.de/regiondo-pro-kosten'),
  (380, 'Visitas', 'FareHarbor', 'Sin cuota', 0.0, 'comision', '6–8 % al cliente final', 'Reservas y pagos', 'El negocio paga la tarjeta', 'Comparador', 'https://captainbook.io/blog/fareharbor-pricing-fees-explained'),
  (390, 'Visitas', 'Winedering', 'Marketplace', 0.0, 'comision', '20 % por reserva', 'Venta de experiencias de enoturismo', 'Pasarela incluida', 'Oficial', 'https://www.winedering.com/es/partners/suppliers'),
  (400, 'Mensajería', 'Superchat', 'Professional', 149.0, 'local', 'por cuenta (6 usuarios)', 'WhatsApp, Instagram, email, SMS; 1 agente IA', 'Permanencia 12 meses; mensajes Meta aparte', 'Oficial', 'https://www.superchat.com/plaene'),
  (410, 'Mensajería', 'Superchat', 'Advanced', 299.0, 'local', 'por cuenta (12 usuarios)', '3 agentes IA', 'Ídem', 'Oficial', 'https://www.superchat.com/plaene'),
  (420, 'Mensajería', 'Respond.io', 'Starter', 68.0, 'local', 'por cuenta (5 usuarios), USD', 'Bandeja omnicanal', 'Meta aparte; contactos extra', 'Comparador', 'https://www.eesel.ai/blog/respond-io-pricing'),
  (430, 'Mensajería', 'Respond.io', 'Growth', 137.0, 'local', 'por cuenta (10 usuarios), USD', '+ agentes IA', 'Créditos IA extra', 'Comparador', 'https://www.eesel.ai/blog/respond-io-pricing'),
  (440, 'Mensajería', 'Callbell', 'Por usuario', 12.0, 'usuario', 'por usuario + canales', 'Bandeja compartida', 'WhatsApp ~46 €, Instagram ~19 €, bot ~19 €', 'Comparador', 'https://www.capterra.in/software/180550/callbell'),
  (450, 'Mensajería', 'Trengo', 'Boost', 299.0, 'local', 'por cuenta (10 usuarios)', 'Omnicanal con IA', '0,25–0,30 € por conversación resuelta por IA', 'Comparador', 'https://www.eesel.ai/blog/trengo-pricing'),
  (460, 'Mensajería', 'Manychat', 'Pro', 25.0, 'local', 'hasta 2.500 contactos, USD', 'DM Instagram/WhatsApp automatizados + IA', 'Meta aparte', 'Comparador', 'https://www.eesel.ai/blog/manychat-pricing'),
  (470, 'Mensajería', 'WATI', 'Pro', 102.0, 'local', 'por cuenta (5 usuarios)', 'WhatsApp + agente IA', 'Margen ~20 % sobre Meta', 'Comparador', 'https://chatarmin.com/en/blog/wati-pricing'),
  (480, 'Mensajería', 'Bookline', 'A medida', null, 'local', 'por proyecto', 'Voz y WhatsApp con IA para restaurantes', 'Segmento enterprise; pedir presupuesto', 'Estimación', 'https://www.appvizer.es/relacion-cliente/sistema-reservas/bookline'),
  (490, 'Compras', 'Haddock', 'FINA', 149.0, 'local', 'por cuenta (prob. por local)', '500 documentos/mes, conciliación bancaria IA', 'Pago con tarjeta', 'Oficial', 'https://haddock.app/precios'),
  (500, 'Compras', 'Haddock', 'FINA + OPS', 248.0, 'local', 'por cuenta', '+ escandallos, pedidos, inventario', '—', 'Oficial', 'https://haddock.app/precios'),
  (510, 'Compras', 'Haddock', 'ALL IN ONE', 299.0, 'local', 'por cuenta', 'Finanzas + operaciones + RRHH', 'Antes ~60–72 €: ha subido mucho', 'Oficial', 'https://haddock.app/precios'),
  (520, 'Compras', 'GStock', 'Zero', 50.0, 'local', 'por local (43,90–56)', 'Pedidos, albaranes, facturas', 'OCR, IA y APPCC aparte', 'Comparador', 'https://www.capterra.es/software/1019904/gstock'),
  (530, 'Compras', 'GStock', 'One', 76.0, 'local', 'por local (65,90–85)', '+ escandallos, inventario, mermas', 'Ídem', 'Comparador', 'https://www.capterra.es/software/1019904/gstock'),
  (540, 'Compras', 'GStock', 'Premium', 114.0, 'local', 'por local (98,90–128)', '+ teórico vs real, multicentro', 'Ídem', 'Comparador', 'https://www.capterra.es/software/1019904/gstock'),
  (550, 'Compras', 'tSpoonLab', 'Professional', 95.0, 'local', 'por cuenta (5 usuarios)', 'Oferta, procesos, OCR albaranes', 'Sin pago inicial', 'Oficial', 'https://www.tspoonlab.com/componente-precios/'),
  (560, 'Compras', 'tSpoonLab', 'tspoonFast', 110.0, 'local', 'por cuenta (5 usuarios)', 'Coste por elaboración, compras, inventario', '—', 'Oficial', 'https://www.tspoonlab.com/componente-precios/'),
  (570, 'Compras', 'tSpoonLab', 'Premium', 150.0, 'local', 'usuarios ilimitados', '+ soporte telefónico, producción', '—', 'Comparador', 'https://chefbusiness.co/tspoonlab-opiniones-resena-software-gestion-hosteleria/'),
  (580, 'Compras', 'Yurest', 'Lite', 79.0, 'local', 'por local (probable)', 'Compras, OCR, cuenta de explotación, fichaje', '—', 'Comparador', 'https://restauracionnews.com/2025/11/yurest-lanza-yurest-lite/'),
  (590, 'Compras', 'Yurest', 'Completo (desde)', 99.0, 'local', 'por local, modular', 'Compras, escandallos, inventario, cocina central', 'Módulos se suman', 'Comparador', 'https://www.capterra.com/p/10047559/Yurest/'),
  (600, 'Compras', 'Dijit', 'Plan 100', 40.0, 'local', '100 páginas/mes', 'Solo OCR con IA', 'Sin alta ni permanencia', 'Oficial', 'https://www.dijit.app/tarifas-de-gestion-documenta-con-ia-y-ocr/'),
  (610, 'Compras', 'Dijit', 'Plan 500', 120.0, 'local', '500 páginas/mes', 'Solo OCR con IA', 'Ídem', 'Oficial', 'https://www.dijit.app/tarifas-de-gestion-documenta-con-ia-y-ocr/'),
  (620, 'Compras', 'Dijit', 'Plan 1.000', 180.0, 'local', '1.000 páginas/mes', 'Solo OCR con IA', 'Ídem', 'Oficial', 'https://www.dijit.app/tarifas-de-gestion-documenta-con-ia-y-ocr/'),
  (630, 'Compras', 'Apicbase', 'Growth (estimado)', 140.0, 'local', 'por local, USD', 'Escandallos, compras, inventario', 'Integraciones aparte', 'Estimación', 'https://toolradar.com/tools/apicbase/pricing'),
  (640, 'Compras', 'MarketMan', 'Starter', 190.0, 'local', 'por local, USD', 'Teórico vs real, 50 facturas IA/mes', 'Implantación ~1.500 $; poca presencia en España', 'Comparador', 'https://pricingsaas.com/companies/marketman'),
  (650, 'Personal', 'Skello', 'Planificación Estándar', 59.0, 'local', 'por local (desde, sube con plantilla)', 'Cuadrantes, horas, ausencias', 'Experto RRHH +20 €', 'Oficial', 'https://www.skello.es/planes'),
  (660, 'Personal', 'Skello', 'Fichaje Estándar', 49.0, 'local', 'por local (desde)', 'Fichaje con geolocalización', '—', 'Oficial', 'https://www.skello.es/planes'),
  (670, 'Personal', 'Skello', 'Duo Estándar', 79.0, 'local', 'por local (desde)', 'Planificación + fichaje', 'Presupuesto real: 295 €/mes con 40 empleados', 'Oficial', 'https://www.skello.es/planes'),
  (680, 'Personal', 'Combo', 'Time', 60.0, 'local', 'por local (desde)', 'Planificación, ratios, nómina', '—', 'Oficial', 'https://combohr.com/fr/pricing'),
  (690, 'Personal', 'Combo', 'People', 80.0, 'local', 'por local (desde)', '+ vacaciones, firma, preparación nómina', '—', 'Oficial', 'https://combohr.com/fr/pricing'),
  (700, 'Personal', 'Factorial', 'Base + módulos', 5.5, 'empleado', 'por empleado (desde)', 'RRHH general; turnos y fichaje como módulos', 'Cuota base según plan', 'Oficial', 'https://factorial.es/plan-de-precios'),
  (710, 'Personal', 'Sesame HR', 'Time Advanced', 4.75, 'empleado', 'por empleado', 'Fichaje, control horario, turnos', 'Importe mínimo no publicado', 'Comparador', 'https://www.capterra.com/p/143413/SesameHR/pricing/'),
  (720, 'Personal', 'Sesame HR', 'HR Starter', 5.5, 'empleado', 'por empleado', '+ vacaciones, documentos', '—', 'Comparador', 'https://www.capterra.com/p/143413/SesameHR/pricing/'),
  (730, 'Personal', 'Shiftbase', 'Basic', 30.0, 'local', '6 empleados incluidos + 4 €/empleado', 'Turnos, fichaje', 'Con 20 empleados ≈ 86 €', 'Oficial (blog)', 'https://www.shiftbase.com/es/blog/software-gestion-turnos-hosteleria'),
  (740, 'Personal', 'Turnozo', 'Pro', 2.99, 'empleado', 'por empleado activo', 'Cuadrantes, fichaje GPS, cierre gestoría', 'Sin permanencia', 'Oficial', 'https://turnozo.com/es/precios'),
  (750, 'Personal', 'aTurnos', 'Estándar', 2.0, 'empleado', 'por empleado (desde)', 'Turnos y fichaje', '—', 'Comparador', 'https://turnozo.com/es/blog/alternativas-a-skello.md'),
  (760, 'Personal', 'Kenjo', 'Starter', 5.4, 'empleado', 'por empleado, anual', 'RRHH y fichaje', '—', 'Comparador', 'https://www.shiftbase.com/es/blog/software-gestion-turnos-hosteleria'),
  (770, 'Personal', 'FichMe', 'Pro', 29.0, 'local', 'hasta 30 empleados', 'Solo fichaje', '—', 'Oficial', 'https://fichme.com/noticias/software-fichaje-hosteleria-restaurantes-2026'),
  (780, 'Personal', 'Haddock', 'FINA + HR', 198.0, 'local', 'por cuenta, empleados ilimitados', 'Fichaje, turnos, ausencias + facturas', 'Agrupa compras y personal', 'Oficial', 'https://haddock.app/precios'),
  (790, 'Contabilidad', 'Holded', 'Básico', 29.0, 'local', 'por empresa (2 usuarios)', '1.000 facturas/año, Verifactu', 'Usuario extra 10 €; TPV Holded desde 25 €/tienda', 'Oficial', 'https://www.holded.com/es/precios'),
  (800, 'Contabilidad', 'Holded', 'Estándar', 59.0, 'local', 'por empresa (4 usuarios)', '3.000 facturas/año, contabilidad, CRM', 'Usuario extra 10 €', 'Oficial', 'https://www.holded.com/es/precios'),
  (810, 'Contabilidad', 'Holded', 'Avanzado', 99.0, 'local', 'por empresa (7 usuarios)', '10.000 facturas/año', 'Usuario extra 10 €', 'Oficial', 'https://www.holded.com/es/precios'),
  (820, 'Contabilidad', 'Holded', 'Premium', 199.0, 'local', 'por empresa', 'Facturas ilimitadas', 'Usuario extra 10 €', 'Oficial', 'https://www.holded.com/es/precios'),
  (830, 'Contabilidad', 'Wolters Kluwer (A3)', 'a3innuva ERP (desde)', 26.0, 'local', 'por empresa', 'Contabilidad y fiscal, acceso asesor', 'Módulos aparte; a3ERP solo vía distribuidor', 'Comparador', 'https://www.cronomia.com/software/a3innuva-erp'),
  (840, 'Contabilidad', 'Sage', 'Sage 50 Essential', 45.0, 'local', 'por empresa (2 usuarios), anual', 'Contabilidad básica, facturación', '—', 'Oficial', 'https://www.sage.com/es-es/productos/sage-50cloud/precios/'),
  (850, 'Contabilidad', 'Sage', 'Sage 50 Standard', 102.0, 'local', 'por empresa (5 usuarios)', 'Analítica, modelos fiscales', '—', 'Oficial', 'https://www.sage.com/es-es/productos/sage-50cloud/precios/'),
  (860, 'Contabilidad', 'Sage', 'Sage 50 Premium', 154.0, 'local', 'por empresa', 'Presupuestaria, soporte prioritario', '—', 'Oficial', 'https://www.sage.com/es-es/productos/sage-50cloud/precios/'),
  (870, 'Contabilidad', 'Quipu', 'Solution', 30.0, 'local', 'por empresa', 'Conciliación bancaria, Verifactu', '—', 'Comparador', 'https://guiafiscal.es/comparativas/quipu-vs-billin/'),
  (880, 'Contabilidad', 'Anfix', 'Empresarial', 69.99, 'local', 'por empresa (9 usuarios)', '6.000 facturas/año, modelos 200/202', '58,33 € con pago anual', 'Comparador', 'https://copilotgestoria.com/blog/anfix-precios-opiniones-2026-gestorias-alternativas'),
  (890, 'Contabilidad', 'Odoo', 'Estándar', 18.6, 'usuario', 'por usuario', 'Todas las apps en la nube', 'Implantación 3.000–25.000 €', 'Comparador', 'https://www.guiadesoftware.com/blog/cuanto-cuesta-odoo'),
  (900, 'CRM', 'CoverManager', 'CRM en CoverOnTheGo', 39.0, 'local', 'por local', 'CRM, encuestas, valoraciones', 'Fidelización: consultar', 'Oficial', 'https://www.covermanager.com/wp-content/uploads/sites/2/2025/06/CoverManager_Pricing_2025.pdf'),
  (910, 'CRM', 'Cheerfy', 'Shop + Loyalty Starter', 29.0, 'comision', '2,1–2,5 % ventas online (mín. 29, máx. 299 €)', 'Pedidos online, fidelización, cupones', 'Alta 99 €; SMS 8,90 €/100', 'Oficial', 'https://en.cheerfy.com/pricing/shop'),
  (920, 'CRM', 'Klaviyo', 'Email (1.000 perfiles)', 26.0, 'local', 'por contactos, USD', 'Automatizaciones, segmentos', '~130 € con 10.000 perfiles; SMS aparte', 'Comparador', 'https://spoks.com/resources/klaviyo-pricing-breakdown'),
  (930, 'CRM', 'Mailchimp', 'Standard', 17.0, 'local', 'desde 500 contactos, USD', 'Email y automatizaciones', 'Sube con contactos', 'Oficial', 'https://mailchimp.com/es/pricing/marketing/'),
  (940, 'CRM', 'SevenRooms', 'Base', 610.0, 'local', 'por local, USD', 'Reservas + CRM + marketing', 'Dato publicado por un competidor', 'Comparador', 'https://restaurant.eatapp.co/blog/compare/sevenrooms-vs-eat-app-the-complete-guest-management-platform-comparison-2026'),
  (950, 'CRM', 'SumUp', 'Fidelidad', 0.0, 'local', 'incluido en SumUp TPV', 'Sellos y puntos ligados a la tarjeta', 'Requiere TPV/datáfono SumUp', 'Oficial', 'https://www.sumup.com/es-es/press/sumup_lanza_en_espana_el_programa_de_fidelizacion/'),
  (960, 'Pago QR', 'Honei', 'Pedir y pagar', null, 'comision', 'propuesta a medida', 'QR, cobro, integración TPV', 'Comisión estimada 1–2 %', 'Estimación', 'https://honei.app/servicios/pedir-y-pagar'),
  (970, 'Pago QR', 'Sunday', 'Pay at table', null, 'comision', '~43–260 €/mes + %', 'Pago QR, propinas, reseñas', 'A veces cobra fee al comensal', 'Comparador', 'https://www.mydigimenu.com/post/sundayapp-com-alternatives-6'),
  (980, 'Pago QR', 'Last.app', 'QR', 0.0, 'comision', '1,5 % por transacción', 'Incluido en planes TPV', '—', 'Oficial', 'https://www.last.app/en/pricing'),
  (990, 'Pago QR', 'DISH Pay (Metro)', 'Pasarela QR', 0.0, 'comision', '1,89 % + 0,05 €', 'Cobro QR y prepago reservas', 'Datáfono 0,59–0,89 %', 'Oficial', 'https://cdn-craftcms.dish.co/DISH-Pay_Price-List_ES-008_ES_20260501.pdf'),
  (1000, 'Web', 'Wix', 'Core', 25.0, 'local', 'por web, anual', 'Web con pagos y reservas', 'Wix Payments 1,9 % + 0,30 €', 'Comparador', 'https://www.joinsecret.com/es/wix/pricing'),
  (1010, 'Web', 'Squarespace', 'Core', 25.0, 'local', 'por web, USD anual', 'Web y tienda', 'Comisión tarjeta 2,5–2,9 %', 'Oficial', 'https://www.squarespace.com/pricing'),
  (1020, 'Web', 'DISH (Metro)', 'Starter', 0.0, 'local', 'por local', 'Web plantilla, carta, widget reservas', 'Solo alta única', 'Oficial', 'https://www.dish.co/HU/en/dish-starter/'),
  (1030, 'Web', 'DISH (Metro)', 'Premium', 79.0, 'local', 'por local (36 meses)', 'Web + reservas + pedidos', 'Alta 279 €', 'Oficial', 'https://www.dish.co/DE/en/dish-premium/'),
  (1040, 'Web', 'Owner.com', 'Flex', 217.0, 'local', 'por local, USD', 'Web IA, pedidos, app, fidelización', '5 % por pedido; poca presencia en España', 'Comparador', 'https://www.getsauce.com/post/owner-com-pricing-fees')
) as v(orden, categoria, proveedor, plan, precio, base, unidad, incluye, extras, fiabilidad, fuente)
where not exists (select 1 from public.dist_competencia c where c.cuenta_id = '082c5366-d9ae-49b9-a8b8-8caad73985bd');
