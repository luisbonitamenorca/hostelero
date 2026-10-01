"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "../acciones";
import {
  calcularDia, efectivosDe, fmtDia, horaDe, hoyIso, iniciales, NT, type Empleado, type Fichaje, type Periodo,
} from "../tipos";
import type { SecProps } from "../lib-rrhh";
import "./empleados.css";

export default function SecEmpleados({ ctx, avisar }: SecProps) {
  const [maestros, setMaestros] = useState<Awaited<ReturnType<typeof api.cargarMaestros>> | null>(null);
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.cargarEmpleados>> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [fCentro, setFCentro] = useState("");
  const [fDepto, setFDepto] = useState("");
  const [soloActivos, setSoloActivos] = useState(false);

  const cargar = useCallback(() => { api.cargarEmpleados().then(setDatos); }, []);
  useEffect(() => {
    api.cargarMaestros().then(setMaestros);
    cargar();
  }, [cargar]);

  if (!maestros || !datos) return <div className="vacio">Cargando…</div>;
  const nombreCentro = (id: string | null) => maestros.centros.find((c) => c.id === id)?.nombre || "—";

  const f = filtro.toLowerCase();
  const lista = datos.empleados.filter(
    (e) =>
      `${e.nombre} ${e.apellidos || ""}`.toLowerCase().includes(f) &&
      (!fDepto || e.departamento === fDepto) &&
      (!fCentro || e.centro_principal_id === fCentro) &&
      (!soloActivos || e._activo),
  );
  const centrosUsados = [...new Set(datos.empleados.map((e) => e.centro_principal_id).filter(Boolean))];
  const base = fCentro ? datos.empleados.filter((e) => e.centro_principal_id === fCentro) : datos.empleados;
  const depUsados = [...new Set(base.map((e) => e.departamento).filter(Boolean))].sort() as string[];
  const nActivos = datos.empleados.filter((e) => e._activo).length;
  const empleadoSel = sel ? datos.empleados.find((e) => e.id === sel) ?? null : null;

  return (
    <>
      <div className="barra">
        {ctx.esGestor ? (
          <button className="btn btn-primario" onClick={async () => {
            const nombre = prompt("Nombre del empleado:");
            if (!nombre?.trim()) return;
            const apellidos = prompt("Apellidos:") ?? "";
            const idx = Number(prompt(`Centro principal (número):\n${maestros.centros.map((c, i) => `${i + 1}. ${c.nombre}`).join("\n")}`));
            const centro = maestros.centros[idx - 1];
            if (!centro) { avisar("Centro no válido"); return; }
            const horas = Number(prompt("Horas/semana del contrato:", "40")) || null;
            const r = await api.altaEmpleado({ nombre: nombre.trim(), apellidos: apellidos.trim(), centroId: centro.id, horasSemana: horas });
            if (!r.ok) { avisar("No se pudo crear: " + r.error); return; }
            avisar(`${nombre} añadido a ${centro.nombre}`);
            cargar();
            setSel(r.data ?? null);
          }}>+ Añadir empleado</button>
        ) : null}
      </div>
      <div className="layout-emp">
        <aside className="aside-emp">
          <input placeholder="Buscar por nombre…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <select value={fCentro} onChange={(e) => { setFCentro(e.target.value); setFDepto(""); }}>
            <option value="">Todos los centros</option>
            {maestros.centros.filter((c) => centrosUsados.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <select value={fDepto} onChange={(e) => setFDepto(e.target.value)}>
            <option value="">Todos los departamentos</option>
            {depUsados.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className="contador-emp">
            {lista.length} de {datos.empleados.length} ·{" "}
            <label style={{ display: "inline", fontWeight: 400, margin: 0, cursor: "pointer" }}>
              <input type="checkbox" checked={soloActivos} onChange={(e) => setSoloActivos(e.target.checked)} style={{ width: "auto", verticalAlign: "middle" }} /> solo activos ({nActivos})
            </label>
          </div>
          <div className="lista-emp">
            {lista.map((e) => (
              <div key={e.id} className={`item-emp ${sel === e.id ? "activo" : ""}`} style={e._activo ? undefined : { opacity: 0.5 }} onClick={() => setSel(e.id)}>
                <div className="avatar">{iniciales(e.nombre + " " + (e.apellidos || ""))}</div>
                <div>
                  <div className="np">{e.nombre} {e.apellidos || ""}{e._activo ? "" : <span style={{ fontSize: 10, color: "var(--tinta-suave)", fontWeight: 400 }}> · inactivo</span>}</div>
                  <div className="sub">{nombreCentro(e.centro_principal_id)}{e.departamento ? ` · ${e.departamento}` : ""}</div>
                </div>
              </div>
            ))}
            {!lista.length ? <div className="vacio">Sin resultados.</div> : null}
          </div>
        </aside>
        <section>
          {!empleadoSel ? (
            <div className="vacio">Elige a alguien de la lista.</div>
          ) : (
            <FichaEmpleado
              key={empleadoSel.id}
              empleado={empleadoSel}
              maestros={maestros}
              asignados={datos.asignaciones[empleadoSel.id] ?? []}
              esGestor={ctx.esGestor}
              avisar={avisar}
              recargar={cargar}
            />
          )}
        </section>
      </div>
    </>
  );
}

function FichaEmpleado({ empleado: e, maestros, asignados, esGestor, avisar, recargar }: {
  empleado: Empleado;
  maestros: Awaited<ReturnType<typeof api.cargarMaestros>>;
  asignados: string[];
  esGestor: boolean;
  avisar: (m: string) => void;
  recargar: () => void;
}) {
  const [nombre, setNombre] = useState(e.nombre);
  const [apellidos, setApellidos] = useState(e.apellidos ?? "");
  const [email, setEmail] = useState(e.email ?? "");
  const [telefono, setTelefono] = useState(e.telefono ?? "");
  const [centroId, setCentroId] = useState(e.centro_principal_id ?? maestros.centros[0]?.id ?? "");
  const [depto, setDepto] = useState(e.departamento ?? "");
  const [contrato, setContrato] = useState(e.tipo_contrato ?? "");
  const [movil, setMovil] = useState(!!e.fichaje_movil);
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [historial, setHistorial] = useState<Fichaje[] | null>(null);
  const [pinNuevo, setPinNuevo] = useState("");
  const [nAlta, setNAlta] = useState(hoyIso());
  const [nBaja, setNBaja] = useState("");
  const [nHoras, setNHoras] = useState("");

  const cargarPeriodos = useCallback(() => { api.periodosDe(e.id).then(setPeriodos); }, [e.id]);
  useEffect(() => {
    cargarPeriodos();
    api.historicoFichajes(e.id).then(setHistorial);
  }, [e.id, cargarPeriodos]);

  const dis = !esGestor;
  const deptosCentro = maestros.deptosPorCentro[centroId]?.length ? maestros.deptosPorCentro[centroId] : maestros.departamentos;
  const hoy = hoyIso();
  const estadoPeriodo = (p: Periodo) =>
    p.fecha_alta > hoy
      ? { txt: "Próximo", color: "var(--blue)", bg: "var(--blue-light)" }
      : p.fecha_baja && p.fecha_baja < hoy
        ? { txt: "Finalizado", color: "var(--tinta-suave)", bg: "var(--arena)" }
        : { txt: "Activo", color: "var(--green)", bg: "var(--green-light)" };

  // Histórico agrupado por día
  const dias: Record<string, Fichaje[]> = {};
  for (const fch of historial ?? []) {
    const d = new Date(fch.ts).toLocaleDateString("sv-SE");
    (dias[d] = dias[d] || []).push(fch);
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="cab-ficha">
        <div className="avatar grande">{iniciales(e.nombre + " " + (e.apellidos || ""))}</div>
        <h2>{e.nombre} {e.apellidos || ""}</h2>
        {e.departamento ? <span className="badge" style={{ background: "var(--arena)" }}>{e.departamento}</span> : null}
        {e.fichaje_movil ? <span className="badge encurso">Fichaje móvil</span> : null}
      </div>
      <div className="subcab">Asignado a: {asignados.length ? asignados.map((id) => maestros.centros.find((c) => c.id === id)?.nombre || "—").join(" · ") : "Sin asignaciones"}</div>

      <div className="panel">
        <h3>Datos</h3>
        <form onSubmit={async (ev) => {
          ev.preventDefault();
          const r = await api.guardarEmpleado(e.id, {
            nombre: nombre.trim(),
            apellidos: apellidos.trim() || null,
            email: email.trim() || null,
            telefono: telefono.trim() || null,
            centro_principal_id: centroId,
            tipo_contrato: contrato.trim() || null,
            departamento: depto.replace(/ \(otro centro\)$/, "").trim() || null,
            fichaje_movil: movil,
          }, asignados);
          if (!r.ok) { avisar("No se pudo guardar: " + r.error); return; }
          avisar("Ficha guardada");
          recargar();
        }}>
          <div className="grid-2">
            <div><label>Nombre</label><input value={nombre} onChange={(ev) => setNombre(ev.target.value)} disabled={dis} style={{ width: "100%" }} /></div>
            <div><label>Apellidos</label><input value={apellidos} onChange={(ev) => setApellidos(ev.target.value)} disabled={dis} style={{ width: "100%" }} /></div>
            <div><label>Email</label><input value={email} onChange={(ev) => setEmail(ev.target.value)} disabled={dis} style={{ width: "100%" }} /></div>
            <div><label>Teléfono</label><input value={telefono} onChange={(ev) => setTelefono(ev.target.value)} disabled={dis} style={{ width: "100%" }} /></div>
          </div>
          <div className="grid-2">
            <div><label>Centro principal</label>
              <select value={centroId} onChange={(ev) => setCentroId(ev.target.value)} disabled={dis} style={{ width: "100%" }}>
                {maestros.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div><label>Departamento</label>
              <select value={depto} onChange={(ev) => setDepto(ev.target.value)} disabled={dis} style={{ width: "100%" }}>
                <option value="">— sin asignar —</option>
                {deptosCentro.map((d) => <option key={d} value={d}>{d}</option>)}
                {depto && !deptosCentro.includes(depto) ? <option value={depto}>{depto} (otro centro)</option> : null}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div><label>Tipo de contrato</label>
              <select value={contrato} onChange={(ev) => setContrato(ev.target.value)} disabled={dis} style={{ width: "100%" }}>
                <option value="">— sin asignar —</option>
                {maestros.contratos.map((c) => <option key={c} value={c}>{c}</option>)}
                {contrato && !maestros.contratos.includes(contrato) ? <option value={contrato}>{contrato}</option> : null}
              </select>
            </div>
            <div />
          </div>
          <div className="check">
            <input type="checkbox" id="rh-ef-movil" checked={movil} onChange={(ev) => setMovil(ev.target.checked)} disabled={dis} />
            <label htmlFor="rh-ef-movil" style={{ margin: 0 }}>Puede fichar desde el móvil (con geolocalización)</label>
          </div>
          {esGestor ? <div className="fila-acciones"><button className="btn btn-primario" type="submit">Guardar cambios</button></div> : null}
        </form>
      </div>

      <div className="panel">
        <h3>Periodos de contrato</h3>
        <div className="nota" style={{ marginBottom: 10 }}>
          Para fijos-discontinuos, cada temporada es un periodo (alta–baja). La fecha de baja es el último día que trabaja. Fuera de sus periodos, el empleado no aparece en el cuadrante.
        </div>
        {periodos === null ? (
          <div className="nota">Cargando…</div>
        ) : !periodos.length ? (
          <div className="nota">Sin periodos registrados.</div>
        ) : (
          <table className="aj" style={{ marginBottom: esGestor ? 14 : 0 }}>
            <thead><tr><th>Alta</th><th>Baja</th><th>Horas/sem.</th><th>Estado</th>{esGestor ? <th /> : null}</tr></thead>
            <tbody>
              {periodos.map((p) => {
                const s = estadoPeriodo(p);
                return (
                  <tr key={p.id}>
                    <td>{fmtDia(p.fecha_alta)}</td>
                    <td>{p.fecha_baja ? fmtDia(p.fecha_baja) : <span style={{ color: "var(--tinta-suave)" }}>abierto</span>}</td>
                    <td>{p.horas_semana != null ? `${p.horas_semana} h` : "—"}</td>
                    <td><span className="badge" style={{ background: s.bg, color: s.color, fontWeight: 600 }}>{s.txt}</span></td>
                    {esGestor ? (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {!p.fecha_baja ? (
                          <>
                            <button className="link-btn2" onClick={async () => {
                              const fb = prompt("Último día que trabaja (AAAA-MM-DD):", hoy);
                              if (!fb) return;
                              if (!/^\d{4}-\d{2}-\d{2}$/.test(fb)) { avisar("Formato de fecha no válido"); return; }
                              const r = await api.guardarPeriodo(p.id, e.id, { fecha_alta: p.fecha_alta, fecha_baja: fb, horas_semana: p.horas_semana });
                              if (!r.ok) { avisar("No se pudo cerrar: " + r.error); return; }
                              avisar("Periodo cerrado"); cargarPeriodos(); recargar();
                            }}>Cerrar</button>{" · "}
                          </>
                        ) : null}
                        <button className="link-btn2" onClick={async () => {
                          const alta = prompt("Fecha de alta (AAAA-MM-DD):", p.fecha_alta);
                          if (!alta) return;
                          const baja = prompt("Fecha de baja (AAAA-MM-DD, vacío = abierto):", p.fecha_baja || "");
                          const horas = prompt("Horas/semana (vacío = sin definir):", p.horas_semana != null ? String(p.horas_semana) : "");
                          const r = await api.guardarPeriodo(p.id, e.id, { fecha_alta: alta, fecha_baja: baja || null, horas_semana: horas === "" || horas == null ? null : Number(horas) });
                          if (!r.ok) { avisar("No se pudo guardar: " + r.error); return; }
                          avisar("Periodo actualizado"); cargarPeriodos(); recargar();
                        }}>Editar</button>{" · "}
                        <button className="link-btn2" style={{ color: "var(--red)" }} onClick={async () => {
                          if (!confirm("¿Borrar este periodo? Se usa para saber cuándo el empleado está activo.")) return;
                          const r = await api.borrarPeriodo(p.id, e.id);
                          if (!r.ok) { avisar("No se pudo borrar: " + r.error); return; }
                          avisar("Periodo borrado"); cargarPeriodos(); recargar();
                        }}>Borrar</button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {esGestor ? (
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div><label style={{ marginTop: 0 }}>Alta</label><input type="date" value={nAlta} onChange={(ev) => setNAlta(ev.target.value)} /></div>
            <div><label style={{ marginTop: 0 }}>Baja (opcional)</label><input type="date" value={nBaja} onChange={(ev) => setNBaja(ev.target.value)} /></div>
            <div><label style={{ marginTop: 0 }}>Horas/sem.</label><input type="number" step={0.5} min={0} value={nHoras} onChange={(ev) => setNHoras(ev.target.value)} style={{ width: 90 }} placeholder="40" /></div>
            <button className="btn btn-primario btn-peque" onClick={async () => {
              if (!nAlta) { avisar("Indica la fecha de alta"); return; }
              const r = await api.guardarPeriodo(null, e.id, { fecha_alta: nAlta, fecha_baja: nBaja || null, horas_semana: nHoras === "" ? null : Number(nHoras) });
              if (!r.ok) { avisar("No se pudo añadir: " + r.error); return; }
              avisar("Periodo añadido"); setNBaja(""); setNHoras(""); cargarPeriodos(); recargar();
            }}>Añadir periodo</button>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h3>PIN de fichaje</h3>
        <div className="pin-caja">
          <span className="nota">El PIN no se puede consultar (solo se guarda cifrado).</span>
          <button className="btn btn-fantasma" onClick={async () => {
            if (!confirm(`Generar un PIN nuevo para ${e.nombre}? El anterior dejará de funcionar al instante.`)) return;
            const r = await fetch("/api/rrhh/fichar", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ accion: "nuevo_pin", empleado_id: e.id }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.ok) { avisar(d.error || "No se pudo generar el PIN"); return; }
            setPinNuevo(d.pin);
          }}>Generar nuevo PIN</button>
          <span className="pin-valor">{pinNuevo}</span>
        </div>
        {pinNuevo ? <div className="nota" style={{ marginTop: 6 }}>Apúntalo y dáselo ahora: no se volverá a mostrar.</div> : null}
      </div>

      <div className="panel">
        <h3>Fichajes · últimos 14 días</h3>
        {historial === null ? (
          <div className="nota">Cargando…</div>
        ) : !historial.length ? (
          <div className="nota">Sin fichajes en las dos últimas semanas.</div>
        ) : (
          Object.keys(dias).sort().reverse().map((d) => {
            const { efectivos, anulados } = efectivosDe(dias[d]);
            const { horas, inc, enCurso } = calcularDia(efectivos, d === hoy);
            const sinSalida = inc.includes("entrada sin salida");
            return (
              <div key={d} className="dia-h">
                <span className="f">{new Date(d + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className="h">{horas.toFixed(2)} h</span>
                {dias[d].map((fch) => {
                  const anu = anulados.has(fch.id);
                  const cl = anu ? fch.tipo + " anulado" : fch.metodo === "correccion" ? "correccion" : fch.tipo;
                  return (
                    <span key={fch.id} className={`chip ${cl}`} style={{ cursor: "default" }} title={fch.metodo === "correccion" ? fch.motivo_correccion || "" : fch.metodo}>
                      {NT[fch.tipo]} {horaDe(fch.ts)}
                    </span>
                  );
                })}
                {enCurso && d === hoy ? <span className="badge-inc" style={{ background: "var(--green-light)", color: "var(--green)" }}>En curso</span> : null}
                {sinSalida ? <span className="badge-inc">⚠ sin salida</span> : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
