"use client";

/* Pestaña «Nuevo»: dictar o escribir el pedido → Interpretar (IA) → revisar agrupado por
   proveedor → Guardar borradores → ficha del pedido (o lista de los creados si hay varios).
   Sin IA en el servidor, el pedido se monta a mano con el buscador.
   Contrato: docs/pedidos-contratos.md §5 (B). */

import { useEffect, useMemo, useRef, useState } from "react";
import BuscadorProducto from "../componentes/BuscadorProducto";
import DictadoVoz from "../componentes/DictadoVoz";
import RevisionLineas from "../componentes/RevisionLineas";
import { interpretarTexto } from "../acciones/interpretar";
import { cargarCatalogo, guardarBorradores } from "../acciones/borradores";
import { listarPedidos } from "../acciones/seguimiento";
import {
  formatoEuros,
  gruposParaGuardar,
  guardarPref,
  hoyMadrid,
  leerPref,
  lineaAGuardar,
  lineaDesdeInterpretada,
  lineaDesdeProducto,
  totalEstimado,
} from "../lib-pedidos";
import { ESTADOS_ENVIADOS, ESTADOS_PEDIDO, MAX_TEXTO_PEDIDO, SIN_PROVEEDOR } from "../tipos";
import type {
  ControlDictado,
  EstadoPedido,
  IdiomaDictado,
  InterpretacionCruda,
  LineaRevision,
  MetaGrupo,
  OrigenPedido,
  PedidoCreado,
  ProductoCatalogo,
  PropsSecNuevo,
} from "../tipos";

type OrigenTexto = "voz" | "texto" | "mixto";
type Dictado = { texto: string; origen: OrigenTexto; interpretacion: InterpretacionCruda };

const MENSAJES_ESPERA = [
  "Leyendo el pedido…",
  "Buscando cada producto en vuestro catálogo…",
  "Repartiendo por proveedor…",
  "Ya casi está…",
];

/** Varios dictados en una misma revisión → una sola interpretación para auditoría. */
function unirInterpretaciones(v: InterpretacionCruda[]): InterpretacionCruda | null {
  if (!v.length) return null;
  return v.slice(1).reduce<InterpretacionCruda>(
    (a, b) => ({
      ...a,
      modelo: b.modelo,
      idioma: b.idioma,
      texto: `${a.texto}\n${b.texto}`,
      lineas: [...a.lineas, ...b.lineas],
      fecha_entrega: a.fecha_entrega ?? b.fecha_entrega,
      notas: [a.notas, b.notas].filter(Boolean).join(" · ") || null,
      dudas: [...a.dudas, ...b.dudas],
      descartados: [...a.descartados, ...b.descartados],
      stop_reason: b.stop_reason,
      uso:
        a.uso && b.uso
          ? {
              entrada: a.uso.entrada + b.uso.entrada,
              salida: a.uso.salida + b.uso.salida,
              cache_lectura: a.uso.cache_lectura + b.uso.cache_lectura,
              cache_escritura: a.uso.cache_escritura + b.uso.cache_escritura,
            }
          : (a.uso ?? b.uso),
    }),
    v[0],
  );
}

function origenDe(dictados: Dictado[], lineas: LineaRevision[]): OrigenPedido {
  if (!dictados.length) return "catalogo"; // todo puesto a mano con el buscador
  // Dictado y además líneas puestas a mano (confianza null): mixto.
  if (lineas.some((l) => l.confianza == null)) return "mixto";
  const tipos = new Set(dictados.map((d) => d.origen));
  return tipos.size === 1 ? dictados[0].origen : "mixto";
}

const unirNotas = (a: string, b: string) => {
  const x = a.trim();
  if (!x) return b;
  return x.includes(b) ? x : `${x} · ${b}`;
};

export default function SecNuevo({ ctx, proveedores, centroId, avisar, abrirPedido, version }: PropsSecNuevo) {
  const [idioma, setIdioma] = useState<IdiomaDictado>("es");
  const [texto, setTexto] = useState("");
  const [origenTexto, setOrigenTexto] = useState<OrigenTexto>("texto");
  const [grabando, setGrabando] = useState(false);
  const dictado = useRef<ControlDictado | null>(null);
  /** Centro de la revisión en curso: se fija con la primera línea (catálogo, alias y frecuencias
      de ese centro); cambiar el selector de arriba no la mueve a otro centro sin avisar. */
  const [centroFijo, setCentroFijo] = useState<string | null>(null);
  const centroUso = centroFijo ?? centroId;

  const [catalogo, setCatalogo] = useState<ProductoCatalogo[]>([]);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  const [lineas, setLineas] = useState<LineaRevision[]>([]);
  const [meta, setMeta] = useState<Record<string, MetaGrupo>>({});
  const [dictados, setDictados] = useState<Dictado[]>([]);
  const [dudas, setDudas] = useState<string[]>([]);
  const [notasIA, setNotasIA] = useState<string[]>([]);
  const [fechaDicha, setFechaDicha] = useState<string | null>(null);
  const [enRevision, setEnRevision] = useState(false);
  const [dictandoMas, setDictandoMas] = useState(false);
  const [aMano, setAMano] = useState(false);

  const [interpretando, setInterpretando] = useState(false);
  const [mensajeEspera, setMensajeEspera] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creados, setCreados] = useState<PedidoCreado[] | null>(null);
  const [centroCreados, setCentroCreados] = useState<string | null>(null);
  /** Estado actual de los borradores creados (null = ya no existe); sin dato = borrador. */
  const [estadosCreados, setEstadosCreados] = useState<Record<string, EstadoPedido | null>>({});

  const centro = ctx.centros.find((c) => c.id === centroUso) ?? null;
  const ocupado = interpretando || guardando;
  const notasDichas = notasIA.join(" · ");

  useEffect(() => {
    const i = leerPref<string>("idioma", "es");
    if (i === "es" || i === "ca") setIdioma(i);
  }, []);

  const cambiarIdioma = (i: IdiomaDictado) => {
    setIdioma(i);
    guardarPref("idioma", i);
  };

  // Catálogo del centro: alimenta el buscador local (lo más pedido primero).
  useEffect(() => {
    let vivo = true;
    setErrorCatalogo(null);
    cargarCatalogo({ centro_id: centroUso })
      .then((r) => {
        if (!vivo) return;
        if (r.ok) setCatalogo(r.productos);
        else {
          setCatalogo([]);
          setErrorCatalogo(r.error);
        }
      })
      .catch(() => {
        if (!vivo) return;
        setCatalogo([]);
        setErrorCatalogo("No se ha podido cargar el catálogo del centro.");
      });
    return () => {
      vivo = false;
    };
  }, [centroUso]);

  // Tras enviar (o borrar) un borrador desde su ficha, la tarjeta de «guardados» lo refleja.
  useEffect(() => {
    if (!creados?.length || !centroCreados) return;
    let vivo = true;
    const t = setTimeout(() => {
      listarPedidos({ centro_id: centroCreados, estados: [...ESTADOS_PEDIDO], limite: 300 })
        .then((r) => {
          if (!vivo || !r.ok) return;
          const m = new Map(r.pedidos.map((p) => [p.id, p.estado]));
          setEstadosCreados(Object.fromEntries(creados.map((c) => [c.id, m.get(c.id) ?? null])));
        })
        .catch(() => {
          /* sin red: la tarjeta se queda como estaba */
        });
    }, 600);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [version, creados, centroCreados]);

  // Mensajes tranquilizadores mientras la IA trabaja (puede tardar 10-20 s).
  useEffect(() => {
    if (!interpretando) return;
    setMensajeEspera(0);
    const t = setInterval(() => setMensajeEspera((m) => Math.min(m + 1, MENSAJES_ESPERA.length - 1)), 4000);
    return () => clearInterval(t);
  }, [interpretando]);

  // Aviso del navegador si se sale con un pedido a medias.
  const aMedias = lineas.length > 0 || texto.trim().length > 0;
  useEffect(() => {
    if (!aMedias) return;
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [aMedias]);

  const limpiar = () => {
    setLineas([]);
    setMeta({});
    setDictados([]);
    setDudas([]);
    setNotasIA([]);
    setFechaDicha(null);
    setEnRevision(false);
    setDictandoMas(false);
    setAMano(false);
    setTexto("");
    setOrigenTexto("texto");
    setError(null);
    setCentroFijo(null);
  };

  const empezarDeNuevo = () => {
    if (lineas.length && !window.confirm("¿Borrar esta revisión y empezar de nuevo?")) return;
    limpiar();
  };

  const interpretar = async () => {
    // Con el micro abierto: se para YA y lo provisional entra en el texto (si no, la última frase
    // llegaría con la petición ya en marcha y se perdería).
    const final = dictado.current?.terminar() ?? { texto, origen: origenTexto };
    const t = final.texto.trim();
    if (!t) {
      setError("Escribe o dicta el pedido.");
      return;
    }
    if (t.length > MAX_TEXTO_PEDIDO) {
      setError("El pedido es demasiado largo: pártelo en dos.");
      return;
    }
    setError(null);
    setCreados(null);
    setInterpretando(true);
    try {
      const r = await interpretarTexto({ centro_id: centroUso, texto: t, idioma });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const res = r.resultado;
      const nuevas = res.lineas.map(lineaDesdeInterpretada);
      if (!nuevas.length) {
        // Nada que revisar: el texto se queda para corregirlo (no hay que volver a dictarlo).
        setError(
          [
            "No he encontrado productos en el texto. Corrígelo y vuelve a interpretar, o añádelos a mano.",
            ...res.dudas.slice(0, 2),
          ].join(" "),
        );
        return;
      }
      setLineas((ls) => [...ls, ...nuevas]);
      setCentroFijo((c) => c ?? centroUso);
      setDictados((d) => [...d, { texto: t, origen: final.origen, interpretacion: res.interpretacion }]);
      if (res.dudas.length) setDudas((d) => [...d, ...res.dudas]);
      const notaDicha = res.notas?.trim();
      if (notaDicha) {
        setNotasIA((n) => [...n, notaDicha]);
        // Los grupos que ya tienen nota (o fecha tocada) también la reciben: la nota dicha va al proveedor.
        setMeta((m) =>
          Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, notas: unirNotas(v.notas, notaDicha) }])),
        );
      }
      if (res.fecha_entrega) setFechaDicha((f) => f ?? res.fecha_entrega);
      setTexto("");
      setOrigenTexto("texto");
      setEnRevision(true);
      setDictandoMas(false);
    } catch {
      setError("La IA no responde ahora mismo. Prueba otra vez en un momento.");
    } finally {
      setInterpretando(false);
    }
  };

  const empezarAMano = (p: ProductoCatalogo) => {
    setLineas((ls) => [...ls, lineaDesdeProducto(p, 1)]);
    setCentroFijo((c) => c ?? centroUso);
    setEnRevision(true);
    setAMano(false);
    setCreados(null);
  };

  const cambiarMeta = (clave: string, m: MetaGrupo) => setMeta((x) => ({ ...x, [clave]: m }));

  // Resumen para la barra de guardar.
  const resumen = useMemo(() => {
    const claves = new Set(lineas.map((l) => l.proveedor_id ?? SIN_PROVEEDOR));
    return {
      borradores: claves.size,
      sinProveedor: lineas.filter((l) => !l.proveedor_id).length,
      total: totalEstimado(lineas.filter((l) => l.producto)),
    };
  }, [lineas]);

  const nombreProveedor = (id: string | null) =>
    (id && (proveedores.find((p) => p.id === id)?.nombre ?? lineas.find((l) => l.proveedor_id === id)?.producto?.proveedor_nombre)) ||
    "sin proveedor";

  const guardar = async () => {
    if (!lineas.length || guardando) return;
    if (
      dictandoMas &&
      texto.trim() &&
      !window.confirm("Hay texto en «Añadir más» que aún no se ha interpretado. ¿Guardar sin él?")
    ) {
      return;
    }
    const grupos = gruposParaGuardar(lineas, meta, { proveedores, fechaDicha, notasDichas }).map((g) => ({
      ...g,
      // Sin fusionar aquí: el servidor aprende los alias línea a línea (con la frase original de
      // cada una) y DESPUÉS fusiona las del mismo producto y unidad (contrato §3.2).
      lineas: lineas
        .filter((l) => (l.proveedor_id ?? SIN_PROVEEDOR) === (g.proveedor_id ?? SIN_PROVEEDOR))
        .map(lineaAGuardar),
    }));
    const hoy = hoyMadrid();
    const pasada = grupos.find((g) => g.fecha_entrega && g.fecha_entrega < hoy);
    if (pasada) {
      setError(`La fecha de entrega de ${nombreProveedor(pasada.proveedor_id)} ya ha pasado.`);
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      const interpretacion = unirInterpretaciones(dictados.map((d) => d.interpretacion));
      const centroGuardar = centroUso;
      const r = await guardarBorradores({
        centro_id: centroGuardar,
        origen: origenDe(dictados, lineas),
        transcripcion: dictados.length ? dictados.map((d) => d.texto).join("\n") : null,
        idioma: interpretacion?.idioma ?? null,
        interpretacion,
        grupos,
        unir_a_borrador: true,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      limpiar();
      setCreados(r.pedidos);
      setCentroCreados(centroGuardar);
      setEstadosCreados({});
      window.dispatchEvent(new CustomEvent("ped:cambio"));
      const n = r.pedidos.length;
      avisar(n === 1 ? `Borrador ${r.pedidos[0].numero} guardado` : `${n} borradores guardados`);
      if (n === 1) abrirPedido(r.pedidos[0].id);
    } catch {
      setError("No se ha podido guardar. Prueba otra vez.");
    } finally {
      setGuardando(false);
    }
  };

  const pendientesCreados = (creados ?? []).filter((c) => {
    const e = estadosCreados[c.id];
    return e === undefined || e === "borrador";
  }).length;

  const espera = interpretando ? (
    <div className="ped-espera" role="status">
      <span className="ped-girando" aria-hidden="true" />
      <div>
        <p className="ped-espera-titulo">{MENSAJES_ESPERA[mensajeEspera]}</p>
        <p className="ped-espera-sub">Puede tardar unos 15 segundos. No cierres esta pantalla.</p>
      </div>
    </div>
  ) : null;

  const avisoError = error ? (
    <p className="aviso-error ped-error" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <div className="ped-seccion ped-nuevo">
      {creados?.length ? (
        <section className="ped-tarjeta ped-creados" aria-live="polite">
          <div className="ped-fila-titulo">
            <h2 className="ped-titulo">{creados.length === 1 ? "Borrador guardado" : `${creados.length} borradores guardados`}</h2>
            <button type="button" className="ped-boton-texto" onClick={() => setCreados(null)}>
              Cerrar
            </button>
          </div>
          <p className="ped-ayuda">
            {pendientesCreados === 0 ? "Ya no queda ninguno por enviar." : "Revísalos y envíalos a cada proveedor."}
          </p>
          <ul className="ped-lista-simple">
            {creados.map((c) => {
              const estado = estadosCreados[c.id];
              const borrado = estado === null;
              const ir =
                estado === undefined || estado === "borrador"
                  ? "Revisar y enviar →"
                  : estado === "cancelado"
                    ? "Cancelado"
                    : borrado
                      ? "Borrado"
                      : ESTADOS_ENVIADOS.includes(estado)
                        ? "Enviado ✓"
                        : "Ver →";
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="ped-fila ped-creado"
                    onClick={() => abrirPedido(c.id)}
                    disabled={borrado}
                  >
                    <span className="ped-creado-cuerpo">
                      <span className="ped-creado-num">{c.numero}</span>
                      <span className="ped-creado-prov">{c.proveedor_nombre ?? "Sin proveedor"}</span>
                      <span className="ped-creado-detalle">
                        {c.n_lineas} {c.n_lineas === 1 ? "línea" : "líneas"}
                        {c.unido ? " · añadido a un borrador que ya tenías" : ""}
                      </span>
                    </span>
                    <span className="ped-creado-ir">{ir}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!enRevision ? (
        <section className="ped-tarjeta ped-paso">
          <h2 className="ped-titulo">Nuevo pedido</h2>
          {ctx.iaDisponible ? (
            <>
              <p className="ped-ayuda">Dilo como lo dirías por teléfono: qué, cuánto y para cuándo.</p>
              <DictadoVoz
                valor={texto}
                onCambio={setTexto}
                idioma={idioma}
                onIdioma={cambiarIdioma}
                onOrigen={setOrigenTexto}
                onGrabando={setGrabando}
                control={dictado}
                desactivado={ocupado}
              />
              {avisoError}
              {espera}
              <button
                type="button"
                className="ped-boton-grande"
                onClick={interpretar}
                disabled={ocupado || (!texto.trim() && !grabando)}
              >
                {interpretando ? "Interpretando…" : grabando ? "Parar e interpretar" : "Interpretar"}
              </button>
              {aMano ? (
                <BuscadorProducto
                  centroId={centroUso}
                  catalogo={catalogo}
                  onElegir={empezarAMano}
                  onCerrar={() => setAMano(false)}
                  autoFocus
                />
              ) : (
                <button type="button" className="ped-boton-texto ped-centrado" onClick={() => setAMano(true)} disabled={ocupado}>
                  o añade los productos a mano
                </button>
              )}
            </>
          ) : (
            <>
              <p className="ped-aviso">
                El dictado no está disponible ahora: añade los productos con el buscador o pide por catálogo.
              </p>
              {avisoError}
              <BuscadorProducto centroId={centroUso} catalogo={catalogo} onElegir={empezarAMano} />
            </>
          )}
          {errorCatalogo ? <p className="ped-nota">Catálogo del centro: {errorCatalogo}</p> : null}
        </section>
      ) : (
        <>
          <div className="ped-fila-titulo">
            <h2 className="ped-titulo">Revisa el pedido</h2>
            <button type="button" className="ped-boton-texto" onClick={empezarDeNuevo} disabled={ocupado}>
              Empezar de nuevo
            </button>
          </div>

          {dudas.length ? (
            <div className="ped-aviso ped-aviso--dudas" role="note">
              <b>Antes de guardar, revisa:</b>
              <ul>
                {dudas.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {notasIA.length ? (
            <p className="ped-aviso ped-aviso--info">
              Va como nota para el proveedor: «{notasDichas}». Puedes cambiarla abajo, en cada proveedor.
            </p>
          ) : null}
          {centroFijo && centroFijo !== centroId ? (
            <p className="ped-aviso">
              Este pedido es para {centro?.nombre ?? "el centro donde lo empezaste"}. Para pedir en otro centro, guárdalo o
              empieza de nuevo.
            </p>
          ) : null}
          {resumen.sinProveedor ? (
            <p className="ped-aviso">
              {resumen.sinProveedor === 1
                ? "1 línea sin proveedor irá a un borrador aparte."
                : `${resumen.sinProveedor} líneas sin proveedor irán a un borrador aparte.`}
            </p>
          ) : null}

          <RevisionLineas
            lineas={lineas}
            onLineas={setLineas}
            meta={meta}
            onMeta={cambiarMeta}
            proveedores={proveedores}
            centroId={centroUso}
            catalogo={catalogo}
            hoy={ctx.hoy}
            fechaDicha={fechaDicha}
            notasDichas={notasDichas || null}
            desactivado={ocupado}
          />

          {ctx.iaDisponible ? (
            dictandoMas ? (
              <section className="ped-tarjeta ped-paso">
                <div className="ped-fila-titulo">
                  <h3 className="ped-subtitulo">Añadir más</h3>
                  <button type="button" className="ped-boton-texto" onClick={() => setDictandoMas(false)} disabled={ocupado}>
                    Cancelar
                  </button>
                </div>
                <DictadoVoz
                  valor={texto}
                  onCambio={setTexto}
                  idioma={idioma}
                  onIdioma={cambiarIdioma}
                  onOrigen={setOrigenTexto}
                  onGrabando={setGrabando}
                  control={dictado}
                  desactivado={ocupado}
                  placeholder="Ej.: «y también dos garrafas de aceite»"
                />
                {espera}
                <button
                  type="button"
                  className="ped-boton-grande"
                  onClick={interpretar}
                  disabled={ocupado || (!texto.trim() && !grabando)}
                >
                  {interpretando ? "Interpretando…" : grabando ? "Parar y añadir" : "Interpretar y añadir"}
                </button>
              </section>
            ) : (
              <button
                type="button"
                className="ped-boton-grande ped-boton-grande--secundario"
                onClick={() => setDictandoMas(true)}
                disabled={ocupado}
              >
                Añadir más dictando
              </button>
            )
          ) : null}

          {avisoError}

          <div className="ped-barra-fija">
            <p className="ped-barra-resumen">
              <span>
                {lineas.length} {lineas.length === 1 ? "producto" : "productos"}
                {resumen.total != null ? ` · ${formatoEuros(resumen.total)}` : ""}
              </span>
              {centro ? <span className="ped-barra-centro">{centro.nombre}</span> : null}
            </p>
            <button
              type="button"
              className="ped-boton-grande"
              onClick={guardar}
              disabled={ocupado || !lineas.length}
            >
              {guardando
                ? "Guardando…"
                : resumen.borradores <= 1
                  ? "Guardar borrador"
                  : `Guardar ${resumen.borradores} borradores`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
