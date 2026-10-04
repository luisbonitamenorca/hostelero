import { MENSAJE_CLAVE_DEBIL, MENSAJE_CLAVE_LONGITUD } from "@/lib/clave";

/** Errores de «Mi contraseña». Fuera de acciones.ts: un "use server" solo exporta funciones. */
export type ErrorMiClave =
  | "actual"
  | "actual-incorrecta"
  | "clave"
  | "distintas"
  | "clave-debil"
  | "misma"
  | "reautenticar"
  | "limite"
  | "fallo";
export type EstadoMiClave = { ok: true } | { error: ErrorMiClave } | null;

export const ERRORES_MI_CLAVE: Record<ErrorMiClave, string> = {
  actual: "Escribe tu contraseña actual.",
  "actual-incorrecta":
    "La contraseña actual no es correcta. Si no la recuerdas, pide a dirección de tu empresa una contraseña temporal nueva.",
  clave: MENSAJE_CLAVE_LONGITUD,
  distintas: "Las dos contraseñas no coinciden. Escríbela igual en los dos campos.",
  "clave-debil": MENSAJE_CLAVE_DEBIL,
  misma: "Es la misma que ya tenías. Pon una distinta.",
  reautenticar:
    "Por seguridad, sal, vuelve a entrar y cámbiala justo después: al volver, entra otra vez en «Mi contraseña» (arriba en la pantalla de inicio).",
  limite: "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.",
  fallo: "No se pudo cambiar la contraseña. Vuelve a intentarlo.",
};
