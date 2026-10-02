"use client";

/* Modal de reserva (nueva / editar), a dos columnas como el de Cover: la reserva a la izquierda,
   el cliente a la derecha y un pie fijo con los avisos al cliente y los botones de guardar.
   Guía: docs/reservas-v2-look.md §5. Acciones de servidor: ../acciones/reserva.ts. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones/reserva";
import type { Adjunto, Etiqueta, Mensaje, StatsCliente, TurnoOcupacion } from "../acciones/reserva";
import { EST, ORIGEN, dowDe, fmtFC, h5, mesasDe, minutos, type Cliente, type Mesa, type Reserva, type Restaurante, type Sala, type Turno } from "../tipos";
import { ESTADOS, TIPOS_RESERVA, colorTexto, estadoDe, fmtFecha } from "../lib-reservas";
import { BuscadorCliente, fmtTel, iniciales } from "./buscador-cliente";
import { BloquePagos } from "./bloque-pagos";
import { cancelarMensaje, reenviar } from "../acciones/mensajes";
import "./modal-reserva.css";

/** Prellenado desde Lista de espera / Clientes (compatibilidad con las secciones actuales). */
export type Prellenar = { cliente?: Cliente | null; pax?: number; notaInterna?: string };

/* ==================== Constantes ==================== */

const IDIOMAS: [string, string][] = [
  ["es", "Español"], ["en", "Inglés"], ["ca", "Català"], ["fr", "Francés"], ["de", "Alemán"], ["it", "Italiano"], ["pt", "Portugués"], ["nl", "Neerlandés"],
];
const PREFIJOS: [string, string][] = [
  ["34", "España"], ["44", "Reino Unido"], ["33", "Francia"], ["39", "Italia"], ["49", "Alemania"], ["31", "Países Bajos"], ["41", "Suiza"], ["32", "Bélgica"],
  ["353", "Irlanda"], ["351", "Portugal"], ["43", "Austria"], ["45", "Dinamarca"], ["46", "Suecia"], ["47", "Noruega"], ["48", "Polonia"],
  ["52", "México"], ["54", "Argentina"], ["1", "EE. UU. / Canadá"],
];
const DURACIONES = Array.from({ length: 23 }, (_, i) => 30 + i * 15); // 0:30 … 6:00
const fmtDur = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fmtKb = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtEur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** 34612345678 → { prefijo: "34", numero: "612345678" }. Nueve dígitos sin prefijo = España. */
function partirTelefono(t: string | null | undefined): { prefijo: string; numero: string } {
  const n = (t || "").replace(/\D/g, "");
  if (!n) return { prefijo: "34", numero: "" };
  if (n.length <= 9) return { prefijo: "34", numero: n };
  const p = [...PREFIJOS].map((x) => x[0]).sort((a, b) => b.length - a.length).find((px) => n.startsWith(px) && n.length - px.length >= 6);
  if (p) return { prefijo: p, numero: n.slice(p.length) };
  return { prefijo: n.slice(0, n.length - 9), numero: n.slice(-9) };
}

/** Fuera de España el 0 inicial (prefijo troncal) no se marca con el prefijo: 07911… → 7911…. */
const sinTroncal = (prefijo: string, numero: string) => (prefijo !== "34" ? numero.replace(/^\s*0/, "") : numero);

/** Lo que hay escrito en el campo teléfono → prefijo + número. Si empieza por «+» o «00» es un
    número internacional completo y manda sobre el selector de prefijo. */
function normalizarTel(prefijo: string, texto: string): { prefijo: string; numero: string } {
  const t = texto.trim();
  if (/^(\+|00)/.test(t)) {
    const dig = t.replace(/^00/, "").replace(/\D/g, "");
    if (!dig) return { prefijo, numero: "" };
    // Con «+» delante, 9 dígitos o menos no son un número español sin prefijo: se busca el prefijo igual.
    const p = [...PREFIJOS].map((x) => x[0]).sort((a, b) => b.length - a.length).find((px) => dig.startsWith(px) && dig.length - px.length >= 6);
    const partes = p ? { prefijo: p, numero: dig.slice(p.length) } : partirTelefono(dig);
    return { prefijo: partes.prefijo, numero: sinTroncal(partes.prefijo, partes.numero) };
  }
  return { prefijo, numero: sinTroncal(prefijo, t) };
}

/** Misma regla que reservas_duracion_pax, calculada en el navegador con la fila del restaurante. */
function duracionLocal(cfg: unknown, pax: number, defecto: number): number {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return defecto;
  for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) {
    const val = Number(v);
    if (!(val > 0)) continue;
    let min: number, max: number;
    if (k.endsWith("+")) { min = Number(k.slice(0, -1)); max = 999; }
    else if (k.includes("-")) { const [a, b] = k.split("-").map(Number); min = a; max = b; }
    else { min = max = Number(k); }
    if (Number.isFinite(min) && Number.isFinite(max) && pax >= min && pax <= max) return val;
  }
  return defecto;
}

type FichaCliente = {
  id: string | null;
  nombre: string;
  apellidos: string;
  idioma: string;
  prefijo: string;
  telefono: string;
  email: string;
  etiquetas: string[];
  alergenos: string[];
  alergias: string;
  notas: string;
  consentimiento: boolean;
  fecha_nacimiento: string;
  empresa: string;
  numero_socio: string;
  vip: boolean;
  lista_negra: boolean;
};

const fichaVacia = (): FichaCliente => ({
  id: null, nombre: "", apellidos: "", idioma: "es", prefijo: "34", telefono: "", email: "", etiquetas: [], alergenos: [],
  alergias: "", notas: "", consentimiento: false, fecha_nacimiento: "", empresa: "", numero_socio: "", vip: false, lista_negra: false,
});

/** Teléfono completo (solo dígitos, con prefijo) de lo que hay en la ficha. */
function telDeFicha(f: FichaCliente | null): string {
  if (!f?.telefono) return "";
  const t = normalizarTel(f.prefijo, f.telefono);
  const n = t.numero.replace(/\D/g, "");
  return n ? `${t.prefijo}${n}` : "";
}

function fichaDe(c: Cliente): FichaCliente {
  const tel = partirTelefono(c.telefono);
  return {
    id: c.id,
    nombre: c.nombre ?? "",
    apellidos: c.apellidos ?? "",
    idioma: c.idioma || "es",
    prefijo: tel.prefijo,
    telefono: tel.numero,
    email: c.email ?? "",
    etiquetas: c.etiquetas ?? [],
    alergenos: c.alergenos ?? [],
    alergias: c.alergias ?? "",
    notas: c.notas ?? "",
    consentimiento: !!c.consentimiento_marketing,
    fecha_nacimiento: c.fecha_nacimiento ?? "",
    empresa: c.empresa ?? "",
    numero_socio: c.numero_socio ?? "",
    vip: !!c.vip,
    lista_negra: !!c.lista_negra,
  };
}

/** Banderas de «Guardar igualmente» que acompañan a un guardado concreto (no viven en el modal). */
type Forzar = { solape?: boolean; cupo?: boolean };

/* ==================== Modal ==================== */

export function ModalReserva(props: {
  rest: Restaurante;
  fecha: string;
  turnos: Turno[];
  salas: Sala[];
  reserva: Reserva | null;
  mesaInicial?: string | null;
  horaInicial?: string | null;
  clienteInicial?: Cliente | null;
  prellenar?: Prellenar;
  cerrar: () => void;
  guardado: (r: { id: string; fecha: string }) => void;
}) {
  const { rest, turnos, salas, reserva: r0, cerrar, guardado } = props;
  const clienteInicial = props.clienteInicial ?? props.prellenar?.cliente ?? null;

  /* ---- reserva */
  const [reservaId, setReservaId] = useState<string | null>(r0?.id ?? null);
  const [localizador, setLocalizador] = useState<string | null>(r0?.localizador ?? null);
  const [fecha, setFecha] = useState(r0?.fecha ?? props.fecha);
  const [hora, setHora] = useState(r0 ? h5(r0.hora) : props.horaInicial ? h5(props.horaInicial) : "");
  const [pax, setPax] = useState<number>(r0?.pax ?? props.prellenar?.pax ?? 2);
  const [duracion, setDuracion] = useState<number>(r0?.duracion_min ?? 0);
  const [duracionManual, setDuracionManual] = useState(!!r0);
  const [zonaId, setZonaId] = useState<string>(r0?.zona_id ?? "");
  const [mesas, setMesas] = useState<string[]>(() => {
    if (r0) return mesasDe(r0);
    return props.mesaInicial ? [props.mesaInicial] : [];
  });
  const [estado, setEstado] = useState(r0?.estado ?? "confirmada");
  const [tipo, setTipo] = useState(r0?.tipo ?? "gratis");
  // El tipo se ha elegido a mano (si no, la regla «tarjeta a partir de N personas» lo ajusta).
  const tipoManual = useRef(!!r0);
  const tipoAuto = useRef(false);
  const [anotadoPor, setAnotadoPor] = useState<string>("");
  const [importe, setImporte] = useState<string>(r0 ? String(r0.importe_prepago ?? r0.importe_garantia ?? "") : "");
  const [importeManual, setImporteManual] = useState(!!(r0?.importe_prepago || r0?.importe_garantia));
  const [experienciaId, setExperienciaId] = useState(r0?.experiencia_id ?? "");
  const [prescriptorId, setPrescriptorId] = useState(r0?.prescriptor_id ?? "");
  const [etiquetasRes, setEtiquetasRes] = useState<string[]>(r0?.etiquetas ?? []);
  const [notasInternas, setNotasInternas] = useState(r0?.notas_internas ?? props.prellenar?.notaInterna ?? "");
  const [notasCliente, setNotasCliente] = useState(r0?.notas_cliente ?? "");
  const [referencia, setReferencia] = useState(r0?.referencia ?? "");
  const [codigoPromo, setCodigoPromo] = useState(r0?.codigo_promo ?? "");
  const [promoInfo, setPromoInfo] = useState<{ valido: boolean; texto: string } | null>(null);
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>(() => (Array.isArray(r0?.adjuntos) ? (r0!.adjuntos as unknown as Adjunto[]) : []));
  const [subiendo, setSubiendo] = useState(false);

  /* ---- cliente */
  const [ficha, setFicha] = useState<FichaCliente | null>(() => {
    const c = r0?.reservas_clientes ?? clienteInicial;
    return c ? fichaDe(c) : null;
  });
  // Email y teléfono tal como están guardados: el redactor manual escribe a estos, no a lo editado.
  const [contactoGuardado, setContactoGuardado] = useState<{ email: string; tel: string }>(() => {
    const c = r0?.reservas_clientes ?? clienteInicial;
    const f = c ? fichaDe(c) : null;
    return { email: f?.email ?? "", tel: telDeFicha(f) };
  });
  const [stats, setStats] = useState<StatsCliente | null>(null);
  const [tabCliente, setTabCliente] = useState<"notas" | "info">("notas");
  const [composer, setComposer] = useState<{ canal: "email" | "sms" | "whatsapp"; asunto: string; cuerpo: string; enviando: boolean; hecho: string | null } | null>(null);

  /* ---- catálogos y ocupación */
  const [cat, setCat] = useState<Awaited<ReturnType<typeof api.catalogosModal>> | null>(null);
  const [ocupacion, setOcupacion] = useState<TurnoOcupacion[]>([]);
  const [ocMesas, setOcMesas] = useState<Awaited<ReturnType<typeof api.ocupacionMesas>>>({ ocupadas: {}, bloqueadas: [], salasBloqueadas: [] });
  const [buscandoMesa, setBuscandoMesa] = useState(false);
  const [mesasAbierto, setMesasAbierto] = useState(false);
  const [nuevoPrescriptor, setNuevoPrescriptor] = useState<string | null>(null);

  /* ---- pie */
  const [notif, setNotif] = useState({ email: rest.envio_email, sms: rest.envio_sms && !rest.envio_whatsapp, whatsapp: rest.envio_whatsapp });
  const [tracking, setTracking] = useState<Mensaje[] | null>(null);
  const [verTracking, setVerTracking] = useState(false);
  const [error, setError] = useState("");
  // `forzar`: banderas con las que se hizo el guardado que dio el aviso; `tarjeta`: el aviso vino
  // de «Solicitar tarjeta» y «Guardar igualmente» tiene que repetir eso, no un guardado normal.
  const [aviso, setAviso] = useState<{ tipo: "solape" | "cupo"; texto: string; notificar: boolean; forzar: Forzar; tarjeta?: boolean } | null>(null);
  // Guardado con advertencia (mesas o avisos que no se pudieron aplicar): el modal se queda
  // abierto para que se lea y se cierra con «Cerrar».
  const [guardadoCon, setGuardadoCon] = useState<{ id: string; fecha: string } | null>(null);
  // Cambios sin guardar: Esc y ✕ preguntan antes de tirarlos.
  const sucio = useRef(false);
  const [preguntarCerrar, setPreguntarCerrar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [enlaceTarjeta, setEnlaceTarjeta] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);
  const mesasRef = useRef<HTMLDivElement>(null);

  const esEdicion = !!reservaId;
  /* Canales que de verdad pueden salir: marcados, activos en el restaurante y con destinatario.
     Con WhatsApp activo el SMS no sale nunca de primeras (solo de respaldo si falla WhatsApp). */
  const canales = useMemo(
    () => ({
      email: notif.email && rest.envio_email && !!ficha?.email,
      sms: notif.sms && rest.envio_sms && !rest.envio_whatsapp && !!ficha?.telefono,
      whatsapp: notif.whatsapp && rest.envio_whatsapp && !!ficha?.telefono,
    }),
    [notif, rest.envio_email, rest.envio_sms, rest.envio_whatsapp, ficha?.email, ficha?.telefono],
  );
  const algunCanal = canales.email || canales.sms || canales.whatsapp;
  const todasMesas: Mesa[] = useMemo(() => salas.flatMap((s) => (s.mesas || []).map((m) => ({ ...m, sala_nombre: s.nombre }))), [salas]);
  const mesaPorId = useCallback((id: string) => todasMesas.find((m) => m.id === id), [todasMesas]);

  const dow = dowDe(fecha);
  const turnosDia = useMemo(() => turnos.filter((t) => t.activo && (t.dias_semana || []).includes(dow)), [turnos, dow]);
  const turnoActual = useMemo(
    () => turnosDia.find((t) => hora && hora >= h5(t.hora_inicio) && hora <= h5(t.hora_fin)) ?? null,
    [turnosDia, hora],
  );

  /* ==================== Cargas ==================== */

  useEffect(() => {
    let vivo = true;
    api.catalogosModal(rest.id, r0?.id ?? null).then((c) => { if (vivo) setCat(c); });
    if (r0?.id) api.trackingMensajes(r0.id).then((m) => { if (vivo) setTracking(m); });
    const cid = r0?.cliente_id ?? clienteInicial?.id;
    if (cid) api.statsCliente(cid).then((s) => { if (vivo) setStats(s); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «Anotado por»: quien anotó la reserva o, si es nueva, el usuario actual
  useEffect(() => {
    if (!cat) return;
    setAnotadoPor((v) => v || (r0 ? cat.anotadoPorId ?? "" : cat.usuario.id));
  }, [cat, r0]);

  // Ocupación por franja cuando cambia el día (reservaId: tras «Solicitar tarjeta» la reserva ya existe)
  useEffect(() => {
    let vivo = true;
    api.ocupacionFranjas(rest.id, fecha, reservaId).then((o) => { if (vivo) setOcupacion(o); });
    return () => { vivo = false; };
  }, [rest.id, fecha, reservaId]);

  // Hora por defecto en una reserva nueva: la primera franja libre a partir de ahora (hoy) o la primera del día
  useEffect(() => {
    if (hora || !ocupacion.length) return;
    const ahora = new Date();
    const hoy = ahora.toLocaleDateString("sv-SE");
    const mAhora = ahora.getHours() * 60 + ahora.getMinutes();
    const franjas = ocupacion.flatMap((t) => t.franjas.map((f) => f.hora));
    const siguiente = fecha === hoy ? franjas.find((h) => minutos(h) >= mAhora) : undefined;
    setHora(siguiente ?? franjas[0] ?? "");
  }, [ocupacion, hora, fecha]);

  // Duración según pax (regla del restaurante) salvo que se haya tocado a mano
  useEffect(() => {
    if (duracionManual) return;
    const defecto = turnoActual?.duracion_min ?? 120;
    setDuracion(duracionLocal(rest.duracion_por_pax, pax, defecto));
  }, [pax, duracionManual, turnoActual, rest.duracion_por_pax]);

  // Ocupación de mesas en la franja (con un pequeño retardo para no disparar en cada tecla)
  useEffect(() => {
    if (!hora || !duracion) return;
    let vivo = true;
    const t = setTimeout(() => {
      api.ocupacionMesas({ restauranteId: rest.id, fecha, hora, duracion, excluirId: reservaId }).then((o) => { if (vivo) setOcMesas(o); });
    }, 150);
    return () => { vivo = false; clearTimeout(t); };
  }, [rest.id, fecha, hora, duracion, reservaId]);

  // Regla del restaurante: garantía con tarjeta a partir de N personas (Ajustes › Políticas).
  // Solo en reservas nuevas y mientras el tipo no se haya elegido a mano; si baja de N, vuelve a gratis.
  const tarjetaDesde = rest.tarjeta_desde_pax;
  useEffect(() => {
    if (tipoManual.current || tarjetaDesde == null) return;
    if (pax >= tarjetaDesde && tipo === "gratis") {
      tipoAuto.current = true;
      setTipo("garantia");
      setImporteManual(false);
    } else if (pax < tarjetaDesde && tipo === "garantia" && tipoAuto.current) {
      tipoAuto.current = false;
      setTipo("gratis");
      setImporteManual(false);
    }
  }, [pax, tipo, tarjetaDesde]);

  // Importe automático según tipo y pax, salvo que se haya escrito a mano
  const experiencia = cat?.experiencias.find((e) => e.id === experienciaId) ?? null;
  useEffect(() => {
    if (importeManual) return;
    let porPax: number | null = null;
    if (tipo === "experiencia") porPax = experiencia?.precio_pax ?? null;
    else if (tipo === "prepago") porPax = rest.prepago_importe_pax ?? null;
    else if (tipo === "garantia" || tipo === "politica_cancelacion") porPax = rest.garantia_importe_pax ?? null;
    setImporte(porPax != null ? String(Math.round(porPax * pax * 100) / 100) : "");
  }, [tipo, pax, importeManual, experiencia, rest.prepago_importe_pax, rest.garantia_importe_pax]);

  // Código promo: se valida al dejar de escribir
  useEffect(() => {
    const c = codigoPromo.trim();
    if (!c) { setPromoInfo(null); return; }
    let vivo = true;
    const t = setTimeout(() => api.validarCodigoPromo(c, rest.id).then((p) => { if (vivo) setPromoInfo(p); }), 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [codigoPromo, rest.id]);

  // Clic fuera del desplegable de mesas
  useEffect(() => {
    if (!mesasAbierto) return;
    const h = (e: MouseEvent) => { if (mesasRef.current && !mesasRef.current.contains(e.target as Node)) setMesasAbierto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [mesasAbierto]);

  /* ==================== Guardar ==================== */

  const datos = useCallback((notificar: boolean, forzar: Forzar): api.DatosReserva | string => {
    if (!ficha) return "Elige un cliente o crea uno nuevo.";
    if (!ficha.nombre.trim()) return "El cliente necesita un nombre.";
    if (!fecha) return "Falta el día.";
    if (!hora) return "Falta la hora.";
    if (!(pax > 0)) return "Las personas tienen que ser al menos 1.";
    const imp = importe.trim() ? Number(importe.replace(",", ".")) : null;
    const tel = normalizarTel(ficha.prefijo, ficha.telefono);
    return {
      id: reservaId,
      restauranteId: rest.id,
      fecha,
      hora,
      pax,
      duracion: duracion || 120,
      turnoId: turnoActual?.id ?? null,
      zonaId: zonaId || null,
      mesas,
      estado,
      tipo,
      importe: imp != null && Number.isFinite(imp) ? imp : null,
      experienciaId: experienciaId || null,
      prescriptorId: prescriptorId || null,
      etiquetas: etiquetasRes,
      notasInternas,
      notasCliente,
      referencia,
      codigoPromo,
      idioma: ficha.idioma,
      cliente: {
        id: ficha.id,
        nombre: ficha.nombre,
        apellidos: ficha.apellidos,
        idioma: ficha.idioma,
        prefijo: tel.prefijo,
        telefono: tel.numero,
        email: ficha.email,
        etiquetas: ficha.etiquetas,
        alergenos: ficha.alergenos,
        alergias: ficha.alergias,
        notas: ficha.notas,
        consentimiento_marketing: ficha.consentimiento,
        fecha_nacimiento: ficha.fecha_nacimiento || null,
        empresa: ficha.empresa,
        numero_socio: ficha.numero_socio,
        vip: ficha.vip,
      },
      notificar,
      canales,
      confirmarSolape: !!forzar.solape,
      confirmarCupo: !!forzar.cupo,
      anotadoPor: anotadoPor || null,
    };
  }, [ficha, fecha, hora, pax, importe, reservaId, rest.id, duracion, turnoActual, zonaId, mesas, estado, tipo, experienciaId, prescriptorId, etiquetasRes, notasInternas, notasCliente, referencia, codigoPromo, canales, anotadoPor]);

  /** Tras guardar: si hubo advertencia, el modal se queda abierto mostrándola; si no, se cierra. */
  const terminar = useCallback((r: { id: string; fecha: string; clienteId: string | null; advertencia?: string }) => {
    sucio.current = false;
    if (r.advertencia) {
      setReservaId(r.id);
      const cid = r.clienteId;
      if (cid) setFicha((f) => (f ? { ...f, id: cid } : f));
      setContactoGuardado({ email: ficha?.email ?? "", tel: telDeFicha(ficha) });
      setGuardadoCon({ id: r.id, fecha: r.fecha });
      setError(r.advertencia);
      return;
    }
    guardado({ id: r.id, fecha: r.fecha });
  }, [guardado, ficha]);

  /** `forzar` solo llega desde «Guardar igualmente»: cada guardado nuevo vuelve a comprobarlo todo. */
  const guardar = useCallback(async (notificar: boolean, forzar: Forzar = {}) => {
    if (guardando) return;
    setError("");
    setAviso(null);
    setPreguntarCerrar(false);
    const d = datos(notificar, forzar);
    if (typeof d === "string") { setError(d); return; }
    setGuardando(true);
    const res = await api.guardarReserva(d);
    setGuardando(false);
    if (!res.ok) {
      if (res.aviso) setAviso({ tipo: res.aviso, texto: res.error, notificar, forzar });
      else setError(res.error);
      return;
    }
    terminar(res);
  }, [datos, terminar, guardando]);

  async function solicitarTarjeta(forzar: Forzar = {}) {
    if (guardando) return;
    setError("");
    setAviso(null);
    setPreguntarCerrar(false);
    const d = datos(true, forzar);
    if (typeof d === "string") { setError(d); return; }
    setGuardando(true);
    const res = await api.solicitarTarjeta(d);
    setGuardando(false);
    if (!res.ok || !res.data) {
      if (res.aviso) setAviso({ tipo: res.aviso, texto: res.error || "", notificar: true, forzar, tarjeta: true });
      else setError(res.error || "No se ha podido pedir la tarjeta.");
      return;
    }
    sucio.current = false;
    setReservaId(res.data.id);
    setEstado("tarjeta_pendiente");
    setEnlaceTarjeta(res.data.enlace);
    if (res.advertencia) setError(res.advertencia);
    api.trackingMensajes(res.data.id).then(setTracking);
    if (!localizador) api.cargarReserva(res.data.id).then((rr) => { if (rr) setLocalizador(rr.localizador); });
  }

  async function forzarYGuardar() {
    if (!aviso) return;
    const forzar = { ...aviso.forzar, [aviso.tipo]: true };
    if (aviso.tarjeta) await solicitarTarjeta(forzar);
    else await guardar(aviso.notificar, forzar);
  }

  /** Esc / ✕: con la reserva ya guardada se cierra refrescando; con cambios sin guardar, se pregunta. */
  const pedirCerrar = useCallback(() => {
    const yaGuardada = guardadoCon ?? (enlaceTarjeta && reservaId ? { id: reservaId, fecha } : null);
    if (sucio.current) { setPreguntarCerrar(true); return; }
    if (yaGuardada) guardado(yaGuardada);
    else cerrar();
  }, [guardadoCon, enlaceTarjeta, reservaId, fecha, guardado, cerrar]);

  const descartar = useCallback(() => {
    const yaGuardada = guardadoCon ?? (enlaceTarjeta && reservaId ? { id: reservaId, fecha } : null);
    sucio.current = false;
    setPreguntarCerrar(false);
    if (yaGuardada) guardado(yaGuardada);
    else cerrar();
  }, [guardadoCon, enlaceTarjeta, reservaId, fecha, guardado, cerrar]);

  async function copiarEnlace() {
    if (!enlaceTarjeta) return;
    try { await navigator.clipboard.writeText(enlaceTarjeta); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sin portapapeles */ }
  }

  /* ==================== Teclas ==================== */

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (preguntarCerrar) { setPreguntarCerrar(false); return; } // Esc otra vez = seguir editando
        if (mesasAbierto) { setMesasAbierto(false); return; }
        if (verTracking) { setVerTracking(false); return; }
        if (composer) { setComposer(null); return; }
        pedirCerrar();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!enlaceTarjeta) void guardar(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [pedirCerrar, guardar, preguntarCerrar, mesasAbierto, verTracking, composer, enlaceTarjeta]);

  /* ==================== Mesas ==================== */

  const salaBloqueada = (salaId: string) => ocMesas.salasBloqueadas.includes("*") || ocMesas.salasBloqueadas.includes(salaId);
  const estadoMesa = (m: Mesa): { libre: boolean; texto: string } => {
    const o = ocMesas.ocupadas[m.id];
    if (o) return { libre: false, texto: `ocupada · ${o.hora} ${o.nombre} (${o.pax}p)` };
    if (ocMesas.bloqueadas.includes(m.id) || salaBloqueada(m.sala_id)) return { libre: false, texto: "bloqueada" };
    return { libre: true, texto: "libre" };
  };
  const cabe = (m: Mesa) => m.cap_min <= pax && m.cap_max >= pax;
  const mesasConflicto = mesas.map(mesaPorId).filter((m): m is Mesa => !!m && !estadoMesa(m).libre);
  const capacidadSel = mesas.map(mesaPorId).reduce((a, m) => a + (m?.cap_max ?? 0), 0);

  async function buscarMejorMesa() {
    if (!hora) return;
    setBuscandoMesa(true);
    const ids = await api.mejorMesa({ restauranteId: rest.id, fecha, hora, duracion: duracion || 120, pax, zonaId: zonaId || null, excluirId: reservaId });
    setBuscandoMesa(false);
    if (!ids) { setError(`No hay ninguna mesa libre para ${pax} personas a las ${hora}.`); return; }
    setError("");
    setMesas(ids);
  }

  /* ==================== Cliente ==================== */

  function elegirCliente(c: Cliente, s: StatsCliente | null) {
    const f = fichaDe(c);
    sucio.current = true;
    setFicha(f);
    setContactoGuardado({ email: f.email, tel: telDeFicha(f) });
    setStats(s);
    setComposer(null);
    if (!s) api.statsCliente(c.id).then(setStats);
  }
  function crearNuevo(texto: string) {
    const f = fichaVacia();
    sucio.current = true;
    if (/^[\d\s+()-]{6,}$/.test(texto)) {
      const limpio = texto.replace(/[()-]/g, " ").trim();
      const t = /^(\+|00)/.test(limpio) ? normalizarTel("34", limpio) : partirTelefono(limpio);
      f.prefijo = t.prefijo;
      f.telefono = t.numero;
    } else if (texto.includes("@")) f.email = texto;
    else {
      const [nombre, ...resto] = texto.split(/\s+/);
      f.nombre = nombre ?? "";
      f.apellidos = resto.join(" ");
    }
    setFicha(f);
    setContactoGuardado({ email: "", tel: "" });
    setStats(null);
    setComposer(null);
  }
  const setF = <K extends keyof FichaCliente>(k: K, v: FichaCliente[K]) => setFicha((f) => (f ? { ...f, [k]: v } : f));
  const toggleLista = (lista: string[], id: string) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  const telCompleto = telDeFicha(ficha);
  // Email o teléfono tocados y sin guardar: el redactor manual no escribe hasta que se guarde.
  const contactoSinGuardar = !!ficha && (ficha.email.trim().toLowerCase() !== contactoGuardado.email.trim().toLowerCase() || telCompleto !== contactoGuardado.tel);

  /** Teléfono: con «+» o «00» delante es internacional y fija también el prefijo (al pegarlo
      o al salir del campo; mientras se escribe se deja tal cual). */
  function cambiarTelefono(valor: string, ahora: boolean) {
    const v = valor.replace(/[^\d\s+]/g, "").replace(/(?!^)\+/g, "");
    if (ahora && /^(\+|00)/.test(v.trim())) {
      setFicha((f) => {
        if (!f) return f;
        const t = normalizarTel(f.prefijo, v);
        return { ...f, prefijo: t.prefijo, telefono: t.numero };
      });
    } else setF("telefono", v);
  }
  function fijarTelefono() {
    setFicha((f) => {
      if (!f || !f.telefono) return f;
      const t = normalizarTel(f.prefijo, f.telefono);
      return t.prefijo === f.prefijo && t.numero === f.telefono ? f : { ...f, prefijo: t.prefijo, telefono: t.numero };
    });
  }
  const nombreCompleto = ficha ? [ficha.nombre, ficha.apellidos].filter((x) => x.trim()).join(" ") || "Cliente nuevo" : "";

  /** Reenviar o descartar un mensaje del tracking (acciones/mensajes.ts) y refrescar la lista. */
  async function accionMensaje(id: string, que: "reenviar" | "cancelar") {
    const r = que === "reenviar" ? await reenviar(id) : await cancelarMensaje(id);
    if (!r.ok) setError(r.error || "No se ha podido actualizar el mensaje.");
    if (reservaId) api.trackingMensajes(reservaId).then(setTracking);
  }

  async function enviarManual() {
    if (!composer || !ficha?.id || contactoSinGuardar) return;
    const dest = composer.canal === "email" ? contactoGuardado.email : contactoGuardado.tel;
    setComposer({ ...composer, enviando: true, hecho: null });
    const r = await api.enviarMensajeManual({
      restauranteId: rest.id,
      clienteId: ficha.id,
      reservaId,
      canal: composer.canal,
      destinatario: dest,
      asunto: composer.asunto,
      cuerpo: composer.cuerpo,
    });
    if (!r.ok) { setComposer({ ...composer, enviando: false, hecho: null }); setError(r.error || "No se ha podido encolar el mensaje."); return; }
    setComposer({
      ...composer,
      enviando: false,
      cuerpo: "",
      hecho:
        composer.canal === "whatsapp"
          ? "En cola: por WhatsApp solo llega si el cliente te ha escrito en las últimas 24 h; si no, usa «Abrir en WhatsApp»."
          : "Mensaje en cola: saldrá en el próximo envío.",
    });
    if (reservaId) api.trackingMensajes(reservaId).then(setTracking);
  }

  /* ==================== Adjuntos ==================== */

  async function subirArchivo(f: File) {
    if (!reservaId) return;
    setSubiendo(true);
    setError("");
    const prep = await api.prepararSubidaAdjunto({ reservaId, nombre: f.name, tamano: f.size, tipo: f.type || null });
    if (!prep.ok || !prep.data) { setSubiendo(false); setError(prep.error || "No se pudo preparar la subida."); return; }
    try {
      const up = await fetch(prep.data.urlSubida, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
      if (!up.ok) throw new Error("subida");
    } catch {
      setSubiendo(false);
      setError("No se pudo subir el archivo.");
      return;
    }
    const reg = await api.registrarAdjunto({ reservaId, nombre: f.name, ruta: prep.data.ruta, tamano: f.size, tipo: f.type || null });
    setSubiendo(false);
    if (!reg.ok || !reg.data) { setError(reg.error || "No se pudo registrar el archivo."); return; }
    setAdjuntos(reg.data);
  }
  async function abrirAdjunto(a: Adjunto) {
    if (!reservaId) return;
    const r = await api.urlAdjunto(reservaId, a.ruta);
    if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener");
    else setError(r.error || "No se pudo abrir el archivo.");
  }
  async function quitarAdjunto(a: Adjunto) {
    if (!reservaId) return;
    const r = await api.borrarAdjunto(reservaId, a.ruta);
    if (r.ok && r.data) setAdjuntos(r.data);
    if (r.error) setError(r.error);
  }

  /* ==================== Render ==================== */

  const etiquetas = (ambito: string): Etiqueta[] => (cat?.etiquetas ?? []).filter((e) => e.ambito === ambito);
  const conTarjeta = tipo !== "gratis";
  const importeNum = Number(importe.replace(",", "."));
  const estadoDef = estadoDe(estado);
  const procedencia = r0 ? [ORIGEN[r0.origen] ?? r0.origen, r0.canal].filter(Boolean).join(" · ") : "Panel";
  const franjaSel = ocupacion.flatMap((t) => t.franjas.map((f) => ({ ...f, t }))).find((f) => f.hora === hora);
  const horaEnLista = ocupacion.some((t) => t.franjas.some((f) => f.hora === hora));

  return (
    <div className="rsp-modal rvm-fondo" role="dialog" aria-modal="true" aria-label={esEdicion ? "Editar reserva" : "Nueva reserva"}>
      <div className="rvm">
        {/* ---------- cabecera ---------- */}
        <header className="rvm-cab">
          <div className="rvm-titulo">
            <h2>{esEdicion ? "Editar reserva" : "Nueva reserva"} <span>en {rest.nombre}</span></h2>
            {localizador ? <span className="rvm-loc" title="Localizador">{localizador}</span> : null}
            {esEdicion ? <span className="rvm-estado-chip" style={{ background: estadoDef.color, color: estadoDef.borde ? "#1a1a1a" : colorTexto(estadoDef.color), borderColor: estadoDef.borde ?? "transparent" }}>{estadoDef.texto}</span> : null}
          </div>
          <label className="rvm-anotado">
            <span>Anotado por</span>
            {!cat ? (
              <b>…</b>
            ) : (
              <select value={anotadoPor} onChange={(e) => { setAnotadoPor(e.target.value); sucio.current = true; }} aria-label="Anotado por">
                {!anotadoPor ? <option value="">{cat.anotadoPor ?? "—"}</option> : null}
                {anotadoPor && !cat.usuarios.some((u) => u.id === anotadoPor) ? <option value={anotadoPor}>{cat.anotadoPor ?? "Otro usuario"}</option> : null}
                {cat.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            )}
          </label>
          <button type="button" className="rvm-cerrar" onClick={pedirCerrar} aria-label="Cerrar">✕</button>
        </header>

        {/* ---------- cuerpo ---------- */}
        <div
          className="rvm-cuerpo"
          onInputCapture={(e) => { if (!(e.target as HTMLElement).closest("[data-neutro]")) sucio.current = true; }}
          onClickCapture={(e) => {
            const el = (e.target as HTMLElement).closest("button, [role=option], [role=button]");
            if (el && !el.closest("[data-neutro]")) sucio.current = true;
          }}
        >
          {/* ===== columna reserva ===== */}
          <section className="rvm-col rvm-reserva">
            <div className="rvm-fila c3">
              <div className="rvm-campo">
                <label>Día</label>
                <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
              </div>
              <div className="rvm-campo">
                <label>Hora</label>
                <select value={hora} onChange={(e) => setHora(e.target.value)}>
                  {!hora ? <option value="">—</option> : null}
                  {hora && !horaEnLista ? <option value={hora}>{hora}</option> : null}
                  {ocupacion.map((t) => (
                    <optgroup key={t.turnoId} label={`${t.nombre}${t.cerrado ? " · CERRADO" : ""} · ${t.paxTurno}${t.aforo ? ` / ${t.aforo}` : ""} pax`}>
                      {t.franjas.map((f) => (
                        <option key={f.hora} value={f.hora}>
                          {f.hora}  ({f.pax}{t.aforo ? ` / ${t.aforo}` : ""}){t.maxReservasIntervalo && f.reservas >= t.maxReservasIntervalo ? " · lleno" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {!ocupacion.length && cat ? <small className="rvm-ayuda err">Ese día no hay turnos abiertos.</small> : null}
                {franjaSel?.t.cerrado ? <small className="rvm-ayuda err">El turno {franjaSel.t.nombre} está cerrado ese día.</small> : null}
              </div>
              <div className="rvm-campo">
                <label>Personas</label>
                <div className="rvm-pax">
                  <button type="button" onClick={() => setPax((p) => Math.max(1, p - 1))} aria-label="Una persona menos">−</button>
                  <input type="number" min={1} inputMode="numeric" value={pax} onChange={(e) => setPax(Math.max(1, parseInt(e.target.value) || 1))} />
                  <button type="button" onClick={() => setPax((p) => p + 1)} aria-label="Una persona más">+</button>
                </div>
              </div>
            </div>

            <div className="rvm-fila c3">
              <div className="rvm-campo">
                <label>Duración</label>
                <select value={duracion || 120} onChange={(e) => { setDuracion(Number(e.target.value)); setDuracionManual(true); }}>
                  {!DURACIONES.includes(duracion) && duracion ? <option value={duracion}>{fmtDur(duracion)}</option> : null}
                  {DURACIONES.map((d) => <option key={d} value={d}>{fmtDur(d)}</option>)}
                </select>
                {!duracionManual && duracion ? <small className="rvm-ayuda">Según personas; se puede cambiar.</small> : null}
              </div>
              <div className="rvm-campo">
                <label>Ref.</label>
                <input type="text" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Referencia externa" />
              </div>
              <div className="rvm-campo">
                <label>Código promo</label>
                <input type="text" value={codigoPromo} onChange={(e) => setCodigoPromo(e.target.value.toUpperCase())} placeholder="—" />
                {promoInfo ? <small className={"rvm-ayuda" + (promoInfo.valido ? " ok" : " err")}>{promoInfo.texto}</small> : null}
              </div>
            </div>

            <div className="rvm-fila c2">
              <div className="rvm-campo">
                <label>Zona</label>
                <select value={zonaId} onChange={(e) => setZonaId(e.target.value)}>
                  <option value="">Todas</option>
                  {salas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              <div className="rvm-campo" ref={mesasRef}>
                <label>Mesa(s){mesas.length ? <span className="rvm-cap"> · cap. {capacidadSel}</span> : null}</label>
                <div className="rvm-mesas">
                  <button type="button" className={"rvm-mesas-btn" + (mesasAbierto ? " abierto" : "")} onClick={() => setMesasAbierto((v) => !v)} aria-haspopup="listbox" aria-expanded={mesasAbierto}>
                    {mesas.length ? (
                      <span className="rvm-mesas-sel">
                        {mesas.map((id) => {
                          const m = mesaPorId(id);
                          const conf = m ? !estadoMesa(m).libre : false;
                          return (
                            <span key={id} className={"rvm-mesa-chip" + (conf ? " conf" : "")}>
                              {m ? `${m.nombre} (${m.sala_nombre}) · ${m.cap_min}-${m.cap_max}` : "?"}
                              <i role="button" aria-label="Quitar mesa" onClick={(e) => { e.stopPropagation(); setMesas(mesas.filter((x) => x !== id)); }}>×</i>
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="rvm-mesas-vacio">Sin mesa (asignar luego)</span>
                    )}
                    <span className="rvm-caret" aria-hidden>▾</span>
                  </button>
                  <button type="button" className="rvm-mejor" onClick={buscarMejorMesa} disabled={buscandoMesa || !hora} title="Buscar la mejor mesa libre para estas personas">
                    {buscandoMesa ? "…" : "Mejor mesa"}
                  </button>
                  {mesasAbierto ? (
                    <div className="rvm-mesas-lista" role="listbox" aria-multiselectable>
                      {salas
                        .filter((s) => !zonaId || s.id === zonaId)
                        .map((s) => {
                          const activas = (s.mesas || []).filter((m) => m.activa).map((m) => ({ ...m, sala_nombre: s.nombre }));
                          const caben = activas.filter(cabe).sort((a, b) => a.cap_max - b.cap_max || a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
                          const noCaben = activas.filter((m) => !cabe(m)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
                          if (!activas.length) return null;
                          const filaMesa = (m: Mesa) => {
                            const st = estadoMesa(m);
                            const sel = mesas.includes(m.id);
                            return (
                              <div
                                key={m.id}
                                role="option"
                                aria-selected={sel}
                                className={"rvm-mesa-item" + (sel ? " sel" : "") + (st.libre ? "" : " ocupada") + (cabe(m) ? "" : " nocabe")}
                                onClick={() => setMesas(toggleLista(mesas, m.id))}
                              >
                                <span className="rvm-check" aria-hidden>{sel ? "✓" : ""}</span>
                                <span className="rvm-mesa-nombre">{m.nombre} <small>({s.nombre}) · {m.cap_min}-{m.cap_max}</small></span>
                                <span className="rvm-mesa-estado">{st.texto}{m.reservable_online ? "" : " · no online"}</span>
                              </div>
                            );
                          };
                          return (
                            <div key={s.id} className="rvm-mesas-grupo">
                              <div className="rvm-mesas-sala">{s.nombre}{salaBloqueada(s.id) ? " · sala bloqueada" : ""}</div>
                              {caben.map(filaMesa)}
                              {noCaben.length ? <div className="rvm-mesas-sub">No caben para {pax}</div> : null}
                              {noCaben.map(filaMesa)}
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                </div>
                {mesasConflicto.length ? (
                  <small className="rvm-ayuda err">
                    {mesasConflicto.map((m) => `La mesa ${m.nombre} está ${estadoMesa(m).texto}`).join(". ")}.
                  </small>
                ) : null}
                {mesas.length && capacidadSel < pax ? <small className="rvm-ayuda err">Las mesas elegidas no llegan a {pax} personas.</small> : null}
              </div>
            </div>

            <div className="rvm-fila c2">
              <div className="rvm-campo">
                <label>Estado</label>
                <div className="rvm-estado">
                  <i style={{ background: estadoDef.color, borderColor: estadoDef.borde ?? estadoDef.color }} aria-hidden />
                  <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                    {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.texto}</option>)}
                    {!ESTADOS.some((e) => e.id === estado) ? <option value={estado}>{EST[estado]?.txt ?? estado}</option> : null}
                  </select>
                </div>
              </div>
              <div className="rvm-campo">
                <label>Tipo de reserva</label>
                <select value={tipo} onChange={(e) => { tipoManual.current = true; setTipo(e.target.value); setImporteManual(false); }}>
                  {TIPOS_RESERVA.map((t) => <option key={t.id} value={t.id} title={t.descripcion}>{t.texto}</option>)}
                </select>
                {tipo === "gratis" && tarjetaDesde != null && pax >= tarjetaDesde ? (
                  <small className="rvm-ayuda err">A partir de {tarjetaDesde} personas el restaurante pide tarjeta.</small>
                ) : null}
              </div>
            </div>

            {conTarjeta ? (
              <div className="rvm-tarjeta">
                <div className="rvm-campo">
                  <label>Importe {tipo === "prepago" || tipo === "experiencia" ? "a cobrar" : "de garantía"} (total)</label>
                  <div className="rvm-importe">
                    <input type="text" inputMode="decimal" value={importe} onChange={(e) => { setImporte(e.target.value); setImporteManual(true); }} placeholder="0,00" />
                    <span>€</span>
                  </div>
                  <small className="rvm-ayuda">{TIPOS_RESERVA.find((t) => t.id === tipo)?.descripcion}{importeNum > 0 && pax > 0 ? ` · ${fmtEur(importeNum / pax)} por persona` : ""}</small>
                </div>
                <div className="rvm-campo rvm-solicitar">
                  <label>&nbsp;</label>
                  <button type="button" className="rvm-btn sec" onClick={() => solicitarTarjeta()} disabled={guardando || !(importeNum > 0) || !!enlaceTarjeta} title={enlaceTarjeta ? "La tarjeta ya está pedida: el enlace está debajo" : "Guarda la reserva pendiente de tarjeta y genera el enlace de pago para el cliente"}>
                    💳 Solicitar tarjeta
                  </button>
                </div>
                {enlaceTarjeta ? (
                  <div className="rvm-enlace" data-neutro>
                    <div>Reserva guardada <b>pendiente de tarjeta</b>. El aviso al cliente sale solo; este es el enlace por si quieres pasárselo a mano:</div>
                    <div className="rvm-enlace-fila">
                      <input type="text" readOnly value={enlaceTarjeta} onFocus={(e) => e.target.select()} />
                      <button type="button" className="rvm-btn sec" onClick={copiarEnlace}>{copiado ? "Copiado" : "Copiar"}</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Estado de pago, cobros y devoluciones (pieza pagos); solo en reservas ya guardadas. */}
            {esEdicion && reservaId ? <BloquePagos reservaId={reservaId} /> : null}

            <div className="rvm-fila c3">
              <div className="rvm-campo">
                <label>Prescriptor</label>
                {nuevoPrescriptor === null ? (
                  <div className="rvm-con-boton">
                    <select value={prescriptorId} onChange={(e) => setPrescriptorId(e.target.value)}>
                      <option value="">Ninguno</option>
                      {(cat?.prescriptores ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                    <button type="button" onClick={() => setNuevoPrescriptor("")} title="Crear prescriptor" aria-label="Crear prescriptor">+</button>
                  </div>
                ) : (
                  <div className="rvm-con-boton">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Nombre del hotel / agencia"
                      value={nuevoPrescriptor}
                      onChange={(e) => setNuevoPrescriptor(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Escape") { e.stopPropagation(); setNuevoPrescriptor(null); }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          const r = await api.crearPrescriptorRapido(nuevoPrescriptor);
                          if (r.ok && r.data) {
                            const p = r.data;
                            setCat((c) => (c && !c.prescriptores.some((x) => x.id === p.id) ? { ...c, prescriptores: [...c.prescriptores, p].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")) } : c));
                            setPrescriptorId(p.id);
                            setNuevoPrescriptor(null);
                          } else setError(r.error || "No se pudo crear el prescriptor.");
                        }
                      }}
                    />
                    <button type="button" onClick={() => setNuevoPrescriptor(null)} aria-label="Cancelar">×</button>
                  </div>
                )}
                {nuevoPrescriptor !== null ? <small className="rvm-ayuda">Enter para crear · Esc para cancelar</small> : null}
              </div>
              <div className="rvm-campo">
                <label>Experiencia</label>
                <select
                  value={experienciaId}
                  onChange={(e) => {
                    setExperienciaId(e.target.value);
                    if (e.target.value && tipo === "gratis") { tipoManual.current = true; setTipo("experiencia"); setImporteManual(false); }
                    if (!e.target.value && tipo === "experiencia") { tipoManual.current = true; setTipo("gratis"); setImporteManual(false); }
                  }}
                >
                  <option value="">Ninguna</option>
                  {(cat?.experiencias ?? []).map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.precio_pax ? ` · ${fmtEur(x.precio_pax)}/p` : ""}</option>)}
                </select>
              </div>
              <div className="rvm-campo">
                <label>Procedencia</label>
                <div className="rvm-solo-lectura">{procedencia}</div>
              </div>
            </div>

            <div className="rvm-campo">
              <label>Etiquetas de la reserva</label>
              <div className="rvm-chips">
                {etiquetas("reserva").map((e) => {
                  const on = etiquetasRes.includes(e.id);
                  return (
                    <button key={e.id} type="button" className={"rvm-chip" + (on ? " on" : "")} style={on ? { background: e.color, color: colorTexto(e.color), borderColor: e.color } : { borderColor: e.color }} onClick={() => setEtiquetasRes(toggleLista(etiquetasRes, e.id))}>
                      {e.nombre}
                    </button>
                  );
                })}
                {cat && !etiquetas("reserva").length ? <small className="rvm-ayuda">Sin etiquetas: se crean en Ajustes › Etiquetas.</small> : null}
              </div>
            </div>

            <div className="rvm-campo">
              <label>Notas del establecimiento</label>
              <textarea rows={3} value={notasInternas} onChange={(e) => setNotasInternas(e.target.value)} placeholder="Lo que la sala tiene que saber: trona, mesa junto a la ventana, celebración…" />
            </div>
            {r0?.notas_cliente || notasCliente ? (
              <div className="rvm-campo">
                <label>Comentario del cliente</label>
                <textarea rows={2} value={notasCliente} onChange={(e) => setNotasCliente(e.target.value)} />
              </div>
            ) : null}

            <div className="rvm-campo">
              <label>Adjuntos</label>
              {adjuntos.length ? (
                <ul className="rvm-adjuntos" data-neutro>
                  {adjuntos.map((a) => (
                    <li key={a.ruta}>
                      <button type="button" className="rvm-link" onClick={() => abrirAdjunto(a)}>{a.nombre}</button>
                      <small>{fmtKb(a.tamano)}</small>
                      <button type="button" className="rvm-x" onClick={() => quitarAdjunto(a)} aria-label="Quitar adjunto">×</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {reservaId ? (
                <>
                  <input ref={archivoRef} type="file" hidden data-neutro accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirArchivo(f); e.target.value = ""; }} />
                  <button type="button" className="rvm-btn sec mini" data-neutro onClick={() => archivoRef.current?.click()} disabled={subiendo}>{subiendo ? "Subiendo…" : "Adjuntar archivo"}</button>
                </>
              ) : (
                <small className="rvm-ayuda">Guarda la reserva para poder adjuntar archivos.</small>
              )}
            </div>

            {localizador ? (
              <div className="rvm-fila c2">
                <div className="rvm-campo">
                  <label>Localizador</label>
                  <div className="rvm-solo-lectura mono">{localizador}</div>
                </div>
                {r0?.creado_en ? (
                  <div className="rvm-campo">
                    <label>Reserva hecha</label>
                    <div className="rvm-solo-lectura">{fmtFC(r0.creado_en.slice(0, 10))} {r0.creado_en.slice(11, 16)}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* ===== columna cliente ===== */}
          <section className="rvm-col rvm-cliente">
            <BuscadorCliente
              etiquetas={cat?.etiquetas}
              autoFocus={!ficha}
              placeholder={ficha ? "Cambiar de cliente: teléfono, email o nombre…" : "Buscar cliente por teléfono, email o nombre…"}
              onSeleccion={({ cliente, stats: s }) => elegirCliente(cliente, s)}
              onCrearNuevo={crearNuevo}
            />

            {!ficha ? (
              <div className="rvm-sin-cliente">
                <div className="rvm-sin-cliente-icono" aria-hidden>☺</div>
                <p>Busca al cliente por teléfono, email o nombre. Si no está, <b>créalo</b> desde la lista.</p>
                <button type="button" className="rvm-btn sec" onClick={() => crearNuevo("")}>Cliente nuevo</button>
              </div>
            ) : (
              <>
                {/* tarjeta */}
                <div className="rvm-tarjeta-cli">
                  <div className="rvm-avatar" aria-hidden>{iniciales(nombreCompleto)}</div>
                  <div className="rvm-tarjeta-cuerpo">
                    <div className="rvm-tarjeta-nombre">
                      {nombreCompleto}
                      {ficha.vip ? <span className="rvm-badge vip">VIP</span> : null}
                      {ficha.id && stats?.riesgo_no_show != null && stats.riesgo_no_show >= 0.3 ? <span className="rvm-badge riesgo" title="Riesgo de no-show">riesgo {Math.round(stats.riesgo_no_show * 100)} %</span> : null}
                      {ficha.lista_negra ? <span className="rvm-badge riesgo" title="Cliente en lista negra">Lista negra</span> : null}
                      {!ficha.id ? <span className="rvm-badge nuevo">Nuevo</span> : null}
                    </div>
                    <div className="rvm-tarjeta-det">
                      {ficha.email || "sin email"} · {ficha.telefono ? fmtTel(telCompleto) : "sin teléfono"}
                    </div>
                    <div className="rvm-tarjeta-btns" data-neutro>
                      <button type="button" disabled={!ficha.id || !contactoGuardado.email || !rest.envio_email} title={!ficha.id ? "Guarda primero el cliente" : !rest.envio_email ? "El restaurante no tiene el email activo" : !contactoGuardado.email ? "Sin email" : ""} onClick={() => setComposer({ canal: "email", asunto: "", cuerpo: "", enviando: false, hecho: null })}>✉ Email</button>
                      <button type="button" disabled={!ficha.id || !contactoGuardado.tel || !rest.envio_sms} title={!ficha.id ? "Guarda primero el cliente" : !rest.envio_sms ? "El restaurante no tiene SMS activo" : !contactoGuardado.tel ? "Sin teléfono" : ""} onClick={() => setComposer({ canal: "sms", asunto: "", cuerpo: "", enviando: false, hecho: null })}>▭ SMS</button>
                      <button type="button" disabled={!ficha.id || !contactoGuardado.tel || !rest.envio_whatsapp} className="wa" title={!ficha.id ? "Guarda primero el cliente" : !rest.envio_whatsapp ? "El restaurante no tiene WhatsApp activo" : !contactoGuardado.tel ? "Sin teléfono" : ""} onClick={() => setComposer({ canal: "whatsapp", asunto: "", cuerpo: "", enviando: false, hecho: null })}>WhatsApp</button>
                      <button type="button" className="quitar" onClick={() => { sucio.current = true; setFicha(null); setStats(null); setComposer(null); }} title="Quitar el cliente de la reserva">Cambiar</button>
                    </div>
                  </div>
                </div>

                {composer ? (
                  <div className="rvm-composer" data-neutro>
                    <div className="rvm-composer-cab">
                      <b>{composer.canal === "email" ? "Email" : composer.canal === "sms" ? "SMS" : "WhatsApp"}</b> a {composer.canal === "email" ? contactoGuardado.email : fmtTel(contactoGuardado.tel)}
                      <button type="button" className="rvm-x" onClick={() => setComposer(null)} aria-label="Cerrar">×</button>
                    </div>
                    {composer.canal === "email" ? <input type="text" placeholder="Asunto" value={composer.asunto} onChange={(e) => setComposer({ ...composer, asunto: e.target.value })} /> : null}
                    <textarea rows={3} placeholder="Escribe el mensaje…" value={composer.cuerpo} onChange={(e) => setComposer({ ...composer, cuerpo: e.target.value })} />
                    <div className="rvm-composer-pie">
                      {composer.canal === "whatsapp" && contactoGuardado.tel ? (
                        <a className="rvm-link" href={`https://wa.me/${contactoGuardado.tel}${composer.cuerpo ? `?text=${encodeURIComponent(composer.cuerpo)}` : ""}`} target="_blank" rel="noopener noreferrer">Abrir en WhatsApp</a>
                      ) : <span />}
                      <span className="rvm-composer-hecho">{contactoSinGuardar ? "Has cambiado el email o el teléfono: guarda la reserva antes de escribirle." : composer.hecho}</span>
                      <button type="button" className="rvm-btn mini" disabled={composer.enviando || !composer.cuerpo.trim() || contactoSinGuardar} onClick={enviarManual}>{composer.enviando ? "Enviando…" : "Enviar"}</button>
                    </div>
                  </div>
                ) : null}

                {/* estadísticas */}
                {ficha.id ? (
                  <div className="rvm-stats">
                    <div><b>{stats?.ultima_visita ? fmtFecha(stats.ultima_visita) : "—"}</b><span>Última visita</span></div>
                    <div><b>{stats ? (stats.visitas ?? 0) + (stats.visitas_presuntas ?? 0) : "—"}</b><span>Visitas</span></div>
                    <div><b className={stats?.no_shows ? "mal" : ""}>{stats?.no_shows ?? "—"}</b><span>No show</span></div>
                    <div><b>{stats?.canceladas ?? "—"}</b><span>Canceladas</span></div>
                    <div><b>{stats?.proxima_reserva ? fmtFecha(stats.proxima_reserva) : "—"}</b><span>Próxima reserva</span></div>
                    <div><b>{stats?.pax_medio ?? "—"}</b><span>Pax por visita</span></div>
                    <div><b>{stats?.valoracion_media != null ? `${stats.valoracion_media} ★` : "—"}</b><span>Media de valoraciones</span></div>
                    <div><b>{stats?.primera_visita ? fmtFecha(stats.primera_visita) : "—"}</b><span>Cliente desde</span></div>
                  </div>
                ) : null}

                {/* datos */}
                <div className="rvm-fila c3">
                  <div className="rvm-campo">
                    <label>Nombre *</label>
                    <input type="text" value={ficha.nombre} onChange={(e) => setF("nombre", e.target.value)} autoFocus={!ficha.id && !ficha.nombre} />
                  </div>
                  <div className="rvm-campo">
                    <label>Apellidos</label>
                    <input type="text" value={ficha.apellidos} onChange={(e) => setF("apellidos", e.target.value)} />
                  </div>
                  <div className="rvm-campo">
                    <label>Idioma</label>
                    <select value={ficha.idioma} onChange={(e) => setF("idioma", e.target.value)}>
                      {IDIOMAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                      {!IDIOMAS.some(([v]) => v === ficha.idioma) ? <option value={ficha.idioma}>{ficha.idioma}</option> : null}
                    </select>
                  </div>
                </div>
                <div className="rvm-fila c3">
                  <div className="rvm-campo">
                    <label>Prefijo</label>
                    <select value={ficha.prefijo} onChange={(e) => setF("prefijo", e.target.value)}>
                      {PREFIJOS.map(([p, n]) => <option key={p} value={p}>+{p} {n}</option>)}
                      {!PREFIJOS.some(([p]) => p === ficha.prefijo) ? <option value={ficha.prefijo}>+{ficha.prefijo}</option> : null}
                    </select>
                  </div>
                  <div className="rvm-campo">
                    <label>Teléfono</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={ficha.telefono}
                      onChange={(e) => cambiarTelefono(e.target.value, (e.nativeEvent as InputEvent).inputType === "insertFromPaste")}
                      onBlur={fijarTelefono}
                      placeholder="612 345 678 o +44 …"
                    />
                  </div>
                  <div className="rvm-campo">
                    <label>Email</label>
                    <input type="email" inputMode="email" value={ficha.email} onChange={(e) => setF("email", e.target.value.trim())} placeholder="nombre@correo.com" />
                  </div>
                </div>

                <div className="rvm-campo">
                  <label>Etiquetas del cliente</label>
                  <div className="rvm-chips">
                    {etiquetas("cliente").map((e) => {
                      const on = ficha.etiquetas.includes(e.id);
                      return (
                        <button key={e.id} type="button" className={"rvm-chip" + (on ? " on" : "")} style={on ? { background: e.color, color: colorTexto(e.color), borderColor: e.color } : { borderColor: e.color }} onClick={() => setF("etiquetas", toggleLista(ficha.etiquetas, e.id))}>
                          {e.nombre}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="rvm-check-linea">
                  <input type="checkbox" checked={ficha.consentimiento} onChange={(e) => setF("consentimiento", e.target.checked)} />
                  Da consentimiento para recibir información comercial por email y SMS
                </label>

                <div className="rvm-tabs" data-neutro>
                  <button type="button" className={tabCliente === "notas" ? "activo" : ""} onClick={() => setTabCliente("notas")}>Notas del cliente</button>
                  <button type="button" className={tabCliente === "info" ? "activo" : ""} onClick={() => setTabCliente("info")}>
                    Información adicional{ficha.alergias || ficha.alergenos.length ? <i className="rvm-punto" title="Tiene alergias" /> : null}
                  </button>
                </div>
                {tabCliente === "notas" ? (
                  <textarea rows={4} value={ficha.notas} onChange={(e) => setF("notas", e.target.value)} placeholder="Preferencias, cómo le gusta la mesa, qué no hay que olvidar…" />
                ) : (
                  <div className="rvm-info">
                    <div className="rvm-campo">
                      <label>Alergias e intolerancias</label>
                      <div className="rvm-chips">
                        {etiquetas("alergeno").map((e) => {
                          const on = ficha.alergenos.includes(e.id);
                          return (
                            <button key={e.id} type="button" className={"rvm-chip alerg" + (on ? " on" : "")} onClick={() => setF("alergenos", toggleLista(ficha.alergenos, e.id))}>
                              {e.nombre}
                            </button>
                          );
                        })}
                      </div>
                      <input type="text" value={ficha.alergias} onChange={(e) => setF("alergias", e.target.value)} placeholder="Otras alergias o detalle (texto libre)" style={{ marginTop: 6 }} />
                    </div>
                    <div className="rvm-fila c3">
                      <div className="rvm-campo">
                        <label>Cumpleaños</label>
                        <input type="date" value={ficha.fecha_nacimiento} onChange={(e) => setF("fecha_nacimiento", e.target.value)} />
                      </div>
                      <div className="rvm-campo">
                        <label>Empresa</label>
                        <input type="text" value={ficha.empresa} onChange={(e) => setF("empresa", e.target.value)} />
                      </div>
                      <div className="rvm-campo">
                        <label>Nº socio</label>
                        <input type="text" value={ficha.numero_socio} onChange={(e) => setF("numero_socio", e.target.value)} />
                      </div>
                    </div>
                    <label className="rvm-check-linea">
                      <input type="checkbox" checked={ficha.vip} onChange={(e) => setF("vip", e.target.checked)} />
                      Cliente VIP
                    </label>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ===== tracking de notificaciones ===== */}
          {verTracking ? (
            <aside className="rvm-tracking" data-neutro>
              <div className="rvm-tracking-cab">
                <b>Tracking de notificaciones</b>
                <button type="button" className="rvm-x" onClick={() => setVerTracking(false)} aria-label="Cerrar">×</button>
              </div>
              {!tracking ? <div className="rvm-ayuda">Cargando…</div> : !tracking.length ? <div className="rvm-ayuda">Todavía no se ha enviado nada de esta reserva.</div> : (
                <ul>
                  {tracking.map((m) => (
                    <li key={m.id}>
                      <span className={"rvm-msg-estado " + m.estado}>{TXT_ESTADO_MSG[m.estado] ?? m.estado}</span>
                      <div className="rvm-msg-cuerpo">
                        <div className="rvm-msg-tit">{TXT_TIPO_MSG[m.tipo] ?? m.tipo} · {m.canal === "email" ? "Email" : m.canal === "sms" ? "SMS" : "WhatsApp"} → {m.destinatario}</div>
                        <div className="rvm-msg-det">
                          {m.enviado_en ? `Enviado ${fmtFechaHora(m.enviado_en)}` : m.estado === "pendiente" ? `Programado ${fmtFechaHora(m.programado_para)}` : `Creado ${fmtFechaHora(m.creado_en)}`}
                          {m.error ? ` · ${m.error}` : ""}
                        </div>
                        {m.asunto ? <div className="rvm-msg-asunto">{m.asunto}</div> : null}
                        {m.estado === "error" || m.estado === "sin_proveedor" || m.estado === "pendiente" ? (
                          <div className="rvm-msg-acciones">
                            {m.estado !== "pendiente" ? (
                              <button type="button" className="rvm-btn sec mini" onClick={() => accionMensaje(m.id, "reenviar")}>Reenviar</button>
                            ) : null}
                            <button type="button" className="rvm-btn sec mini" onClick={() => accionMensaje(m.id, "cancelar")}>{m.estado === "pendiente" ? "No enviar" : "Descartar"}</button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          ) : null}
        </div>

        {/* ---------- avisos ---------- */}
        {ficha?.lista_negra ? (
          <div className="rvm-aviso warn fijo" role="status">
            <span><b>Cliente en lista negra.</b> Revisa su ficha antes de confirmar la reserva.</span>
          </div>
        ) : null}
        {preguntarCerrar ? (
          <div className="rvm-aviso warn" role="alertdialog" aria-label="Cambios sin guardar">
            <span>Hay cambios sin guardar en la reserva.</span>
            <button type="button" className="rvm-btn sec mini" onClick={descartar}>Descartar</button>
            <button type="button" className="rvm-btn mini" autoFocus onClick={() => setPreguntarCerrar(false)}>Seguir editando</button>
          </div>
        ) : null}
        {error ? <div className="rvm-aviso err"><span>{error}</span><button type="button" className="rvm-x" onClick={() => setError("")} aria-label="Cerrar">×</button></div> : null}
        {aviso ? (
          <div className="rvm-aviso warn">
            <span>{aviso.texto}</span>
            <button type="button" className="rvm-btn sec mini" onClick={forzarYGuardar} disabled={guardando}>Guardar igualmente</button>
            <button type="button" className="rvm-x" onClick={() => setAviso(null)} aria-label="Cerrar">×</button>
          </div>
        ) : null}

        {/* ---------- pie ---------- */}
        <footer className="rvm-pie">
          <div className="rvm-notif">
            <label
              title={
                !rest.envio_sms
                  ? "El restaurante no tiene SMS activo"
                  : rest.envio_whatsapp
                    ? "El SMS sale solo como respaldo si falla WhatsApp"
                    : !ficha?.telefono
                      ? "El cliente no tiene teléfono"
                      : ""
              }
            >
              <input type="checkbox" checked={notif.sms && !rest.envio_whatsapp} disabled={!rest.envio_sms || rest.envio_whatsapp || !ficha?.telefono} onChange={(e) => setNotif({ ...notif, sms: e.target.checked })} /> SMS
            </label>
            <label title={!rest.envio_email ? "El restaurante no tiene email activo" : !ficha?.email ? "El cliente no tiene email" : ""}>
              <input type="checkbox" checked={notif.email} disabled={!rest.envio_email || !ficha?.email} onChange={(e) => setNotif({ ...notif, email: e.target.checked })} /> Email
            </label>
            <label title={!rest.envio_whatsapp ? "El restaurante no tiene WhatsApp activo" : !ficha?.telefono ? "El cliente no tiene teléfono" : ""}>
              <input type="checkbox" checked={notif.whatsapp} disabled={!rest.envio_whatsapp || !ficha?.telefono} onChange={(e) => setNotif({ ...notif, whatsapp: e.target.checked })} /> WhatsApp
            </label>
          </div>
          <div className="rvm-pie-btns">
            {esEdicion ? (
              <button type="button" className="rvm-btn sec" onClick={() => { setVerTracking((v) => !v); if (!tracking && reservaId) api.trackingMensajes(reservaId).then(setTracking); }}>
                Ver tracking{tracking?.length ? ` (${tracking.length})` : ""}
              </button>
            ) : null}
            {guardadoCon && !enlaceTarjeta ? (
              <button type="button" className="rvm-btn sec" onClick={pedirCerrar} title="La reserva ya está guardada">Cerrar</button>
            ) : null}
            {enlaceTarjeta && reservaId ? (
              <button type="button" className="rvm-btn" onClick={pedirCerrar}>Cerrar</button>
            ) : (
              <>
                <button type="button" className="rvm-btn sec" onClick={() => guardar(false)} disabled={guardando} title="Ctrl/Cmd + Enter">{guardando ? "Guardando…" : "Guardar"}</button>
                <button type="button" className="rvm-btn" onClick={() => guardar(true)} disabled={guardando || !algunCanal} title={!algunCanal ? "Marca al menos un canal con el que avisar al cliente" : ""}>
                  {guardando ? "Guardando…" : "Guardar y notificar"}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

const TXT_ESTADO_MSG: Record<string, string> = {
  pendiente: "En cola", enviado: "Enviado", entregado: "Entregado", abierto: "Abierto", error: "Error", sin_proveedor: "Sin proveedor", cancelado: "Cancelado",
};
const TXT_TIPO_MSG: Record<string, string> = {
  confirmacion: "Recibida", confirmada: "Confirmación", recordatorio: "Recordatorio", reconfirmacion: "Reconfirmación", cancelacion: "Cancelación", modificacion: "Modificación",
  lista_espera: "Lista de espera", valoracion: "Valoración", pago: "Pago", garantia: "Garantía", noshow: "No-show", invitacion: "Invitación", manual: "Manual",
};
function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${fmtFC(d.toLocaleDateString("sv-SE"))} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
