"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";

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

export async function crearUsuario(formData: FormData) {
  const { cuenta } = await exigirDireccion();

  const nombre = String(formData.get("nombre") ?? "").trim();
  const correo = String(formData.get("correo") ?? "").trim().toLowerCase();
  const clave = String(formData.get("clave") ?? "");
  const rol = String(formData.get("rol") ?? "");

  if (!nombre || !correo || !correo.includes("@")) redirect("/usuarios?error=datos");
  if (clave.length < 8) redirect("/usuarios?error=clave");
  if (!ROLES_VALIDOS.includes(rol)) redirect("/usuarios?error=datos");

  // El alta en Auth y el perfil van con la service key: crear usuarios es
  // una operación de administración que la RLS reserva al operador, y la
  // autorización real ya se ha comprobado arriba (sesión + dirección).
  const servicio = crearClienteServicio();
  if (!servicio) redirect("/usuarios?error=configuracion");

  const { data: creado, error: errorAuth } = await servicio.auth.admin.createUser({
    email: correo,
    password: clave,
    email_confirm: true,
    user_metadata: { nombre },
  });
  if (errorAuth || !creado.user) {
    redirect(`/usuarios?error=${errorAuth?.code === "email_exists" ? "existe" : "auth"}`);
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
    await servicio.auth.admin.deleteUser(creado.user.id);
    redirect("/usuarios?error=perfil");
  }

  revalidatePath("/usuarios");
  redirect("/usuarios?creado=" + encodeURIComponent(nombre));
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

  if (objetivo.rol !== rol) {
    await servicio.from("perfiles").update({ rol }).eq("id", perfilId);
    // Un rol nuevo arranca con sus permisos por defecto: los vetos eran
    // ajustes sobre el rol ANTERIOR y arrastrarlos deja al usuario con una
    // mezcla que no responde a ninguna decisión. Se limpian todos y los
    // extras del rol nuevo se vetan a mano después (pedido de Luis, 25-08).
    await servicio.from("modulos_vetados").delete().eq("perfil_id", perfilId);
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

  // Borrar el usuario de Auth arrastra el perfil (FK on delete cascade) y el
  // perfil arrastra sus vetos: un solo golpe y no quedan huérfanos.
  const { error } = await servicio.auth.admin.deleteUser(perfilId);
  if (error) redirect("/usuarios?error=auth");

  revalidatePath("/usuarios");
  redirect("/usuarios?borrado=1");
}
