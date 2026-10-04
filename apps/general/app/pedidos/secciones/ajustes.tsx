"use client";

/* Pestaña «Ajustes» de Pedidos (constructor C). Solo dirección y responsables de área (el panel
   la oculta al resto y las acciones lo vuelven a exigir).
   - Proveedores: buscador, «solo los que aparecen en Pedidos», ficha con los datos de pedido
     (canal, email, WhatsApp, teléfono, mínimo, días de reparto, hora de corte, notas, albaranes
     por email, aparece en Pedidos), importar catálogo y «Pedir catálogo y albaranes por email».
   - Alias aprendidos: frase → producto, usos, borrar.
   - Importaciones: las últimas 20 con su resumen y filas con error.
   Contrato: docs/pedidos-contratos.md §5 (C) · acciones: ../acciones/ajustes. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  borrarAlias,
  cargarAjustes,
  enviarPeticionProveedor,
  guardarDatosProveedor,
  listarAlias,
  prepararPeticionProveedor,
} from "../acciones/ajustes";
import ImportadorCatalogo from "../componentes/ImportadorCatalogo";
import {
  DIAS_CORTOS,
  enlaceMailto,
  esEmail,
  formatoEuros,
  formatoFecha,
  formatoMomento,
  guardarPref,
  horaCorta,
  leerPref,
  nombreUnidad,
  normalizarTexto,
  parsearNumero,
  textoDiasReparto,
} from "../lib-pedidos";
import { CANALES_PEDIDO, CANAL_TXT } from "../tipos";
import type {
  AliasAprendido,
  AlternativaEnvio,
  CanalPedido,
  ConfigPedidos,
  DatosPedidoProveedor,
  ImportacionCatalogo,
  PeticionProveedor,
  PropsSecAjustes,
  ProveedorAjustes,
  ProveedorPedido,
} from "../tipos";
import "./ajustes.css";

type Vista = "proveedores" | "alias" | "importaciones";
const VISTAS: { id: Vista; txt: string }[] = [
  { id: "proveedores", txt: "Proveedores" },
  { id: "alias", txt: "Lo aprendido" },
  { id: "importaciones", txt: "Importaciones" },
];

type DatosAjustes = { proveedores: ProveedorAjustes[]; config: ConfigPedidos; importaciones: ImportacionCatalogo[] };

const ERROR_RED = "No hay conexión con el servidor. Prueba otra vez.";

/** Destino de pedidos para pintar en la lista. */
function destinoTxt(p: ProveedorPedido): string {
  if (p.pedido_canal === "email") return p.pedido_email ?? "sin email";
  if (p.pedido_canal === "whatsapp") return p.pedido_whatsapp ? `+${p.pedido_whatsapp}` : "sin número";
  if (p.pedido_canal === "telefono") return p.pedido_telefono ?? "sin teléfono";
  return "web del proveedor";
}

export default function SecAjustes({ ctx, avisar, alGuardarProveedor }: PropsSecAjustes) {
  const [datos, setDatos] = useState<DatosAjustes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<Vista>(() => {
    const v = leerPref<string>("ajustes_vista", "proveedores");
    return VISTAS.some((x) => x.id === v) ? (v as Vista) : "proveedores";
  });
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const peticion = useRef(0);

  const cargar = useCallback(async () => {
    const n = ++peticion.current;
    setCargando(true);
    try {
      const r = await cargarAjustes();
      if (n !== peticion.current) return;
      if (r.ok) {
        setDatos({ proveedores: r.proveedores, config: r.config, importaciones: r.importaciones });
        setError(null);
      } else setError(r.error);
    } catch {
      if (n === peticion.current) setError(ERROR_RED);
    } finally {
      if (n === peticion.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const elegirVista = (v: Vista) => {
    setVista(v);
    guardarPref("ajustes_vista", v);
  };

  const alGuardado = (p: ProveedorPedido) => {
    setDatos((d) =>
      d ? { ...d, proveedores: d.proveedores.map((x) => (x.id === p.id ? { ...x, ...p } : x)) } : d,
    );
    alGuardarProveedor(p);
  };

  const config = datos?.config ?? null;
  const prov = seleccionado ? (datos?.proveedores.find((p) => p.id === seleccionado) ?? null) : null;

  return (
    <section className="peda">
      {config ? <AvisosConfig config={config} /> : null}

      {!prov ? (
        <div className="peda-vistas" role="tablist" aria-label="Ajustes">
          {VISTAS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={vista === v.id}
              className={`peda-vista${vista === v.id ? " peda-vista--activa" : ""}`}
              onClick={() => elegirVista(v.id)}
            >
              {v.txt}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="aviso-error peda-error">
          {error}{" "}
          <button type="button" className="peda-enlace" onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      ) : null}

      {!datos ? (
        <div className="ped-vacio peda-vacio">{cargando ? "Cargando ajustes…" : ""}</div>
      ) : prov ? (
        <FichaProveedor
          key={prov.id}
          proveedor={prov}
          config={datos.config}
          importaciones={datos.importaciones.filter((i) => i.proveedor_id === prov.id)}
          avisar={avisar}
          onGuardado={alGuardado}
          onRecargar={() => void cargar()}
          onVolver={() => setSeleccionado(null)}
        />
      ) : vista === "proveedores" ? (
        <ListaProveedores proveedores={datos.proveedores} onElegir={setSeleccionado} />
      ) : vista === "alias" ? (
        <VistaAlias ctx={ctx} avisar={avisar} />
      ) : (
        <VistaImportaciones importaciones={datos.importaciones} proveedores={datos.proveedores} hoy={ctx.hoy} />
      )}
    </section>
  );
}

/* ═══════════════════════ Avisos de configuración ═══════════════════════ */

function AvisosConfig({ config }: { config: ConfigPedidos }) {
  const avisos: string[] = [];
  if (!config.buzon_albaranes) {
    avisos.push(
      "Falta el buzón para albaranes (PEDIDOS_BUZON_ALBARANES en el servidor): los pedidos no piden el albarán en PDF a ninguna dirección.",
    );
  }
  if (!config.correo_configurado) {
    avisos.push("El correo no está configurado en el servidor: los pedidos por email se tendrán que mandar desde el correo de cada uno.");
  }
  if (!config.ia_configurada) {
    avisos.push("La IA no está configurada en el servidor: el dictado no se podrá interpretar (se pide por catálogo o con el buscador).");
  }
  if (!avisos.length) return null;
  return (
    <ul className="peda-avisos">
      {avisos.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
}

/* ═══════════════════════ Lista de proveedores ═══════════════════════ */

function ListaProveedores({ proveedores, onElegir }: { proveedores: ProveedorAjustes[]; onElegir: (id: string) => void }) {
  const [texto, setTexto] = useState("");
  const [soloPedibles, setSoloPedibles] = useState(true);

  const lista = useMemo(() => {
    const q = normalizarTexto(texto) ?? "";
    return proveedores.filter((p) => (!soloPedibles || p.pedible) && (!q || (normalizarTexto(p.nombre) ?? "").includes(q)));
  }, [proveedores, texto, soloPedibles]);

  const nPedibles = proveedores.filter((p) => p.pedible).length;

  return (
    <div className="peda-proveedores">
      <div className="peda-filtros">
        <input
          type="search"
          className="peda-buscar"
          placeholder="Buscar proveedor"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar proveedor"
        />
        <label className="peda-check">
          <input type="checkbox" checked={soloPedibles} onChange={(e) => setSoloPedibles(e.target.checked)} />
          Solo los que aparecen en Pedidos ({nPedibles})
        </label>
      </div>
      {lista.length === 0 ? (
        <div className="ped-vacio peda-vacio">No hay proveedores con ese nombre.</div>
      ) : (
        <ul className="peda-lista">
          {lista.map((p) => (
            <li key={p.id}>
              <button type="button" className="peda-prov" onClick={() => onElegir(p.id)}>
                <span className="peda-prov-nombre">{p.nombre}</span>
                <span className="peda-prov-meta">
                  <span>
                    {CANAL_TXT[p.pedido_canal]}: {destinoTxt(p)}
                  </span>
                  <span>Reparte: {textoDiasReparto(p.pedido_dias_reparto)}</span>
                  <span>
                    {p.n_productos} productos{p.n_productos_catalogo ? ` (${p.n_productos_catalogo} del catálogo)` : ""}
                  </span>
                </span>
                <span className="peda-prov-chips">
                  {!p.pedible ? <span className="peda-chip peda-chip--gris">No aparece en Pedidos</span> : null}
                  {p.albaranes_por_email ? <span className="peda-chip peda-chip--verde">Albaranes por email</span> : null}
                  {p.catalogo_actualizado_en ? (
                    <span className="peda-chip">Catálogo {formatoFecha(p.catalogo_actualizado_en)}</span>
                  ) : null}
                  {p.pedido_minimo ? <span className="peda-chip">Mínimo {formatoEuros(p.pedido_minimo)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ═══════════════════════ Ficha de proveedor ═══════════════════════ */

type Formulario = {
  canal: CanalPedido;
  email: string;
  whatsapp: string;
  telefono: string;
  minimo: string;
  dias: number[];
  hora: string;
  notas: string;
  albaranes: boolean;
  pedible: boolean;
};

const formDe = (p: ProveedorPedido): Formulario => ({
  canal: p.pedido_canal,
  email: p.pedido_email ?? "",
  whatsapp: p.pedido_whatsapp ? `+${p.pedido_whatsapp}` : "",
  telefono: p.pedido_telefono ?? "",
  minimo: p.pedido_minimo != null ? String(p.pedido_minimo).replace(".", ",") : "",
  dias: [...(p.pedido_dias_reparto ?? [])].sort((a, b) => a - b),
  hora: horaCorta(p.pedido_hora_corte),
  notas: p.pedido_notas ?? "",
  albaranes: p.albaranes_por_email,
  pedible: p.pedible,
});

function FichaProveedor({
  proveedor,
  config,
  importaciones,
  avisar,
  onGuardado,
  onRecargar,
  onVolver,
}: {
  proveedor: ProveedorAjustes;
  config: ConfigPedidos;
  importaciones: ImportacionCatalogo[];
  avisar: PropsSecAjustes["avisar"];
  onGuardado: (p: ProveedorPedido) => void;
  onRecargar: () => void;
  onVolver: () => void;
}) {
  const [f, setF] = useState<Formulario>(() => formDe(proveedor));
  const [guardando, setGuardando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [peticion, setPeticion] = useState<PeticionProveedor | null>(null);
  const [paraPeticion, setParaPeticion] = useState("");
  const [preparando, setPreparando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [alternativa, setAlternativa] = useState<AlternativaEnvio | null>(null);

  const original = useMemo(() => formDe(proveedor), [proveedor]);
  const cambiado = JSON.stringify(f) !== JSON.stringify(original);
  const poner = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }));

  const alternarDia = (d: number) =>
    setF((x) => ({ ...x, dias: x.dias.includes(d) ? x.dias.filter((y) => y !== d) : [...x.dias, d].sort((a, b) => a - b) }));

  const guardar = async () => {
    const email = f.email.trim();
    if (email && !esEmail(email)) {
      avisar("El email no parece válido", "error");
      return;
    }
    let minimo: number | null = null;
    if (f.minimo.trim()) {
      minimo = parsearNumero(f.minimo);
      if (minimo == null || minimo < 0) {
        avisar("El pedido mínimo no es válido", "error");
        return;
      }
    }
    if (f.hora.trim() && !horaCorta(f.hora)) {
      avisar("La hora de corte no es válida (escríbela como 12:00)", "error");
      return;
    }
    if (f.canal === "email" && !email) avisar("Ojo: el canal es email pero no hay email guardado", "error");
    const datos: DatosPedidoProveedor = {
      pedido_canal: f.canal,
      pedido_email: email || null,
      pedido_whatsapp: f.whatsapp.trim() || null,
      pedido_telefono: f.telefono.trim() || null,
      pedido_minimo: minimo,
      pedido_dias_reparto: f.dias.length ? f.dias : null,
      pedido_hora_corte: f.hora.trim() ? horaCorta(f.hora) : null,
      pedido_notas: f.notas.trim() || null,
      albaranes_por_email: f.albaranes,
      pedible: f.pedible,
    };
    setGuardando(true);
    try {
      const r = await guardarDatosProveedor(proveedor.id, datos);
      if (!r.ok) {
        avisar(r.error, "error");
        return;
      }
      avisar("Proveedor guardado");
      setF(formDe(r.proveedor));
      onGuardado(r.proveedor);
    } catch {
      avisar(ERROR_RED, "error");
    } finally {
      setGuardando(false);
    }
  };

  const preparar = async () => {
    setPreparando(true);
    setAlternativa(null);
    try {
      const r = await prepararPeticionProveedor(proveedor.id);
      if (!r.ok) {
        avisar(r.error, "error");
        return;
      }
      setPeticion(r.peticion);
      setParaPeticion(r.peticion.para ?? f.email.trim());
    } catch {
      avisar(ERROR_RED, "error");
    } finally {
      setPreparando(false);
    }
  };

  const enviarPeticion = async () => {
    const para = paraPeticion.trim();
    if (!esEmail(para)) {
      avisar("Escribe un email válido", "error");
      return;
    }
    setEnviando(true);
    try {
      const r = await enviarPeticionProveedor(proveedor.id, para);
      if (r.ok) {
        avisar(`Correo enviado a ${r.enviado_a}`);
        setPeticion(null);
        setAlternativa(null);
        if (!proveedor.pedido_email) onRecargar();
        return;
      }
      avisar(r.error, "error");
      if ("alternativa" in r && r.alternativa) setAlternativa(r.alternativa);
    } catch {
      avisar(ERROR_RED, "error");
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      avisar("Texto copiado");
    } catch {
      avisar("No se ha podido copiar: selecciona el texto y cópialo a mano", "error");
    }
  };

  return (
    <div className="peda-ficha">
      <button type="button" className="peda-volver" onClick={onVolver}>
        ← Proveedores
      </button>
      <h2 className="peda-titulo">{proveedor.nombre}</h2>
      <p className="peda-ayuda">
        {proveedor.n_productos} productos
        {proveedor.n_productos_catalogo ? ` · ${proveedor.n_productos_catalogo} del catálogo` : ""}
        {proveedor.catalogo_actualizado_en ? ` · catálogo del ${formatoFecha(proveedor.catalogo_actualizado_en)}` : " · sin catálogo importado"}
      </p>

      {/* ── Datos de pedido ── */}
      <div className="peda-bloque">
        <h3 className="peda-h3">Cómo se le pide</h3>
        <div className="peda-canales" role="radiogroup" aria-label="Canal de los pedidos">
          {CANALES_PEDIDO.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={f.canal === c}
              className={`peda-canal${f.canal === c ? " peda-canal--activo" : ""}`}
              onClick={() => poner("canal", c)}
            >
              {CANAL_TXT[c]}
            </button>
          ))}
        </div>

        <div className="peda-rejilla">
          <label className="peda-campo">
            <span>Email para pedidos</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              value={f.email}
              placeholder="pedidos@proveedor.com"
              onChange={(e) => poner("email", e.target.value)}
            />
          </label>
          <label className="peda-campo">
            <span>WhatsApp</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={f.whatsapp}
              placeholder="+34 600 000 000"
              onChange={(e) => poner("whatsapp", e.target.value)}
            />
          </label>
          <label className="peda-campo">
            <span>Teléfono</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={f.telefono}
              onChange={(e) => poner("telefono", e.target.value)}
            />
          </label>
          <label className="peda-campo">
            <span>Pedido mínimo (€, sin IVA)</span>
            <input
              inputMode="decimal"
              value={f.minimo}
              placeholder="Sin mínimo"
              onChange={(e) => poner("minimo", e.target.value)}
            />
          </label>
        </div>

        <div className="peda-campo">
          <span>Días de reparto</span>
          <div className="peda-dias" role="group" aria-label="Días de reparto">
            {DIAS_CORTOS.map((d, i) => {
              const iso = i + 1;
              const on = f.dias.includes(iso);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={`peda-dia${on ? " peda-dia--on" : ""}`}
                  onClick={() => alternarDia(iso)}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <small className="peda-nota">{f.dias.length ? textoDiasReparto(f.dias) : "Sin marcar = reparte cualquier día"}</small>
        </div>

        <div className="peda-rejilla">
          <label className="peda-campo">
            <span>Hora límite para pedir</span>
            <input type="time" value={f.hora} onChange={(e) => poner("hora", e.target.value)} />
            <small className="peda-nota">Pasada esta hora, el pedido va al reparto siguiente.</small>
          </label>
          <label className="peda-campo peda-campo--ancho">
            <span>Notas internas</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={f.notas}
              placeholder="Ej.: pedir antes del jueves para el fin de semana"
              onChange={(e) => poner("notas", e.target.value)}
            />
          </label>
        </div>

        <label className="peda-check peda-check--grande">
          <input type="checkbox" checked={f.albaranes} onChange={(e) => poner("albaranes", e.target.checked)} />
          Ya envía los albaranes en PDF por email
        </label>
        <label className="peda-check peda-check--grande">
          <input type="checkbox" checked={f.pedible} onChange={(e) => poner("pedible", e.target.checked)} />
          Aparece en Pedidos
        </label>

        <div className="peda-botones">
          <button type="button" className="peda-accion" disabled={!cambiado || guardando} onClick={() => void guardar()}>
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          {cambiado ? (
            <button type="button" className="boton-secundario peda-btn-sec" disabled={guardando} onClick={() => setF(original)}>
              Deshacer cambios
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Catálogo ── */}
      <div className="peda-bloque">
        <h3 className="peda-h3">Catálogo</h3>
        {importando ? (
          <ImportadorCatalogo
            proveedor={proveedor}
            avisar={avisar}
            onTerminado={() => {
              setImportando(false);
              onRecargar();
            }}
            onCancelar={() => setImportando(false)}
          />
        ) : (
          <>
            <p className="peda-ayuda">
              Con el catálogo del proveedor (sus códigos, formatos y precios) los pedidos salen con sus referencias y el cotejo
              con el albarán es más fiable.
            </p>
            <button type="button" className="peda-accion peda-accion--claro" onClick={() => setImportando(true)}>
              Importar catálogo (Excel o CSV)
            </button>
          </>
        )}
        {importaciones.length && !importando ? (
          <ul className="peda-imps peda-imps--compacta">
            {importaciones.slice(0, 5).map((i) => (
              <li key={i.id}>
                <span>{formatoMomento(i.creado_en)}</span>
                <span className="peda-imp-archivo">{i.archivo ?? "catálogo"}</span>
                <span>
                  {i.creados} nuevos · {i.actualizados} actualizados{i.errores ? ` · ${i.errores} con error` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ── Petición estándar ── */}
      <div className="peda-bloque">
        <h3 className="peda-h3">Pedir catálogo y albaranes por email</h3>
        {!peticion ? (
          <>
            <p className="peda-ayuda">
              Prepara un correo para el proveedor pidiendo su catálogo en Excel con códigos y precios, que mande los albaranes en
              PDF{config.buzon_albaranes ? ` a ${config.buzon_albaranes}` : ""} y que confirme dónde le mandamos los pedidos. Lo
              envías tú: las respuestas te llegan a tu correo.
            </p>
            {!config.buzon_albaranes ? (
              <div className="peda-aviso">
                Falta el buzón para albaranes: el correo pedirá que respondan con el albarán a tu email.
              </div>
            ) : null}
            <button
              type="button"
              className="peda-accion peda-accion--claro"
              disabled={preparando}
              onClick={() => void preparar()}
            >
              {preparando ? "Preparando…" : "Preparar el correo"}
            </button>
          </>
        ) : (
          <div className="peda-peticion">
            <label className="peda-campo">
              <span>Para</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="off"
                value={paraPeticion}
                placeholder="email del proveedor"
                onChange={(e) => setParaPeticion(e.target.value)}
              />
            </label>
            <p className="peda-asunto">
              <b>Asunto:</b> {peticion.asunto}
            </p>
            <pre className="peda-texto">{peticion.texto}</pre>
            {alternativa ? (
              <div className="peda-alternativa">
                El correo no ha salido. Ábrelo en tu correo o copia el texto.
              </div>
            ) : null}
            <div className="peda-botones">
              <button type="button" className="peda-accion" disabled={enviando} onClick={() => void enviarPeticion()}>
                {enviando ? "Enviando…" : "Enviar"}
              </button>
              <a
                className="boton-secundario peda-btn-sec"
                href={alternativa?.enlace_mailto ?? enlaceMailto(paraPeticion, peticion.asunto, peticion.texto)}
              >
                Abrir en mi correo
              </a>
              <button type="button" className="boton-secundario peda-btn-sec" onClick={() => void copiar(peticion.texto)}>
                Copiar texto
              </button>
              <button
                type="button"
                className="peda-enlace"
                onClick={() => {
                  setPeticion(null);
                  setAlternativa(null);
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════ Alias aprendidos ═══════════════════════ */

function VistaAlias({ ctx, avisar }: { ctx: PropsSecAjustes["ctx"]; avisar: PropsSecAjustes["avisar"] }) {
  const [centro, setCentro] = useState("");
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [alias, setAlias] = useState<AliasAprendido[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const peticion = useRef(0);

  // Pausa al escribir para no pedir en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  useEffect(() => {
    const n = ++peticion.current;
    setCargando(true);
    listarAlias({ centro_id: centro || null, texto: busqueda || null })
      .then((r) => {
        if (n !== peticion.current) return;
        if (r.ok) {
          setAlias(r.alias);
          setError(null);
        } else setError(r.error);
      })
      .catch(() => {
        if (n === peticion.current) setError(ERROR_RED);
      })
      .finally(() => {
        if (n === peticion.current) setCargando(false);
      });
  }, [centro, busqueda]);

  const borrar = async (a: AliasAprendido) => {
    setBorrando(a.id);
    try {
      const r = await borrarAlias(a.id);
      if (!r.ok) {
        avisar(r.error, "error");
        return;
      }
      setAlias((l) => (l ? l.filter((x) => x.id !== a.id) : l));
      setConfirmar(null);
      avisar("Borrado: la IA ya no lo usará");
    } catch {
      avisar(ERROR_RED, "error");
    } finally {
      setBorrando(null);
    }
  };

  return (
    <div className="peda-alias">
      <p className="peda-ayuda">
        Cuando alguien corrige lo que entendió la IA, se guarda aquí («una caixa de pa» → el producto que eligió). La próxima vez
        la IA lo usa primero. Borra lo que esté mal.
      </p>
      <div className="peda-filtros">
        <input
          type="search"
          className="peda-buscar"
          placeholder="Buscar frase"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar frase"
        />
        {ctx.centros.length > 1 ? (
          <select className="peda-select" value={centro} onChange={(e) => setCentro(e.target.value)} aria-label="Centro">
            <option value="">Todos los centros</option>
            {ctx.centros.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {error ? <div className="aviso-error peda-error">{error}</div> : null}
      {alias === null ? (
        <div className="ped-vacio peda-vacio">{cargando ? "Cargando…" : ""}</div>
      ) : alias.length === 0 ? (
        <div className="ped-vacio peda-vacio">{busqueda ? "Nada con esa frase." : "Todavía no se ha aprendido nada."}</div>
      ) : (
        <ul className="peda-lista-alias">
          {alias.map((a) => (
            <li key={a.id} className="peda-alias-fila">
              <div className="peda-alias-texto">
                <span className="peda-frase">«{a.frase}»</span>
                <span className="peda-flecha">→ {a.producto_nombre}</span>
                <span className="peda-alias-meta">
                  {a.proveedor_nombre ? <span>{a.proveedor_nombre}</span> : null}
                  {a.unidad ? <span>{nombreUnidad(a.unidad)}</span> : null}
                  {a.centro_nombre ? <span>{a.centro_nombre}</span> : null}
                  <span>
                    usado {a.usos} {a.usos === 1 ? "vez" : "veces"}
                  </span>
                  <span>{formatoMomento(a.ultimo_uso, ctx.hoy)}</span>
                </span>
              </div>
              {confirmar === a.id ? (
                <div className="peda-alias-confirmar">
                  <button
                    type="button"
                    className="peda-btn-peligro"
                    disabled={borrando === a.id}
                    onClick={() => void borrar(a)}
                  >
                    {borrando === a.id ? "Borrando…" : "Sí, borrar"}
                  </button>
                  <button type="button" className="boton-secundario peda-btn-sec" onClick={() => setConfirmar(null)}>
                    No
                  </button>
                </div>
              ) : (
                <button type="button" className="peda-enlace peda-enlace--peligro" onClick={() => setConfirmar(a.id)}>
                  Borrar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {alias && alias.length >= 500 ? <p className="peda-nota">Se ven los 500 más usados. Busca para encontrar otros.</p> : null}
    </div>
  );
}

/* ═══════════════════════ Importaciones ═══════════════════════ */

function VistaImportaciones({
  importaciones,
  proveedores,
  hoy,
}: {
  importaciones: ImportacionCatalogo[];
  proveedores: ProveedorAjustes[];
  hoy: string;
}) {
  const nombre = (id: string) => proveedores.find((p) => p.id === id)?.nombre ?? "Proveedor";
  if (!importaciones.length) {
    return <div className="ped-vacio peda-vacio">Todavía no se ha importado ningún catálogo. Hazlo desde la ficha de un proveedor.</div>;
  }
  return (
    <ul className="peda-imps">
      {importaciones.map((i) => {
        const d = i.detalle;
        return (
          <li key={i.id} className="peda-imp-fila">
            <div className="peda-imp-cab">
              <span className="peda-prov-nombre">{nombre(i.proveedor_id)}</span>
              <span className="peda-imp-cuando">{formatoMomento(i.creado_en, hoy)}</span>
            </div>
            <div className="peda-imp-archivo">{i.archivo ?? "catálogo"}</div>
            <div className="peda-prov-meta">
              <span>{i.filas} filas</span>
              <span>{i.creados} nuevos</span>
              <span>{i.actualizados} actualizados</span>
              {d ? <span>{d.sin_cambios} sin cambios</span> : null}
              {i.errores ? <span className="peda-mal">{i.errores} con error</span> : null}
              {d && !d.cerrada ? <span className="peda-mal">sin terminar</span> : null}
            </div>
            {d && (d.errores_filas.length || d.avisos.length) ? (
              <details className="peda-errores">
                <summary>Detalle</summary>
                {d.avisos.length ? (
                  <ul>
                    {d.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                ) : null}
                {d.errores_filas.length ? (
                  <ul>
                    {d.errores_filas.map((e, k) => (
                      <li key={`${e.fila}-${k}`}>
                        <span className="peda-mono">Fila {e.fila}</span>
                        {e.ref ? <span className="peda-mono"> · {e.ref}</span> : null} — {e.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
