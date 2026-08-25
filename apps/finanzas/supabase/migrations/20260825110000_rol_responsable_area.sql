-- Rol nuevo «Responsable de área» (pedido de Luis, 25-08-2026): perfil de
-- mando intermedio que ve la operativa de su área sin entrar en finanzas ni
-- en la gestión de usuarios. Qué módulos ve exactamente lo decide
-- ACCESO_POR_ROL en el código (ratios, rrhh, tpv, compras, crm, docs,
-- reservas); aquí solo se amplía la lista de roles que el perfil admite.
alter table perfiles drop constraint perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check
  check (rol = any (array['direccion'::text, 'responsable_area'::text,
    'jefe_sala'::text, 'administracion'::text, 'empleado'::text]));
