"use client";

/* Ficha de un pedido (constructor C). PanelPedidos la pinta encima de la pestaña.
   - Borrador: proveedor, fecha y notas; líneas editables (−/+, unidad, nota, cambiar producto,
     quitar, añadir con el buscador); envío según el canal del proveedor (email, WhatsApp,
     teléfono o web) con vista previa del texto; borrar borrador.
   - Enviado en adelante: confirmado / recibido en parte / recibido, cancelar, documentos
     (albarán y factura con sugerencias), «Cotejar» y la tabla de cotejo con «sustituido».
   Contrato: docs/pedidos-contratos.md §5 (C). Usa acciones de A (borradores, envío) por su firma. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cambiarEstadoSeguimiento,
  cargarPedido,
  cotejar,
  marcarSustituido,
  sugerirDocumentos,
  vincularDocumento,
} from "../acciones/seguimiento";
import {
  actualizarBorrador,
  actualizarLinea,
  anadirLinea,
  borrarBorrador,
  cargarCatalogo,
  quitarLinea,
} from "../acciones/borradores";
import { cancelarPedido, enviarPorEmail, marcarEnviado, prepararEnvio } from "../acciones/envio";
import BuscadorProducto from "../componentes/BuscadorProducto";
import TablaCotejo from "../componentes/TablaCotejo";
import {
  enlaceMailto,
  enlaceTelefono,
  enlaceWhatsApp,
  esEmail,
  fechaEntregaPorDefecto,
  formatoCantidad,
  formatoEuros,
  formatoFecha,
  formatoFechaLarga,
  formatoFechaRelativa,
  formatoMomento,
  formatoNumero,
  lineaAGuardar,
  lineaDesdeProducto,
  nivelConfianza,
  normalizarUnidad,
  nombreUnidad,
  parsearNumero,
  redondear,
  textoDiasReparto,
  totalEstimado,
} from "../lib-pedidos";
import {
  CANALES_PEDIDO,
  CANAL_TXT,
  ESTADO_COTEJO_PEDIDO_TXT,
  ESTADO_PEDIDO_TXT,
  ESTADOS_ENVIADOS,
  IDIOMA_TXT,
  UNIDADES,
} from "../tipos";
import type {
  AlternativaEnvio,
  CambiosBorrador,
  CambiosLinea,
  CanalPedido,
  DocumentoResumen,
  EstadoSeguimiento,
  LineaPedido,
  PedidoCompleto,
  ProductoCatalogo,
  PropsSecFicha,
  SugerenciaDocumento,
  VistaEnvio,
} from "../tipos";
import "./ficha.css";

const ORIGEN_TXT: Record<string, string> = {
  voz: "dictado",
  texto: "escrito",
  catalogo: "por catálogo",
  mixto: "dictado y catálogo",
};

const ESTADOS_SEGUIMIENTO: { id: EstadoSeguimiento; txt: string }[] = [
  { id: "confirmado", txt: "Confirmado" },
  { id: "recibido_parcial", txt: "Recibido en parte" },
  { id: "recibido", txt: "Recibido" },
];

const PAUSA_LINEA_MS = 700;
const PAUSA_ENVIO_MS = 900;

/** Nombre que se pinta para una línea guardada. */
const nombreLinea = (l: LineaPedido) => l.producto?.nombre ?? l.descripcion ?? l.texto_original ?? "(sin nombre)";

/** Paso de los botones −/+: 1; 0,5 en kg/caja cuando ya hay decimales. */
const pasoDe = (l: LineaPedido) =>
  ["kg", "caja"].includes(normalizarUnidad(l.unidad) ?? "") && !Number.isInteger(l.cantidad) ? 0.5 : 1;

const ERROR_RED = "No hay conexión con el servidor. Prueba otra vez.";

export default function SecFicha({ ctx, proveedores, pedidoId, avisar, cerrar, alCambiar }: PropsSecFicha) {
  const [pedido, setPedido] = useState<PedidoCompleto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const ocupadoRef = useRef<string | null>(null);

  // envío (solo borrador)
  const [envio, setEnvio] = useState<VistaEnvio | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [canalElegido, setCanalElegido] = useState<CanalPedido | null>(null);
  const [emailPara, setEmailPara] = useState("");
  const [alternativa, setAlternativa] = useState<AlternativaEnvio | null>(null);
  const [abiertoFuera, setAbiertoFuera] = useState<CanalPedido | null>(null);
  /** El correo salió pero el pedido no quedó marcado: solo falta «Ya lo he enviado» (no reenviar). */
  const [correoSalido, setCorreoSalido] = useState(false);

  // edición de borrador
  const [buscador, setBuscador] = useState<null | { modo: "anadir" } | { modo: "cambiar"; lineaId: string }>(null);
  const [catalogo, setCatalogo] = useState<ProductoCatalogo[] | null>(null);
  const [notas, setNotas] = useState("");
  const [fecha, setFecha] = useState("");
  const [notaAbierta, setNotaAbierta] = useState<Record<string, boolean>>({});

  // seguimiento
  const [sugerencias, setSugerencias] = useState<SugerenciaDocumento[] | null>(null);
  const [confirmar, setConfirmar] = useState<"borrar" | "cancelar" | null>(null);

  const peticion = useRef(0);
  const pendientes = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; cambios: CambiosLinea }>());
  const timerEnvio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peticionEnvio = useRef(0);

  /* El texto del envío (WhatsApp, copiar, leer por teléfono) lo compone el servidor: tras cualquier
     cambio va por detrás hasta que se guarda todo y se vuelve a pedir. Mientras tanto
     («previa vieja») no se deja abrir WhatsApp ni el correo, copiar ni leer el texto: el proveedor
     recibiría cantidades viejas y el pedido guardado diría otras. */
  const [previaVieja, setPreviaVieja] = useState(false);
  const previaViejaRef = useRef(false);
  /** Cambios mandados al servidor que aún no han vuelto. */
  const cambiosEnVuelo = useRef(0);
  /** Cuenta de cambios que ya han vuelto: una vista previa pedida antes de alguno está vieja. */
  const cambiosHechos = useRef(0);
  /** Guardado de las notas en curso (el envío lo espera). */
  const notasGuardando = useRef<Promise<void> | null>(null);

  const marcarVieja = useCallback(() => {
    previaViejaRef.current = true;
    setPreviaVieja(true);
  }, []);

  /* ─── carga ─── */

  const refrescarEnvio = useCallback(async () => {
    const n = ++peticionEnvio.current;
    const marca = cambiosHechos.current;
    try {
      const r = await prepararEnvio(pedidoId);
      if (n !== peticionEnvio.current) return;
      if (r.ok) {
        setEnvio(r.envio);
        setErrorEnvio(null);
        // Al día solo si se pidió después del último cambio y no queda nada por guardar ni por refrescar.
        if (
          marca === cambiosHechos.current &&
          cambiosEnVuelo.current === 0 &&
          pendientes.current.size === 0 &&
          !timerEnvio.current &&
          !notasGuardando.current
        ) {
          previaViejaRef.current = false;
          setPreviaVieja(false);
        }
      } else {
        setEnvio(null);
        setErrorEnvio(r.error);
      }
    } catch {
      if (n === peticionEnvio.current) {
        // Sin red: nada de enseñar (ni mandar) el texto viejo.
        setEnvio(null);
        setErrorEnvio(ERROR_RED);
      }
    }
  }, [pedidoId]);

  const programarEnvio = useCallback(() => {
    marcarVieja();
    if (timerEnvio.current) clearTimeout(timerEnvio.current);
    timerEnvio.current = setTimeout(() => {
      timerEnvio.current = null;
      void refrescarEnvio();
    }, PAUSA_ENVIO_MS);
  }, [marcarVieja, refrescarEnvio]);

  /** Envuelve una escritura del borrador: la vista previa queda vieja hasta que se vuelva a pedir. */
  const conCambio = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      marcarVieja();
      cambiosEnVuelo.current += 1;
      try {
        return await fn();
      } catch (e) {
        programarEnvio();
        throw e;
      } finally {
        cambiosEnVuelo.current -= 1;
        cambiosHechos.current += 1;
      }
    },
    [marcarVieja, programarEnvio],
  );

  const cargar = useCallback(
    async (silencioso = false) => {
      const n = ++peticion.current;
      if (!silencioso) setCargando(true);
      try {
        const r = await cargarPedido(pedidoId);
        if (n !== peticion.current) return;
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        setPedido(r.pedido);
        setNotas(r.pedido.notas ?? "");
        setFecha(r.pedido.fecha_entrega ?? "");
        if (r.pedido.estado === "borrador") void refrescarEnvio();
        else setEnvio(null);
      } catch {
        if (n === peticion.current) setError(ERROR_RED);
      } finally {
        if (n === peticion.current) setCargando(false);
      }
    },
    [pedidoId, refrescarEnvio],
  );

  useEffect(() => {
    setPedido(null);
    setEnvio(null);
    setErrorEnvio(null);
    setCanalElegido(null);
    setAlternativa(null);
    setAbiertoFuera(null);
    setCorreoSalido(false);
    setBuscador(null);
    setCatalogo(null);
    setSugerencias(null);
    setConfirmar(null);
    void cargar();
  }, [cargar]);

  // Al salir: lo que quede pendiente de guardar se manda igualmente.
  useEffect(() => {
    const mapa = pendientes.current;
    return () => {
      if (timerEnvio.current) clearTimeout(timerEnvio.current);
      for (const [id, p] of mapa) {
        clearTimeout(p.timer);
        void actualizarLinea(id, p.cambios).catch(() => undefined);
      }
      mapa.clear();
    };
  }, []);

  /** Ejecuta una acción con el indicador de «ocupado» y sin dejar que una excepción de red rompa la UI. */
  const hacer = useCallback(
    async <T,>(clave: string, fn: () => Promise<T>): Promise<T | null> => {
      if (ocupadoRef.current) return null;
      ocupadoRef.current = clave;
      setOcupado(clave);
      try {
        return await fn();
      } catch {
        avisar(ERROR_RED, "error");
        return null;
      } finally {
        ocupadoRef.current = null;
        setOcupado(null);
      }
    },
    [avisar],
  );

  /* ─── líneas del borrador ─── */

  const guardarLinea = useCallback(
    async (lineaId: string) => {
      const p = pendientes.current.get(lineaId);
      if (!p) return;
      clearTimeout(p.timer);
      pendientes.current.delete(lineaId);
      try {
        const r = await conCambio(() => actualizarLinea(lineaId, p.cambios));
        if (!r.ok) {
          avisar(r.error, "error");
          void cargar(true);
          return;
        }
        if (!pendientes.current.has(lineaId)) {
          setPedido((ped) => (ped ? { ...ped, lineas: ped.lineas.map((l) => (l.id === lineaId ? r.linea : l)) } : ped));
        }
        alCambiar();
        programarEnvio();
      } catch {
        avisar(ERROR_RED, "error");
        void cargar(true);
      }
    },
    [alCambiar, avisar, cargar, conCambio, programarEnvio],
  );

  const vaciarPendientes = useCallback(async () => {
    await Promise.all([...pendientes.current.keys()].map((id) => guardarLinea(id)));
    if (notasGuardando.current) await notasGuardando.current;
  }, [guardarLinea]);

  /** Cambio de cantidad / unidad / nota: se ve al momento y se guarda tras una pausa corta. */
  const editarLinea = (lineaId: string, cambios: CambiosLinea, inmediato = false) => {
    marcarVieja();
    setPedido((ped) =>
      ped
        ? {
            ...ped,
            lineas: ped.lineas.map((l) =>
              l.id === lineaId
                ? {
                    ...l,
                    ...(cambios.cantidad !== undefined ? { cantidad: cambios.cantidad } : {}),
                    ...(cambios.unidad !== undefined ? { unidad: cambios.unidad } : {}),
                    ...(cambios.nota !== undefined ? { nota: cambios.nota } : {}),
                  }
                : l,
            ),
          }
        : ped,
    );
    const prev = pendientes.current.get(lineaId);
    if (prev) clearTimeout(prev.timer);
    const acumulado = { ...(prev?.cambios ?? {}), ...cambios };
    const timer = setTimeout(() => void guardarLinea(lineaId), inmediato ? 0 : PAUSA_LINEA_MS);
    pendientes.current.set(lineaId, { timer, cambios: acumulado });
  };

  const quitar = async (l: LineaPedido) => {
    const p = pendientes.current.get(l.id);
    if (p) {
      clearTimeout(p.timer);
      pendientes.current.delete(l.id);
    }
    const r = await hacer(`quitar-${l.id}`, () => conCambio(() => quitarLinea(l.id)));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      return;
    }
    setPedido((ped) => (ped ? { ...ped, lineas: ped.lineas.filter((x) => x.id !== l.id) } : ped));
    avisar("Línea quitada");
    alCambiar();
    programarEnvio();
  };

  const abrirBuscador = async (modo: { modo: "anadir" } | { modo: "cambiar"; lineaId: string }) => {
    setBuscador(modo);
    if (catalogo !== null || !pedido) return;
    try {
      const r = await cargarCatalogo({ centro_id: pedido.centro_id, proveedor_id: pedido.proveedor_id });
      setCatalogo(r.ok ? r.productos : []);
    } catch {
      setCatalogo([]);
    }
  };

  const elegirProducto = async (p: ProductoCatalogo) => {
    if (!pedido || !buscador) return;
    if (buscador.modo === "anadir") {
      const r = await hacer("anadir", () => conCambio(() => anadirLinea(pedido.id, lineaAGuardar(lineaDesdeProducto(p)))));
      if (!r) return;
      if (!r.ok) {
        avisar(r.error, "error");
        return;
      }
      avisar(r.fusionada ? "Sumado a la línea que ya había" : "Producto añadido");
    } else {
      const lineaId = buscador.lineaId;
      await vaciarPendientes();
      const r = await hacer(`cambiar-${lineaId}`, () => conCambio(() => actualizarLinea(lineaId, { producto_id: p.producto_id })));
      if (!r) return;
      if (!r.ok) {
        avisar(r.error, "error");
        return;
      }
      avisar("Producto cambiado");
    }
    setBuscador(null);
    if (pedido.proveedor_id !== p.proveedor_id) setCatalogo(null);
    alCambiar();
    await cargar(true);
  };

  /* ─── cabecera del borrador ─── */

  const guardarCabecera = async (cambios: CambiosBorrador, ok?: string) => {
    if (!pedido) return;
    const r = await hacer("cabecera", () => conCambio(() => actualizarBorrador(pedido.id, cambios)));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      void cargar(true);
      return;
    }
    if (ok) avisar(ok);
    if (cambios.proveedor_id !== undefined) setCatalogo(null);
    alCambiar();
    await cargar(true);
  };

  /** Notas para el proveedor: se guardan al salir del campo SIN bloquear los botones (si no, el
      primer toque en «Enviar…» tras escribir se perdía); el envío espera a que terminen. */
  const guardarNotas = async () => {
    if (!pedido) return;
    const v = notas.trim() || null;
    if (v === ((pedido.notas ?? "").trim() || null)) return;
    const id = pedido.id;
    const antes = pedido.notas ?? "";
    const tarea = (async () => {
      try {
        const r = await conCambio(() => actualizarBorrador(id, { notas: v }));
        if (!r.ok) {
          avisar(r.error, "error");
          setNotas(antes);
          void cargar(true);
          return;
        }
        setPedido((ped) => (ped ? { ...ped, notas: v } : ped));
        avisar("Notas guardadas");
        alCambiar();
        programarEnvio();
      } catch {
        avisar(ERROR_RED, "error");
      }
    })();
    notasGuardando.current = tarea;
    try {
      await tarea;
    } finally {
      if (notasGuardando.current === tarea) notasGuardando.current = null;
    }
  };

  /* ─── envío ─── */

  /** Abrir WhatsApp / el correo con un texto que va por detrás de lo que se ve: se frena. */
  const frenarSiVieja = (e: React.MouseEvent) => {
    if (!previaViejaRef.current) return false;
    e.preventDefault();
    avisar("Un momento: se está actualizando el texto del pedido");
    return true;
  };

  const copiar = async (texto: string) => {
    if (previaViejaRef.current) {
      avisar("Un momento: se está actualizando el texto del pedido");
      return;
    }
    try {
      await navigator.clipboard.writeText(texto);
      avisar("Texto copiado");
    } catch {
      avisar("No se ha podido copiar: selecciona el texto y cópialo a mano", "error");
    }
  };

  const trasEnviar = async (mensaje: string) => {
    avisar(mensaje);
    setAlternativa(null);
    setAbiertoFuera(null);
    setCorreoSalido(false);
    alCambiar();
    await cargar(true);
  };

  const enviarEmail = async () => {
    if (!pedido || correoSalido) return;
    // Otra dirección solo si el servidor lo permite (quien gestiona, o proveedor sin email).
    const para = envio?.email_editable ? emailPara.trim() : "";
    if (para && !esEmail(para)) {
      avisar("El email no parece válido", "error");
      return;
    }
    if (!para && !pedido.proveedor?.pedido_email) {
      avisar("Escribe el email del proveedor", "error");
      return;
    }
    await vaciarPendientes();
    const r = await hacer("email", () => enviarPorEmail(pedido.id, para ? { para } : undefined));
    if (!r) return;
    if (r.ok) {
      await trasEnviar("Pedido enviado por email");
      return;
    }
    avisar(r.error, "error");
    if ("ya_enviado" in r && r.ya_enviado) {
      setAlternativa(null);
      setCorreoSalido(true);
      return;
    }
    if ("alternativa" in r && r.alternativa) setAlternativa(r.alternativa);
  };

  const marcar = async (canal: CanalPedido) => {
    if (!pedido) return;
    await vaciarPendientes();
    const r = await hacer(`marcar-${canal}`, () => marcarEnviado(pedido.id, canal));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      return;
    }
    await trasEnviar("Pedido marcado como enviado");
  };

  const borrar = async () => {
    if (!pedido) return;
    const r = await hacer("borrar", () => borrarBorrador(pedido.id));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      return;
    }
    for (const p of pendientes.current.values()) clearTimeout(p.timer);
    pendientes.current.clear();
    avisar("Borrador borrado");
    alCambiar();
    cerrar();
  };

  /* ─── seguimiento ─── */

  const cambiarEstado = async (estado: EstadoSeguimiento) => {
    if (!pedido) return;
    const r = await hacer(`estado-${estado}`, () => cambiarEstadoSeguimiento(pedido.id, estado));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      return;
    }
    avisar(`Marcado como «${ESTADO_PEDIDO_TXT[estado]}»`);
    alCambiar();
    await cargar(true);
  };

  const cancelar = async () => {
    if (!pedido) return;
    const r = await hacer("cancelar", () => cancelarPedido(pedido.id));
    if (!r) return;
    setConfirmar(null);
    if (!r.ok) {
      avisar(r.error, "error");
      return;
    }
    avisar("Pedido cancelado");
    alCambiar();
    await cargar(true);
  };

  const buscarDocumentos = async () => {
    if (!pedido) return;
    const r = await hacer("sugerir", () => sugerirDocumentos(pedido.id));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      return;
    }
    setSugerencias(r.sugerencias);
  };

  const vincular = async (tipo: "albaran" | "factura", docId: string | null) => {
    if (!pedido) return;
    const r = await hacer(`vincular-${tipo}-${docId ?? "quitar"}`, () => vincularDocumento(pedido.id, tipo, docId));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      await cargar(true);
      return;
    }
    const que = tipo === "albaran" ? "Albarán" : "Factura";
    avisar(
      docId
        ? `${que} ${tipo === "albaran" ? "vinculado" : "vinculada"} · ${ESTADO_COTEJO_PEDIDO_TXT[r.cotejo_estado]}`
        : `${que} ${tipo === "albaran" ? "quitado" : "quitada"}`,
    );
    setSugerencias(null);
    alCambiar();
    await cargar(true);
  };

  const hacerCotejo = async () => {
    if (!pedido) return;
    const r = await hacer("cotejar", () => cotejar(pedido.id));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      return;
    }
    avisar(ESTADO_COTEJO_PEDIDO_TXT[r.cotejo_estado]);
    alCambiar();
    await cargar(true);
  };

  const sustituido = async (lineaId: string, valor: boolean) => {
    const r = await hacer(`sust-${lineaId}`, () => marcarSustituido(lineaId, valor));
    if (!r) return;
    if (!r.ok) {
      avisar(r.error, "error");
      await cargar(true);
      return;
    }
    avisar(valor ? "Marcado como sustituido" : "Marca quitada");
    alCambiar();
    await cargar(true);
  };

  /* ─── derivados ─── */

  const proveedor = pedido?.proveedor ?? null;
  const total = useMemo(() => (pedido ? totalEstimado(pedido.lineas) : null), [pedido]);
  const opcionesProveedor = useMemo(() => {
    const l = [...proveedores];
    if (proveedor && !l.some((p) => p.id === proveedor.id)) l.push(proveedor);
    return l.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [proveedores, proveedor]);

  // El email del proveedor rellena el campo al cargar (se puede cambiar para este envío).
  useEffect(() => {
    setEmailPara(proveedor?.pedido_email ?? "");
  }, [proveedor?.pedido_email]);

  /* ─── pintar ─── */

  if (cargando && !pedido) {
    return (
      <section className="pedf">
        <BarraVolver cerrar={cerrar} />
        <div className="ped-vacio pedf-vacio">Cargando pedido…</div>
      </section>
    );
  }
  if (!pedido) {
    return (
      <section className="pedf">
        <BarraVolver cerrar={cerrar} />
        <div className="aviso-error">{error ?? "No se ha encontrado el pedido"}</div>
        <button type="button" className="boton-secundario pedf-btn-sec" onClick={() => void cargar()}>
          Reintentar
        </button>
      </section>
    );
  }

  const esBorrador = pedido.estado === "borrador";
  const enviado = ESTADOS_ENVIADOS.includes(pedido.estado);
  const cancelado = pedido.estado === "cancelado";
  const canal: CanalPedido = canalElegido ?? envio?.canal ?? proveedor?.pedido_canal ?? "email";
  const textoEnvio = envio?.texto ?? "";
  const avisosEnvio = envio ? [...envio.avisos, ...(envio.avisos_canal?.[canal] ?? [])] : [];
  const hayDocs = !!(pedido.albaran_doc_id || pedido.factura_doc_id);
  const cotejoConLineas = !!pedido.cotejo && ((pedido.cotejo.lineas?.length ?? 0) > 0 || !!pedido.cotejo.motivo);

  return (
    <section className="pedf">
      <BarraVolver cerrar={cerrar} />

      {/* ── Cabecera ── */}
      <header className="pedf-cabecera">
        <div className="pedf-cab-arriba">
          <span className="pedf-numero">{pedido.numero}</span>
          <span className={`ped-chip ped-chip--${pedido.estado}`}>{ESTADO_PEDIDO_TXT[pedido.estado]}</span>
          {enviado ? (
            <span className={`ped-chip ped-chip--cotejo-${pedido.cotejo_estado}`}>{ESTADO_COTEJO_PEDIDO_TXT[pedido.cotejo_estado]}</span>
          ) : null}
        </div>
        <h2 className="pedf-proveedor">{pedido.proveedor_nombre ?? "Sin proveedor"}</h2>
        <p className="pedf-cab-meta">
          <span>{pedido.centro.nombre}</span>
          <span>Entrega: {pedido.fecha_entrega ? formatoFechaLarga(pedido.fecha_entrega) : "sin fecha"}</span>
          <span className="pedf-total">{total != null ? formatoEuros(total) : "Sin precio"}</span>
        </p>
        <p className="pedf-cab-sub">
          {enviado || pedido.enviado_en
            ? `Enviado ${formatoMomento(pedido.enviado_en, ctx.hoy)}${pedido.canal_envio ? ` por ${CANAL_TXT[pedido.canal_envio]}` : ""}`
            : `Creado ${formatoMomento(pedido.creado_en, ctx.hoy)}`}
          {ORIGEN_TXT[pedido.origen] ? ` · ${ORIGEN_TXT[pedido.origen]}` : ""}
        </p>
        {pedido.transcripcion ? (
          <details className="pedf-dictado">
            <summary>Lo que se {pedido.origen === "voz" ? "dictó" : "escribió"}{pedido.idioma ? ` (${IDIOMA_TXT[pedido.idioma]})` : ""}</summary>
            <p>{pedido.transcripcion}</p>
          </details>
        ) : null}
      </header>

      {cancelado ? <div className="pedf-banda pedf-banda--gris">Pedido cancelado</div> : null}

      {/* ── Borrador: datos del pedido ── */}
      {esBorrador ? (
        <div className="pedf-bloque">
          <h3 className="pedf-h3">Datos del pedido</h3>
          <div className="pedf-campos">
            <label className="pedf-campo">
              <span>Proveedor</span>
              <select
                value={pedido.proveedor_id ?? ""}
                disabled={!!ocupado}
                onChange={(e) => void guardarCabecera({ proveedor_id: e.target.value || null }, "Proveedor cambiado")}
              >
                <option value="">— Elige el proveedor —</option>
                {opcionesProveedor.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="pedf-campo">
              <span>Fecha de entrega</span>
              <input
                type="date"
                min={ctx.hoy}
                value={fecha}
                disabled={!!ocupado}
                onChange={(e) => {
                  // Se guarda al elegir una fecha completa y válida (al teclear el año en un
                  // ordenador pasan fechas a medias como «0002-10-07»: esas no se mandan).
                  const v = e.target.value;
                  setFecha(v);
                  if (v === (pedido.fecha_entrega ?? "")) return;
                  if (!v) void guardarCabecera({ fecha_entrega: null });
                  else if (v >= ctx.hoy && v.slice(0, 4) >= "2000") void guardarCabecera({ fecha_entrega: v });
                }}
                onBlur={() => {
                  if (fecha && fecha !== (pedido.fecha_entrega ?? "") && fecha < ctx.hoy) {
                    avisar("La fecha de entrega ya ha pasado", "error");
                    setFecha(pedido.fecha_entrega ?? "");
                  }
                }}
              />
              {proveedor ? (
                <small className="pedf-ayuda">
                  Reparte: {textoDiasReparto(proveedor.pedido_dias_reparto)}
                  {proveedor.pedido_hora_corte ? ` · pedir antes de las ${proveedor.pedido_hora_corte.slice(0, 5)}` : ""}
                  {(() => {
                    const sig = fechaEntregaPorDefecto(proveedor);
                    return sig !== pedido.fecha_entrega ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="pedf-enlace"
                          disabled={!!ocupado}
                          onClick={() => void guardarCabecera({ fecha_entrega: sig })}
                        >
                          Usar {formatoFechaRelativa(sig, ctx.hoy).toLowerCase()}
                        </button>
                      </>
                    ) : null;
                  })()}
                </small>
              ) : null}
            </label>
            <label className="pedf-campo pedf-campo--ancho">
              <span>Notas para el proveedor</span>
              <textarea
                rows={2}
                value={notas}
                maxLength={1000}
                placeholder="Opcional"
                onChange={(e) => setNotas(e.target.value)}
                onBlur={() => void guardarNotas()}
              />
            </label>
          </div>
        </div>
      ) : null}

      {/* ── Líneas ── */}
      {esBorrador ? (
        <div className="pedf-bloque">
          <div className="pedf-h3-fila">
            <h3 className="pedf-h3">
              Productos <span className="pedf-h3-n">{pedido.lineas.length}</span>
            </h3>
          </div>
          {pedido.lineas.length === 0 ? <p className="pedf-nada">El pedido no tiene productos. Añade alguno.</p> : null}
          <ul className="pedf-lineas">
            {pedido.lineas.map((l) => {
              const paso = pasoDe(l);
              const unidadCanon = normalizarUnidad(l.unidad);
              const unidades: string[] = [...UNIDADES];
              if (unidadCanon && !unidades.includes(unidadCanon)) unidades.push(unidadCanon);
              const conf = nivelConfianza(l.confianza);
              const sinProducto = !l.producto;
              const verNota = notaAbierta[l.id] || !!l.nota;
              return (
                <li key={l.id} className={`pedf-linea${sinProducto ? " pedf-linea--sin" : ""}`}>
                  <div className="pedf-linea-cabeza">
                    <div className="pedf-linea-nombre">
                      <span className="pedf-nombre">{nombreLinea(l)}</span>
                      <span className="pedf-linea-datos">
                        {sinProducto ? <span className="pedf-sin-id">Sin identificar</span> : null}
                        {l.producto?.ref_proveedor ? <span className="pedf-ref">{l.producto.ref_proveedor}</span> : null}
                        {l.producto?.formato ? <span>{l.producto.formato}</span> : null}
                        {conf && conf !== "alta" ? (
                          <span className={`ped-confianza--${conf} pedf-conf`}>{conf === "media" ? "Revisar" : "Dudoso"}</span>
                        ) : null}
                      </span>
                      {l.texto_original && l.texto_original !== nombreLinea(l) ? (
                        <span className="pedf-dicho">«{l.texto_original}»</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="pedf-quitar"
                      aria-label={`Quitar ${nombreLinea(l)}`}
                      disabled={!!ocupado}
                      onClick={() => void quitar(l)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="pedf-linea-controles">
                    <div className="pedf-cantidad">
                      <button
                        type="button"
                        aria-label="Menos"
                        disabled={redondear(l.cantidad - paso) <= 0}
                        onClick={() => editarLinea(l.id, { cantidad: redondear(l.cantidad - paso) })}
                      >
                        −
                      </button>
                      <input
                        key={`${l.id}-${l.cantidad}`}
                        inputMode="decimal"
                        aria-label="Cantidad"
                        defaultValue={formatoNumero(l.cantidad)}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => {
                          const v = parsearNumero(e.currentTarget.value);
                          if (v != null && v > 0 && v <= 100000) {
                            if (redondear(v) !== l.cantidad) editarLinea(l.id, { cantidad: redondear(v) }, true);
                          } else {
                            e.currentTarget.value = formatoNumero(l.cantidad);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <button
                        type="button"
                        aria-label="Más"
                        onClick={() => editarLinea(l.id, { cantidad: redondear(l.cantidad + paso) })}
                      >
                        +
                      </button>
                    </div>
                    <select
                      className="pedf-unidad"
                      aria-label="Unidad"
                      value={unidadCanon ?? ""}
                      onChange={(e) => editarLinea(l.id, { unidad: e.target.value || null }, true)}
                    >
                      <option value="">—</option>
                      {unidades.map((u) => (
                        <option key={u} value={u}>
                          {nombreUnidad(u, l.cantidad) || u}
                        </option>
                      ))}
                    </select>
                    <span className="pedf-linea-precio">
                      {l.precio_estimado != null ? formatoEuros(redondear(l.cantidad * l.precio_estimado, 2)) : "Sin precio"}
                    </span>
                  </div>
                  <div className="pedf-linea-acciones">
                    <button
                      type="button"
                      className="pedf-enlace"
                      disabled={!!ocupado}
                      onClick={() => void abrirBuscador({ modo: "cambiar", lineaId: l.id })}
                    >
                      {sinProducto ? "Elegir producto" : "Cambiar producto"}
                    </button>
                    {!verNota ? (
                      <button type="button" className="pedf-enlace" onClick={() => setNotaAbierta((m) => ({ ...m, [l.id]: true }))}>
                        Añadir nota
                      </button>
                    ) : null}
                  </div>
                  {verNota ? (
                    <input
                      className="pedf-nota-input"
                      key={`${l.id}-nota-${l.nota ?? ""}`}
                      defaultValue={l.nota ?? ""}
                      maxLength={300}
                      placeholder="Nota para el proveedor (p. ej. «bien maduros»)"
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim() || null;
                        if (v !== (l.nota ?? null)) editarLinea(l.id, { nota: v }, true);
                      }}
                    />
                  ) : null}
                  {buscador?.modo === "cambiar" && buscador.lineaId === l.id ? (
                    <div className="pedf-buscador">
                      <BuscadorProducto
                        centroId={pedido.centro_id}
                        proveedorId={pedido.proveedor_id}
                        catalogo={catalogo ?? undefined}
                        onElegir={(p) => void elegirProducto(p)}
                        onCerrar={() => setBuscador(null)}
                        placeholder={sinProducto ? `¿Qué es «${nombreLinea(l)}»?` : "Busca el producto correcto"}
                        autoFocus
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {buscador?.modo === "anadir" ? (
            <div className="pedf-buscador">
              <BuscadorProducto
                centroId={pedido.centro_id}
                proveedorId={pedido.proveedor_id}
                catalogo={catalogo ?? undefined}
                onElegir={(p) => void elegirProducto(p)}
                onCerrar={() => setBuscador(null)}
                placeholder="Busca un producto para añadir"
                autoFocus
              />
            </div>
          ) : (
            <button
              type="button"
              className="boton-secundario pedf-btn-sec pedf-anadir"
              disabled={!!ocupado}
              onClick={() => void abrirBuscador({ modo: "anadir" })}
            >
              + Añadir producto
            </button>
          )}
        </div>
      ) : null}

      {/* ── Borrador: envío ── */}
      {esBorrador ? (
        <div className="pedf-bloque pedf-envio">
          <h3 className="pedf-h3">Enviar al proveedor</h3>
          {errorEnvio && !envio ? (
            <div className="aviso-error">
              {errorEnvio}{" "}
              <button type="button" className="pedf-enlace" onClick={() => void refrescarEnvio()}>
                Reintentar
              </button>
            </div>
          ) : null}
          {envio ? (
            <>
              {avisosEnvio.length ? (
                <ul className="pedf-avisos">
                  {avisosEnvio.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : null}
              {!envio.puede_enviar ? (
                <div className="pedf-banda pedf-banda--ambar">{envio.motivo_bloqueo ?? "Todavía no se puede enviar"}</div>
              ) : (
                <>
                  <div className="pedf-canales" role="tablist" aria-label="Cómo se envía">
                    {CANALES_PEDIDO.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="tab"
                        aria-selected={canal === c}
                        className={`pedf-canal${canal === c ? " pedf-canal--activo" : ""}`}
                        onClick={() => {
                          setCanalElegido(c);
                          setAlternativa(null);
                        }}
                      >
                        {CANAL_TXT[c]}
                        {proveedor?.pedido_canal === c ? <small> habitual</small> : null}
                      </button>
                    ))}
                  </div>

                  {canal === "email" ? (
                    <div className="pedf-canal-cuerpo">
                      {envio.email_editable ? (
                        <label className="pedf-campo">
                          <span>Se envía a</span>
                          <input
                            type="email"
                            inputMode="email"
                            autoComplete="off"
                            placeholder="email del proveedor"
                            value={emailPara}
                            onChange={(e) => setEmailPara(e.target.value)}
                          />
                        </label>
                      ) : (
                        <p className="pedf-ayuda">
                          Se envía a <b>{proveedor?.pedido_email}</b>
                        </p>
                      )}
                      {correoSalido ? (
                        <>
                          <div className="pedf-banda pedf-banda--ambar">
                            El correo ya ha salido. No lo reenvíes: pulsa «Ya lo he enviado».
                          </div>
                          <button
                            type="button"
                            className="pedf-accion pedf-accion--oscuro"
                            disabled={!!ocupado}
                            onClick={() => void marcar("email")}
                          >
                            Ya lo he enviado
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="pedf-accion pedf-accion--verde"
                          disabled={!!ocupado}
                          onClick={() => void enviarEmail()}
                        >
                          {ocupado === "email" ? "Enviando…" : "Enviar por email"}
                        </button>
                      )}
                      {!alternativa && !correoSalido && abiertoFuera === "email" ? (
                        <button
                          type="button"
                          className="pedf-accion pedf-accion--oscuro"
                          disabled={!!ocupado}
                          onClick={() => void marcar("email")}
                        >
                          Ya lo he enviado desde mi correo
                        </button>
                      ) : null}
                      {alternativa && !correoSalido ? (
                        <div className="pedf-alternativa">
                          <p>El correo no ha salido. Mándalo desde tu correo y después pulsa «Ya lo he enviado».</p>
                          <div className="pedf-botones">
                            {/* Texto vivo (el de la vista previa), no el del momento del fallo: si se
                                cambia algo después, sale lo nuevo. */}
                            <button
                              type="button"
                              className="boton-secundario pedf-btn-sec"
                              disabled={previaVieja}
                              onClick={() => void copiar(textoEnvio)}
                            >
                              {previaVieja ? "Actualizando…" : "Copiar texto"}
                            </button>
                            <a
                              className={`boton-secundario pedf-btn-sec${previaVieja ? " pedf-espera" : ""}`}
                              aria-disabled={previaVieja || undefined}
                              href={enlaceMailto(
                                alternativa.para || (envio.email_editable ? emailPara.trim() : "") || proveedor?.pedido_email,
                                envio.asunto,
                                textoEnvio,
                              )}
                              onClick={(e) => {
                                if (!frenarSiVieja(e)) setAbiertoFuera("email");
                              }}
                            >
                              Abrir en mi correo
                            </a>
                            <button
                              type="button"
                              className="pedf-accion pedf-accion--oscuro"
                              disabled={!!ocupado}
                              onClick={() => void marcar("email")}
                            >
                              Ya lo he enviado
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {canal === "whatsapp" ? (
                    <div className="pedf-canal-cuerpo">
                      <p className="pedf-ayuda">
                        {proveedor?.pedido_whatsapp
                          ? `Se abre WhatsApp con el pedido escrito para +${proveedor.pedido_whatsapp}. Envíalo desde tu móvil.`
                          : "No hay número de WhatsApp: WhatsApp te dejará elegir el chat."}
                      </p>
                      <a
                        className={`pedf-accion pedf-accion--verde${previaVieja ? " pedf-espera" : ""}`}
                        href={enlaceWhatsApp(proveedor?.pedido_whatsapp, textoEnvio)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={previaVieja || undefined}
                        onClick={(e) => {
                          if (!frenarSiVieja(e)) setAbiertoFuera("whatsapp");
                        }}
                      >
                        {previaVieja ? "Actualizando el texto…" : "Abrir WhatsApp"}
                      </a>
                      <button
                        type="button"
                        className={`pedf-accion ${abiertoFuera === "whatsapp" ? "pedf-accion--oscuro" : "pedf-accion--claro"}`}
                        disabled={!!ocupado}
                        onClick={() => void marcar("whatsapp")}
                      >
                        Ya lo he enviado
                      </button>
                    </div>
                  ) : null}

                  {canal === "telefono" ? (
                    <div className="pedf-canal-cuerpo">
                      {enlaceTelefono(proveedor?.pedido_telefono) ? (
                        <a
                          className="pedf-accion pedf-accion--verde"
                          href={enlaceTelefono(proveedor?.pedido_telefono)!}
                          onClick={() => setAbiertoFuera("telefono")}
                        >
                          Llamar al {proveedor?.pedido_telefono}
                        </a>
                      ) : (
                        <p className="pedf-ayuda">No hay teléfono guardado para este proveedor.</p>
                      )}
                      <p className="pedf-ayuda">{previaVieja ? "Actualizando el texto…" : "Lee esto al proveedor:"}</p>
                      <pre className={`pedf-texto${previaVieja ? " pedf-espera" : ""}`} aria-busy={previaVieja || undefined}>
                        {textoEnvio}
                      </pre>
                      <button type="button" className="pedf-accion pedf-accion--oscuro" disabled={!!ocupado} onClick={() => void marcar("telefono")}>
                        Hecho, ya lo he pedido
                      </button>
                    </div>
                  ) : null}

                  {canal === "portal" ? (
                    <div className="pedf-canal-cuerpo">
                      <p className="pedf-ayuda">Haz el pedido en la web del proveedor. Puedes copiar el texto para tenerlo a mano.</p>
                      <button
                        type="button"
                        className="boton-secundario pedf-btn-sec"
                        disabled={previaVieja}
                        onClick={() => void copiar(textoEnvio)}
                      >
                        {previaVieja ? "Actualizando…" : "Copiar texto"}
                      </button>
                      <button type="button" className="pedf-accion pedf-accion--oscuro" disabled={!!ocupado} onClick={() => void marcar("portal")}>
                        Hecho, ya lo he pedido
                      </button>
                    </div>
                  ) : null}

                  {canal !== "telefono" ? (
                    <details className="pedf-previa">
                      <summary>Ver el texto del pedido</summary>
                      <p className="pedf-asunto">
                        <b>Asunto:</b> {envio.asunto}
                      </p>
                      <pre className={`pedf-texto${previaVieja ? " pedf-espera" : ""}`} aria-busy={previaVieja || undefined}>
                        {textoEnvio}
                      </pre>
                      <div className="pedf-botones">
                        <button
                          type="button"
                          className="boton-secundario pedf-btn-sec"
                          disabled={previaVieja}
                          onClick={() => void copiar(textoEnvio)}
                        >
                          {previaVieja ? "Actualizando…" : "Copiar texto"}
                        </button>
                        {canal === "email" ? (
                          <a
                            className={`boton-secundario pedf-btn-sec${previaVieja ? " pedf-espera" : ""}`}
                            aria-disabled={previaVieja || undefined}
                            href={enlaceMailto(
                              (envio.email_editable ? emailPara.trim() : "") || proveedor?.pedido_email,
                              envio.asunto,
                              textoEnvio,
                            )}
                            onClick={(e) => {
                              if (!frenarSiVieja(e)) setAbiertoFuera("email");
                            }}
                          >
                            Abrir en mi correo
                          </a>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </>
              )}
            </>
          ) : !errorEnvio ? (
            <p className="pedf-nada">Preparando el envío…</p>
          ) : null}

          <div className="pedf-peligro">
            {confirmar === "borrar" ? (
              <div className="pedf-confirmar">
                <span>¿Borrar este borrador? No se puede deshacer.</span>
                <button type="button" className="pedf-btn-peligro" disabled={!!ocupado} onClick={() => void borrar()}>
                  Sí, borrar
                </button>
                <button type="button" className="boton-secundario pedf-btn-sec" onClick={() => setConfirmar(null)}>
                  No
                </button>
              </div>
            ) : (
              <button type="button" className="pedf-enlace pedf-enlace--peligro" onClick={() => setConfirmar("borrar")}>
                Borrar borrador
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Enviado en adelante: estado ── */}
      {enviado ? (
        <div className="pedf-bloque">
          <h3 className="pedf-h3">¿Cómo va?</h3>
          <div className="pedf-estados">
            {ESTADOS_SEGUIMIENTO.map((e) => (
              <button
                key={e.id}
                type="button"
                aria-pressed={pedido.estado === e.id}
                className={`pedf-estado-btn${pedido.estado === e.id ? " pedf-estado-btn--activo" : ""}`}
                disabled={!!ocupado || pedido.estado === e.id}
                onClick={() => void cambiarEstado(e.id)}
              >
                {e.txt}
              </button>
            ))}
          </div>
          {pedido.cotejo_estado === "ok" && pedido.estado !== "recibido" ? (
            <div className="aviso-ok pedf-sugiere">
              Todo cuadra con los documentos.{" "}
              <button type="button" className="pedf-enlace" disabled={!!ocupado} onClick={() => void cambiarEstado("recibido")}>
                Marcar como recibido
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Enviado en adelante: documentos y cotejo ── */}
      {enviado ? (
        <div className="pedf-bloque">
          <h3 className="pedf-h3">Albarán y factura</h3>
          <div className="pedf-docs">
            <Documento
              tipo="albaran"
              doc={pedido.documentos.albaran}
              vinculadoId={pedido.albaran_doc_id}
              ocupado={!!ocupado}
              onQuitar={() => void vincular("albaran", null)}
            />
            <Documento
              tipo="factura"
              doc={pedido.documentos.factura}
              vinculadoId={pedido.factura_doc_id}
              ocupado={!!ocupado}
              onQuitar={() => void vincular("factura", null)}
            />
          </div>
          <div className="pedf-botones">
            <button type="button" className="boton-secundario pedf-btn-sec" disabled={!!ocupado} onClick={() => void buscarDocumentos()}>
              {ocupado === "sugerir" ? "Buscando…" : sugerencias ? "Buscar otra vez" : "Buscar albarán y factura"}
            </button>
            {hayDocs ? (
              <button type="button" className="pedf-accion pedf-accion--oscuro pedf-accion--auto" disabled={!!ocupado} onClick={() => void hacerCotejo()}>
                {ocupado === "cotejar" ? "Cotejando…" : "Cotejar"}
              </button>
            ) : null}
          </div>

          {sugerencias ? (
            <Sugerencias
              lista={sugerencias}
              pedido={pedido}
              ocupado={ocupado}
              onVincular={(s) => void vincular(s.tipo, s.doc_id)}
              onCerrar={() => setSugerencias(null)}
            />
          ) : null}

          {pedido.cotejo && cotejoConLineas ? (
            <div className="pedf-cotejo-caja">
              <h4 className="pedf-h4">Cotejo</h4>
              <TablaCotejo
                cotejo={pedido.cotejo}
                lineas={pedido.lineas}
                editable={!cancelado}
                onSustituido={(id, v) => void sustituido(id, v)}
                ocupado={!!ocupado}
              />
            </div>
          ) : (
            <>
              {!hayDocs ? (
                <p className="pedf-ayuda">
                  Cuando llegue el albarán (por correo o foto en Compras), búscalo aquí para comparar lo pedido con lo que llega.
                </p>
              ) : null}
              <LineasSoloLectura lineas={pedido.lineas} />
            </>
          )}

          {(pedido.estado === "enviado" || pedido.estado === "confirmado") && !cancelado ? (
            <div className="pedf-peligro">
              {confirmar === "cancelar" ? (
                <div className="pedf-confirmar">
                  <span>¿Cancelar el pedido? Avisa tú al proveedor.</span>
                  <button type="button" className="pedf-btn-peligro" disabled={!!ocupado} onClick={() => void cancelar()}>
                    Sí, cancelar
                  </button>
                  <button type="button" className="boton-secundario pedf-btn-sec" onClick={() => setConfirmar(null)}>
                    No
                  </button>
                </div>
              ) : (
                <button type="button" className="pedf-enlace pedf-enlace--peligro" onClick={() => setConfirmar("cancelar")}>
                  Cancelar pedido
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Cancelado: lo que se pidió ── */}
      {cancelado ? (
        <div className="pedf-bloque">
          <h3 className="pedf-h3">Productos</h3>
          <LineasSoloLectura lineas={pedido.lineas} />
          {pedido.cotejo && cotejoConLineas ? (
            <div className="pedf-cotejo-caja">
              <h4 className="pedf-h4">Último cotejo</h4>
              <TablaCotejo cotejo={pedido.cotejo} lineas={pedido.lineas} editable={false} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ═══════════════════════ Piezas ═══════════════════════ */

function BarraVolver({ cerrar }: { cerrar: () => void }) {
  return (
    <div className="pedf-volver">
      <button type="button" className="pedf-volver-btn" onClick={cerrar}>
        ← Volver
      </button>
    </div>
  );
}

function LineasSoloLectura({ lineas }: { lineas: LineaPedido[] }) {
  if (!lineas.length) return <p className="pedf-nada">El pedido no tiene productos.</p>;
  return (
    <ul className="pedf-lineas-lectura">
      {lineas.map((l) => (
        <li key={l.id}>
          <span className="pedf-lectura-cant">{formatoCantidad(l.cantidad, l.unidad)}</span>
          <span className="pedf-lectura-nombre">
            {nombreLinea(l)}
            {l.producto?.ref_proveedor ? <span className="pedf-ref"> {l.producto.ref_proveedor}</span> : null}
            {l.nota ? <span className="pedf-lectura-nota"> · {l.nota}</span> : null}
          </span>
          <span className="pedf-lectura-precio">
            {l.precio_estimado != null ? formatoEuros(redondear(l.cantidad * l.precio_estimado, 2)) : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Documento({
  tipo,
  doc,
  vinculadoId,
  ocupado,
  onQuitar,
}: {
  tipo: "albaran" | "factura";
  doc: DocumentoResumen | null;
  vinculadoId: string | null;
  ocupado: boolean;
  onQuitar: () => void;
}) {
  const titulo = tipo === "albaran" ? "Albarán" : "Factura";
  if (!vinculadoId) {
    return (
      <div className="pedf-doc pedf-doc--vacio">
        <span className="pedf-doc-tipo">{titulo}</span>
        <span className="pedf-doc-datos">{tipo === "albaran" ? "Sin albarán" : "Sin factura"}</span>
      </div>
    );
  }
  return (
    <div className="pedf-doc">
      <span className="pedf-doc-tipo">{titulo}</span>
      <span className="pedf-doc-datos">
        {doc ? (
          <>
            {doc.num_documento ? `nº ${doc.num_documento}` : "sin número"} · {formatoFecha(doc.fecha)}
            {doc.total != null ? ` · ${formatoEuros(doc.total)}` : ""}
          </>
        ) : (
          "No se puede leer"
        )}
      </span>
      <span className="pedf-doc-acciones">
        {doc?.imagen_url ? (
          <a className="pedf-enlace" href={doc.imagen_url} target="_blank" rel="noopener noreferrer">
            Ver
          </a>
        ) : null}
        <button type="button" className="pedf-enlace" disabled={ocupado} onClick={onQuitar}>
          Quitar
        </button>
      </span>
    </div>
  );
}

function Sugerencias({
  lista,
  pedido,
  ocupado,
  onVincular,
  onCerrar,
}: {
  lista: SugerenciaDocumento[];
  pedido: PedidoCompleto;
  ocupado: string | null;
  onVincular: (s: SugerenciaDocumento) => void;
  onCerrar: () => void;
}) {
  const albaranes = lista.filter((s) => s.tipo === "albaran");
  const facturas = lista.filter((s) => s.tipo === "factura");
  if (!lista.length) {
    return (
      <div className="pedf-sugerencias">
        <p className="pedf-nada">
          No hay albaranes ni facturas de este proveedor cerca de la fecha de entrega. Cuando Compras los lea, aparecerán aquí.
        </p>
        <button type="button" className="pedf-enlace" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    );
  }
  const grupo = (titulo: string, items: SugerenciaDocumento[], yaHay: boolean) =>
    items.length ? (
      <div className="pedf-sug-grupo">
        <h4 className="pedf-h4">{titulo}</h4>
        <ul className="pedf-sug-lista">
          {items.map((s) => (
            <li key={s.doc_id} className={`pedf-sug${s.incluye_albaran ? " pedf-sug--recoge" : ""}`}>
              <div className="pedf-sug-cabeza">
                <span className="pedf-sug-num">
                  {s.tipo === "albaran" ? "Albarán" : "Factura"} {s.num_documento ? `nº ${s.num_documento}` : "sin número"}
                </span>
                <span className="pedf-sug-punt" title="Coincidencia con el pedido">
                  <span className="pedf-sug-barra">
                    <span style={{ width: `${Math.round(s.puntuacion)}%` }} />
                  </span>
                  {Math.round(s.puntuacion)}%
                </span>
              </div>
              <div className="pedf-sug-datos">
                {formatoFecha(s.fecha)}
                {s.total != null ? ` · ${formatoEuros(s.total)}` : ""}
                {s.n_lineas ? ` · ${s.n_lineas} ${s.n_lineas === 1 ? "línea" : "líneas"}` : ""}
              </div>
              {s.motivo ? <div className="pedf-sug-motivo">{s.motivo}</div> : null}
              {s.vinculado_a ? <div className="pedf-sug-aviso">Ya está en {s.vinculado_a}</div> : null}
              <button
                type="button"
                className="pedf-accion pedf-accion--claro pedf-accion--auto"
                disabled={!!ocupado}
                onClick={() => onVincular(s)}
              >
                {ocupado === `vincular-${s.tipo}-${s.doc_id}` ? "Vinculando…" : yaHay ? "Cambiar por este" : "Es este"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="pedf-sugerencias">
      {grupo("Albaranes", albaranes, !!pedido.albaran_doc_id)}
      {grupo("Facturas", facturas, !!pedido.factura_doc_id)}
      <button type="button" className="pedf-enlace" onClick={onCerrar}>
        Cerrar sugerencias
      </button>
    </div>
  );
}
