"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { longitudValida } from "@/lib/clave";
import type { ErrorAlta, EstadoAlta, EstadoNuevaClave } from "./errores";

/**
 * Acciones del módulo Usuarios (autogestión del dueño). Todas exigen el
 * módulo Y el rol dirección: exigirModulo ya valida sesión, contratación,
 * rol y veto; el chequeo extra de rol es porque este módulo es especial —
 * ver a tu gente y vetarle módulos no es cosa de cualquier rol con acceso.
 */
async function exigirDireccion() {
  const ctx = await exigirModulo("usuarios");
  if (ctx.perfil.rol !== "direccion") redirect("/no-autorizado");
  return ctx;
}

const ROLES_VALIDOS = ["direccion", "responsable_area", "administracion", "jefe_sala", "empleado"];

type ClienteServicio = NonNullable<ReturnType<typeof crearClienteServicio>>;

/**
 * ¿Es operador de Hostelero (public.operadores: acceso global a la consola y a
 * TODAS las cuentas)? Una dirección de cuenta no puede tocar su contraseña ni
 * borrarlo: sería tomar o tumbar una cuenta con acceso a todo. Devuelve null
 * si no se ha podido comprobar, y quien llama lo trata como «no se toca»:
 * ante la duda, cerrado.
 */
async function esOperador(servicio: ClienteServicio, usuarioId: string): Promise<boolean | null> {
  const { data, error } = await servicio.from("operadores").select("id").eq("id", usuarioId).maybeSingle();
  if (error) return null;
  return !!data;
}

/**
 * Candado para las acciones que van por redirect (rol, vetos, concesiones):
 * si el perfil es de un operador de Hostelero, o no se puede comprobar, se
 * vuelve a /usuarios con el error y no se toca nada.
 */
async function bloquearSiOperador(perfilId: string, error: string) {
  const servicio = crearClienteServicio();
  if (!servicio) redirect("/usuarios?error=configuracion");
  const operador = await esOperador(servicio, perfilId);
  if (operador === null) redirect("/usuarios?error=operador-fallo");
  if (operador) redirect("/usuarios?error=" + error);
}

/** Códigos de Auth (auth-js) que se traducen a un texto concreto del alta. */
const ERROR_AUTH_ALTA: Record<string, ErrorAlta> = {
  email_exists: "existe",
  user_already_exists: "existe",
  weak_password: "clave-debil",
  email_address_invalid: "datos",
  validation_failed: "datos",
  over_request_rate_limit: "limite",
  over_email_send_rate_limit: "limite",
};

/**
 * Alta de usuario. Todo vuelve como estado, sin redirect: los fallos, para que
 * el formulario de cliente conserve nombre, correo, rol y contraseña; y el
 * éxito, para que el formulario enseñe JUSTO la contraseña que se ha puesto
 * (con un redirect se remontaba y generaba otra, y era fácil pasar la mala).
 * La contraseña nunca se registra en ningún log; de los fallos de Auth solo
 * se registran código, estado y mensaje, para no tener que ir a ciegas.
 */
export async function crearUsuario(_previo: EstadoAlta, formData: FormData): Promise<EstadoAlta> {
  const { cuenta } = await exigirDireccion();

  const nombre = String(formData.get("nombre") ?? "").trim();
  const correo = String(formData.get("correo") ?? "").trim().toLowerCase();
  // Sin espacios al principio ni al final: casi siempre se cuelan al copiar y pegar.
  const clave = String(formData.get("clave") ?? "").trim();
  const rol = String(formData.get("rol") ?? "");

  if (!nombre || !correo || !correo.includes("@")) return { error: "datos" };
  if (!longitudValida(clave)) return { error: "clave" };
  if (!ROLES_VALIDOS.includes(rol)) return { error: "datos" };

  // El alta en Auth y el perfil van con la service key: crear usuarios es
  // una operación de administración que la RLS reserva al operador, y la
  // autorización real ya se ha comprobado arriba (sesión + dirección).
  const servicio = crearClienteServicio();
  if (!servicio) return { error: "configuracion" };

  const { data: creado, error: errorAuth } = await servicio.auth.admin.createUser({
    email: correo,
    password: clave,
    email_confirm: true,
    user_metadata: { nombre },
  });
  if (errorAuth || !creado.user) {
    // Supabase rechaza contraseñas filtradas o demasiado fáciles (weak_password):
    // decirlo claro, que el genérico «vuelve a intentarlo» confunde.
    const traducido =
      (errorAuth?.code && ERROR_AUTH_ALTA[errorAuth.code]) || (errorAuth?.status === 429 ? "limite" : null);
    if (traducido) return { error: traducido };
    console.error("crearUsuario: Auth rechazó el alta", {
      code: errorAuth?.code,
      status: errorAuth?.status,
      message: errorAuth?.message,
    });
    return { error: "auth" };
  }

  const { error: errorPerfil } = await servicio.from("perfiles").insert({
    id: creado.user.id,
    cuenta_id: cuenta.id,
    correo,
    nombre,
    rol,
  });
  if (errorPerfil) {
    // Sin perfil, el usuario no puede entrar a nada: mejor deshacer el alta
    // entera que dejar un usuario huérfano en Auth.
    console.error("crearUsuario: no se pudo crear el perfil", {
      code: errorPerfil.code,
      message: errorPerfil.message,
    });
    await servicio.auth.admin.deleteUser(creado.user.id);
    return { error: "perfil" };
  }

  // Refresca la tabla de abajo en la misma respuesta, sin navegar: el
  // formulario conserva su estado y puede enseñar la contraseña.
  revalidatePath("/usuarios");
  return { ok: true, nombre };
}

/**
 * Contraseña temporal nueva para alguien de la cuenta que no puede entrar,
 * SIN borrarlo (borrar arrastra todo lo vinculado a su usuario: operadores,
 * vetos, concesiones…). La contraseña nunca se registra en ningún log.
 *
 * Quién NO entra aquí: uno mismo («Mi contraseña»), los operadores de
 * Hostelero (acceso global) y quien también gestiona Usuarios (concesión):
 * ponerle contraseña a un igual sería poder entrar como él sin que se note.
 * Cada cambio deja una línea en el log del servidor (quién, a quién, cuenta).
 */
export async function nuevaClaveTemporal(
  _previo: EstadoNuevaClave,
  formData: FormData
): Promise<EstadoNuevaClave> {
  const { perfil, cuenta } = await exigirDireccion();

  const perfilId = String(formData.get("perfil") ?? "");
  // Sin espacios al principio ni al final: casi siempre se cuelan al copiar y pegar.
  const clave = String(formData.get("clave") ?? "").trim();

  if (!perfilId) return { error: "no-encontrado" };
  // La propia se cambia en «Mi contraseña», con la sesión de uno mismo.
  if (perfilId === perfil.id) return { error: "propio-clave" };
  if (!longitudValida(clave)) return { error: "clave" };

  const servicio = crearClienteServicio();
  if (!servicio) return { error: "configuracion" };

  // La service key salta la RLS: la pertenencia a la cuenta se comprueba a
  // mano, como en cambiarRol y borrarUsuario. Sin esto, una dirección podría
  // ponerle contraseña a un usuario de OTRA cuenta acertando su uuid.
  const { data: objetivo } = await servicio
    .from("perfiles")
    .select("id")
    .eq("id", perfilId)
    .eq("cuenta_id", cuenta.id)
    .maybeSingle();
  if (!objetivo) return { error: "no-encontrado" };

  const operador = await esOperador(servicio, perfilId);
  if (operador === null) return { error: "fallo-clave" };
  // Un operador de Hostelero sí puede ponérsela a otro operador o a quien
  // gestiona Usuarios (p. ej. Luis a Joan cuando no puede entrar): ya tiene
  // acceso global, no gana nada que no tuviera. Desde una cuenta, no.
  const yoOperador = await esOperador(servicio, perfil.id);
  if (yoOperador === null) return { error: "fallo-clave" };
  if (operador && !yoOperador) return { error: "operador" };

  // ¿Gestiona Usuarios (concesión)? Ante la duda, cerrado.
  const { data: gestor, error: errorGestor } = await servicio
    .from("modulos_concedidos")
    .select("modulo_id")
    .eq("perfil_id", perfilId)
    .eq("modulo_id", "usuarios")
    .maybeSingle();
  if (errorGestor) return { error: "fallo-clave" };
  if (gestor && !yoOperador) return { error: "gestor" };

  const { error } = await servicio.auth.admin.updateUserById(perfilId, { password: clave });
  if (error) {
    if (error.code === "weak_password") return { error: "clave-debil" };
    if (error.code === "user_not_found") return { error: "no-encontrado" };
    console.error("nuevaClaveTemporal: Auth rechazó el cambio", {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    return { error: "fallo-clave" };
  }

  // Rastro mínimo (en Auth el autor sale como service_role): quién, a quién y
  // en qué cuenta. Nunca la contraseña.
  console.info("nuevaClaveTemporal: contraseña temporal nueva", {
    cuenta: cuenta.id,
    por: perfil.id,
    para: perfilId,
  });
  return { ok: true };
}

export async function cambiarVeto(formData: FormData) {
  const { supabase, perfil, cuenta } = await exigirDireccion();

  const perfilId = String(formData.get("perfil") ?? "");
  const moduloId = String(formData.get("modulo") ?? "");
  const vetar = formData.get("vetar") === "si";

  // Que nadie se cierre su propia puerta de gestión: sin este candado, un
  // clic despistado de la única dirección dejaría la pantalla inalcanzable
  // para todos y el arreglo sería a mano en la base.
  if (vetar && perfilId === perfil.id && moduloId === "usuarios") {
    redirect("/usuarios?error=propio");
  }
  // A un operador de Hostelero no se le quitan módulos desde una cuenta
  // (levantarle un veto sí: eso solo suma). Lo de uno mismo es cosa suya.
  if (vetar && perfilId !== perfil.id) await bloquearSiOperador(perfilId, "operador-permisos");

  // Con el cliente de SESIÓN a propósito: la RLS de modulos_vetados vuelve a
  // comprobar dirección + misma cuenta. Defensa en profundidad, no confianza
  // en que este código sea el único camino.
  if (vetar) {
    await supabase.from("modulos_vetados").insert({
      cuenta_id: cuenta.id,
      perfil_id: perfilId,
      modulo_id: moduloId,
    });
  } else {
    await supabase
      .from("modulos_vetados")
      .delete()
      .eq("perfil_id", perfilId)
      .eq("modulo_id", moduloId);
  }

  revalidatePath("/usuarios");
  redirect("/usuarios");
}

export async function cambiarConcesion(formData: FormData) {
  const { supabase, perfil, cuenta } = await exigirDireccion();

  const perfilId = String(formData.get("perfil") ?? "");
  const moduloId = String(formData.get("modulo") ?? "");
  const conceder = formData.get("conceder") === "si";

  // Usuarios es solo-por-concesión: quitarse la propia dejaría esta pantalla
  // inalcanzable para todos. Mismo candado que el veto.
  if (!conceder && perfilId === perfil.id && moduloId === "usuarios") {
    redirect("/usuarios?error=propio");
  }
  // Igual que el veto: a un operador se le puede conceder, no quitar.
  if (!conceder && perfilId !== perfil.id) await bloquearSiOperador(perfilId, "operador-permisos");

  // Con el cliente de SESIÓN a propósito, como el veto: la RLS de
  // modulos_concedidos vuelve a comprobar dirección + misma cuenta.
  if (conceder) {
    await supabase.from("modulos_concedidos").insert({
      cuenta_id: cuenta.id,
      perfil_id: perfilId,
      modulo_id: moduloId,
    });
  } else {
    await supabase
      .from("modulos_concedidos")
      .delete()
      .eq("perfil_id", perfilId)
      .eq("modulo_id", moduloId);
  }

  revalidatePath("/usuarios");
  redirect("/usuarios");
}

export async function cambiarRol(formData: FormData) {
  const { perfil, cuenta } = await exigirDireccion();

  const perfilId = String(formData.get("perfil") ?? "");
  const rol = String(formData.get("rol") ?? "");
  if (!ROLES_VALIDOS.includes(rol)) redirect("/usuarios?error=datos");

  // Cambiarse el rol a uno mismo queda cerrado: la única dirección podría
  // degradarse sin querer y dejar la cuenta sin nadie que gestione usuarios.
  if (perfilId === perfil.id) redirect("/usuarios?error=propio-rol");

  const servicio = crearClienteServicio();
  if (!servicio) redirect("/usuarios?error=configuracion");

  // La service key salta la RLS, así que la pertenencia a la cuenta se
  // comprueba aquí a mano: sin esto, una dirección podría cambiar el rol a
  // un usuario de OTRA cuenta acertando su uuid.
  const { data: objetivo } = await servicio
    .from("perfiles")
    .select("id, rol")
    .eq("id", perfilId)
    .eq("cuenta_id", cuenta.id)
    .maybeSingle();
  if (!objetivo) redirect("/usuarios?error=datos");

  // Un operador de Hostelero no se degrada desde una cuenta: con la service
  // key, además, el cambio le borraría vetos y concesiones (Usuarios incluida)
  // y la portada lo mandaría a /empleado. Ante la duda, cerrado.
  const operador = await esOperador(servicio, perfilId);
  if (operador === null) redirect("/usuarios?error=operador-fallo");
  if (operador) redirect("/usuarios?error=operador-rol");

  if (objetivo.rol !== rol) {
    await servicio.from("perfiles").update({ rol }).eq("id", perfilId);
    // Un rol nuevo arranca con sus permisos por defecto: vetos y concesiones
    // eran ajustes sobre el rol ANTERIOR y arrastrarlos deja al usuario con
    // una mezcla que no responde a ninguna decisión. Se limpian todos y los
    // extras del rol nuevo se ajustan a mano después (pedido de Luis, 25-08).
    await servicio.from("modulos_vetados").delete().eq("perfil_id", perfilId);
    await servicio.from("modulos_concedidos").delete().eq("perfil_id", perfilId);
  }

  revalidatePath("/usuarios");
  redirect("/usuarios");
}

export async function borrarUsuario(formData: FormData) {
  const { perfil, cuenta } = await exigirDireccion();

  const perfilId = String(formData.get("perfil") ?? "");
  if (perfilId === perfil.id) redirect("/usuarios?error=propio-borrado");

  const servicio = crearClienteServicio();
  if (!servicio) redirect("/usuarios?error=configuracion");

  const { data: objetivo } = await servicio
    .from("perfiles")
    .select("id")
    .eq("id", perfilId)
    .eq("cuenta_id", cuenta.id)
    .maybeSingle();
  if (!objetivo) redirect("/usuarios?error=datos");

  // Un operador de Hostelero tiene acceso a todas las cuentas: no se borra
  // desde una de ellas (ni por error ni a propósito). Si no se puede
  // comprobar, tampoco se borra.
  const operador = await esOperador(servicio, perfilId);
  if (operador === null) redirect("/usuarios?error=borrado-fallo");
  if (operador) redirect("/usuarios?error=operador-borrado");

  // Borrar el usuario de Auth arrastra el perfil (FK on delete cascade) y el
  // perfil arrastra sus vetos: un solo golpe y no quedan huérfanos. Ojo: se
  // pierde TODO lo vinculado a su usuario; si solo no puede entrar, lo
  // correcto es «Nueva contraseña» (nuevaClaveTemporal).
  const { error } = await servicio.auth.admin.deleteUser(perfilId);
  if (error) redirect("/usuarios?error=borrado-fallo");

  revalidatePath("/usuarios");
  redirect("/usuarios?borrado=1");
}
