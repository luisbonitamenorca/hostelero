# Traspaso · Módulo Visitas → esqueleto Hostelero

**Fecha:** 02/08/2026 · **Preparado en:** sesión de chat (migración de base ya ejecutada y verificada el 30/07)
**Para:** sesión de Claude Code sobre el repo `hostelero`

---

## 1. Contexto en cinco líneas

Hostelero es el SaaS 360 de hostelería. El esqueleto vive en el monorepo (apps/consola + apps/general,
Next.js 15 App Router + Supabase SSR con RLS) y en el proyecto Supabase `hostelero`. Visitas es el
**segundo módulo cuya capa de datos ya está migrada y cuadrada** (el primero fue Compras, hoy aparcado:
su legado sigue en obras — **no tocar nada de `compras_*` ni de docs/migracion-compras.md**). La app
legada de Visitas (backoffice + front público de reservas) **sigue viva y es la de referencia hasta el
corte**. Esta sesión porta el front; la prioridad de HOY es solo el backoffice (T1).

## 2. Datos clave

| Cosa | Valor |
|---|---|
| Supabase hostelero (destino) | `jwsvkjyjwocuksdgiqnv` |
| Supabase legado Visitas (SOLO LECTURA) | `faocwphdaughhziserqb` |
| Cuenta Bonita Menorca (`cuenta_id`) | `082c5366-d9ae-49b9-a8b8-8caad73985bd` |
| Centro de las sesiones (Binifadet Bodega) | `a2c6e3e1-c8e0-4c0a-a70f-8c612a3a2d77` |
| Módulo en el catálogo | id `visitas` · área Operaciones (ya contratado por Bonita) |
| Referencia funcional backoffice | `docs/legado/visitas-index.html` |
| Referencia funcional front público | `docs/legado/visitas-front-index.html` (NO se porta hoy) |

## 3. Estado de la base `hostelero` (ya hecho — no repetir)

- Migración `modulo_visitas` aplicada. Tablas: `visitas_productos`, `visitas_sesiones`,
  `visitas_reservas`, `visitas_bonos` — esquema 1:1 con el legado más `cuenta_id` en todas
  (defecto `cuenta_actual()`) y `centro_id` en sesiones.
- Tipos enumerados con prefijo: `visitas_tipo_producto`, `visitas_idioma`, `visitas_tipo_bono`,
  `visitas_estado_sesion`, `visitas_metodo_pago` (stripe · agora_tpv · bono),
  `visitas_estado_reserva` (pendiente_pago · pagada · cancelada), `visitas_estado_bono`.
  Para el cliente JS son texto: los valores no cambian, solo el nombre del tipo.
- Funciones portadas (todas con prefijo `visitas_`):
  - `visitas_generar_sesiones(producto, desde, hasta, hora, dias[], aforo, centro_id)` — nuevo
    parámetro final `p_centro_id`; pasarlo desde un selector alimentado por la tabla `centros`
    (por defecto Binifadet Bodega).
  - `visitas_plazas_disponibles(sesion)` · `visitas_validar_bono(codigo)` — lectura, validar NO gasta.
  - `visitas_crear_reserva(...)` — security definer, hereda la cuenta de la sesión, bloqueo
    anti-carrera intacto. `visitas_cancelar_reserva(codigo)` y `visitas_canjear_bono(...)` —
    acotadas a la cuenta del llamante.
- Trigger de caducidad de bonos activo (`trg_visitas_bono_caducidad`).
- RLS en todo con el patrón del núcleo: `cuenta_id = cuenta_actual() OR es_operador()`, rol
  `authenticated`. **Sin políticas anon y con EXECUTE revocado a anon en todas las funciones**:
  el invariante "anon no ve nada" se mantiene; el front público irá por route handlers de
  servidor cuando toque (T2, otra sesión).
- Datos migrados y cuadrados al céntimo (ver §7). Columnas de Ágora (`ticket_agora_id`,
  `agora_registrado_at`) conservadas; la integración estaba sin estrenar en origen (0 tickets).

## 4. Tareas

### T1 · HOY · Backoffice → `apps/general/app/visitas/`
Referencia: `docs/legado/visitas-index.html`. Pestañas del legado: dashboard, calendario,
reservas, bonos, productos.

Reglas del porte:
- Pierde su login, cabecera y cliente propios; hereda layout, sesión y cliente Supabase del
  paquete común (mismo patrón que la portada de apps/general).
- Renombrado mecánico de llamadas: `.from('sesiones')` → `.from('visitas_sesiones')`, etc., y
  `rpc('crear_reserva')` → `rpc('visitas_crear_reserva')` (ídem el resto).
- El generador de sesiones añade selector de centro (tabla `centros` de la cuenta, defecto
  Binifadet Bodega) y pasa `p_centro_id`.
- Nada de hardcodear cuenta ni centro fuera del selector: la cuenta la pone la sesión/RLS.

**Criterio de aceptación (sin ensuciar datos):**
1. Con `luis@bonitamenorca.com`, la portada muestra Visitas y entra.
2. Dashboard y calendario pintan con los datos reales migrados.
3. El listado de reservas muestra las 15 (total 1.078 €) con estados e importes correctos.
4. Crear una reserva de prueba (método `agora_tpv`, nombre "PRUEBA CODE") en una sesión futura
   y **cancelarla** acto seguido desde la propia interfaz.
5. Validar (NO canjear) un bono en estado `vendido`: `visitas_validar_bono` debe responder "Válido".
6. Build limpio y push; indicar la URL de producción para probar.

### T2 · OTRA SESIÓN · Front público de reservas
Página pública (sin login) dentro del monorepo + **route handlers de servidor** con
`SUPABASE_SERVICE_ROLE_KEY` (variable de servidor, aún no configurada — se da de alta cuando
toque esta pieza). Tres operaciones: sesiones disponibles (activa + visible_web + fecha futura,
con plazas), plazas de una sesión, crear reserva. Prohibido exponer la service key o añadir
políticas anon. Hoy NO se empieza.

### T3 · OTRA SESIÓN · Webhook de Stripe
Para que las reservas online pasen a `pagada` solas (en el legado se marca a mano; hay 9
pendientes por eso). Requiere decidir el mecanismo de cobro en Stripe. Hoy NO.

### T4 · Corte (cuando T1–T2 estén validadas; NUNCA con prisas)
Web de Binifadet apunta al front nuevo, equipo usa el backoffice nuevo, delta de datos (a día
de hoy: cero — las dos bases están idénticas), app vieja a archivo.

## 5. Reglas duras de la sesión

1. El proyecto Supabase legado de Visitas es **solo lectura**. La app vieja sigue operativa.
2. La service key jamás al cliente ni al repo (y hoy ni siquiera hace falta).
3. Probar sin ensuciar: reservas de prueba se cancelan; los bonos reales NO se canjean.
4. No tocar nada de Compras (`compras_*`, sus docs, su parte del legado).
5. Commits pequeños con mensajes claros. Decisión no cubierta por este documento → preguntar.

## 6. Mejora ya identificada (no ejecutar hoy, no perder)

Webhook Stripe (T3) + revisión de las 9 reservas `pendiente_pago` del legado (792 €, la mayoría
pruebas de Luis) al hacer el corte: se marcan pagadas, se cancelan o se depuran.

## 7. Números de referencia para el cuadre (verificados el 02/08/2026)

| Métrica | Valor |
|---|---|
| Filas: productos / sesiones / reservas / bonos | 7 / 320 / 15 / 6 |
| Sesiones activas + canceladas · rango | 316 + 4 · 07/06 a 18/10 |
| Reservas: pendiente-stripe / pagada-bono / pagada-Ágora | 9 (792 €) / 4 (232 €) / 2 (54 €) |
| Total reservas | 1.078 € |
| Bonos: canjeados / vendidos · enlaces de canje | 4 / 2 · 4 |
| Delta legado → hostelero a 02/08 | 0 filas (bases idénticas) |
