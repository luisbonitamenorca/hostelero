-- Libro mayor (pedido de Luis, 26-08-2026): la lista de cuentas con
-- movimiento por prefijo (430 clientes, 400/410 proveedores, o cualquier
-- otro) agregada en la base — 3.166 cuentas y 22.856 apuntes no se pasean
-- hasta Vercel para sumarse allí. SECURITY INVOKER: la RLS del que llama
-- decide qué ve, como en fin_informe_mensual (F5c).
create or replace function fin_mayor_saldos(p_prefijos text[])
returns table(codigo text, nombre text, debe numeric, haber numeric,
              saldo numeric, apuntes int, ultima_fecha date)
language sql stable
set search_path to 'public'
as $$
  select pc.codigo, pc.nombre,
         round(sum(ap.debe), 2), round(sum(ap.haber), 2),
         round(sum(ap.debe - ap.haber), 2),
         count(*)::int, max(a.fecha)
  from fin_plan_cuentas pc
  join fin_apuntes ap on ap.cuenta_plan_id = pc.id
  join fin_asientos a on a.id = ap.asiento_id and a.estado = 'confirmado'
  where exists (select 1 from unnest(p_prefijos) pr where pc.codigo like pr || '%')
  group by pc.codigo, pc.nombre
  order by pc.codigo;
$$;
