// Tipos y utilidades del módulo CRM, usables en servidor y cliente.
import type { Tables } from "@hostelero/db";

export type Cliente = Tables<"clientes">;
export type Vigente = Tables<"clientes_consentimiento_vigente">;
export type Origen = Tables<"clientes_origenes">;
export type Supresion = Tables<"supresiones">;
export type Lista = Tables<"crm_listas"> & { n?: number };
export type Campana = Tables<"crm_campanas">;
export type Canal = Tables<"crm_canales">;

export const CANALES = [
  { id: "email", nombre: "Email", necesita: "email" as const, detalle: "Boletines y confirmaciones por correo." },
  { id: "sms", nombre: "SMS", necesita: "telefono" as const, detalle: "Mensajes de texto cortos." },
  { id: "whatsapp", nombre: "WhatsApp", necesita: "telefono" as const, detalle: "Mensajes por WhatsApp con plantillas aprobadas." },
] as const;
export type CanalId = (typeof CANALES)[number]["id"];

export const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString("es-ES");
export const fFecha = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

/** Consentimiento vigente como mapa {email,sms,whatsapp}. */
export type ConsentMap = { email: boolean; sms: boolean; whatsapp: boolean };
export const SIN_CONSENT: ConsentMap = { email: false, sms: false, whatsapp: false };
