# Hostelero

Monorepo del producto Hostelero. Una base de datos común en Supabase (proyecto
`hostelero`), aplicaciones por audiencia, paquetes compartidos.

## Estructura

    apps/
      consola/     Consola interna de Hostelero (solo operadores)
      general/     App del cliente (llegará después)
    packages/
      db/          Tipos TypeScript generados del esquema de Supabase
      ui/          Identidad y tokens de diseño compartidos

## Consola

Next.js 15 (App Router) + Supabase (auth con cookies vía @supabase/ssr).
Todo el renderizado es de servidor; las escrituras van por server actions y
pasan por las políticas RLS del rol autenticado (solo operadores).

### Variables de entorno (Vercel > Settings > Environment Variables)

    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY

### Despliegue en Vercel

1. Add New Project → importar este repositorio.
2. Root Directory: `apps/consola`.
3. Añadir las dos variables de entorno.
4. Deploy.

### Decisiones que no se negocian sin conversación previa

- Tenencia: cuenta → sociedad → centro. Todo dato de módulo cuelga de ahí.
- RLS activo en toda tabla desde su primera migración.
- La configuración (cuentas, módulos, usuarios) solo la escriben operadores.
- Los módulos contratados son datos (`modulos_contratados`), no código.
- Apagar un módulo quita acceso, nunca borra datos.

## Pendiente conocido

- Alta y edición de usuarios de cuenta desde la consola (hoy: desde Supabase).
- "Entrar como cliente" con registro en `accesos_soporte` (necesita la app general).
- Regenerar tipos al cambiar el esquema: `supabase gen types typescript` (o pedírselo a Claude).
