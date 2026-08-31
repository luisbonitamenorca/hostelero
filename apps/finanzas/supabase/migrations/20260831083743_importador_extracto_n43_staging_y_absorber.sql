-- Importador del extracto CaixaBank «con referencias SEPA y conceptos adicionales».
-- Staging efímero (se trunca en cada carga) + función que enriquece los movimientos
-- existentes (match fecha+importe+saldo) e inserta los nuevos.
-- NOTA: la función de esta versión quedó superada por la v3
-- (20260831084357); aquí queda la tabla y la primera versión.
create table if not exists fin_n43_staging (
  id bigint generated always as identity primary key,
  fecha date not null,
  fecha_valor date,
  importe numeric not null,
  saldo numeric not null,
  concepto text,
  n43_comun text,
  n43_propio text,
  referencia text,
  contraparte text,
  extra text
);
alter table fin_n43_staging enable row level security;  -- sin políticas: solo service_role
revoke all on table fin_n43_staging from anon, authenticated;

create or replace function fin_n43_absorber(p_banco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_enriquecidos int; v_insertados int; v_cuenta uuid; v_sociedad uuid;
begin
  select cuenta_id, sociedad_id into v_cuenta, v_sociedad
  from fin_bancos_cuentas where id = p_banco;
  if v_cuenta is null then raise exception 'cuenta bancaria desconocida'; end if;

  update fin_banco_movimientos m
  set n43_comun = s.n43_comun, n43_propio = s.n43_propio,
      contraparte = s.contraparte, referencia = s.referencia,
      detalle = case when coalesce(s.extra,'') = '' then m.detalle
                     when coalesce(m.detalle,'') = '' then s.extra
                     else m.detalle || ' · ' || s.extra end
  from fin_n43_staging s
  where m.banco_cuenta_id = p_banco
    and m.fecha = s.fecha and m.importe = s.importe and m.saldo = s.saldo
    and m.n43_comun is null;
  get diagnostics v_enriquecidos = row_count;

  insert into fin_banco_movimientos
    (cuenta_id, sociedad_id, banco_cuenta_id, fecha, fecha_valor, concepto, detalle,
     importe, saldo, hash_mov, estado, n43_comun, n43_propio, contraparte, referencia)
  select v_cuenta, v_sociedad, p_banco, s.fecha, s.fecha_valor, s.concepto, s.extra,
         s.importe, s.saldo,
         substr(md5(concat_ws('|','n43', s.fecha, s.importe, s.saldo, s.concepto, s.extra)), 1, 20),
         'pendiente', s.n43_comun, s.n43_propio, s.contraparte, s.referencia
  from fin_n43_staging s
  where s.fecha >= date '2026-01-01'
    and not exists (select 1 from fin_banco_movimientos m
                    where m.banco_cuenta_id = p_banco
                      and m.fecha = s.fecha and m.importe = s.importe and m.saldo = s.saldo)
  on conflict (banco_cuenta_id, hash_mov) do nothing;
  get diagnostics v_insertados = row_count;

  return jsonb_build_object(
    'staging', (select count(*) from fin_n43_staging),
    'enriquecidos', v_enriquecidos,
    'insertados', v_insertados);
end $$;
revoke execute on function fin_n43_absorber(uuid) from public, anon, authenticated;
