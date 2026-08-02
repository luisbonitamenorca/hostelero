# Traspaso · Módulo CRM → esqueleto Hostelero

**Fecha:** 02/08/2026 · **Preparado en:** sesión de chat (estructura ya construida, extendida y verificada hoy)
**Para:** sesión de Claude Code sobre el repo `hostelero`

---

## 1. Contexto en cinco líneas

El CRM legado es **un solo index.html** montado sobre la base de reservas-bonita (ya congelada);
sus tablas estaban **todas vacías** → aquí no hay datos que migrar, solo pantalla. La estructura
nueva vive ya en la base `hostelero` (migraciones `nucleo_clientes_y_crm` + `crm_extension_legado`):
maestro de clientes en el núcleo, consentimiento RGPD por eventos, y la capa de campañas v1,
extendida con lo bueno del legado (orígenes con id_externo, cumpleaños, atributos, audiencia).
**No hay cuenta de Resend todavía**: se construye todo menos el disparo real. Los datos llegarán
con la "carga limpia 2026" (por origen, solo consentidos) — ese día un borrón se lleva las pruebas.

## 2. Datos clave

| Cosa | Valor |
|---|---|
| Supabase hostelero (destino) | `jwsvkjyjwocuksdgiqnv` |
| Cuenta Bonita Menorca (`cuenta_id`) | `082c5366-d9ae-49b9-a8b8-8caad73985bd` |
| Módulo en el catálogo | id `crm` (ya contratado por Bonita) |
| Referencia funcional | `docs/legado/crm-index.html` |
| Canal email | ya sembrado en `crm_canales`: proveedor resend, estado `sin_conectar` |

## 3. Estado de la base (ya hecho — no repetir)

Núcleo: `clientes` (con `telefono_norm`/`email_norm` **generados por la base**, `cumpleanos`,
`atributos`, `origen_alta`), `clientes_origenes`, `consentimientos` (registro de **eventos**
inmutable), `supresiones` (por valor normalizado), vista `clientes_consentimiento_vigente`
(booleanos calculados, solo lectura) y función `cliente_apto_email(uuid)`.
CRM: `crm_plantillas`, `crm_segmentos`, `crm_campanas` (con preencabezado, cuerpo_html,
cuerpo_texto, audiencia jsonb, lista_id, segmento_id, centro_id, remitente), `crm_listas`,
`crm_lista_clientes`, `crm_envios`, `crm_eventos_envio`, `crm_canales`.
RLS patrón del núcleo en todo; **anon a cero**. Los módulos Reservas y Visitas ya tienen
`cliente_id` hacia el maestro (nulo hasta la carga 2026).

## 4. Mapa conceptual legado → nuevo (para el porte)

| Legado (front) | Hostelero |
|---|---|
| `contactos` | `clientes` (maestro; la normalización de teléfono/email la hace la base) |
| `contactos.consentimiento_email/sms/whatsapp` | LEER: vista `clientes_consentimiento_vigente` · ESCRIBIR: **insert de evento** en `consentimientos` (alta→`otorgado`, baja→`retirado`; canal email→finalidad `marketing_email`, etc.). Nunca update/delete. |
| `contacto_fuentes` (fuente, id_externo, datos) | `clientes_origenes` (origen, id_externo, datos) |
| `listas` / `lista_contactos` | `crm_listas` / `crm_lista_clientes` (contacto_id→cliente_id) |
| `campanas` (asunto, preencabezado, html, cuerpo_texto, audiencia, remitente, programada_en) | `crm_campanas` (mismos campos; `programada_en`→`programada_para`; estados: borrador/programada/enviando/enviada/cancelada) |
| `consentimientos` (canal, accion, detalle) | `consentimientos` (finalidad, estado, `evidencia` jsonb con el detalle) |
| `supresiones.identificador` | `supresiones.valor_norm` (normalizar con `norm_email`/`norm_telefono` al escribir) |
| `canales` | `crm_canales` (email ya sembrado `sin_conectar`) |
| Lecturas de `reservas`/`clientes` del legado | `reservas_reservas` / `reservas_clientes` de la MISMA base, vía `cliente_id` cuando exista; hasta la carga 2026 la ficha puede no tener historial: mostrar vacío con gracia |

## 5. Tareas

### T1 · Pantalla CRM → `apps/general/app/crm/`
Referencia: `docs/legado/crm-index.html`. Secciones del legado: clientes (ex contactos), listas,
campañas, ajustes/canales.

- Hereda login, layout y cliente del esqueleto (fuera `signInWithPassword`).
- Renombrado con el mapa del §4. Consentimientos **siempre como eventos**; los interruptores de
  la ficha leen la vista y escriben eventos.
- Botón de envío de campañas **bloqueado** con aviso "canal sin conectar" (leído de `crm_canales`).
- Altas manuales de cliente: `origen_alta='manual'` + fila en `clientes_origenes`.

**Aceptación T1**: crear cliente "PRUEBA CRM"; otorgarle consentimiento email desde la ficha
(evento visible en `consentimientos`, la vista pasa a true); crear una lista y añadirlo; crear
una campaña en borrador con audiencia y verla listada; comprobar que enviar está bloqueado por
canal sin conectar. El cliente PRUEBA CRM **se queda** — el borrón de la carga 2026 se lo lleva.

### T2 · Consentimiento y baja públicos (si hay energía; si no, siguiente sesión)
- **Casilla de marketing en los dos fronts públicos vivos** (Visitas `/reservar` y el de mesas):
  al marcarla, el route handler (service key) busca-o-crea el cliente en el maestro por
  email/teléfono normalizado (`origen_alta` del front + `clientes_origenes`) e inserta el evento
  de consentimiento con origen `front_visitas`/`front_reservas`. Así el maestro nace orgánicamente
  **solo con consentidos** — la política acordada, hecha código. Sin casilla marcada, no se toca
  el maestro.
- **Página pública de baja**: enlace con el email firmado (token HMAC con secreto de servidor)
  → handler que inserta la supresión (`baja_usuario`) y el evento `retirado`. Añadir la ruta a
  las exclusiones del middleware.

### T3 · NO en esta sesión
Conexión real de Resend (no hay cuenta), envío de campañas y webhooks de eventos. Cuando exista
la cuenta, lo primero será la verificación del dominio (registros DNS) — tiene su plazo.

## 6. Reglas duras de la sesión

1. crm-bonita queda **congelado** desde hoy (como reservas-bonita); su base es solo lectura.
2. Claves de proveedor: jamás en `crm_canales.config`, en el repo ni en el cliente — solo
   variables de entorno de servidor, y hoy ni siquiera hacen falta.
3. `consentimientos` no se edita ni se borra desde la app: solo inserts.
4. No tocar lo estable: Compras (aparcado), Visitas y Reservas (en pruebas de producción).
5. Commits pequeños. Decisión no cubierta aquí → preguntar.

## 7. Verificación

No hay números de cuadre (cero datos que migrar): **la aceptación de la T1 es el cuadre**, y el
ciclo RGPD ya quedó verificado en base hoy (sin consentimiento no apto → con consentimiento apto
→ tras baja no apto, con la baja mandando sobre el consentimiento).
