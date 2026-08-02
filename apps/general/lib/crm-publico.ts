import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@hostelero/db";
import { CUENTA_PUBLICA } from "./publico";

type SB = SupabaseClient<Database>;

/**
 * Alta de consentimiento desde los fronts públicos (T2 del traspaso CRM).
 * Solo se llama cuando la persona ha MARCADO la casilla: sin casilla, el maestro
 * no se toca. Busca-o-crea el cliente por email/teléfono normalizado e inserta el
 * evento `otorgado`. Corre con service key: cuenta_id va explícito siempre.
 * Nunca lanza: un fallo aquí no debe romper la reserva ya creada.
 */
export async function registrarConsentimientoPublico(
  sb: SB,
  input: {
    nombre: string | null;
    email: string | null;
    telefono: string | null;
    front: "front_visitas" | "front_reservas";
  },
) {
  try {
    const email = input.email?.trim() || null;
    const telefono = input.telefono?.trim() || null;
    if (!email && !telefono) return;

    const [{ data: emailNorm }, { data: telNorm }] = await Promise.all([
      email ? sb.rpc("norm_email", { t: email }) : Promise.resolve({ data: null }),
      telefono ? sb.rpc("norm_telefono", { t: telefono }) : Promise.resolve({ data: null }),
    ]);

    // Buscar por email normalizado primero; si no, por teléfono.
    let clienteId: string | null = null;
    if (emailNorm) {
      const { data } = await sb.from("clientes").select("id").eq("cuenta_id", CUENTA_PUBLICA).eq("email_norm", emailNorm).limit(1).maybeSingle();
      clienteId = data?.id ?? null;
    }
    if (!clienteId && telNorm) {
      const { data } = await sb.from("clientes").select("id").eq("cuenta_id", CUENTA_PUBLICA).eq("telefono_norm", telNorm).limit(1).maybeSingle();
      clienteId = data?.id ?? null;
    }
    if (!clienteId) {
      const origenAlta = input.front === "front_visitas" ? "visitas" : "reservas_restaurante";
      const { data, error } = await sb
        .from("clientes")
        .insert({ cuenta_id: CUENTA_PUBLICA, nombre: input.nombre, email, telefono, origen_alta: origenAlta })
        .select("id")
        .single();
      if (error || !data) return;
      clienteId = data.id;
      await sb.from("clientes_origenes").insert({ cuenta_id: CUENTA_PUBLICA, cliente_id: clienteId, origen: origenAlta });
    }

    // El evento: email si hay email (el canal vivo); el registro es inmutable.
    if (email) {
      await sb.from("consentimientos").insert({
        cuenta_id: CUENTA_PUBLICA,
        cliente_id: clienteId,
        finalidad: "marketing_email",
        estado: "otorgado",
        origen: input.front,
        evidencia: { detalle: "Casilla marcada al reservar", email },
      });
    }
  } catch {
    // Silencioso a propósito: la reserva del cliente ya está hecha.
  }
}

/* ---------- Baja pública (token HMAC firmado con la service key) ---------- */

function secreto() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export function firmarEmailBaja(email: string) {
  return createHmac("sha256", secreto()).update(email.trim().toLowerCase()).digest("hex");
}

export function verificarTokenBaja(email: string, token: string) {
  const esperado = firmarEmailBaja(email);
  const a = Buffer.from(esperado);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ejecuta la baja: supresión (baja_usuario) + evento retirado. */
export async function ejecutarBajaEmail(sb: SB, email: string) {
  const { data: emailNorm } = await sb.rpc("norm_email", { t: email });
  if (!emailNorm) return { ok: false as const };
  const { data: cli } = await sb.from("clientes").select("id").eq("cuenta_id", CUENTA_PUBLICA).eq("email_norm", emailNorm).limit(1).maybeSingle();
  const { error } = await sb.from("supresiones").upsert(
    [{ cuenta_id: CUENTA_PUBLICA, canal: "email", valor_norm: emailNorm, motivo: "baja_usuario", detalle: "Página pública de baja", cliente_id: cli?.id ?? null }],
    { onConflict: "cuenta_id,canal,valor_norm", ignoreDuplicates: true },
  );
  if (error) return { ok: false as const };
  if (cli?.id) {
    await sb.from("consentimientos").insert({
      cuenta_id: CUENTA_PUBLICA,
      cliente_id: cli.id,
      finalidad: "marketing_email",
      estado: "retirado",
      origen: "pagina_baja",
      evidencia: { detalle: "Baja desde la página pública" },
    });
  }
  return { ok: true as const };
}
