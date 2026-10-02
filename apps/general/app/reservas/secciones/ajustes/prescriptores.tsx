"use client";

/* Ajustes › Prescriptores: hoteles, agencias y empresas que recomiendan. Tipo, contacto, comisión
   y slug para los enlaces de campaña del widget (?p=<slug>). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { borrarPrescriptor, guardarPrescriptor, listarPrescriptores, type CamposPrescriptor, type Prescriptor } from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, Chip, Confirmar, Interruptor, ModalForm, SoloLectura, Vacio, useAccion, type AjProps } from "./comunes";

const TIPOS: { id: string; texto: string; color: string }[] = [
  { id: "hotel", texto: "Hotel", color: "#2F80ED" },
  { id: "agencia", texto: "Agencia", color: "#7C3AED" },
  { id: "empresa", texto: "Empresa", color: "#D99A1E" },
  { id: "canal", texto: "Canal", color: "#16A34A" },
  { id: "otro", texto: "Otro", color: "#8A9199" },
];
const tipoDe = (id: string) => TIPOS.find((t) => t.id === id) ?? TIPOS[4];

function slugDe(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

type Form = { nombre: string; tipo: string; telefono: string; email: string; comision_pct: string; slug: string; notas: string; activo: boolean };

function Modal({ p, enlaceBase, avisar, cerrar, guardado, puedeBorrar }: { p: Prescriptor | null; enlaceBase: string; avisar: (m: string) => void; cerrar: () => void; guardado: () => void; puedeBorrar: boolean }) {
  const [f, setF] = useState<Form>({
    nombre: p?.nombre ?? "",
    tipo: p?.tipo ?? "hotel",
    telefono: p?.telefono ?? "",
    email: p?.email ?? "",
    comision_pct: p?.comision_pct != null ? String(p.comision_pct) : "",
    slug: p?.slug ?? "",
    notas: p?.notas ?? "",
    activo: p ? p.activo : true,
  });
  const [slugManual, setSlugManual] = useState(!!p?.slug);
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const slugFinal = slugManual ? slugDe(f.slug) : slugDe(f.nombre);

  async function guardar() {
    const c: CamposPrescriptor = {
      nombre: f.nombre,
      tipo: f.tipo,
      telefono: f.telefono || null,
      email: f.email || null,
      comision_pct: f.comision_pct === "" ? null : parseFloat(f.comision_pct.replace(",", ".")),
      slug: slugFinal || null,
      notas: f.notas || null,
      activo: f.activo,
    };
    const r = await correr(guardarPrescriptor(p?.id ?? null, c), p ? "Prescriptor guardado." : "Prescriptor creado.");
    if (r.ok) guardado();
  }

  return (
    <>
      <ModalForm soloLectura={!puedeBorrar} titulo={p ? p.nombre : "Nuevo prescriptor"} onCerrar={cerrar} onGuardar={guardar} ocupado={ocupado} guardarTexto={p ? "Guardar" : "Crear"}
        extra={p && puedeBorrar ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>Borrar</Boton> : null}>
        <div className="aj-form">
          <Campo label="Nombre" ancho={2}><input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={80} placeholder="Hotel Torralbenc" /></Campo>
          <Campo label="Tipo">
            <select value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>{TIPOS.map((t) => <option key={t.id} value={t.id}>{t.texto}</option>)}</select>
          </Campo>
          <Campo label="Teléfono"><input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} /></Campo>
          <Campo label="Email"><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Campo>
          <Campo label="Comisión" ayuda="Porcentaje sobre la cuenta, si lo hay."><div className="aj-con-unidad"><input type="number" min={0} max={100} step={0.5} value={f.comision_pct} onChange={(e) => set("comision_pct", e.target.value)} placeholder="0" /><span>%</span></div></Campo>
          <Campo label="Enlace de campaña" ancho="todo" ayuda={slugFinal ? `${enlaceBase}?p=${slugFinal} — las reservas que entren por aquí se atribuyen a este prescriptor.` : "Se genera a partir del nombre."}>
            <div className="aj-linea">
              <input value={slugManual ? f.slug : slugFinal} style={{ flex: 1 }} onChange={(e) => { setSlugManual(true); set("slug", e.target.value); }} placeholder="hotel-torralbenc" />
              {slugManual ? <Boton tipo="fantasma" className="mini" onClick={() => { setSlugManual(false); set("slug", ""); }}>Automático</Boton> : null}
            </div>
          </Campo>
          <Campo label="Notas" ancho="todo"><textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} maxLength={400} placeholder="Contacto en recepción, condiciones acordadas…" /></Campo>
          <Campo label="Estado"><Interruptor on={f.activo} onChange={(v) => set("activo", v)} texto={f.activo ? "Activo" : "Inactivo (no se ofrece en el modal)"} /></Campo>
        </div>
      </ModalForm>
      {confirmar && p ? (
        <Confirmar texto={`¿Borrar «${p.nombre}»?`} detalle="Si tiene reservas o clientes atribuidos, se desactiva en vez de borrarse." confirmarTexto="Borrar" peligro ocupado={ocupado} onNo={() => setConfirmar(false)}
          onSi={async () => { const r = await correr(borrarPrescriptor(p.id)); if (r.ok) { avisar(r.data?.desactivado ? "Tenía reservas: se ha desactivado." : "Prescriptor borrado."); guardado(); } setConfirmar(false); }} />
      ) : null}
    </>
  );
}

export default function AjPrescriptores({ rest, avisar, puedeEditar }: AjProps) {
  const [lista, setLista] = useState<Prescriptor[] | null>(null);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [modal, setModal] = useState<{ p: Prescriptor | null } | null>(null);
  const { correr } = useAccion(avisar);
  const ro = !puedeEditar;
  const enlaceBase = `${(rest.url_base || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "")}/reservar-mesa/${rest.slug}`;

  const cargar = useCallback(async () => setLista(await listarPrescriptores()), []);
  useEffect(() => { cargar(); }, [cargar]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (lista ?? []).filter((p) => (verInactivos || p.activo) && (!tipo || p.tipo === tipo) && (!t || p.nombre.toLowerCase().includes(t) || (p.slug ?? "").includes(t) || (p.email ?? "").toLowerCase().includes(t)));
  }, [lista, q, tipo, verInactivos]);

  const copiar = async (p: Prescriptor) => {
    if (!p.slug) return;
    try { await navigator.clipboard.writeText(`${enlaceBase}?p=${p.slug}`); avisar("Enlace copiado."); } catch { avisar("No se ha podido copiar."); }
  };

  return (
    <>
      <Cabecera titulo="Prescriptores" texto="Quién recomienda el restaurante. Cada uno tiene un enlace de campaña: las reservas que entren por él quedan atribuidas y salen en Informes.">
        {!ro ? <Boton tipo="primario" onClick={() => setModal({ p: null })}>+ Nuevo prescriptor</Boton> : null}
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      <div className="aj-linea" style={{ marginBottom: 10 }}>
        <input placeholder="Buscar por nombre, enlace o email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 220px", maxWidth: 360 }} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.texto}</option>)}
        </select>
        <Interruptor on={verInactivos} onChange={setVerInactivos} texto="Ver inactivos" pequeno />
        <span className="mudo" style={{ marginLeft: "auto", fontSize: 12 }}>{filtrados.length} de {(lista ?? []).length}</span>
      </div>

      {lista === null ? (
        <div className="spinner" />
      ) : (
        <div className="aj-tabla-env">
          <table className="aj-tabla">
            <thead>
              <tr><th>Nombre</th><th>Tipo</th><th>Contacto</th><th className="num">Comisión</th><th>Enlace de campaña</th><th className="acc" /></tr>
            </thead>
            <tbody>
              {filtrados.map((p) => {
                const t = tipoDe(p.tipo);
                return (
                  <tr key={p.id} className={p.activo ? "" : "inactiva"}>
                    <td className="nombre">{p.nombre}{p.notas ? <span className="det">{p.notas}</span> : null}</td>
                    <td><Chip color={t.color}>{t.texto}</Chip></td>
                    <td>{p.telefono || p.email ? <>{p.telefono}{p.telefono && p.email ? " · " : ""}{p.email}</> : <span className="mudo">—</span>}</td>
                    <td className="num">{p.comision_pct != null ? `${p.comision_pct} %` : <span className="mudo">—</span>}</td>
                    <td>
                      {p.slug ? (
                        <span className="aj-linea" style={{ gap: 4 }}>
                          <span className="mono" style={{ fontSize: 12 }}>?p={p.slug}</span>
                          <Boton className="icono" tipo="fantasma" onClick={() => copiar(p)} title="Copiar enlace completo">⧉</Boton>
                        </span>
                      ) : <span className="mudo">—</span>}
                    </td>
                    <td className="acc">
                      {!ro ? <Interruptor on={p.activo} pequeno onChange={async (v) => { const r = await correr(guardarPrescriptor(p.id, { nombre: p.nombre, tipo: p.tipo, telefono: p.telefono, email: p.email, comision_pct: p.comision_pct, slug: p.slug, notas: p.notas, activo: v })); if (r.ok) cargar(); }} /> : null}
                      <Boton className="mini" onClick={() => setModal({ p })}>{ro ? "Ver" : "Editar"}</Boton>
                    </td>
                  </tr>
                );
              })}
              {!filtrados.length ? <tr><td colSpan={6}><Vacio>{lista.length ? "Nada que coincida con el filtro." : "Sin prescriptores. Añade los hoteles y agencias que os mandan clientes."}</Vacio></td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {modal ? <Modal p={modal.p} enlaceBase={enlaceBase} avisar={avisar} puedeBorrar={!ro} cerrar={() => setModal(null)} guardado={async () => { setModal(null); await cargar(); }} /> : null}
    </>
  );
}
