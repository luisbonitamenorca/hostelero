// Helpers puros del módulo Visitas, usables desde servidor y cliente.
// Sin dependencias de React ni de Supabase: solo formato y etiquetas.

export const IDIOMAS: Record<string, string> = { es: "Español", en: "Inglés", fr: "Francés" };
export const DIAS: [string, number][] = [
  ["L", 1], ["M", 2], ["X", 3], ["J", 4], ["V", 5], ["S", 6], ["D", 7],
];
export const DOW_FULL = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export const PAGO_LABEL: Record<string, string> = {
  stripe: "Online",
  agora_tpv: "Presencial (Ágora)",
  bono: "Bono",
};

export const euro = (n: number | string | null | undefined) =>
  (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export const fDate = (d: string | null | undefined) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

export const fHora = (h: string | null | undefined) => (h ? h.slice(0, 5) : "");

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const addDaysISO = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const startOfWeek = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  const off = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - off);
  return d.toISOString().slice(0, 10);
};

/** Idioma legible a partir del nombre del producto (el campo idioma no es fiable). */
export const langLabel = (name: string | null | undefined) => {
  const n = (name || "").toLowerCase();
  if (/franc/.test(n)) return "Francés";
  if (/ingl|angl|english/.test(n)) return "Inglés";
  if (/portug/.test(n)) return "Portugués";
  if (/espa|castell/.test(n)) return "Español";
  return "";
};

export const esMaridaje = (nombre: string | null | undefined) =>
  /marida/.test((nombre || "").toLowerCase());

/** Sesión enriquecida con ocupación, tal como la consumen las vistas y diálogos. */
export type SesionVista = {
  id: string;
  producto_id: string;
  nombre: string;
  precio: number;
  fecha: string;
  hora: string;
  aforo: number;
  oc: number;
  libre: number;
  estado: string;
  nota: string | null;
  visible_web: boolean;
  maridaje: boolean;
  idiomaLabel: string;
};

/** Clase de color del chip de sesión según ocupación. */
export function chipEstado(s: { estado: string; oc: number; aforo: number }) {
  if (s.estado === "cancelada") return "s-cancel";
  if (s.oc <= 0) return "s-empty";
  if (s.oc >= s.aforo) return "s-full";
  return "s-part";
}

// --- Tipos compartidos servidor/cliente (fuera de acciones.ts, que es "use server"
//     y solo puede exportar funciones async). ---

export type QuienViene = { codigo: string; nombre: string; personas: number; metodo: string };

export type SesionDia = { id: string; hora: string; nombre: string; idioma: string | null };

export type ResultadoBono = {
  ok: boolean;
  error?: string;
  valido?: boolean;
  motivo?: string;
  concepto?: string;
  importe?: number;
  caduca_at?: string | null;
  unidades?: number;
};
