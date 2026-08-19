-- APLICADA 19-08-2026 (registrada como 20260819123742).
-- Caja de secretos de la plataforma: credenciales de máquina que el servidor
-- necesita en tiempo de ejecución (p. ej. el usuario puente del proyecto de
-- agentes, para servir /agentes sin su contraseña interna). RLS encendida SIN
-- políticas a propósito: ni anon ni authenticated ven nada — solo la service
-- key del servidor, que además pierde el grant explícitamente por si algún
-- día alguien crea una política de más.
-- Los VALORES nunca van en migraciones (el repo es público): se insertan a
-- mano por el canal de administración.

create table plataforma_secretos (
  clave text primary key,
  valor jsonb not null,
  actualizado_en timestamptz not null default now()
);

alter table plataforma_secretos enable row level security;

revoke all on plataforma_secretos from anon;
revoke all on plataforma_secretos from authenticated;
