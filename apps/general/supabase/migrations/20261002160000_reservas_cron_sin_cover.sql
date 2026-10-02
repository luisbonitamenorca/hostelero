-- Reservas v2 · el cron no toca reservas importadas de CoverManager (02-10-2026).
--
-- Mientras Cover siga siendo el sistema de sala, sus reservas llegan aquí como foto del informe
-- (cover_id no nulo). El cron cada 5 minutos las marcaría «a revisar» / «no_show» o cancelaría
-- las «tarjeta_pendiente» con un estado que en Cover ya ha cambiado, y Ratios
-- (comensales_desde_reservas) contaría menos comensales hasta la siguiente carga. Mismas funciones
-- de 20261001120000 con un filtro más: solo reservas propias (cover_id is null).

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
    and r.cover_id is null
    and r.estado in ('pendiente', 'confirmada', 'reconfirmada')
    and r.llegada_en is null
    and r.fecha between current_date - 1 and current_date
    and reservas_ts(r.fecha, r.hora, rr.zona_horaria) + make_interval(mins => rr.liberar_tras_min) < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.reservas_marcar_a_revisar() from anon, public, authenticated;

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
      and r.cover_id is null
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
    and r.cover_id is null
    and r.estado = 'tarjeta_pendiente'
    and coalesce(r.tarjeta_solicitada_en, r.creado_en) + make_interval(mins => rr.tarjeta_caduca_min) < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.reservas_caducar_tarjeta_pendiente() from anon, public, authenticated;
