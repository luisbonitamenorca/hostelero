"use client";

/* Ajustes › Preguntas: preguntas personalizadas del widget (reservas_preguntas). Se hacen en el
   paso de datos y la respuesta queda en la reserva (reservas_reservas.respuestas).
   Tipos: sí/no, texto libre, desplegable (una opción) y varias opciones. Orden por arrastre o
   flechas; texto en inglés opcional (el widget lo usa si el cliente reserva en inglés). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { borrarPregunta, guardarPregunta, listarPreguntas, ordenarPreguntas, type CamposPregunta, type Pregunta } from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, Chip, Confirmar, Interruptor, ModalForm, Panel, SoloLectura, Vacio, useAccion, type AjProps } from "./comunes";

const TIPOS: { id: string; texto: string; ayuda: string; color: string }[] = [
  { id: "si_no", texto: "Sí / No", ayuda: "Una casilla. Ideal para trona, carrito, accesibilidad…", color: "#2F80ED" },
  { id: "texto", texto: "Texto libre", ayuda: "Una línea para que escriban (alergias, ocasión…).", color: "#7C3AED" },
  { id: "desplegable", texto: "Desplegable", ayuda: "Eligen una opción de la lista.", color: "#D99A1E" },
  { id: "multiple", texto: "Varias opciones", ayuda: "Pueden marcar varias opciones.", color: "#16A34A" },
];
const tipoDe = (id: string) => TIPOS.find((t) => t.id === id) ?? TIPOS[0];
const conOpciones = (tipo: string) => tipo === "desplegable" || tipo === "multiple";

/** Sugerencias de un clic (lo que más se pregunta en sala). */
const SUGERENCIAS: Omit<CamposPregunta, "orden" | "activa">[] = [
  { texto: "¿Necesitáis trona?", texto_en: "Do you need a high chair?", tipo: "si_no", opciones: null, obligatoria: false },
  { texto: "¿Venís con carrito de bebé?", texto_en: "Will you bring a pushchair?", tipo: "si_no", opciones: null, obligatoria: false },
  { texto: "¿Alguien del grupo va en silla de ruedas?", texto_en: "Does anyone in your party use a wheelchair?", tipo: "si_no", opciones: null, obligatoria: false },
  { texto: "¿Celebráis algo especial?", texto_en: "Are you celebrating anything?", tipo: "desplegable", opciones: ["Cumpleaños", "Aniversario", "Comida de empresa", "Pedida", "Otra celebración"], obligatoria: false },
  { texto: "¿Alguna alergia o intolerancia?", texto_en: "Any allergies or intolerances?", tipo: "texto", opciones: null, obligatoria: false },
  { texto: "¿Cómo nos habéis conocido?", texto_en: "How did you hear about us?", tipo: "desplegable", opciones: ["Recomendación", "Google", "Instagram", "Hotel", "Ya habíamos venido"], obligatoria: false },
];

/* ---- vista previa: cómo se verá en el widget (siempre en claro, como el widget) ---- */

function Vista({ texto, tipo, opciones, obligatoria }: { texto: string; tipo: string; opciones: string[]; obligatoria: boolean }) {
  const t = texto.trim() || "Texto de la pregunta";
  const ops = opciones.map((o) => o.trim()).filter(Boolean);
  const caja: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #E2DDD2", borderRadius: 12, padding: "12px 14px", fontSize: 14 };
  const etiqueta = <span style={{ fontWeight: 600 }}>{t}{obligatoria ? <span style={{ color: "#D32F2F" }}> *</span> : null}</span>;
  return (
    <div style={caja} aria-label="Vista previa en el widget">
      {tipo === "si_no" ? (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}><input type="checkbox" style={{ width: 18, height: 18, minHeight: 0 }} readOnly />{etiqueta}</label>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {etiqueta}
          {tipo === "texto" ? (
            <div style={{ border: "1px solid #CFC8BA", borderRadius: 8, height: 36, background: "#FAF8F3" }} />
          ) : tipo === "desplegable" ? (
            <div style={{ border: "1px solid #CFC8BA", borderRadius: 8, height: 36, background: "#FAF8F3", display: "flex", alignItems: "center", padding: "0 10px", color: "#6b6b6b", justifyContent: "space-between" }}>
              <span>{ops[0] ?? "Elige una opción"}</span><span>▾</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(ops.length ? ops : ["Opción 1", "Opción 2"]).map((o, i) => (
                <span key={i} style={{ border: "1px solid #CFC8BA", borderRadius: 999, padding: "4px 11px", fontSize: 13 }}>{o}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- modal de alta / edición ---- */

type Form = { texto: string; texto_en: string; tipo: string; opciones: string[]; obligatoria: boolean; activa: boolean };

function Modal({ p, restId, ordenNueva, avisar, cerrar, guardado, puedeBorrar }: {
  p: Pregunta | null; restId: string; ordenNueva: number; avisar: (m: string) => void; cerrar: () => void; guardado: () => void; puedeBorrar: boolean;
}) {
  const [f, setF] = useState<Form>({
    texto: p?.texto ?? "",
    texto_en: p?.texto_en ?? "",
    tipo: p?.tipo ?? "si_no",
    opciones: p?.opciones?.length ? [...p.opciones] : ["", ""],
    obligatoria: p?.obligatoria ?? false,
    activa: p ? p.activa : true,
  });
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const setOpcion = (i: number, v: string) => setF((x) => ({ ...x, opciones: x.opciones.map((o, j) => (j === i ? v : o)) }));
  const moverOpcion = (i: number, dir: -1 | 1) => setF((x) => {
    const j = i + dir;
    if (j < 0 || j >= x.opciones.length) return x;
    const o = [...x.opciones];
    [o[i], o[j]] = [o[j], o[i]];
    return { ...x, opciones: o };
  });

  async function guardar() {
    if (!f.texto.trim()) { avisar("Escribe el texto de la pregunta."); return; }
    const ops = f.opciones.map((o) => o.trim()).filter(Boolean);
    if (conOpciones(f.tipo)) {
      if (ops.length < 2) { avisar("Pon al menos dos opciones."); return; }
      if (new Set(ops.map((o) => o.toLowerCase())).size !== ops.length) { avisar("Hay opciones repetidas."); return; }
    }
    const c: CamposPregunta = {
      texto: f.texto,
      texto_en: f.texto_en || null,
      tipo: f.tipo,
      opciones: conOpciones(f.tipo) ? ops : null,
      obligatoria: f.obligatoria,
      orden: p?.orden ?? ordenNueva,
      activa: f.activa,
    };
    const r = await correr(guardarPregunta(p?.id ?? null, restId, c), p ? "Pregunta guardada." : "Pregunta creada.");
    if (r.ok) guardado();
  }

  return (
    <>
      <ModalForm soloLectura={!puedeBorrar} titulo={p ? "Editar pregunta" : "Nueva pregunta"} onCerrar={cerrar} onGuardar={guardar} ocupado={ocupado} guardarTexto={p ? "Guardar" : "Crear"} ancho={680}
        extra={p && puedeBorrar ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>Borrar</Boton> : null}>
        <div className="aj-form">
          <Campo label="Pregunta" ancho="todo"><input autoFocus value={f.texto} maxLength={200} onChange={(e) => set("texto", e.target.value)} placeholder="¿Necesitáis trona?" /></Campo>
          <Campo label="En inglés" ancho="todo" ayuda="Opcional. Si el cliente reserva en inglés y está vacío, se le muestra en español.">
            <input value={f.texto_en} maxLength={200} onChange={(e) => set("texto_en", e.target.value)} placeholder="Do you need a high chair?" />
          </Campo>
          <Campo label="Tipo de respuesta" ayuda={tipoDe(f.tipo).ayuda}>
            <select value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.texto}</option>)}
            </select>
          </Campo>
          <Campo label="Opciones">
            <div className="aj-interruptores">
              <Interruptor on={f.obligatoria} onChange={(v) => set("obligatoria", v)} texto={f.tipo === "si_no" ? "Obligatoria (tienen que marcarla)" : "Obligatoria"} />
              <Interruptor on={f.activa} onChange={(v) => set("activa", v)} texto={f.activa ? "Activa en el widget" : "Desactivada"} />
            </div>
          </Campo>
          {conOpciones(f.tipo) ? (
            <Campo label="Respuestas posibles" ancho="todo" ayuda="Hasta 20. El orden de aquí es el orden en el widget.">
              <div style={{ display: "grid", gap: 6 }}>
                {f.opciones.map((o, i) => (
                  <div key={i} className="aj-linea" style={{ flexWrap: "nowrap" }}>
                    <input value={o} maxLength={80} style={{ flex: 1, width: "auto" }} onChange={(e) => setOpcion(i, e.target.value)} placeholder={`Opción ${i + 1}`}
                      onKeyDown={(e) => {
                        // Enter en la última opción añade otra (sin enviar el formulario)
                        if (e.key === "Enter" && i === f.opciones.length - 1 && o.trim() && f.opciones.length < 20) { e.preventDefault(); set("opciones", [...f.opciones, ""]); }
                      }} />
                    <Boton className="icono" tipo="fantasma" disabled={i === 0} onClick={() => moverOpcion(i, -1)} title="Subir">↑</Boton>
                    <Boton className="icono" tipo="fantasma" disabled={i === f.opciones.length - 1} onClick={() => moverOpcion(i, 1)} title="Bajar">↓</Boton>
                    <Boton className="icono" tipo="peligro" disabled={f.opciones.length <= 1} onClick={() => set("opciones", f.opciones.filter((_, j) => j !== i))} title="Quitar">✕</Boton>
                  </div>
                ))}
                <div><Boton className="mini" disabled={f.opciones.length >= 20} onClick={() => set("opciones", [...f.opciones, ""])}>+ Añadir opción</Boton></div>
              </div>
            </Campo>
          ) : null}
          <Campo label="Así se verá en el widget" ancho="todo">
            <Vista texto={f.texto} tipo={f.tipo} opciones={f.opciones} obligatoria={f.obligatoria} />
          </Campo>
        </div>
      </ModalForm>
      {confirmar && p ? (
        <Confirmar texto={`¿Borrar la pregunta «${p.texto}»?`} detalle="Las respuestas ya guardadas en reservas anteriores se conservan." confirmarTexto="Borrar" peligro ocupado={ocupado}
          onNo={() => setConfirmar(false)}
          onSi={async () => { const r = await correr(borrarPregunta(p.id), "Pregunta borrada."); setConfirmar(false); if (r.ok) guardado(); }} />
      ) : null}
    </>
  );
}

/* ---- pantalla ---- */

export default function AjPreguntas({ rest, avisar, puedeEditar }: AjProps) {
  const [lista, setLista] = useState<Pregunta[] | null>(null);
  const [modal, setModal] = useState<{ p: Pregunta | null } | null>(null);
  const [arrastre, setArrastre] = useState<{ id: string; sobre: string | null } | null>(null);
  const { ocupado, correr } = useAccion(avisar);
  const ro = !puedeEditar;

  const cargar = useCallback(async () => setLista(await listarPreguntas(rest.id)), [rest.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const ordenNueva = useMemo(() => ((lista ?? []).reduce((m, p) => Math.max(m, p.orden), 0) + 10), [lista]);
  const activas = (lista ?? []).filter((p) => p.activa).length;
  // Sugerencias que aún no están (comparando el texto sin mayúsculas)
  const sugerencias = useMemo(() => {
    const ya = new Set((lista ?? []).map((p) => p.texto.trim().toLowerCase()));
    return SUGERENCIAS.filter((s) => !ya.has(s.texto.toLowerCase()));
  }, [lista]);

  async function cambiar(p: Pregunta, c: Partial<Pick<CamposPregunta, "obligatoria" | "activa">>) {
    // Optimista: el interruptor responde al momento; si falla, se relee
    setLista((xs) => (xs ?? []).map((x) => (x.id === p.id ? { ...x, ...c } : x)));
    const r = await correr(guardarPregunta(p.id, rest.id, {
      texto: p.texto, texto_en: p.texto_en, tipo: p.tipo, opciones: p.opciones, orden: p.orden,
      obligatoria: c.obligatoria ?? p.obligatoria, activa: c.activa ?? p.activa,
    }));
    if (!r.ok) await cargar();
  }

  async function reordenar(ids: string[]) {
    setLista((xs) => [...(xs ?? [])].map((x) => ({ ...x, orden: (ids.indexOf(x.id) + 1) * 10 })).sort((a, b) => a.orden - b.orden));
    const r = await correr(ordenarPreguntas(ids));
    if (!r.ok) await cargar();
  }
  const mover = (i: number, dir: -1 | 1) => {
    const ids = (lista ?? []).map((p) => p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reordenar(ids);
  };
  const soltar = () => {
    if (!arrastre || !arrastre.sobre || arrastre.id === arrastre.sobre) { setArrastre(null); return; }
    const ids = (lista ?? []).map((p) => p.id);
    const de = ids.indexOf(arrastre.id), a = ids.indexOf(arrastre.sobre);
    ids.splice(de, 1);
    ids.splice(a, 0, arrastre.id);
    setArrastre(null);
    reordenar(ids);
  };

  async function anadirSugerencia(s: (typeof SUGERENCIAS)[number]) {
    const r = await correr(guardarPregunta(null, rest.id, { ...s, orden: ordenNueva, activa: true }), "Pregunta añadida.");
    if (r.ok) await cargar();
  }

  return (
    <>
      <Cabecera titulo="Preguntas del widget" texto={`Lo que se pregunta al cliente en el paso de datos al reservar en ${rest.nombre}. La respuesta aparece en la reserva, en el modal y en la lista de sala. Mejor pocas: cada pregunta de más es una reserva que se queda a medias.`}>
        {!ro ? <Boton tipo="primario" onClick={() => setModal({ p: null })}>+ Nueva pregunta</Boton> : null}
      </Cabecera>
      {ro ? <SoloLectura /> : null}
      {lista && activas > 5 ? <div className="aj-aviso">Hay {activas} preguntas activas. Cover recomienda no pasar de 3–4 para no perder reservas en el último paso.</div> : null}

      {lista === null ? (
        <div className="spinner" />
      ) : (
        <div className="aj-tabla-env">
          <table className="aj-tabla" onDragOver={(e) => e.preventDefault()} onDrop={soltar}>
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th>Pregunta</th>
                <th>Tipo</th>
                <th>Respuestas</th>
                <th className="centro">Obligatoria</th>
                <th className="centro">Activa</th>
                <th className="acc" />
              </tr>
            </thead>
            <tbody>
              {lista.map((p, i) => {
                const t = tipoDe(p.tipo);
                return (
                  <tr
                    key={p.id}
                    className={`${p.activa ? "" : "inactiva"}${arrastre?.id === p.id ? " arrastrando" : ""}${arrastre?.sobre === p.id && arrastre.id !== p.id ? " destino" : ""}`}
                    draggable={!ro}
                    onDragStart={() => setArrastre({ id: p.id, sobre: null })}
                    onDragEnter={() => setArrastre((a) => (a ? { ...a, sobre: p.id } : a))}
                    onDragEnd={() => setArrastre(null)}
                  >
                    <td className="arrastre" title={ro ? undefined : "Arrastra para ordenar"}>{ro ? "" : "⋮⋮"}</td>
                    <td className="nombre">
                      {p.texto}
                      <span className="det">{p.texto_en ? `EN: ${p.texto_en}` : "Sin traducción al inglés"}</span>
                    </td>
                    <td><Chip color={t.color}>{t.texto}</Chip></td>
                    <td>
                      {p.opciones?.length ? (
                        <span className="mudo" style={{ fontSize: 12 }} title={p.opciones.join(" · ")}>
                          {p.opciones.slice(0, 3).join(" · ")}{p.opciones.length > 3 ? ` · +${p.opciones.length - 3}` : ""}
                        </span>
                      ) : <span className="mudo">—</span>}
                    </td>
                    <td className="centro"><Interruptor on={p.obligatoria} disabled={ro} pequeno onChange={(v) => cambiar(p, { obligatoria: v })} /></td>
                    <td className="centro"><Interruptor on={p.activa} disabled={ro} pequeno onChange={(v) => cambiar(p, { activa: v })} /></td>
                    <td className="acc">
                      {!ro ? (
                        <>
                          <Boton className="icono" tipo="fantasma" disabled={i === 0 || ocupado} onClick={() => mover(i, -1)} title="Subir">↑</Boton>
                          <Boton className="icono" tipo="fantasma" disabled={i === lista.length - 1 || ocupado} onClick={() => mover(i, 1)} title="Bajar">↓</Boton>
                        </>
                      ) : null}
                      <Boton className="mini" onClick={() => setModal({ p })}>{ro ? "Ver" : "Editar"}</Boton>
                    </td>
                  </tr>
                );
              })}
              {!lista.length ? <tr><td colSpan={7}><Vacio>Sin preguntas: el widget solo pide nombre, contacto y comentario.</Vacio></td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {!ro && lista && sugerencias.length ? (
        <Panel titulo="Sugerencias" texto="Las más habituales, listas para añadir con un clic (luego se pueden editar).">
          <div className="aj-chips">
            {sugerencias.map((s) => (
              <button key={s.texto} type="button" className="aj-chip-mesa" disabled={ocupado} onClick={() => anadirSugerencia(s)} title={`${tipoDe(s.tipo).texto}${s.opciones ? `: ${s.opciones.join(", ")}` : ""}`}>
                + {s.texto}
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      {modal ? (
        <Modal p={modal.p} restId={rest.id} ordenNueva={ordenNueva} avisar={avisar} puedeBorrar={!ro}
          cerrar={() => setModal(null)} guardado={async () => { setModal(null); await cargar(); }} />
      ) : null}
    </>
  );
}
