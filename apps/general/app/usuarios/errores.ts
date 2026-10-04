import { MENSAJE_CLAVE_DEBIL, MENSAJE_CLAVE_LONGITUD } from "@/lib/clave";

/**
 * Textos de error del módulo Usuarios, en un solo sitio: los usan la página
 * (errores que llegan por ?error= tras un redirect) y los formularios de
 * cliente (alta y nueva contraseña, que reciben el error como estado para no
 * vaciar lo que ya se había escrito). Fuera de acciones.ts porque un fichero
 * "use server" solo puede exportar funciones.
 */

export type ErrorAlta =
  | "datos"
  | "clave"
  | "clave-debil"
  | "existe"
  | "limite"
  | "auth"
  | "perfil"
  | "configuracion";
/** El éxito NO redirige: vuelve como estado para enseñar la contraseña que se acaba de poner. */
export type EstadoAlta = { ok: true; nombre: string } | { error: ErrorAlta } | null;

export type ErrorNuevaClave =
  | "no-encontrado"
  | "clave"
  | "clave-debil"
  | "configuracion"
  | "propio-clave"
  | "operador"
  | "gestor"
  | "fallo-clave";
export type EstadoNuevaClave = { ok: true } | { error: ErrorNuevaClave } | null;

export const ERRORES: Record<string, string> = {
  datos: "Faltan datos o el correo no es válido.",
  clave: MENSAJE_CLAVE_LONGITUD,
  existe:
    "Ya hay un usuario con ese correo. Si está en la lista de abajo y no puede entrar, usa «Nueva contraseña» en su fila; si no aparece, escribe a soporte de Hostelero.",
  limite: "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.",
  "clave-debil": MENSAJE_CLAVE_DEBIL,
  auth: "No se pudo crear el usuario. Vuelve a intentarlo.",
  perfil: "No se pudo crear el perfil; el alta se ha deshecho entera.",
  configuracion: "Falta configuración en el servidor (clave de servicio).",
  "no-encontrado": "Ese usuario no es de tu cuenta o ya no existe. Recarga la página.",
  "propio-clave": "Tu propia contraseña se cambia en «Mi contraseña» (arriba en la portada).",
  operador: "Este usuario es operador de Hostelero: su contraseña solo la cambia él.",
  "operador-borrado": "Este usuario es operador de Hostelero: no se puede borrar desde una cuenta.",
  "operador-rol": "Este usuario es operador de Hostelero: su rol no se cambia desde una cuenta.",
  "operador-permisos":
    "Este usuario es operador de Hostelero: desde una cuenta se le pueden dar módulos, pero no quitárselos.",
  "operador-fallo": "No se pudo comprobar si es operador de Hostelero; no se ha cambiado nada. Vuelve a intentarlo.",
  gestor:
    "También gestiona Usuarios: su contraseña la cambia él en «Mi contraseña». Si no puede entrar, escribe a soporte de Hostelero.",
  "fallo-clave": "No se pudo guardar la contraseña. Vuelve a intentarlo.",
  "borrado-fallo": "No se pudo borrar el usuario. Vuelve a intentarlo.",
  propio: "No puedes vetarte a ti mismo el módulo de Usuarios: te quedarías fuera de esta pantalla.",
  "propio-rol": "Tu propio rol no se cambia desde aquí: la única dirección podría degradarse y dejar la cuenta sin gestión.",
  "propio-borrado": "No puedes borrarte a ti mismo.",
};
