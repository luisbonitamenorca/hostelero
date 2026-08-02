import { createHash, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { crearClienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Porte del Edge Function `fichar` del legado (§7 de docs/migracion-rrhh.md).
 * Acciones:
 *  - ping       {token}                → valida la tablet y devuelve {local}
 *  - (fichar)   {token, pin, tipo}     → registra el fichaje con hora de servidor
 *  - nuevo_pin  {accion, empleado_id}  → sesión de gestor/encargado (RLS decide);
 *                                        genera PIN de 4 dígitos y devuelve {pin} UNA vez
 * PIN: sha256(PEPPER + pin). El pepper conserva el valor del legado (env RRHH_PIN_PEPPER):
 * los pin_hash cargados en la T1 dependen de él.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function pepper() {
  return process.env.RRHH_PIN_PEPPER ?? "";
}

/** Hash del token de tablet, como lo guardó el legado (hashes intactos en rrhh_dispositivos). */
function hashToken(token: string) {
  return sha256(token); // pendiente de confirmar contra el literal del Edge Function del legado
}

const TIPOS = ["entrada", "salida", "pausa_inicio", "pausa_fin"] as const;
type Tipo = (typeof TIPOS)[number];

const TZ = "Europe/Madrid";
const hoyLocalISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Petición no válida" }, { status: 400 });

  if (body.accion === "nuevo_pin") return nuevoPin(String(body.empleado_id || ""));

  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "Servidor sin configurar" }, { status: 503 });

  const token = String(body.token || "").trim();
  if (!token) return NextResponse.json({ error: "Falta el código del dispositivo" }, { status: 400 });

  const { data: disp } = await sb
    .from("rrhh_dispositivos")
    .select("id, cuenta_id, centro_id, nombre, activo, centros(nombre)")
    .eq("token_hash", hashToken(token))
    .eq("activo", true)
    .maybeSingle();
  if (!disp) return NextResponse.json({ error: "Dispositivo no reconocido" }, { status: 401 });

  if (body.accion === "ping") {
    return NextResponse.json({ ok: true, local: disp.centros?.nombre ?? disp.nombre });
  }

  // ---- fichar ----
  const pin = String(body.pin || "");
  const tipo = String(body.tipo || "") as Tipo;
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: "PIN no válido" }, { status: 400 });
  if (!TIPOS.includes(tipo)) return NextResponse.json({ error: "Tipo de fichaje no válido" }, { status: 400 });

  const { data: emp } = await sb
    .from("empleados")
    .select("id, nombre, apellidos, fecha_baja")
    .eq("cuenta_id", disp.cuenta_id)
    .eq("pin_hash", sha256(pepper() + pin))
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "PIN no reconocido" }, { status: 401 });
  if (emp.fecha_baja) return NextResponse.json({ error: "Empleado dado de baja" }, { status: 403 });

  const hoy = hoyLocalISO();
  const { data: asig } = await sb
    .from("rrhh_asignaciones")
    .select("id")
    .eq("empleado_id", emp.id)
    .eq("centro_id", disp.centro_id)
    .lte("fecha_inicio", hoy)
    .or(`fecha_fin.is.null,fecha_fin.gte.${hoy}`)
    .limit(1)
    .maybeSingle();
  if (!asig) return NextResponse.json({ error: "Sin asignación vigente en este centro" }, { status: 403 });

  // Último fichaje del día, para que la tablet muestre contexto.
  const { data: ant } = await sb
    .from("rrhh_fichajes")
    .select("tipo, ts")
    .eq("empleado_id", emp.id)
    .gte("ts", `${hoy}T00:00:00+02:00`)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: fich, error } = await sb
    .from("rrhh_fichajes")
    .insert({
      cuenta_id: disp.cuenta_id,
      empleado_id: emp.id,
      centro_id: disp.centro_id,
      tipo,
      metodo: "tablet_pin",
      dispositivo_id: disp.id,
    })
    .select("tipo, ts")
    .single();
  if (error || !fich) return NextResponse.json({ error: "No se pudo registrar" }, { status: 500 });

  return NextResponse.json({
    ok: true,
    nombre: [emp.nombre, emp.apellidos].filter(Boolean).join(" "),
    tipo: fich.tipo,
    hora: new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(fich.ts)),
    anterior: ant ? { tipo: ant.tipo } : null,
  });
}

/** Nuevo PIN: la escritura va con el cliente AUTENTICADO — la RLS de tres niveles decide. */
async function nuevoPin(empleadoId: string) {
  if (!empleadoId) return NextResponse.json({ error: "Falta el empleado" }, { status: 400 });
  const sb = await crearClienteServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  const pin = String(randomInt(0, 10000)).padStart(4, "0");
  const { data, error } = await sb
    .from("empleados")
    .update({ pin_hash: sha256(pepper() + pin) })
    .eq("id", empleadoId)
    .select("id");
  if (error) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Sin permiso sobre ese empleado" }, { status: 403 });
  return NextResponse.json({ ok: true, pin });
}
