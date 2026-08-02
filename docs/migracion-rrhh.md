# Traspaso · Módulo RRHH (Planifica) → esqueleto Hostelero

**Fecha:** 02/08/2026 · **Preparado en:** sesión de chat (maestros, módulo y configuración ya migrados y verificados hoy)
**Para:** sesión de Claude Code sobre el repo `hostelero`

---

## 1. Contexto en cinco líneas

Planifica es el módulo de personal: cuadrantes, fichajes con tablet y PIN, ausencias y contratos.
El legado (planifica-bonita: 3 páginas + una Edge Function `fichar`) quedó **congelado el 02/08**;
sus datos son **pruebas reales importadas de Skello** y nadie usa la app → no hay corte de
usuarios (el corte Skello → Hostelero es decisión futura). Lo estratégico ya está hecho en base:
**empleados y departamentos son maestros del núcleo**, los "locales" del legado **son los centros**
(no existe tabla locales), y el módulo `rrhh_*` está completo con su RLS de tres niveles.
Esta sesión: datos por script, las tres superficies y el handler de fichar.

## 2. Datos clave

| Cosa | Valor |
|---|---|
| Supabase hostelero (destino) | `jwsvkjyjwocuksdgiqnv` |
| Supabase legado Planifica (SOLO LECTURA) | `cwhmyarbjyvkfskxreeo` |
| Cuenta Bonita Menorca (`cuenta_id`) | `082c5366-d9ae-49b9-a8b8-8caad73985bd` |
| Módulo en el catálogo | id `rrhh` (Personal, ya contratado por Bonita) |
| Referencia panel gestor | `docs/legado/planifica-index.html` (92KB) |
| Referencia app empleado | `docs/legado/planifica-empleado.html` (22KB) |
| Referencia kiosco tablet | `docs/legado/planifica-kiosco.html` (9KB) |

**Mapa locales (legado) → centros (hostelero)** — imprescindible para el script:

| Local legado | id legado | Centro hostelero | id hostelero |
|---|---|---|---|
| Binifadet Bodega | `bdc739b5-f496-4d22-b073-0d58e04792b6` | Binifadet Bodega | `a2c6e3e1-c8e0-4c0a-a70f-8c612a3a2d77` |
| Binifadet Restaurante | `8520bfba-6404-4fcc-aab5-100c0fb418ec` | Binifadet Restaurante | `2c3b1092-bf98-4a59-bdc4-8df06c067a0a` |
| Binifadet Tienda | `285b8b7b-f8b4-41dc-b6f7-ef3a7c913baa` | Binifadet Tienda | `1c6593a8-f805-43a5-b920-9bb2d4a93f59` |
| Casa Tirant | `439ee458-6959-4fcf-bbc0-cac3fe5fc291` | Casa Tirant | `c974f3b0-ffbf-45f2-90ae-26745bb2f8f1` |
| Oficina | `ecb21326-4109-47ab-9784-9f1783213191` | **Estructura** | `0e5c90bd-62e9-4f6f-877e-bb2228f10325` |
| Producción | `4a22b74f-ca97-4d9e-b423-479885d0795e` | Cocina Produccion | `b62bee30-03d3-4f61-9cc7-1c0f5492873b` |
| Tamarindos Bar | `dd25b6a2-f021-4e18-9575-f7730045fad1` | Tamarindos Bar | `e89c055e-956d-4eba-a1f3-581dd7740a6f` |
| Tamarindos Restaurante | `87f4cd8d-0ed6-4eb7-b9f0-12dbb1d1530f` | Tamarindos Restaurante | `fb9e4af7-e50d-4617-b5e7-2de795faa894` |

## 3. Estado de la base (ya hecho — no repetir)

**Núcleo** (migración `nucleo_personal`): maestro `empleados` (con `centro_principal_id`,
`departamento_id` + `departamento` text transitorio, `area_funcional` primera…quinta, `pin_hash`,
`user_id` único hacia auth, `dni_ultimos` 3 cifras+letra); maestro `departamentos` (10 cargados)
y `centros_departamentos` (18); centros con dirección y coordenadas (6 con geo); `perfiles` admite
rol **`empleado`**; `mi_empleado_id()`; `vincular_mi_empleado()` adaptada (vincula por email al
primer login y **autoprovisiona el perfil** atado a la cuenta — el trigger global del legado NO
se porta).

**Módulo** (migración `modulo_rrhh`): enums `rrhh_*`; **ya cargados**: `rrhh_convenios` (3),
`rrhh_tipos_ausencia` (5), `rrhh_tipos_contrato` (4), `rrhh_centros_config` (8: radio 150 m,
convenio Hostelería Baleares), `rrhh_dispositivos` (9 tablets, **hashes de token intactos** — las
tablets físicas seguirán funcionando); **vacíos, los llena la T1**: `rrhh_periodos_contrato`,
`rrhh_asignaciones`, `rrhh_turnos`, `rrhh_fichajes`, `rrhh_ausencias`, `rrhh_encargados_centro`.
Funciones portadas: `rrhh_plantilla_centro`, `rrhh_descanso_minimo_horas`,
`rrhh_empleado_activo_en`, `rrhh_horas_vigentes`; helpers `rrhh_es_gestor()`,
`rrhh_gestiona_centro(uuid)`. `rrhh_fichajes` es **append-only con hora de servidor** (triggers
activos). RLS de tres niveles: gestor todo · encargado sus centros · empleado lo suyo (turnos solo
publicados). Anon a cero.

**Mapa de renombres para el porte:**

| Legado | Hostelero |
|---|---|
| `locales` | **no existe**: `centros` + `rrhh_centros_config` (radio, pacto, convenio) |
| `local_departamentos` | `centros_departamentos` (núcleo) |
| `empleados` (local_principal_id) | `empleados` (núcleo, **sin prefijo**; `centro_principal_id`) |
| `asignaciones` / `turnos` / `fichajes` (local_id) | `rrhh_asignaciones` / `rrhh_turnos` / `rrhh_fichajes` (`centro_id`) |
| `ausencias` / `tipos_ausencia` / `tipos_contrato` | `rrhh_ausencias` / `rrhh_tipos_ausencia` / `rrhh_tipos_contrato` |
| `convenios` / `periodos_contrato` / `dispositivos` | `rrhh_convenios` / `rrhh_periodos_contrato` / `rrhh_dispositivos` |
| `encargado_locales` (user_id, local_id) | `rrhh_encargados_centro` (user_id, centro_id) |
| `perfiles` + enum `rol_app` | **NO se portan**: perfiles del núcleo (admin→`direccion`, encargado→`jefe_sala` + fila en `rrhh_encargados_centro`) |
| `es_admin()` / `gestiona_local(uuid)` / `app_rol()` | `rrhh_es_gestor()` / `rrhh_gestiona_centro(uuid)` / rol del perfil |
| `plantilla_centro` / `descanso_minimo_horas` / `empleado_activo_en` / `horas_vigentes` | mismas con prefijo `rrhh_` |
| `mi_empleado_id()` / `vincular_mi_empleado()` | mismos nombres (ya en el núcleo, adaptadas) |
| Edge Function `fichar` | route handler `app/api/rrhh/fichar/` (T2) |

## 4. Tareas (en orden; pausa de validación con Luis tras cada una)

### T1 · Script de carga (datos de prueba de Skello)
Copiar del legado, **en este orden**: `empleados` (164) → `periodos_contrato` (165) →
`asignaciones` (160) → `turnos` (8.820) → `fichajes` (5) → `ausencias` (0).

- Script Node en `scripts/` (no se despliega): REST del legado con su service key (Luis la pega
  en `.env.local`) → REST de hostelero con la suya. Paginación de 1000. Ids se conservan.
- Mapeos: `cuenta_id` en todo; `local_id` → `centro_id` con el mapa del §2;
  `empleados.local_principal_id` → `centro_principal_id`; `empleados.departamento` (texto) se
  copia tal cual **y además** se resuelve `departamento_id` casando por nombre contra el maestro.
- **`empleados.user_id` viaja siempre a NULL**: los usuarios de auth del legado son de otro
  proyecto y aquí no existen. La vinculación real la hará cada empleado con
  `vincular_mi_empleado()` en su primer login.
- Los 5 fichajes de prueba: el trigger de hora de servidor les pondrá el ts de la carga — aceptado
  (son pruebas; el registro horario append-only no se toca ni para esto).
- **Aceptación T1**: counts 164 / 165 / 160 / 8.820 / 5 / 0; ningún `user_id` poblado; ningún
  empleado sin `centro_principal_id`; `departamento_id` resuelto donde el nombre case; turnos
  publicados con su `publicado_at`.

### T2 · Handler de fichar → `app/api/rrhh/fichar/`
Porte del Edge Function (el código de referencia está en el §7): acciones `ping`, fichaje con
token de tablet + PIN, y `nuevo_pin` (con sesión de gestor o encargado del centro del empleado).

- La pimienta del PIN pasa a variable de entorno `RRHH_PIN_PEPPER` en Vercel — **con el MISMO
  valor que el legado** (retirado de este documento — el repo es público; el valor vive en `.env.local` y en Vercel): los `pin_hash` cargados en la T1 se calcularon
  con ella; cambiarla invalidaría todos los PINs (rotarla = regenerar PINs, decisión aparte).
- Validaciones idénticas al legado: token_hash del dispositivo, PIN sha256(pepper+pin), empleado
  sin fecha_baja, asignación vigente al centro de la tablet. Todo con service key de servidor.

### T3 · Panel del gestor → `apps/general/app/rrhh/`
Referencia: `planifica-index.html`. Cuadrantes por centro y semana, empleados, contratos,
ausencias, dispositivos, ajustes.

- Hereda sesión y layout del esqueleto; renombres del §3; permisos: donde el legado decía
  `es_admin()` → `rrhh_es_gestor()`; encargado → rol `jefe_sala` + `rrhh_encargados_centro`.
- El selector de local sale de `centros` de la cuenta.
- **Aceptación T3** (con los datos de la T1): el cuadrante pinta una semana con turnos reales;
  crear un turno borrador, publicarlo, verlo aparecer; aprobar una ausencia solicitada de prueba;
  regenerar el PIN de un empleado de prueba (pasa por el handler de la T2).

### T4 · App del empleado → `apps/general/app/empleado/`
Referencia: `planifica-empleado.html`. Sus turnos publicados, sus fichajes, solicitar ausencias.

- Login normal del esqueleto; al entrar llama a `vincular_mi_empleado()` (vincula por email y
  crea el perfil rol `empleado` si es el primer login). La RLS ya limita lo que ve.
- Si es fácil, conservar `manifest.json` e iconos del legado: como PWA instalable en el móvil del
  empleado tiene su gracia.
- **Aceptación T4**: con un usuario de prueba cuyo email case con un empleado cargado: entra,
  se vincula, ve SOLO sus turnos publicados y puede solicitar una ausencia (queda `solicitada`).

### T5 · Kiosco → `apps/general/app/kiosco/`
Referencia: `planifica-kiosco.html`. Página **sin sesión** (excluir del middleware, como
`/reservar`): pide el token de tablet una vez (localStorage) y ficha contra el handler de la T2.

- **Aceptación T5**: con el token de la "TEST tablet" reactivada (o uno nuevo generado desde el
  panel), fichar entrada y salida de un empleado de prueba con su PIN; verificar en base que los
  fichajes aparecen con `metodo='tablet_pin'`, su `dispositivo_id` y hora de servidor.

**Si la sesión se alarga**: cortar tras la T3 y seguir en otra — este documento sobrevive entre
sesiones.

### Cierre del legado (NO en esta sesión)
Con T1–T5 validadas: pausar el proyecto Vercel planifica-bonita y archivar el repo en Private.
El corte real Skello → Hostelero es decisión de negocio aparte, con carga fresca ese día.

## 5. Reglas duras de la sesión

1. El Supabase legado es **solo lectura**; su service key solo para leer en el script de la T1.
2. Service keys y `RRHH_PIN_PEPPER` jamás al repo ni al cliente: `.env.local` y variables de
   Vercel. El pepper conserva el valor del legado (los hashes dependen de él).
3. `rrhh_fichajes` es append-only **también para el script**: solo inserts, nunca update/delete.
4. PII (empleados): sin ficheros intermedios; si los hay, se borran al acabar.
5. No tocar lo estable: Compras, Visitas, Reservas, CRM.
6. Commits pequeños. Decisión no cubierta aquí → preguntar.

## 6. Números de referencia (verificados el 02/08/2026)

| Métrica | Valor |
|---|---|
| Legado a cargar: empleados/periodos/asignaciones/turnos/fichajes/ausencias | 164 / 165 / 160 / 8.820 / 5 / 0 |
| Ya cargado en hostelero: departamentos / centros-deptos / convenios / t.ausencia / t.contrato / config / tablets | 10 / 18 / 3 / 5 / 4 / 8 / 9 |
| Centros con dirección y geo | 6 de 8 |

## 7. Código de referencia del Edge Function `fichar` (v3 del legado)

Portarlo como route handler con los renombres del §3 (`dispositivos`→`rrhh_dispositivos`,
`empleados` del núcleo, `asignaciones`→`rrhh_asignaciones`, `fichajes`→`rrhh_fichajes`,
`perfiles`/`encargado_locales`→`rrhh_es_gestor()`/`rrhh_encargados_centro`, `locales(nombre)`→
`centros(nombre)`) y `PEPPER` desde `process.env.RRHH_PIN_PEPPER`:

```ts
// Acciones: ping (validar tablet) · fichar (token + PIN) · nuevo_pin (gestor/encargado)
// PIN: sha256(PEPPER + pin) — solo se guarda el hash; el PIN se muestra UNA vez.
// Fichaje: valida dispositivo activo por token_hash, empleado por pin_hash y sin baja,
// asignación vigente al centro de la tablet; inserta con metodo 'tablet_pin' y
// dispositivo_id; la hora la pone el servidor (trigger). Devuelve nombre, tipo, hora
// y el último fichaje del día para que la tablet muestre contexto.
```

(El código completo del legado está recuperado en la sesión de chat del 02/08; si hace falta el
literal, pedírselo a Luis para que se lo pida al chat — pero con el resumen y los renombres de
arriba se reconstruye entero y mejor adaptado al monorepo.)
