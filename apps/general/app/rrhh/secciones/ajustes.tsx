"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "../acciones";
import {
  type Convenio, type Dispositivo,
} from "../tipos";
import type { SecProps } from "../lib-rrhh";
import "./ajustes.css";

export default function SecAjustes({ ctx, avisar }: SecProps) {
  const [sub, setSub] = useState<"convenios" | "centros" | "ausencias" | "catalogos" | "matriz" | "tablets">("convenios");
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.cargarAjustes>> | null>(null);
  const [convSel, setConvSel] = useState<string | null>(null);
  const [reglas, setReglas] = useState<Record<string, string>>({});

  const REGLAS: [keyof Convenio & string, string, string, string][] = [
    ["descanso_diario_h", "Descanso diario mínimo", "horas libres entre jornadas", "h"],
    ["descanso_semanal_dias", "Descanso semanal", "días libres consecutivos por semana", "días"],
    ["max_dias_consecutivos", "Máximo días seguidos", "días de trabajo sin descanso", "días"],
    ["jornada_max_diaria_h", "Jornada máxima diaria", "horas máximas en un día", "h"],
    ["jornada_min_diaria_h", "Jornada mínima por turno", "salvo petición del trabajador", "h"],
    ["jornada_max_semanal_h", "Jornada máxima semanal", "media semanal anual", "h"],
    ["pausa_tras_h", "Pausa obligatoria tras", "horas seguidas trabajadas", "h"],
    ["pausa_min_minutos", "Duración mínima de la pausa", "", "min"],
  ];

  const cargar = useCallback(() => {
    api.cargarAjustes().then((d) => {
      setDatos(d);
      setConvSel((prev) => prev ?? (d.convenios.find((c) => c.es_por_defecto) || d.convenios[0])?.id ?? null);
    });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (!datos || !convSel) return;
    const c = datos.convenios.find((x) => x.id === convSel);
    if (!c) return;
    const r: Record<string, string> = {};
    for (const [k] of REGLAS) r[k] = c[k] != null ? String(c[k]) : "";
    setReglas(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, convSel]);

  if (!datos) return <div className="vacio">Cargando…</div>;
  const conv = datos.convenios.find((x) => x.id === convSel);
  const configDe = (centroId: string) => datos.config.find((c) => c.centro_id === centroId);
  const matrizSet = new Set(datos.matriz.map((r) => `${r.centro_id}|${r.departamento_id}`));

  const SUBS: [typeof sub, string, string][] = [
    ["convenios", "Convenios y reglas", "Descansos, jornadas, avisos"],
    ["centros", "Centros y fichaje", "Ubicación, radio y convenio"],
    ["ausencias", "Tipos de ausencia", "Catálogo y vacaciones"],
    ["catalogos", "Departamentos y contratos", "Listas de la ficha"],
    ["matriz", "Departamentos por centro", "Qué hay en cada centro"],
    ["tablets", "Tablets", "Kioscos de fichaje"],
  ];

  return (
    <>
      <div className="barra" />
      <div className="layout-aj">
        <aside className="aside-aj">
          {SUBS.map(([id, titulo, det]) => (
            <button key={id} className={`nav-sec ${sub === id ? "activa" : ""}`} onClick={() => setSub(id)}>
              {titulo}<small>{det}</small>
            </button>
          ))}
        </aside>
        <section className="aj-cuerpo">
          {sub === "convenios" && conv ? (
            <>
              <h2>Convenios y reglas</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Las reglas alimentan los avisos del cuadrante. No bloquean: avisan al encargado.</div>
              <div className="chip-conv">
                {datos.convenios.map((x) => (
                  <button key={x.id} className={x.id === convSel ? "activa" : ""} onClick={() => setConvSel(x.id)}>
                    {x.nombre}{x.es_por_defecto ? <span className="badge-def">por defecto</span> : null}
                  </button>
                ))}
              </div>
              <div className="panel">
                <h3>Reglas de «{conv.nombre}»</h3>
                <div className="nota" style={{ marginBottom: 12 }}>Deja un campo vacío para desactivar ese aviso.</div>
                {REGLAS.map(([k, t, d, u]) => (
                  <div key={k} className="grid-regla">
                    <div className="txt">{t}<small>{d}</small></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="number" step={0.5} min={0} value={reglas[k] ?? ""} onChange={(e) => setReglas({ ...reglas, [k]: e.target.value })} />
                      <span style={{ fontSize: 12, color: "var(--tinta-suave)", minWidth: 26 }}>{u}</span>
                    </div>
                  </div>
                ))}
                <div className="fila-guardar">
                  <button className="btn btn-primario" onClick={async () => {
                    const campos: Record<string, number | null> = {};
                    for (const [k] of REGLAS) campos[k] = reglas[k] === "" ? null : Number(reglas[k]);
                    const r = await api.guardarConvenio(conv.id, campos);
                    avisar(r.ok ? "Reglas guardadas" : "No se pudo guardar: " + r.error);
                    if (r.ok) cargar();
                  }}>Guardar reglas</button>
                </div>
              </div>
            </>
          ) : null}

          {sub === "centros" ? (
            <>
              <h2>Centros y fichaje</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Coordenadas y radio para el fichaje móvil, convenio y pacto de descanso por centro.</div>
              <div className="aviso-caja">Para obtener lat/lng: abre Google Maps, clic derecho sobre el local y copia los dos números.</div>
              {datos.centros.map((c) => {
                const cfg = configDe(c.id);
                if (!cfg) return null;
                return <PanelCentroConfig key={c.id} centro={c} cfg={cfg} convenios={datos.convenios} avisar={avisar} recargar={cargar} />;
              })}
            </>
          ) : null}

          {sub === "ausencias" ? (
            <>
              <h2>Tipos de ausencia</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Qué ausencias existen, cuáles restan de vacaciones y cuáles puede pedir el empleado.</div>
              <div className="panel">
                <table className="aj">
                  <thead><tr><th>Tipo</th><th className="c">Activo</th><th className="c">Resta vacaciones</th><th className="c">La pide el empleado</th></tr></thead>
                  <tbody>
                    {datos.tiposAusencia.map((t) => (
                      <tr key={t.id}>
                        <td>{t.nombre}</td>
                        {(["activo", "computa_vacaciones", "solicitable_empleado"] as const).map((campo) => (
                          <td key={campo} className="c">
                            <label className="switch">
                              <input type="checkbox" checked={!!t[campo]} onChange={async (e) => {
                                const r = await api.guardarCatalogo("rrhh_tipos_ausencia", t.id, { [campo]: e.target.checked });
                                avisar(r.ok ? "Guardado" : "No se pudo guardar");
                                cargar();
                              }} />
                              <span className="slider" />
                            </label>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AnadirCatalogo tabla="rrhh_tipos_ausencia" titulo="Añadir tipo" placeholder="Ej.: Permiso por mudanza" avisar={avisar} recargar={cargar} />
            </>
          ) : null}

          {sub === "catalogos" ? (
            <>
              <h2>Departamentos y contratos</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Las listas de la ficha del empleado. Desactivar un valor lo oculta de los desplegables, pero no cambia a quien ya lo tenga.</div>
              {([["Departamentos", "departamentos", datos.departamentos], ["Tipos de contrato", "rrhh_tipos_contrato", datos.tiposContrato]] as const).map(([titulo, tabla, filas]) => (
                <div key={tabla} className="panel">
                  <h3>{titulo}</h3>
                  <table className="aj">
                    <thead><tr><th>Nombre</th><th className="c">Activo</th><th className="c" /></tr></thead>
                    <tbody>
                      {filas.map((fila) => (
                        <tr key={fila.id}>
                          <td>{fila.nombre}</td>
                          <td className="c">
                            <label className="switch">
                              <input type="checkbox" checked={!!fila.activo} onChange={async (e) => {
                                const r = await api.guardarCatalogo(tabla, fila.id, { activo: e.target.checked });
                                avisar(r.ok ? "Guardado" : "No se pudo guardar");
                                cargar();
                              }} />
                              <span className="slider" />
                            </label>
                          </td>
                          <td className="c">
                            <button className="btn btn-fantasma btn-peque" onClick={async () => {
                              if (!confirm("¿Quitar este valor de la lista? Quien ya lo tenga asignado lo conserva.")) return;
                              const r = await api.borrarCatalogo(tabla, fila.id);
                              avisar(r.ok ? "Quitado" : r.error || "No se pudo quitar");
                              cargar();
                            }}>Quitar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <AnadirCatalogo tabla={tabla} titulo={`Añadir a ${titulo.toLowerCase()}`} placeholder="Nombre nuevo" avisar={avisar} recargar={cargar} />
                </div>
              ))}
            </>
          ) : null}

          {sub === "matriz" ? (
            <>
              <h2>Departamentos por centro</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Marca qué departamentos existen en cada centro. En la ficha del empleado, el desplegable mostrará solo los de su centro.</div>
              <div className="panel" style={{ overflowX: "auto" }}>
                <table className="aj" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "#fff" }}>Centro</th>
                      {datos.departamentos.filter((d) => d.activo).map((d) => (
                        <th key={d.id} className="c" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 90, whiteSpace: "nowrap" }}>{d.nombre}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.centros.map((c) => (
                      <tr key={c.id}>
                        <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600 }}>{c.nombre}</td>
                        {datos.departamentos.filter((d) => d.activo).map((d) => (
                          <td key={d.id} className="c">
                            <label className="switch">
                              <input type="checkbox" checked={matrizSet.has(`${c.id}|${d.id}`)} onChange={async (e) => {
                                const r = await api.toggleMatriz(c.id, d.id, e.target.checked);
                                avisar(r.ok ? "Guardado" : "No se pudo guardar");
                                cargar();
                              }} />
                              <span className="slider" />
                            </label>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {sub === "tablets" ? <SecDispositivos ctx={ctx} avisar={avisar} /> : null}
        </section>
      </div>
    </>
  );
}

function PanelCentroConfig({ centro, cfg, convenios, avisar, recargar }: {
  centro: { id: string; nombre: string; lat: number | null; lng: number | null };
  cfg: { radio_fichaje_m: number | null; convenio_id: string | null; pacto_descanso_10h: boolean | null };
  convenios: Convenio[];
  avisar: (m: string) => void;
  recargar: () => void;
}) {
  const [lat, setLat] = useState(centro.lat != null ? String(centro.lat) : "");
  const [lng, setLng] = useState(centro.lng != null ? String(centro.lng) : "");
  const [radio, setRadio] = useState(String(cfg.radio_fichaje_m ?? 150));
  const [convenioId, setConvenioId] = useState(cfg.convenio_id ?? "");
  const [pacto, setPacto] = useState(!!cfg.pacto_descanso_10h);
  return (
    <div className="panel">
      <h3>{centro.nombre}</h3>
      <div className="grid-2">
        <div><label>Latitud</label><input type="number" step={0.000001} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="39.8xxxxx" style={{ width: "100%" }} /></div>
        <div><label>Longitud</label><input type="number" step={0.000001} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="4.2xxxxx" style={{ width: "100%" }} /></div>
      </div>
      <div className="grid-2">
        <div><label>Radio de fichaje (metros)</label><input type="number" min={20} step={10} value={radio} onChange={(e) => setRadio(e.target.value)} style={{ width: "100%" }} /></div>
        <div><label>Convenio</label>
          <select value={convenioId} onChange={(e) => setConvenioId(e.target.value)} style={{ width: "100%" }}>
            {convenios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="check">
        <input type="checkbox" id={`rh-pacto-${centro.id}`} checked={pacto} onChange={(e) => setPacto(e.target.checked)} />
        <label htmlFor={`rh-pacto-${centro.id}`} style={{ margin: 0 }}>Pacto de descanso reducido a 10 h entre jornadas</label>
      </div>
      <div className="fila-guardar">
        <button className="btn btn-primario btn-peque" onClick={async () => {
          const r = await api.guardarCentroConfig(
            centro.id,
            { radio_fichaje_m: radio === "" ? 150 : Number(radio), convenio_id: convenioId || undefined, pacto_descanso_10h: pacto },
            { lat: lat === "" ? null : Number(lat), lng: lng === "" ? null : Number(lng) },
          );
          avisar(r.ok ? "Centro actualizado" : "No se pudo guardar: " + r.error);
          if (r.ok) recargar();
        }}>Guardar</button>
      </div>
    </div>
  );
}

function AnadirCatalogo({ tabla, titulo, placeholder, avisar, recargar }: {
  tabla: "rrhh_tipos_ausencia" | "rrhh_tipos_contrato" | "departamentos";
  titulo: string;
  placeholder: string;
  avisar: (m: string) => void;
  recargar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  return (
    <div className="panel">
      <h3>{titulo}</h3>
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={{ marginTop: 0 }}>Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={placeholder} style={{ width: "100%" }} />
        </div>
        <button className="btn btn-primario btn-peque" onClick={async () => {
          if (!nombre.trim()) { avisar("Escribe un nombre"); return; }
          const r = await api.anadirCatalogo(tabla, nombre.trim());
          avisar(r.ok ? "Añadido" : "No se pudo añadir: " + r.error);
          if (r.ok) { setNombre(""); recargar(); }
        }}>Añadir</button>
      </div>
    </div>
  );
}

/* ==================== TABLETS (antes Dispositivos) ==================== */

function SecDispositivos({ ctx, avisar }: SecProps) {
  const [lista, setLista] = useState<Dispositivo[] | null>(null);
  const [tokenNuevo, setTokenNuevo] = useState<{ nombre: string; token: string } | null>(null);
  const [alta, setAlta] = useState(false);
  const [nNombre, setNNombre] = useState("");
  const [nCentro, setNCentro] = useState(ctx.centros[0]?.id ?? "");

  const cargar = useCallback(() => { api.listarDispositivos().then(setLista); }, []);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <div className="barra">
        <button className="btn btn-primario" onClick={() => setAlta(true)}>+ Nueva tablet</button>
      </div>
      {tokenNuevo ? (
        <div className="aviso-caja" style={{ maxWidth: 860 }}>
          Código de <b>{tokenNuevo.nombre}</b> (cópialo ahora, no se volverá a mostrar):{" "}
          <code style={{ fontSize: 14, fontWeight: 700, userSelect: "all" }}>{tokenNuevo.token}</code>
          {" "}· pégalo en el kiosco de la tablet (/kiosco).
        </div>
      ) : null}
      {lista === null ? (
        <div className="vacio">Cargando…</div>
      ) : (
        <div className="panel" style={{ maxWidth: 860 }}>
          <table className="aj">
            <thead><tr><th>Tablet</th><th>Centro</th><th className="c">Activa</th><th /></tr></thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id}>
                  <td>{d.nombre}</td>
                  <td>{d.centros?.nombre || "—"}</td>
                  <td className="c">
                    <label className="switch">
                      <input type="checkbox" checked={d.activo} onChange={async (e) => {
                        const r = await api.toggleDispositivo(d.id, e.target.checked);
                        avisar(r.ok ? (e.target.checked ? "Tablet activada" : "Tablet desactivada") : r.error || "No se pudo");
                        cargar();
                      }} />
                      <span className="slider" />
                    </label>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="link-btn2" onClick={async () => {
                      if (!confirm(`¿Regenerar el código de «${d.nombre}»? El actual dejará de funcionar y habrá que pegarlo de nuevo en esa tablet.`)) return;
                      const r = await api.regenerarToken(d.id);
                      if (!r.ok || !r.data) { avisar(r.error || "No se pudo"); return; }
                      setTokenNuevo({ nombre: d.nombre ?? "tablet", token: r.data });
                    }}>Regenerar código</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="nota" style={{ marginTop: 10 }}>
            El código solo se guarda cifrado: al crear o regenerar se muestra una única vez. Las tablets lo recuerdan en su pantalla de configuración (5 toques en la cabecera del kiosco).
          </div>
        </div>
      )}

      {alta ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setAlta(false); }}>
          <form className="modal" onSubmit={async (e) => {
            e.preventDefault();
            if (!nNombre.trim()) return;
            const r = await api.crearDispositivo(nCentro, nNombre.trim());
            if (!r.ok || !r.data) { avisar(r.error || "No se pudo crear"); return; }
            setAlta(false);
            setTokenNuevo({ nombre: nNombre.trim(), token: r.data });
            setNNombre("");
            cargar();
          }}>
            <h2>Nueva tablet</h2>
            <label>Nombre</label>
            <input value={nNombre} onChange={(e) => setNNombre(e.target.value)} placeholder="Tablet Casa Tirant barra" />
            <label>Centro</label>
            <select value={nCentro} onChange={(e) => setNCentro(e.target.value)}>
              {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <div className="modal-acciones">
              <button type="button" className="btn btn-fantasma" onClick={() => setAlta(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primario">Crear y ver código</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
