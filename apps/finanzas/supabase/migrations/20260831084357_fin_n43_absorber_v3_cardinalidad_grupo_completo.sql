-- v3 (definitiva): fase 1 match exacto fecha+importe+saldo; fase 2 emparejamiento
-- por rango de saldo dentro de cada grupo (fecha, importe) — CaixaNow y el fichero
-- SEPA ordenan distinto el intradía y el saldo puede diferir; inserción solo de la
-- diferencia de cardinalidad por grupo (idempotente: recargar no duplica).
create or replace function fin_n43_absorber(p_banco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_exactos int; v_por_rango int; v_insertados int; v_cuenta uuid; v_sociedad uuid;
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
  get diagnostics v_exactos = row_count;

  with d as (
    select m.id, m.fecha, m.importe,
           row_number() over (partition by m.fecha, m.importe order by m.saldo) as rn
    from fin_banco_movimientos m
    where m.banco_cuenta_id = p_banco and m.n43_comun is null
  ), s2 as (
    select s.id as sid, s.fecha, s.importe,
           row_number() over (partition by s.fecha, s.importe order by s.saldo) as rn
    from fin_n43_staging s
    where not exists (select 1 from fin_banco_movimientos m
                      where m.banco_cuenta_id = p_banco and m.fecha = s.fecha
                        and m.importe = s.importe and m.saldo = s.saldo
                        and m.n43_comun is not null)
  )
  update fin_banco_movimientos m
  set n43_comun = s.n43_comun, n43_propio = s.n43_propio,
      contraparte = s.contraparte, referencia = s.referencia,
      detalle = case when coalesce(s.extra,'') = '' then m.detalle
                     when coalesce(m.detalle,'') = '' then s.extra
                     else m.detalle || ' · ' || s.extra end
  from d join s2 on s2.fecha = d.fecha and s2.importe = d.importe and s2.rn = d.rn
  join fin_n43_staging s on s.id = s2.sid
  where m.id = d.id and m.n43_comun is null;
  get diagnostics v_por_rango = row_count;

  with grupos_db as (
    select fecha, importe, count(*) as dn, array_agg(saldo) as saldos
    from fin_banco_movimientos where banco_cuenta_id = p_banco
    group by fecha, importe
  ), stg as (
    select s.*, count(*) over (partition by s.fecha, s.importe) as sn
    from fin_n43_staging s
    where s.fecha >= date '2026-01-01'
  ), candidatos as (
    select st.*, coalesce(g.dn, 0) as dn,
           row_number() over (partition by st.fecha, st.importe order by st.saldo) as rn
    from stg st
    left join grupos_db g on g.fecha = st.fecha and g.importe = st.importe
    where g.saldos is null or not st.saldo = any(g.saldos)
  )
  insert into fin_banco_movimientos
    (cuenta_id, sociedad_id, banco_cuenta_id, fecha, fecha_valor, concepto, detalle,
     importe, saldo, hash_mov, estado, n43_comun, n43_propio, contraparte, referencia)
  select v_cuenta, v_sociedad, p_banco, c.fecha, c.fecha_valor, c.concepto, c.extra,
         c.importe, c.saldo,
         substr(md5(concat_ws('|','n43', c.fecha, c.importe, c.saldo, c.concepto, c.extra)), 1, 20),
         'pendiente', c.n43_comun, c.n43_propio, c.contraparte, c.referencia
  from candidatos c
  where c.rn <= c.sn - c.dn
  on conflict (banco_cuenta_id, hash_mov) do nothing;
  get diagnostics v_insertados = row_count;

  return jsonb_build_object(
    'staging', (select count(*) from fin_n43_staging),
    'exactos', v_exactos, 'por_rango', v_por_rango, 'insertados', v_insertados);
end $$;
revoke execute on function fin_n43_absorber(uuid) from public, anon, authenticated;
