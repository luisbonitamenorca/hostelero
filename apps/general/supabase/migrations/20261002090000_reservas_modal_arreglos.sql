-- Reservas v2 · arreglos del modal de reserva (02-10-2026)
--
-- 1) Política reservas_mensajes_acceso: en el WITH CHECK, `cliente_id` sin calificar dentro de
--    `exists (select 1 from reservas_clientes c where c.id = cliente_id …)` se resolvía como
--    c.cliente_id (la columna del cliente maestro), así que cualquier insert/update con cliente_id
--    fallaba por RLS: los mensajes manuales del modal y la anulación de avisos por canal
--    desmarcado. Se recrea calificando todas las columnas de la fila.
-- 2) reservas_usuarios_anotadores(): usuarios de la cuenta con el módulo de reservas, para el
--    selector «Anotado por» del modal (la RLS de perfiles solo deja leerlos a dirección).

-- ─── 1) reservas_mensajes_acceso ─────────────────────────────────────────
drop policy if exists reservas_mensajes_acceso on public.reservas_mensajes;
create policy reservas_mensajes_acceso on public.reservas_mensajes
  for all to authenticated
  using (reservas_mensajes.cuenta_id = (select cuenta_actual()) or (select es_operador()))
  with check (
    (reservas_mensajes.cuenta_id = (select cuenta_actual()) or (select es_operador()))
    and (reservas_mensajes.reserva_id is null or exists (
      select 1 from public.reservas_reservas r
      where r.id = reservas_mensajes.reserva_id and r.cuenta_id = reservas_mensajes.cuenta_id))
    and (reservas_mensajes.cliente_id is null or exists (
      select 1 from public.reservas_clientes c
      where c.id = reservas_mensajes.cliente_id and c.cuenta_id = reservas_mensajes.cuenta_id))
    and (reservas_mensajes.lista_espera_id is null or exists (
      select 1 from public.reservas_lista_espera l
      where l.id = reservas_mensajes.lista_espera_id and l.cuenta_id = reservas_mensajes.cuenta_id))
  );

-- ─── 2) reservas_usuarios_anotadores ─────────────────────────────────────
-- Mismo criterio que exigirModulo (lib/supabase/server.ts): el rol trae el módulo
-- (direccion, responsable_area, jefe_sala) o hay concesión expresa, y no hay veto.
-- Solo id y nombre visible: nada de correos ni roles.
create or replace function public.reservas_usuarios_anotadores()
returns table (id uuid, nombre text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, coalesce(nullif(btrim(p.nombre), ''), split_part(p.correo, '@', 1)) as nombre
  from public.perfiles p
  where p.cuenta_id = cuenta_actual()
    and (
      p.rol in ('direccion', 'responsable_area', 'jefe_sala')
      or exists (select 1 from public.modulos_concedidos mc where mc.perfil_id = p.id and mc.modulo_id = 'reservas')
    )
    and not exists (select 1 from public.modulos_vetados mv where mv.perfil_id = p.id and mv.modulo_id = 'reservas')
  order by 2;
$$;
revoke execute on function public.reservas_usuarios_anotadores() from anon, public;
grant execute on function public.reservas_usuarios_anotadores() to authenticated;
