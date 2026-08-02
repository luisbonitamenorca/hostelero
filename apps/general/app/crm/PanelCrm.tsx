"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./acciones";
import { CANALES, fFecha, fmt, type Campana, type Canal, type CanalId, type Cliente, type ConsentMap, type Lista } from "./tipos";

type Sec = "panel" | "clientes" | "listas" | "campanas" | "canales";
type Ficha =
  | { tipo: "clienteNuevo" }
  | { tipo: "cliente"; id: string }
  | { tipo: "campana"; campana: Campana | null }
  | { tipo: "listaNueva" }
  | { tipo: "lista"; lista: Lista }
  | null;

export default function PanelCrm() {
  const [sec, setSec] = useState<Sec>("panel");
  const [ficha, setFicha] = useState<Ficha>(null);
  const [canales, setCanales] = useState<Canal[]>([]);
  const [refresco, setRefresco] = useState(0);
  const recargar = () => setRefresco((x) => x + 1);

  useEffect(() => {
    api.canales().then(setCanales);
  }, []);

  const emailConectado = canales.find((c) => c.canal === "email")?.estado === "conectado";

  return (
    <div className="crm">
      <div className="tabsbar">
        {(
          [["panel", "Panel"], ["clientes", "Clientes"], ["listas", "Listas"], ["campanas", "Campañas"], ["canales", "Canales"]] as [Sec, string][]
        ).map(([id, nombre]) => (
          <button key={id} className={sec === id ? "activo" : ""} onClick={() => setSec(id)}>
            {nombre}
          </button>
        ))}
      </div>
      <main>
        {sec === "panel" ? <SecPanel canales={canales} refresco={refresco} /> : null}
        {sec === "clientes" ? (
          <SecClientes
            refresco={refresco}
            abrir={(id) => setFicha({ tipo: "cliente", id })}
            nuevo={() => setFicha({ tipo: "clienteNuevo" })}
          />
        ) : null}
        {sec === "listas" ? (
          <SecListas refresco={refresco} nueva={() => setFicha({ tipo: "listaNueva" })} abrir={(l) => setFicha({ tipo: "lista", lista: l })} />
        ) : null}
        {sec === "campanas" ? (
          <SecCampanas refresco={refresco} abrir={(c) => setFicha({ tipo: "campana", campana: c })} />
        ) : null}
        {sec === "canales" ? <SecCanales canales={canales} /> : null}
      </main>

      {ficha ? (
        <>
          <div className="crm-velo" onClick={() => setFicha(null)} />
          <aside className="crm-ficha">
            {ficha.tipo === "clienteNuevo" ? (
              <FichaClienteNuevo cerrar={() => setFicha(null)} creado={(id) => { recargar(); setFicha({ tipo: "cliente", id }); }} />
            ) : ficha.tipo === "cliente" ? (
              <FichaCliente id={ficha.id} cerrar={() => setFicha(null)} cambiado={recargar} />
            ) : ficha.tipo === "campana" ? (
              <FichaCampana campana={ficha.campana} emailConectado={emailConectado} cerrar={() => setFicha(null)} guardada={() => { recargar(); setFicha(null); }} />
            ) : ficha.tipo === "listaNueva" ? (
              <FichaListaNueva cerrar={() => setFicha(null)} creada={() => { recargar(); setFicha(null); }} />
            ) : (
              <FichaLista lista={ficha.lista} cerrar={() => setFicha(null)} cambiada={recargar} />
            )}
          </aside>
        </>
      ) : null}
    </div>
  );
}

/* ================= Secciones ================= */

function SecPanel({ canales, refresco }: { canales: Canal[]; refresco: number }) {
  const [k, setK] = useState<Awaited<ReturnType<typeof api.kpis>> | null>(null);
  useEffect(() => {
    api.kpis().then(setK);
  }, [refresco]);
  const hoy = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <>
      <div className="cabecera-sec"><h1>El censo</h1><span className="fecha">{hoy}</span></div>
      <div className="kpis">
        {!k ? (
          <div className="tarjeta kpi"><div className="cifra">…</div><div className="rotulo">Cargando</div></div>
        ) : (
          <>
            <div className="tarjeta kpi"><div className="cifra">{fmt(k.total)}</div><div className="rotulo">Clientes</div></div>
            <div className="tarjeta kpi"><div className="cifra" style={{ color: "var(--mar)" }}>{fmt(k.email)}</div><div className="rotulo">Enviables · email</div></div>
            <div className="tarjeta kpi"><div className="cifra" style={{ color: "var(--persiana)" }}>{fmt(k.sms)}</div><div className="rotulo">Enviables · SMS</div></div>
            <div className="tarjeta kpi"><div className="cifra" style={{ color: "var(--wa)" }}>{fmt(k.whatsapp)}</div><div className="rotulo">Enviables · WhatsApp</div></div>
            <div className="tarjeta kpi"><div className="cifra">{fmt(k.salaSinFicha)}</div><div className="rotulo">Clientes de sala sin ficha</div></div>
            <div className="tarjeta kpi"><div className="cifra" style={{ color: "var(--gamba)" }}>{fmt(k.supresiones)}</div><div className="rotulo">Supresiones</div></div>
          </>
        )}
      </div>
      <div className="tarjeta carta-borde">
        <h2 style={{ fontSize: 18, marginBottom: 10, fontFamily: "Georgia,serif" }}>Canales</h2>
        {CANALES.map((c) => {
          const info = canales.find((x) => x.canal === c.id);
          const est = info?.estado || "sin_conectar";
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderBottom: "1px solid var(--sal)" }}>
              <span className={`punto ${est}`} /><b style={{ width: 86 }}>{c.nombre}</b>
              <span>
                {est === "conectado"
                  ? `Conectado${info?.proveedor ? " · " + info.proveedor : ""}`
                  : `Sin conectar${info?.proveedor ? " · previsto " + info.proveedor : " · proveedor por decidir"}`}
              </span>
            </div>
          );
        })}
        <p className="mini" style={{ margin: "10px 0 0" }}>
          Los envíos se activan canal a canal según se conectan. Mientras, todo lo demás — clientes, consentimientos, borradores — ya funciona.
        </p>
      </div>
    </>
  );
}

function SecClientes({ refresco, abrir, nuevo }: { refresco: number; abrir: (id: string) => void; nuevo: () => void }) {
  const [filtro, setFiltro] = useState("todos");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<{ clientes: Cliente[]; consentimientos: Record<string, ConsentMap>; count: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.listarClientes({ filtro, q, pagina }).then(setDatos);
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [filtro, q, pagina, refresco]);

  const paginas = datos ? Math.ceil(datos.count / 50) : 0;
  const FILTROS: [string, string][] = [["todos", "Todos"], ["email", "Email ✓"], ["sms", "SMS ✓"], ["whatsapp", "WhatsApp ✓"], ["baja", "Bajas"]];
  return (
    <>
      <div className="cabecera-sec"><h1>Clientes</h1><button className="boton" onClick={nuevo}>Nuevo cliente</button></div>
      <div className="fila-herr">
        <input type="search" placeholder="Buscar por nombre, email o teléfono…" value={q} onChange={(e) => { setQ(e.target.value); setPagina(0); }} />
        <div className="filtros">
          {FILTROS.map(([id, n]) => (
            <button key={id} className={`filtro ${filtro === id ? "activo" : ""}`} onClick={() => { setFiltro(id); setPagina(0); }}>{n}</button>
          ))}
        </div>
      </div>
      <div className="tarjeta" style={{ padding: "6px 14px" }}>
        <div className="lista-tabla">
          {!datos ? (
            <div className="vacio">Cargando…</div>
          ) : !datos.clientes.length ? (
            <div className="vacio">
              <h3>Nada por aquí</h3>
              {datos.count === 0 && !q && filtro === "todos"
                ? "El maestro se llenará con la carga limpia 2026 (por origen, solo consentidos) y con las altas del panel y los fronts."
                : "Prueba con otra búsqueda u otro filtro."}
            </div>
          ) : (
            datos.clientes.map((c) => {
              const v = datos.consentimientos[c.id];
              return (
                <div key={c.id} className="filac" onClick={() => abrir(c.id)}>
                  <div className="quien">
                    <b>{c.nombre || c.email || c.telefono}</b>
                    <span>{[c.email, c.telefono].filter(Boolean).join(" · ")}</span>
                  </div>
                  {CANALES.map((k) => (
                    <span key={k.id} className={`chip canal-${k.id} ${v?.[k.id] ? "" : "apagado"}`} title={`${k.nombre}: ${v?.[k.id] ? "con" : "sin"} consentimiento`}>
                      {k.nombre}
                    </span>
                  ))}
                </div>
              );
            })
          )}
        </div>
        {datos ? (
          <div className="paginacion">
            {paginas > 1 ? (
              <>
                <button className="boton secundario" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
                <span>{pagina + 1} de {paginas} · {fmt(datos.count)} clientes</span>
                <button className="boton secundario" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
              </>
            ) : (
              <span>{fmt(datos.count)} cliente{datos.count === 1 ? "" : "s"}</span>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

function SecListas({ refresco, nueva, abrir }: { refresco: number; nueva: () => void; abrir: (l: Lista) => void }) {
  const [listas, setListas] = useState<Lista[] | null>(null);
  useEffect(() => {
    api.listarListas().then(setListas);
  }, [refresco]);
  return (
    <>
      <div className="cabecera-sec"><h1>Listas</h1><button className="boton" onClick={nueva}>Nueva lista</button></div>
      <div className="tarjeta" style={{ padding: "6px 14px" }}>
        <div className="lista-tabla">
          {!listas ? (
            <div className="vacio">Cargando…</div>
          ) : !listas.length ? (
            <div className="vacio"><h3>Sin listas todavía</h3>Las listas son grupos fijos: prensa, empleados, clientes del bono regalo…</div>
          ) : (
            listas.map((l) => (
              <div key={l.id} className="filac" onClick={() => abrir(l)}>
                <div className="quien"><b>{l.nombre}</b><span>{l.descripcion || ""}</span></div>
                <span className="chip">{fmt(l.n)} clientes</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function SecCampanas({ refresco, abrir }: { refresco: number; abrir: (c: Campana | null) => void }) {
  const [campanas, setCampanas] = useState<Campana[] | null>(null);
  useEffect(() => {
    api.listarCampanas().then(setCampanas);
  }, [refresco]);
  return (
    <>
      <div className="cabecera-sec"><h1>Campañas</h1><button className="boton" onClick={() => abrir(null)}>Nueva campaña</button></div>
      <div className="tarjeta" style={{ padding: "6px 14px" }}>
        <div className="lista-tabla">
          {!campanas ? (
            <div className="vacio">Cargando…</div>
          ) : !campanas.length ? (
            <div className="vacio"><h3>Aún no hay campañas</h3>Crea la primera cuando quieras: se guarda como borrador y el envío se activará al conectar el canal de email.</div>
          ) : (
            campanas.map((c) => (
              <div key={c.id} className="filac" onClick={() => abrir(c)}>
                <div className="quien"><b>{c.nombre}</b><span>{c.asunto || "Sin asunto"} · creada {fFecha(c.creado_en)}</span></div>
                <span className="chip canal-email">Email</span>
                <span className={`chip estado-${c.estado}`}>{c.estado}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function SecCanales({ canales }: { canales: Canal[] }) {
  return (
    <>
      <div className="cabecera-sec"><h1>Canales</h1></div>
      <div className="canal-tarjetas">
        {CANALES.map((k) => {
          const info = canales.find((x) => x.canal === k.id);
          const conectado = info?.estado === "conectado";
          return (
            <div key={k.id} className="tarjeta">
              <h3><span className={`punto ${info?.estado || "sin_conectar"}`} />{k.nombre}</h3>
              <p className="mini" style={{ margin: "8px 0 12px" }}>{k.detalle}</p>
              <p className="mini">
                <b>Estado:</b> {conectado ? "conectado" : "sin conectar"}<br />
                <b>Proveedor:</b> {info?.proveedor || "por decidir"}
              </p>
              <button className="boton secundario" disabled title="La conexión se hace desde el servidor, con las claves en secreto">
                {conectado ? "Conectado" : "Conectar (próxima fase)"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mini" style={{ marginTop: 14 }}>
        Las claves de cada proveedor viven en el servidor (variables de entorno), nunca en esta pantalla ni en la base de datos. Email será el primero, con Resend.
      </p>
    </>
  );
}

/* ================= Fichas laterales ================= */

function Cabecera({ titulo, cerrar }: { titulo: string; cerrar: () => void }) {
  return (
    <header>
      <h2>{titulo}</h2>
      <button className="boton secundario" onClick={cerrar}>Cerrar</button>
    </header>
  );
}

function FichaClienteNuevo({ cerrar, creado }: { cerrar: () => void; creado: (id: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [tel, setTel] = useState("");
  const [cumple, setCumple] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <Cabecera titulo="Nuevo cliente" cerrar={cerrar} />
      <div className="cuerpo"><div className="form-modal">
        <div className="campo"><label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="dos">
          <div className="campo"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="campo"><label>Teléfono</label><input type="tel" value={tel} onChange={(e) => setTel(e.target.value)} /></div>
        </div>
        <div className="campo"><label>Cumpleaños</label><input type="date" value={cumple} onChange={(e) => setCumple(e.target.value)} /></div>
        <p className="mini">Se crea sin consentimientos: actívalos en su ficha solo si la persona los ha dado de verdad (queda registrado como evento).</p>
        {error ? <div className="aviso mal">{error}</div> : null}
        <button
          className="boton"
          onClick={async () => {
            setError("");
            const r = await api.crearCliente({
              nombre: nombre.trim() || null,
              email: email.trim().toLowerCase() || null,
              telefono: tel.trim() || null,
              cumpleanos: cumple || null,
            });
            if (!r.ok || !r.data) { setError(r.error || "No se pudo crear."); return; }
            creado(r.data.id);
          }}
        >
          Crear cliente
        </button>
      </div></div>
    </>
  );
}

function FichaCliente({ id, cerrar, cambiado }: { id: string; cerrar: () => void; cambiado: () => void }) {
  const [f, setF] = useState<Awaited<ReturnType<typeof api.ficha>> | null>(null);
  const [candidatos, setCandidatos] = useState<Awaited<ReturnType<typeof api.candidatosSala>> | null>(null);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [tel, setTel] = useState("");
  const [cumple, setCumple] = useState("");
  const [notas, setNotas] = useState("");
  const [pendiente, setPendiente] = useState(false);

  const cargar = useCallback(async () => {
    const d = await api.ficha(id);
    setF(d);
    if (d) {
      setNombre(d.cliente.nombre ?? "");
      setEmail(d.cliente.email ?? "");
      setTel(d.cliente.telefono ?? "");
      setCumple(d.cliente.cumpleanos ?? "");
      setNotas(d.cliente.notas ?? "");
      if (d.sala.vinculadas === 0) setCandidatos(await api.candidatosSala(d.cliente.telefono));
      else setCandidatos(null);
    }
  }, [id]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!f) return <><Cabecera titulo="Cargando…" cerrar={cerrar} /><div className="cuerpo" /></>;
  const c = f.cliente;
  const deBaja = f.supresiones.length > 0;

  return (
    <>
      <Cabecera titulo={c.nombre || "Cliente"} cerrar={cerrar} />
      <div className="cuerpo">
        {deBaja ? (
          <div className="aviso mal" style={{ marginBottom: 12 }}>
            En la lista de supresión ({[...new Set(f.supresiones.map((s) => s.canal))].join(", ")}). La supresión manda sobre el consentimiento: no recibirá envíos.
          </div>
        ) : null}
        <div className="campo"><label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="dos">
          <div className="campo"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="campo"><label>Teléfono</label><input type="tel" value={tel} onChange={(e) => setTel(e.target.value)} /></div>
        </div>
        <div className="campo"><label>Cumpleaños</label><input type="date" value={cumple} onChange={(e) => setCumple(e.target.value)} /></div>
        <div className="campo"><label>Notas</label><textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
        <button
          className="boton secundario"
          disabled={pendiente}
          onClick={async () => {
            setPendiente(true);
            const r = await api.guardarCliente(id, {
              nombre: nombre.trim() || null,
              email: email.trim().toLowerCase() || null,
              telefono: tel.trim() || null,
              cumpleanos: cumple || null,
              notas: notas.trim() || null,
            });
            setPendiente(false);
            if (!r.ok) { alert(r.error || "No se pudo guardar."); return; }
            cambiado();
            cargar();
          }}
        >
          Guardar cambios
        </button>

        <div className="bloque">
          <h3>Consentimientos</h3>
          <div className="consents">
            {CANALES.map((k) => {
              const tiene = k.necesita === "email" ? !!c.email : !!c.telefono;
              return (
                <div key={k.id} className="consent">
                  <div>
                    <b style={{ fontSize: 14 }}>{k.nombre}</b>
                    <div className="mini">{tiene ? k.detalle : `Necesita ${k.necesita === "email" ? "un email" : "un teléfono"}.`}</div>
                  </div>
                  <span className="interruptor">
                    <input
                      type="checkbox"
                      checked={f.consent[k.id]}
                      disabled={!tiene || pendiente}
                      onChange={async (e) => {
                        setPendiente(true);
                        const r = await api.cambiarConsent(id, k.id as CanalId, e.target.checked);
                        setPendiente(false);
                        if (!r.ok) { alert(r.error || "No se pudo registrar."); return; }
                        cambiado();
                        cargar();
                      }}
                    />
                    <i />
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mini">Cada cambio queda registrado como evento, con fecha y origen, en el libro de consentimientos. Aquí no se borra nada.</p>
        </div>

        <div className="bloque">
          <h3>En el restaurante</h3>
          {f.sala.vinculadas > 0 ? (
            <div className="resumen-visitas">
              <div><b>{fmt(f.sala.visitas)}</b><span>Visitas</span></div>
              <div><b>{f.sala.ultima ? fFecha(f.sala.ultima) : "—"}</b><span>Última</span></div>
              <div><b style={f.sala.noshows ? { color: "var(--gamba)" } : undefined}>{fmt(f.sala.noshows)}</b><span>No-shows</span></div>
            </div>
          ) : candidatos === null ? (
            <div className="mini">Cargando…</div>
          ) : !candidatos.length ? (
            <div className="mini">Sin vínculo con la base de reservas todavía. Llegará con la carga 2026 o al vincular por teléfono.</div>
          ) : (
            <div className="mini">
              Posible ficha de sala:{" "}
              {candidatos.map((x) => (
                <button
                  key={x.id}
                  className="boton secundario"
                  style={{ margin: "4px 6px 0 0", padding: "5px 10px", fontSize: 12.5 }}
                  onClick={async () => {
                    const r = await api.vincularSala(x.id, id);
                    if (!r.ok) { alert(r.error || "No se pudo vincular."); return; }
                    cargar();
                  }}
                >
                  {x.nombre || "Sin nombre"} · {x.telefono || ""}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bloque">
          <h3>Orígenes</h3>
          <div className="mini">
            {f.origenes.length
              ? f.origenes.map((o, i) => (
                  <span key={i}>{o.origen}{o.id_externo ? ` (${o.id_externo})` : ""} · {fFecha(o.creado_en)}<br /></span>
                ))
              : `Alta ${c.origen_alta || "directa"} en el CRM.`}
          </div>
        </div>

        {!deBaja ? (
          <div className="bloque">
            <h3>Zona delicada</h3>
            <button
              className="boton peligro"
              disabled={pendiente}
              onClick={async () => {
                if (!confirm("¿Dar de baja de todos los canales y añadir a la lista de supresión?")) return;
                setPendiente(true);
                const r = await api.darDeBaja(id);
                setPendiente(false);
                if (!r.ok) { alert(r.error || "No se pudo completar la baja."); return; }
                cambiado();
                cargar();
              }}
            >
              Dar de baja de todo
            </button>
            <p className="mini" style={{ marginTop: 6 }}>
              Retira los tres consentimientos y añade sus datos a la lista de supresión. La ficha se conserva.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function FichaCampana({ campana: c, emailConectado, cerrar, guardada }: {
  campana: Campana | null;
  emailConectado: boolean;
  cerrar: () => void;
  guardada: () => void;
}) {
  const [listas, setListas] = useState<Lista[]>([]);
  const [nombre, setNombre] = useState(c?.nombre ?? "");
  const [asunto, setAsunto] = useState(c?.asunto ?? "");
  const [pre, setPre] = useState(c?.preencabezado ?? "");
  const [cuerpo, setCuerpo] = useState(c?.cuerpo_html ?? "");
  const audienciaInicial = (c?.audiencia as { tipo?: string } | null)?.tipo === "lista" && c?.lista_id ? c.lista_id : "enviables";
  const [audiencia, setAudiencia] = useState(audienciaInicial);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listarListas().then(setListas);
  }, []);

  return (
    <>
      <Cabecera titulo={c ? "Campaña" : "Nueva campaña"} cerrar={cerrar} />
      <div className="cuerpo"><div className="form-modal">
        <div className="campo"><label>Canal</label>
          <input value={`Email${emailConectado ? "" : " — sin conectar"}`} disabled />
        </div>
        <div className="campo"><label>Nombre interno</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Newsletter julio, aviso cierre agosto…" />
        </div>
        <div className="campo"><label>Asunto</label>
          <input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="Puedes usar {{nombre}}" />
        </div>
        <div className="campo"><label>Preencabezado</label>
          <input value={pre} onChange={(e) => setPre(e.target.value)} placeholder="La línea que se ve junto al asunto en la bandeja" />
        </div>
        <div className="campo"><label>Mensaje</label>
          <textarea rows={9} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} placeholder="Hola {{nombre}}, …" />
          <div className="contador">Variables disponibles: {"{{nombre}}"}</div>
        </div>
        <div className="campo"><label>Audiencia</label>
          <select value={audiencia} onChange={(e) => setAudiencia(e.target.value)}>
            <option value="enviables">Todos los enviables del canal</option>
            {listas.map((l) => <option key={l.id} value={l.id}>Lista · {l.nombre}</option>)}
          </select>
          <p className="mini" style={{ margin: "5px 0 0" }}>«Enviables» = consentimiento email vigente, menos supresiones. Con listas afinas el tiro.</p>
        </div>
        {error ? <div className="aviso mal">{error}</div> : null}
        <button
          className="boton"
          onClick={async () => {
            setError("");
            if (!nombre.trim()) { setError("Ponle un nombre interno."); return; }
            const esLista = audiencia !== "enviables";
            const r = await api.guardarCampana(c?.id ?? null, {
              nombre: nombre.trim(),
              asunto: asunto.trim() || null,
              preencabezado: pre.trim() || null,
              cuerpo_html: cuerpo || null,
              audiencia: esLista ? { tipo: "lista", lista_id: audiencia } : { tipo: "enviables" },
              lista_id: esLista ? audiencia : null,
            });
            if (!r.ok) { setError(r.error || "No se pudo guardar."); return; }
            guardada();
          }}
        >
          {c ? "Guardar cambios" : "Guardar borrador"}
        </button>
        <button className="boton secundario" disabled title="Se activa al conectar el canal">
          Enviar — canal sin conectar
        </button>
      </div></div>
    </>
  );
}

function FichaListaNueva({ cerrar, creada }: { cerrar: () => void; creada: () => void }) {
  const [nombre, setNombre] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <Cabecera titulo="Nueva lista" cerrar={cerrar} />
      <div className="cuerpo"><div className="form-modal">
        <div className="campo"><label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Prensa, VIPs, bono regalo…" /></div>
        <div className="campo"><label>Descripción</label><input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        {error ? <div className="aviso mal">{error}</div> : null}
        <button
          className="boton"
          onClick={async () => {
            if (!nombre.trim()) { setError("Ponle nombre a la lista."); return; }
            const r = await api.crearLista(nombre.trim(), desc.trim() || null);
            if (!r.ok) { setError(r.error || "No se pudo crear."); return; }
            creada();
          }}
        >
          Crear lista
        </button>
      </div></div>
    </>
  );
}

function FichaLista({ lista, cerrar, cambiada }: { lista: Lista; cerrar: () => void; cambiada: () => void }) {
  const [miembros, setMiembros] = useState<Awaited<ReturnType<typeof api.miembrosLista>> | null>(null);
  const [q, setQ] = useState("");
  const [sugerencias, setSugerencias] = useState<Cliente[]>([]);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cargar = useCallback(() => {
    api.miembrosLista(lista.id).then(setMiembros);
  }, [lista.id]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <>
      <Cabecera titulo={`Lista · ${lista.nombre}`} cerrar={cerrar} />
      <div className="cuerpo">
        {lista.descripcion ? <p className="mini" style={{ marginTop: 0 }}>{lista.descripcion}</p> : null}
        <div className="campo">
          <label>Añadir cliente</label>
          <input
            placeholder="Buscar por nombre, email o teléfono…"
            value={q}
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);
              if (tRef.current) clearTimeout(tRef.current);
              if (v.trim().length < 2) { setSugerencias([]); return; }
              tRef.current = setTimeout(async () => setSugerencias(await api.sugerirClientes(v)), 300);
            }}
          />
          {sugerencias.length ? (
            <div className="sugerencias">
              {sugerencias.map((s) => (
                <div
                  key={s.id}
                  onClick={async () => {
                    const r = await api.anadirALista(lista.id, s.id);
                    if (!r.ok) { alert(r.error || "No se pudo añadir."); return; }
                    setQ("");
                    setSugerencias([]);
                    cargar();
                    cambiada();
                  }}
                >
                  {s.nombre || s.email || s.telefono}{s.email ? ` · ${s.email}` : ""}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="bloque">
          <h3>Clientes de la lista</h3>
          {!miembros ? (
            <div className="mini">Cargando…</div>
          ) : !miembros.length ? (
            <div className="mini">Vacía todavía: busca arriba y añade.</div>
          ) : (
            miembros.map((m) => (
              <div key={m.cliente_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #E3E7E1" }}>
                <div className="mini" style={{ color: "inherit" }}>
                  <b>{m.clientes?.nombre || m.clientes?.email || m.clientes?.telefono}</b>
                  <div className="mini">{[m.clientes?.email, m.clientes?.telefono].filter(Boolean).join(" · ")}</div>
                </div>
                <button
                  className="boton secundario"
                  style={{ padding: "5px 10px", fontSize: 12 }}
                  onClick={async () => {
                    const r = await api.quitarDeLista(lista.id, m.cliente_id);
                    if (r.ok) { cargar(); cambiada(); }
                  }}
                >
                  Quitar
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
