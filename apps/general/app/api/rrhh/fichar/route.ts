import { createHash, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { crearClienteServidor } from "@/lib/supabase/server";
import { calcularDia, efectivosDe, type Fichaje } from "@/app/rrhh/tipos";

export const dynamic = "force-dynamic";

/**
 * Porte del Edge Function `fichar` del legado (§7 de docs/migracion-rrhh.md), ampliado en la
 * v2 del kiosco (plan RRHH v2, 2.10).
 * Acciones:
 *  - ping       {token}                         → valida la tablet y devuelve {local}
 *  - (fichar)   {token, pin, tipo, ts_dispositivo?} → registra el fichaje con hora de servidor
 *                                                  (el trigger pone `ts`; `ts_dispositivo` es la hora
 *                                                  que tenía la tablet, útil si fichó sin conexión).
 *                                                  Devuelve el resumen del día. Si el mismo empleado
 *                                                  repite el mismo tipo en menos de 60 s, o llega un
 *                                                  reintento con el mismo `ts_dispositivo`, no inserta
 *                                                  y responde {ok:true, duplicado:true}.
 *  - resumen    {token, pin}                    → el resumen del día sin fichar («Ver mis horas»).
 *  - nuevo_pin  {accion, empleado_id}           → sesión de gestor/encargado (RLS decide);
 *                                                  genera PIN de 4 dígitos único en la cuenta y
 *                                                  devuelve {pin} UNA vez
 * PIN: sha256(PEPPER + pin). El pepper conserva el valor del legado (env RRHH_PIN_PEPPER):
 * los pin_hash cargados en la T1 dependen de él.
 *
 * Jornada «de hoy»: incluye la de ayer si quedó abierta (turnos de noche que cruzan medianoche:
 * entrada 20:00, salida 02:00). Se cargan los fichajes de ayer y hoy y se recorta a partir de la
 * última salida de ayer.
 *
 * Resumen del día (`resumen` en la respuesta):
 *  { fichajes: [{tipo, hora}], horas, enCurso, enPausa, turnos: [{inicio, fin}], incidencias }
 *  `horas` son las netas de la jornada; si sigue abierta incluye el tramo en curso.
 *
 * Pendiente (migración aparte, no en este fichero): índice único parcial en empleados
 * `(cuenta_id, pin_hash) where pin_hash is not null`.
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
const DUPLICADO_SEG = 60;
const INTENTOS_PIN = 20;

const fechaLocalISO = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const horaLocal = (ts: string | Date) =>
  new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(
    typeof ts === "string" ? new Date(ts) : ts
  );

/** Instante (UTC) en que empieza el día `iso` en Europe/Madrid: prueba los dos offsets posibles. */
function inicioDiaLocal(iso: string) {
  for (const off of ["+02:00", "+01:00"]) {
    const d = new Date(`${iso}T00:00:00${off}`);
    if (fechaLocalISO(d) === iso && horaLocal(d) === "00:00") return d;
  }
  return new Date(`${iso}T00:00:00+01:00`);
}

const sumaDiaISO = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** `ts_dispositivo` solo se acepta si es una fecha válida y razonable (30 días atrás, 5 min adelante). */
function tsDispositivoValido(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return null;
  const ahora = Date.now();
  if (t > ahora + 5 * 60_000 || t < ahora - 30 * 86_400_000) return null;
  return new Date(t).toISOString();
}

type Sb = NonNullable<ReturnType<typeof crearClienteServicio>>;
type Dispositivo = { id: string; cuenta_id: string; centro_id: string; nombre: string | null };
type Turno = { fecha: string; hora_inicio: string; hora_fin: string; pausa_min: number; centro_id: string };

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

  // ---- empleado por PIN (fichar y resumen) ----
  const pin = String(body.pin || "");
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: "PIN no válido" }, { status: 400 });

  // Se piden 2 filas para distinguir «no existe» de «dos empleados con el mismo PIN» (hasta que
  // exista el índice único, un PIN repetido dejaría a los dos sin poder fichar sin saber por qué).
  const { data: emps } = await sb
    .from("empleados")
    .select("id, nombre, apellidos, fecha_baja")
    .eq("cuenta_id", disp.cuenta_id)
    .eq("pin_hash", sha256(pepper() + pin))
    .limit(2);
  if (!emps?.length) return NextResponse.json({ error: "PIN no reconocido" }, { status: 401 });
  if (emps.length > 1) return NextResponse.json({ error: "PIN duplicado: avisa a RRHH" }, { status: 409 });
  const emp = emps[0];

  const ahora = new Date();
  const hoy = fechaLocalISO(ahora);
  // `fecha_baja` es una fecha, no un flag: una baja programada con preaviso sigue fichando hasta ese día.
  if (emp.fecha_baja && emp.fecha_baja <= hoy) {
    return NextResponse.json({ error: "Empleado dado de baja" }, { status: 403 });
  }

  const nombre = [emp.nombre, emp.apellidos].filter(Boolean).join(" ");

  if (body.accion === "resumen") {
    const j = await cargarJornada(sb, emp.id, hoy);
    return NextResponse.json({ ok: true, nombre, resumen: construirResumen(j.efectivos, j.turnos, disp.centro_id, ahora) });
  }

  // ---- fichar ----
  const tipo = String(body.tipo || "") as Tipo;
  if (!TIPOS.includes(tipo)) return NextResponse.json({ error: "Tipo de fichaje no válido" }, { status: 400 });
  const tsDispositivo = tsDispositivoValido(body.ts_dispositivo);

  const { data: asig } = await sb
    .from("rrhh_asignaciones")
    .select("id")
    .eq("empleado_id", emp.id)
    .eq("centro_id", disp.centro_id)
    .or(`fecha_inicio.is.null,fecha_inicio.lte.${hoy}`)
    .or(`fecha_fin.is.null,fecha_fin.gte.${hoy}`)
    .limit(1)
    .maybeSingle();
  if (!asig) return NextResponse.json({ error: "Sin asignación vigente en este centro" }, { status: 403 });

  // Duplicado, dos criterios:
  //  1. mismo `ts_dispositivo` (identificador natural del reintento de la cola sin conexión:
  //     la primera petición llegó pero la tablet no vio la respuesta), sin ventana de tiempo;
  //  2. mismo tipo hace menos de 60 s (doble toque).
  // No se inserta nada en ninguno de los dos casos.
  const dup = await buscarDuplicado(sb, emp.id, tipo, tsDispositivo, ahora);
  if (dup) {
    const j = await cargarJornada(sb, emp.id, hoy);
    return NextResponse.json({
      ok: true,
      duplicado: true,
      nombre,
      tipo: dup.tipo,
      hora: horaLocal(dup.ts),
      anterior: null,
      resumen: construirResumen(j.efectivos, j.turnos, disp.centro_id, ahora),
    });
  }

  // Jornada antes de este fichaje: el último efectivo sirve para el aviso de «dos entradas seguidas»
  // (incluye la de ayer si quedó abierta, para que el aviso funcione también en turnos de noche).
  const jornada = await cargarJornada(sb, emp.id, hoy);
  const ant = jornada.efectivos[jornada.efectivos.length - 1] ?? null;

  const { data: fich, error } = await sb
    .from("rrhh_fichajes")
    .insert({
      cuenta_id: disp.cuenta_id,
      empleado_id: emp.id,
      centro_id: disp.centro_id,
      tipo,
      metodo: "tablet_pin",
      dispositivo_id: disp.id,
      ts_dispositivo: tsDispositivo,
    })
    .select("*")
    .single();
  if (error || !fich) return NextResponse.json({ error: "No se pudo registrar" }, { status: 500 });

  // El resumen se construye con lo ya cargado más el fichaje nuevo: sin segunda consulta.
  const resumen = construirResumen([...jornada.efectivos, fich as Fichaje], jornada.turnos, disp.centro_id, ahora);

  return NextResponse.json({
    ok: true,
    nombre,
    tipo: fich.tipo,
    hora: horaLocal(fich.ts),
    hora_dispositivo: tsDispositivo ? horaLocal(tsDispositivo) : null,
    anterior: ant ? { tipo: ant.tipo } : null,
    resumen,
  });
}

async function buscarDuplicado(sb: Sb, empleadoId: string, tipo: Tipo, tsDispositivo: string | null, ahora: Date) {
  const base = () => sb.from("rrhh_fichajes").select("tipo, ts").eq("empleado_id", empleadoId).eq("tipo", tipo).is("corrige_a", null);
  if (tsDispositivo) {
    const { data } = await base().eq("ts_dispositivo", tsDispositivo).limit(1).maybeSingle();
    if (data) return data;
  }
  const { data } = await base()
    .gte("ts", new Date(ahora.getTime() - DUPLICADO_SEG * 1000).toISOString())
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Fichajes efectivos de la jornada «de hoy» y turnos publicados de hoy (más los de ayer que
 * cruzan medianoche). Se cargan dos días (consulta acotada) y se recorta: lo posterior a la
 * última salida de ayer. Si ayer no quedó jornada abierta, eso deja solo los de hoy; si quedó
 * abierta (turno de noche), esos fichajes forman parte de la jornada actual.
 */
async function cargarJornada(sb: Sb, empleadoId: string, hoy: string) {
  const ayer = sumaDiaISO(hoy, -1);
  const inicioHoy = inicioDiaLocal(hoy).getTime();
  const desde = inicioDiaLocal(ayer).toISOString();
  const hasta = inicioDiaLocal(sumaDiaISO(hoy, 1)).toISOString();
  const [{ data: fichajes }, { data: turnos }] = await Promise.all([
    sb
      .from("rrhh_fichajes")
      .select("*")
      .eq("empleado_id", empleadoId)
      .gte("ts", desde)
      .lt("ts", hasta)
      .order("ts", { ascending: true }),
    sb
      .from("rrhh_turnos")
      .select("fecha, hora_inicio, hora_fin, pausa_min, centro_id")
      .eq("empleado_id", empleadoId)
      .in("fecha", [ayer, hoy])
      .eq("estado", "publicado")
      .order("fecha", { ascending: true })
      .order("hora_inicio", { ascending: true }),
  ]);

  let { efectivos } = efectivosDe((fichajes ?? []) as Fichaje[]);
  // Última salida de ayer: lo anterior (incluida) es jornada cerrada y se descarta. Si ayer hubo
  // fichajes pero ninguna salida, quedan dentro: jornada abierta que sigue hoy.
  let corte = -1;
  efectivos.forEach((f, i) => {
    if (f.tipo === "salida" && new Date(f.ts).getTime() < inicioHoy) corte = i;
  });
  if (corte >= 0) efectivos = efectivos.slice(corte + 1);

  // Turnos de ayer solo si cruzan medianoche (hora_fin < hora_inicio).
  const lista = ((turnos ?? []) as Turno[]).filter((t) => t.fecha === hoy || t.hora_fin < t.hora_inicio);

  return { efectivos, turnos: lista };
}

/**
 * Resumen de la jornada: fichajes (hora local), horas netas (con el tramo en curso si sigue
 * abierta) y turno(s). Reutiliza `calcularDia` de app/rrhh/tipos.ts para que el kiosco y el
 * panel cuenten las horas igual.
 */
function construirResumen(efectivos: Fichaje[], turnos: Turno[], centroId: Dispositivo["centro_id"], ahora: Date) {
  const base = calcularDia(efectivos, true);
  let horas = base.horas;
  let enPausa = false;
  if (base.enCurso) {
    // Estado de la pausa: el último evento de pausa/entrada decide.
    const ultEvento = [...efectivos].reverse().find((f) => f.tipo !== "salida");
    enPausa = ultEvento?.tipo === "pausa_inicio";
    // Cerramos virtualmente la jornada ahora mismo para contar el tramo en curso.
    const molde = efectivos[efectivos.length - 1];
    const virtuales: Fichaje[] = [];
    if (enPausa) virtuales.push({ ...molde, tipo: "pausa_fin", ts: ahora.toISOString() });
    virtuales.push({ ...molde, tipo: "salida", ts: ahora.toISOString() });
    horas = calcularDia([...efectivos, ...virtuales], false).horas;
  }

  // Turnos: primero los de este centro, luego los de otros (jornada partida = varios).
  const lista = turnos.slice().sort((a, b) => {
    const ca = a.centro_id === centroId ? 0 : 1;
    const cb = b.centro_id === centroId ? 0 : 1;
    return ca - cb || a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio);
  });

  return {
    fichajes: efectivos.map((f) => ({ tipo: f.tipo, hora: horaLocal(f.ts) })),
    horas: Math.round(horas * 100) / 100,
    enCurso: base.enCurso,
    enPausa,
    incidencias: base.inc,
    turnos: lista.map((t) => ({
      inicio: t.hora_inicio.slice(0, 5),
      fin: t.hora_fin.slice(0, 5),
      pausa_min: t.pausa_min,
      este_centro: t.centro_id === centroId,
    })),
  };
}

/**
 * Nuevo PIN: la escritura va con el cliente AUTENTICADO — la RLS de tres niveles decide.
 * El PIN se sortea hasta que no coincida con el de otro empleado de la misma cuenta (con 196
 * empleados y 10.000 combinaciones, repetir es cuestión de tiempo; un PIN repetido deja a los
 * dos sin fichar).
 */
async function nuevoPin(empleadoId: string) {
  if (!empleadoId) return NextResponse.json({ error: "Falta el empleado" }, { status: 400 });
  const sb = await crearClienteServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  const { data: emp } = await sb.from("empleados").select("id, cuenta_id").eq("id", empleadoId).maybeSingle();
  if (!emp) return NextResponse.json({ error: "Sin permiso sobre ese empleado" }, { status: 403 });

  let pin = "";
  let hash = "";
  for (let i = 0; i < INTENTOS_PIN; i++) {
    const candidato = String(randomInt(0, 10000)).padStart(4, "0");
    const h = sha256(pepper() + candidato);
    const { data: otros, error } = await sb
      .from("empleados")
      .select("id")
      .eq("cuenta_id", emp.cuenta_id)
      .eq("pin_hash", h)
      .neq("id", emp.id)
      .limit(1);
    if (error) return NextResponse.json({ error: "No se pudo comprobar el PIN" }, { status: 500 });
    if (!otros?.length) {
      pin = candidato;
      hash = h;
      break;
    }
  }
  if (!pin) return NextResponse.json({ error: "No se encontró un PIN libre, inténtalo otra vez" }, { status: 500 });

  const { data, error } = await sb.from("empleados").update({ pin_hash: hash }).eq("id", emp.id).select("id");
  if (error) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Sin permiso sobre ese empleado" }, { status: 403 });
  return NextResponse.json({ ok: true, pin });
}
