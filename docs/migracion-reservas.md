# Traspaso · Módulo Reservas → esqueleto Hostelero

**Fecha:** 02/08/2026 · **Preparado en:** sesión de chat (motor y configuración ya migrados y verificados hoy)
**Para:** sesión de Claude Code sobre el repo `hostelero`

---

## 1. Contexto en cinco líneas

Tercer módulo que entra en el esqueleto (tras Compras-datos y Visitas). El legado
(reservas-bonita: index.html público + panel.html de sala + Supabase propio) **NO está en
producción** — solo lo probaba Luis — y quedó **congelado el 02/08**. Por tanto aquí no hay corte
de usuarios: la sala real sigue en CoverManager, y ese cambio (CoverManager → Hostelero) es una
decisión de negocio de octubre, **fuera de esta sesión**. El motor de mesas, las 12 funciones y la
configuración completa ya viven en la base `hostelero`, verificados. Esta sesión: datos gordos,
panel y front público.

## 2. Datos clave

| Cosa | Valor |
|---|---|
| Supabase hostelero (destino) | `jwsvkjyjwocuksdgiqnv` |
| Supabase legado Reservas (SOLO LECTURA) | `rgetdomhvcbrcimabwja` |
| Cuenta Bonita Menorca (`cuenta_id`) | `082c5366-d9ae-49b9-a8b8-8caad73985bd` |
| Módulo en el catálogo | id `reservas` (ya contratado por Bonita) |
| Referencia panel de sala | `docs/legado/reservas-panel.html` |
| Referencia front público | `docs/legado/reservas-index.html` |

**Restaurantes ya migrados, enlazados a centros (ids conservados del legado):**
Bodegas Binifadet `f876b0d6…` → centro Binifadet Restaurante · Restaurante Tamarindos `15c9c094…`
→ Tamarindos Restaurante · Casa Tirant `da406024…` → Casa Tirant · El Bar de Tamarindos
`9a8065c9…` → Tamarindos Bar.

## 3. Estado de la base `hostelero` (ya hecho — no repetir)

- Migración `modulo_reservas` aplicada: 10 tablas con prefijo, `cuenta_id` en todas (defecto
  `cuenta_actual()`), RLS patrón del núcleo, **anon a cero** (tablas y funciones).
- **Configuración ya copiada y verificada**: 4 restaurantes (con `centro_id`), 8 salas, 112 mesas
  con plano, 8 turnos. Motor probado: Binifadet mañana 2 pax → parrilla completa; Tirant 8 pax →
  cero huecos online (correcto: ninguna mesa online llega a 8).
- Fuera del alcance (decidido, no "olvidado"): los 16 cascarones CRM (se construirán nativos),
  `canales` (config de mensajería, va con el CRM), `personal_autorizado` + `fn_es_staff`
  (los sustituye la sesión del esqueleto), `normalizar_telefono` (código muerto del legado).

**Mapa de renombres para el porte (mecánico, buscar-y-reemplazar):**

| Legado | Hostelero |
|---|---|
| `restaurantes` / `salas` / `mesas` / `turnos` / `cierres` | `reservas_restaurantes` / `reservas_salas` / `reservas_mesas` / `reservas_turnos` / `reservas_cierres` |
| `clientes` / `reservas` / `reserva_mesas` | `reservas_clientes` / `reservas_reservas` / `reservas_reserva_mesas` |
| `lista_espera` / `emails_salientes` | `reservas_lista_espera` / `reservas_emails_salientes` |
| `fn_disponibilidad` | `reservas_disponibilidad` |
| `fn_crear_reserva_online` | `reservas_crear_online` |
| `fn_consultar_reserva` / `fn_cancelar_reserva` | `reservas_consultar` / `reservas_cancelar` |
| `fn_apuntar_lista_espera` | `reservas_apuntar_lista_espera` |
| `fn_mejor_mesa` / `fn_mesas_libres` | `reservas_mejor_mesa` / `reservas_mesas_libres` |

Triggers ACTIVOS en `reservas_reservas`: touch, cola de emails (inserta en
`reservas_emails_salientes` cuando origen='online' o cambia el estado) y sincronía de mesa
principal (auto-inserta en `reservas_reserva_mesas`). **Importan para la T1.**

## 4. Tareas (en orden; pausa de validación con Luis tras cada una)

### T1 · Carga de las tres gordas por script
Copiar del legado a hostelero, **en este orden**: `clientes` (9.793) → `reservas` (14.610) →
`reserva_mesas` (12.075).

- Script Node en `scripts/` (no se despliega): lee del REST del legado **con su service key**
  (Luis la saca del dashboard de Supabase del proyecto reservas-bonita → Settings → API y la pega
  en `.env.local`, que está en .gitignore) y escribe en el REST de hostelero con su service key.
  Paginación de 1000. Ids se conservan; columnas idénticas; se añade `cuenta_id` a todo.
- **Triggers — no desactivar nada, gestionarlos así**: al insertar las reservas, el trigger de
  emails encolará ~9,8k correos fantasma (las de origen online) y el de mesa principal
  auto-insertará su fila en `reservas_reserva_mesas`. Por eso: el paso de `reserva_mesas` va con
  `ON CONFLICT (reserva_id, mesa_id) DO NOTHING` (vía `Prefer: resolution=ignore-duplicates` en
  PostgREST), y al terminar la carga se vacía la cola: `delete from reservas_emails_salientes;`
  (no hay nada legítimo en ella todavía).
- **Aceptación T1**: counts exactos 9.793 / 14.610 / 12.075; estados de reservas
  10.004 terminada / 2.371 cancelada / 1.694 confirmada / 477 no_show / 64 pendiente;
  fechas de 2026-03-27 a 2026-10-25; cola de emails a cero; ningún cliente sin `cuenta_id`.

### T2 · Panel de sala → `apps/general/app/reservas/`
Referencia: `docs/legado/reservas-panel.html`. Pestañas: sala (plano), espera, clientes, datos,
ajustes.

- Pierde su login (`signInWithPassword` + `personal_autorizado` desaparecen): hereda layout,
  sesión y cliente del paquete común, como Visitas.
- Renombrado mecánico con el mapa del §3. El refresco por sondeo de 60 s se mantiene tal cual;
  no introducir realtime.
- El selector de restaurante sale de `reservas_restaurantes` de la cuenta (nada en duro).

**Aceptación T2** (con datos reales de la T1, sin ensuciar): el plano pinta las 112 mesas con las
reservas del día; crear una reserva de panel para mañana, cambiarla de mesa (verificar que
`reservas_reserva_mesas` se sincroniza sola), cancelarla; buscar un cliente del histórico en la
pestaña clientes; alta y descarte en lista de espera.

### T3 · Front público → página pública nueva + route handlers
Referencia: `docs/legado/reservas-index.html`. **Ojo: `/reservar` ya es de Visitas** — proponer
nombre (p. ej. `/reservar-mesa`) y añadirlo a las exclusiones del middleware junto con sus
handlers.

- Route handlers de servidor en `app/api/publico/reservas/` (disponibilidad, crear, consultar,
  cancelar, lista-espera) que llaman con la service key a los RPC `reservas_*` del §3. Mismo
  patrón exacto que `api/publico/visitas/`.
- La página no toca Supabase directamente (ni siquiera para leer restaurantes: handler también).

**Aceptación T3**: reserva online de prueba de punta a punta — se crea desde la página pública,
aparece en el panel con su localizador, se consulta y se cancela por localizador+teléfono desde
la página pública. La reserva de prueba queda cancelada.

### T4 · Cierre del legado (NO en esta sesión)
Con T1–T3 validadas: pausar el proyecto Vercel reservas-bonita y archivar el repo (**mantener
PRIVATE siempre**: el historial contiene `import_cover.tsv` con datos de clientes; purga del
historial opcional al archivar). El corte de producción real es CoverManager → Hostelero:
decisión de octubre, con re-importación fresca del histórico ese día si procede.

## 5. Reglas duras de la sesión

1. El Supabase legado es **solo lectura**: su service key se usa únicamente para leer en el
   script de la T1.
2. Service keys jamás al cliente, al repo ni a este documento: solo `.env.local` (en .gitignore)
   y las variables de Vercel.
3. PII: los datos de clientes no se vuelcan a ficheros intermedios; si el script necesita
   temporales, se borran al acabar.
4. No tocar nada de Compras (`compras_*`, aparcado) ni de Visitas (`visitas_*`, en producción de
   pruebas — la reserva de Sabina vive ahí).
5. Commits pequeños. Decisión no cubierta aquí → preguntar, no resolver en silencio.

## 6. Números de referencia (verificados el 02/08/2026)

| Métrica | Valor |
|---|---|
| Legado: clientes / reservas / reserva_mesas | 9.793 / 14.610 / 12.075 |
| Estados: terminada/cancelada/confirmada/no_show/pendiente | 10.004 / 2.371 / 1.694 / 477 / 64 |
| Orígenes: online/panel/walkin | 9.815 / 2.452 / 2.343 |
| Rango de fechas del histórico | 2026-03-27 → 2026-10-25 |
| Hostelero ya cargado: restaurantes/salas/mesas/turnos | 4 / 8 / 112 / 8 |
| Restaurantes con centro enlazado | 4 de 4 |
