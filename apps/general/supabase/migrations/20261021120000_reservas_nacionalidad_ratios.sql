-- APLICADA 21-10-2026 (registrada como reservas_nacionalidad_ratios) · Nacionalidad de las reservas para Ratios.
--
-- Luis pidió ver en la pestaña Comensales de Ratios la tabla «reservas y comensales por
-- nacionalidad» que antes se sacó a Excel: por centro, con columnas que cuadran al 100 %:
-- Walk-in, un país por columna y Resto países. Regla de Luis (21-10): un país tiene columna
-- propia si en algún centro pasa del 2 % de las reservas; el resto se agrupa en «Resto».
-- Esa regla la aplica Ratios en pantalla, por eso la vista devuelve el país y no la categoría.
--
-- Vista comensales_nacionalidad_desde_reservas (seguridad del que consulta, como
-- comensales_desde_reservas): una fila por día, centro, servicio y país, con el número de
-- reservas y de comensales. Sin datos personales.
--
-- Reglas:
--   * Mismas reservas que la vista de comensales: estados llegada/sentada/postre/cuenta/
--     terminada/pendiente/confirmada/reconfirmada, solo hasta hoy. Así la suma de comensales
--     cuadra con la pestaña Comensales.
--   * Walk-in = origen 'walkin' (los walk-ins de Cover). No tienen ficha ni teléfono, así
--     que no se les asigna país aunque Cover les ponga «ES».
--   * Nacionalidad = prefijo internacional del teléfono del cliente (9 cifras que empiezan por
--     6/7/8/9 = España). Es lo mismo que hace Cover, pero Cover lo adivina mal en bloque
--     (Vaticano = +39 Italia, Islas Vírgenes = +1 EE.UU./Canadá, Afganistán = España): se
--     corrige. Si no hay teléfono se usa el país de la reserva o de la ficha; si tampoco, '??'.
--   * pais: 'WALKIN' para los walk-ins, ISO-2 del país, o '??' si no se pudo deducir.

create or replace view public.comensales_nacionalidad_desde_reservas
with (security_invoker = true) as
with cta as (
  select cuenta_actual() as id
),
rest as (
  select r.id, r.slug, r.cuenta_id,
         case r.slug
           when 'binifadet' then 'BINIFADET'
           when 'tamarindos' then 'TAMARINDOS'
           when 'bar-tamarindos' then 'TAMARINDOS BAR'
           when 'casa-tirant' then 'TIRANT'
           else coalesce(replace(rrhh_codigo_centro_ratios(c.nombre), '_', ' '), upper(r.slug))
         end as centro
  from public.reservas_restaurantes r
  cross join cta
  left join public.centros c on c.id = r.centro_id
  where r.cuenta_id = cta.id
),
turno as (
  select t.id, t.restaurante_id,
         case when lower(t.nombre) like 'cena%' then 'Cena' else 'Comida' end as servicio
  from public.reservas_turnos t
  join rest on rest.id = t.restaurante_id
  where t.activo
),
-- Prefijos telefónicos internacionales → ISO-2 (los que aparecen en nuestras reservas y
-- los habituales; el que no esté cae en «Resto países» en Ratios igualmente).
cc(code, iso) as (values
  ('1','US'),('7','RU'),('20','EG'),('27','ZA'),('30','GR'),('31','NL'),('32','BE'),('33','FR'),('34','ES'),
  ('36','HU'),('39','IT'),('40','RO'),('41','CH'),('43','AT'),('44','GB'),('45','DK'),('46','SE'),('47','NO'),
  ('48','PL'),('49','DE'),('51','PE'),('52','MX'),('53','CU'),('54','AR'),('55','BR'),('56','CL'),('57','CO'),
  ('58','VE'),('60','MY'),('61','AU'),('62','ID'),('63','PH'),('64','NZ'),('65','SG'),('66','TH'),('81','JP'),
  ('82','KR'),('84','VN'),('86','CN'),('90','TR'),('91','IN'),('92','PK'),('98','IR'),
  ('212','MA'),('213','DZ'),('216','TN'),('218','LY'),('221','SN'),('225','CI'),('233','GH'),('234','NG'),
  ('254','KE'),('255','TZ'),('256','UG'),('258','MZ'),('262','RE'),
  ('351','PT'),('352','LU'),('353','IE'),('354','IS'),('355','AL'),('356','MT'),('357','CY'),('358','FI'),
  ('359','BG'),('370','LT'),('371','LV'),('372','EE'),('373','MD'),('374','AM'),('375','BY'),('376','AD'),
  ('377','MC'),('378','SM'),('380','UA'),('381','RS'),('382','ME'),('385','HR'),('386','SI'),('387','BA'),
  ('389','MK'),('420','CZ'),('421','SK'),('423','LI'),
  ('502','GT'),('503','SV'),('504','HN'),('505','NI'),('506','CR'),('507','PA'),('509','HT'),('590','GP'),
  ('591','BO'),('592','GY'),('593','EC'),('594','GF'),('595','PY'),('596','MQ'),('597','SR'),('598','UY'),
  ('852','HK'),('853','MO'),('886','TW'),('960','MV'),('961','LB'),('962','JO'),('963','SY'),('964','IQ'),
  ('965','KW'),('966','SA'),('967','YE'),('968','OM'),('971','AE'),('972','IL'),('973','BH'),('974','QA'),
  ('975','BT'),('976','MN'),('977','NP'),('994','AZ'),('995','GE'),('998','UZ')),
-- Países que Cover adivina mal a partir del prefijo
fix(src, iso) as (values ('VA','IT'), ('VI','US'), ('AF','ES')),
res as (
  select r.restaurante_id, r.fecha, r.pax, r.actualizado_en,
         (r.origen = 'walkin') as walkin,
         coalesce(t.servicio, case when r.hora < time '17:00' then 'Comida' else 'Cena' end) as servicio,
         regexp_replace(coalesce(c.telefono_norm, c.telefono, ''), '\D', '', 'g') as tel,
         coalesce(fr.iso, r.pais) as r_pais,
         coalesce(fc.iso, c.pais) as c_pais
  from public.reservas_reservas r
  join rest on rest.id = r.restaurante_id
  left join turno t on t.id = r.turno_id
  left join public.reservas_clientes c on c.id = r.cliente_id
  left join fix fr on fr.src = r.pais
  left join fix fc on fc.src = c.pais
  where r.estado in ('llegada', 'sentada', 'postre', 'cuenta', 'terminada',
                     'pendiente', 'confirmada', 'reconfirmada')
    and r.fecha <= current_date
),
res2 as (
  select *, case when tel ~ '^0\d{10,}' then substr(tel, 2) else tel end as tel2
  from res
),
clas as (
  select b.*,
    case
      when b.walkin then 'WALKIN'
      when b.tel2 = '' then coalesce(b.r_pais, b.c_pais, '??')
      when length(b.tel2) = 9 and b.tel2 ~ '^[6789]' then 'ES'
      else coalesce(
        (select cc.iso from cc where b.tel2 like cc.code || '%' order by length(cc.code) desc limit 1),
        b.r_pais, b.c_pais, '??')
    end as iso
  from res2 b
)
select abs(hashtext(k.fecha::text || '|' || k.centro || '|' || k.servicio || '|' || k.pais))::bigint as id,
       k.fecha,
       extract(year from k.fecha)::integer  as anio,
       extract(month from k.fecha)::integer as mes,
       extract(week from k.fecha)::integer  as semana,
       k.servicio,
       k.centro,
       k.pais,
       k.reservas,
       k.comensales,
       k.created_at
from (
  select c.fecha, rest.centro, c.servicio,
         c.iso as pais,
         count(*)::integer as reservas,
         coalesce(sum(c.pax), 0)::integer as comensales,
         coalesce(max(c.actualizado_en), now()) as created_at
  from clas c
  join rest on rest.id = c.restaurante_id
  group by 1, 2, 3, 4
) k
order by k.fecha, k.centro, k.servicio, k.pais;

comment on view public.comensales_nacionalidad_desde_reservas is
  'Ratios · pestaña Comensales: reservas y comensales por día, centro, servicio y país (WALKIN, ISO-2 o ??) desde el módulo Reservas. Nacionalidad por prefijo del teléfono.';

grant select on public.comensales_nacionalidad_desde_reservas to authenticated;
revoke all on public.comensales_nacionalidad_desde_reservas from anon;
