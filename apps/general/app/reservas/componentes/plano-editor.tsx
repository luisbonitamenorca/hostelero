"use client";

/* Editor del plano (Ajustes › Salas y planos). Envuelve a <Plano modo="edicion">:
   paleta de objetos, propiedades del elemento seleccionado, rotar/duplicar/borrar/alinear,
   deshacer, rejilla y guardar (acciones/plano.ts → guardarPlano). El editor trabaja sobre una copia;
   al guardar calcula el delta frente a lo cargado y sustituye los ids temporales por los reales.
   Con `soloLectura` (sin permiso «editar plano») solo se ve el plano y la ficha de la mesa. */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { Mesa, Sala } from "../tipos";
import { guardarPref, leerPref, type Tema } from "../lib-reservas";
import { guardarPlano } from "../acciones/plano";
import { numeroMesa, Plano, tamanoMesa, type CambioMesa, type CambioObjeto, type PlanoCambios, type PlanoObjeto } from "./plano";
import "./plano-editor.css";

export type PlanoEditorProps = {
  sala: Sala;
  objetos: PlanoObjeto[];
  tema: Tema;
  /** Tras guardar con éxito: sala y objetos ya con ids reales (para que Ajustes refresque su copia). */
  onGuardado?: (r: { sala: Sala; objetos: PlanoObjeto[] }) => void;
  onCerrar?: () => void;
  avisar?: (m: string) => void;
  /** Sin permiso para editar: se ve el plano y la ficha, sin barra, paleta ni teclado. */
  soloLectura?: boolean;
  /** Nº de cambios sin guardar (para que Ajustes confirme antes de cambiar de sala o de pestaña). 0 al desmontar. */
  onPendientes?: (n: number) => void;
};

type Sel = { clase: "mesa" | "objeto"; id: string } | null;
type Foto = { mesas: Mesa[]; objetos: PlanoObjeto[]; clave?: string };

const PALETA: { tipo: PlanoObjeto["tipo"]; texto: string; ancho: number; alto: number; extra?: Partial<PlanoObjeto> }[] = [
  { tipo: "planta", texto: "Planta", ancho: 5, alto: 5 },
  { tipo: "planta", texto: "Arbusto", ancho: 4.5, alto: 4.5, extra: { texto: "redonda" } },
  { tipo: "pared", texto: "Pared", ancho: 1.2, alto: 20 },
  { tipo: "barra", texto: "Barra", ancho: 18, alto: 5, extra: { texto: "Barra" } },
  { tipo: "texto", texto: "Etiqueta de zona", ancho: 14, alto: 3.2, extra: { texto: "Zona" } },
  { tipo: "puerta", texto: "Puerta", ancho: 4, alto: 4 },
  { tipo: "columna", texto: "Columna", ancho: 2.5, alto: 2.5 },
  { tipo: "ventana", texto: "Ventana", ancho: 10, alto: 1.2 },
  { tipo: "escalera", texto: "Escalera", ancho: 5, alto: 8 },
  { tipo: "cocina", texto: "Cocina", ancho: 18, alto: 10, extra: { texto: "Cocina" } },
];

const CAMPOS_MESA: (keyof Mesa)[] = ["nombre", "cap_min", "cap_max", "forma", "tipo", "pos_x", "pos_y", "ancho", "alto", "rotacion", "color", "etiqueta", "reservable_online", "activa", "unible", "prioridad"];
const CAMPOS_OBJETO: (keyof PlanoObjeto)[] = ["tipo", "pos_x", "pos_y", "ancho", "alto", "rotacion", "texto", "color"];
const REJILLAS = [0, 1, 2.5, 5];

let contador = 0;
const idNuevo = () => `nuevo-${Date.now().toString(36)}-${++contador}`;
const esNuevo = (id: string) => id.startsWith("nuevo-");
const r1 = (v: number) => Math.round(v * 10) / 10;
/** Mismos límites que guardarLienzo/guardarPlano en el servidor. */
const lienzoValido = (l: { ancho: number; alto: number }) => ({
  ancho: Math.round(Math.max(40, Math.min(400, Number(l.ancho) || 100))),
  alto: Math.round(Math.max(30, Math.min(400, Number(l.alto) || 70))),
});

/** Campo numérico que deja vaciar el texto mientras se escribe: solo aplica el número cuando es válido
    (dentro de min/max) y, al salir, ajusta o restaura. Así 2 → 4 no acaba en «14». */
function CampoNum(props: {
  valor: number | null | undefined;
  onValor: (n: number) => void;
  min?: number;
  max?: number;
  paso?: number;
  entero?: boolean;
  mal?: boolean;
  normalizar?: (n: number) => number;
}) {
  const { valor, onValor, min, max, paso, entero, mal, normalizar } = props;
  const aTexto = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "" : String(v));
  const [txt, setTxt] = useState(aTexto(valor));
  const foco = useRef(false);
  useEffect(() => { if (!foco.current) setTxt(aTexto(valor)); }, [valor]);
  const leer = (t: string) => {
    if (t.trim() === "") return null;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const ajustar = (n: number) => {
    let v = entero ? Math.round(n) : n;
    if (normalizar) v = normalizar(v);
    return v;
  };
  const enRango = (n: number) => (min == null || n >= min) && (max == null || n <= max);
  return (
    <input
      type="number"
      inputMode={entero ? "numeric" : "decimal"}
      min={min}
      max={max}
      step={paso}
      value={txt}
      className={mal ? "mal" : undefined}
      aria-invalid={mal || undefined}
      onFocus={() => { foco.current = true; }}
      onChange={(e) => {
        setTxt(e.target.value);
        const n = leer(e.target.value);
        if (n != null && enRango(n)) { const v = ajustar(n); if (v !== Number(valor)) onValor(v); }
      }}
      onBlur={() => {
        foco.current = false;
        const n = leer(txt);
        if (n == null) { setTxt(aTexto(valor)); return; }
        const v = ajustar(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
        if (v !== Number(valor)) onValor(v);
        setTxt(aTexto(v));
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function distinto(a: unknown, b: unknown) {
  if (a == null && b == null) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) !== Number(b);
  return a !== b;
}

/** Delta entre lo cargado y lo actual, en el formato de guardarPlano. */
function calcularDelta(origen: Foto, actual: Foto): PlanoCambios {
  const mesas: CambioMesa[] = [];
  const oM = new Map(origen.mesas.map((m) => [m.id, m]));
  for (const m of actual.mesas) {
    if (esNuevo(m.id)) {
      const c: CambioMesa = { id: m.id, _nuevo: true };
      for (const k of CAMPOS_MESA) (c as Record<string, unknown>)[k] = m[k];
      mesas.push(c);
      continue;
    }
    const o = oM.get(m.id);
    if (!o) continue;
    const c: CambioMesa = { id: m.id };
    let hay = false;
    for (const k of CAMPOS_MESA) if (distinto(m[k], o[k])) { (c as Record<string, unknown>)[k] = m[k]; hay = true; }
    if (hay) mesas.push(c);
  }
  const objetos: CambioObjeto[] = [];
  const aO = new Set(actual.objetos.map((o) => o.id));
  const oO = new Map(origen.objetos.map((o) => [o.id, o]));
  for (const o of actual.objetos) {
    if (esNuevo(o.id)) {
      const c: CambioObjeto = { id: o.id, _nuevo: true };
      for (const k of CAMPOS_OBJETO) (c as Record<string, unknown>)[k] = o[k];
      objetos.push(c);
      continue;
    }
    const prev = oO.get(o.id);
    if (!prev) continue;
    const c: CambioObjeto = { id: o.id };
    let hay = false;
    for (const k of CAMPOS_OBJETO) if (distinto(o[k], prev[k])) { (c as Record<string, unknown>)[k] = o[k]; hay = true; }
    if (hay) objetos.push(c);
  }
  for (const o of origen.objetos) if (!aO.has(o.id)) objetos.push({ id: o.id, _borrar: true });
  return { mesas, objetos };
}

export function PlanoEditor(props: PlanoEditorProps): JSX.Element {
  const { sala, tema, avisar, soloLectura = false } = props;
  const [mesas, setMesas] = useState<Mesa[]>(() => sala.mesas ?? []);
  const [objetos, setObjetos] = useState<PlanoObjeto[]>(() => props.objetos);
  const origen = useRef<Foto>({ mesas: sala.mesas ?? [], objetos: props.objetos });
  const historialRef = useRef<Foto[]>([]);
  const [nHistorial, setNHistorial] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [rejilla, setRejilla] = useState<number>(1);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lienzo, setLienzo] = useState({ ancho: Number(sala.ancho) || 100, alto: Number(sala.alto) || 70 });
  // Lienzo guardado en la base (cambia al guardar con éxito, sin esperar a que el padre recargue).
  const [lienzoBase, setLienzoBase] = useState({ ancho: Number(sala.ancho) || 100, alto: Number(sala.alto) || 70 });
  const envRef = useRef<HTMLDivElement>(null);

  // Al cambiar de sala el editor parte de cero (no al re-renderizar el padre: se perdería el trabajo).
  const salaIdPrev = useRef(sala.id);
  useEffect(() => {
    if (salaIdPrev.current === sala.id) return;
    salaIdPrev.current = sala.id;
    setMesas(sala.mesas ?? []);
    setObjetos(props.objetos);
    origen.current = { mesas: sala.mesas ?? [], objetos: props.objetos };
    historialRef.current = [];
    setNHistorial(0);
    setSel(null);
    setError(null);
    setLienzo({ ancho: Number(sala.ancho) || 100, alto: Number(sala.alto) || 70 });
    setLienzoBase({ ancho: Number(sala.ancho) || 100, alto: Number(sala.alto) || 70 });
  }, [sala.id, sala.mesas, sala.ancho, sala.alto, props.objetos]);

  useEffect(() => { setRejilla(leerPref<number>("plano:rejilla", 1)); }, []);
  const cambiarRejilla = (v: number) => { setRejilla(v); guardarPref("plano:rejilla", v); };

  const salaLocal = useMemo<Sala>(() => ({ ...sala, ancho: lienzo.ancho, alto: lienzo.alto, mesas }), [sala, lienzo, mesas]);
  const delta = useMemo(() => calcularDelta(origen.current, { mesas, objetos }), [mesas, objetos]);
  const lienzoCambia = lienzo.ancho !== lienzoBase.ancho || lienzo.alto !== lienzoBase.alto;
  const nCambios = delta.mesas.length + delta.objetos.length + (lienzoCambia ? 1 : 0);

  /* ---------- validación local (el servidor vuelve a comprobarlo) ---------- */
  const problemas = useMemo(() => {
    const out: string[] = [];
    const malCap = new Set<string>();
    const repetidas = new Set<string>();
    const origM = new Map(origen.current.mesas.map((m) => [m.id, m]));
    for (const m of mesas) {
      if (!m.nombre.trim()) out.push("Hay una mesa sin número");
      if (m.cap_min > m.cap_max) { malCap.add(m.id); out.push(`Mesa ${numeroMesa(m)}: la capacidad mínima supera la máxima`); }
    }
    // Números visibles repetidos entre mesas activas, solo si los provoca un cambio de esta edición.
    const grupos = new Map<string, Mesa[]>();
    for (const m of mesas) if (m.activa) { const k = numeroMesa(m).trim().toLowerCase(); grupos.set(k, [...(grupos.get(k) ?? []), m]); }
    for (const ms of grupos.values()) {
      if (ms.length < 2) continue;
      const tocada = ms.some((m) => { const o = origM.get(m.id); return !o || !o.activa || numeroMesa(o) !== numeroMesa(m); });
      if (!tocada) continue;
      ms.forEach((m) => repetidas.add(m.id));
      out.push(`La mesa ${numeroMesa(ms[0])} está repetida`);
    }
    return { textos: [...new Set(out)], malCap, repetidas };
  }, [mesas]);
  const bloqueaGuardar = problemas.textos.length > 0;

  // Ajustes necesita saber si hay trabajo sin guardar (cambio de sala o de pestaña desmonta el editor).
  const onPendientesRef = useRef(props.onPendientes);
  onPendientesRef.current = props.onPendientes;
  useEffect(() => { onPendientesRef.current?.(nCambios); }, [nCambios]);
  useEffect(() => () => onPendientesRef.current?.(0), []);

  /* ---------- historial ---------- */
  const recordar = useCallback((clave?: string) => {
    const h = historialRef.current;
    // Cambios seguidos del mismo campo (teclear un nombre) se agrupan en un solo paso.
    if (clave && h.length && h[h.length - 1].clave === clave) return;
    historialRef.current = [...h.slice(-49), { mesas, objetos, clave }];
    setNHistorial(historialRef.current.length);
  }, [mesas, objetos]);

  const deshacer = useCallback(() => {
    const h = historialRef.current;
    if (!h.length) return;
    const ultimo = h[h.length - 1];
    historialRef.current = h.slice(0, -1);
    setNHistorial(historialRef.current.length);
    setMesas(ultimo.mesas);
    setObjetos(ultimo.objetos);
  }, []);

  /* ---------- aplicar cambios ---------- */
  const aplicar = useCallback((c: PlanoCambios, clave?: string) => {
    recordar(clave);
    if (c.mesas.length) {
      setMesas((ms) => ms.map((m) => {
        const cm = c.mesas.find((x) => x.id === m.id);
        if (!cm) return m;
        const { id: _id, _nuevo, _borrar, ...campos } = cm;
        void _id; void _nuevo; void _borrar;
        return { ...m, ...campos };
      }));
    }
    if (c.objetos.length) {
      setObjetos((os) => os.map((o) => {
        const co = c.objetos.find((x) => x.id === o.id);
        if (!co) return o;
        const { id: _id, _nuevo, _borrar, ...campos } = co;
        void _id; void _nuevo; void _borrar;
        return { ...o, ...campos };
      }));
    }
  }, [recordar]);

  const editarSel = (campos: Partial<Mesa> | Partial<PlanoObjeto>, clave?: string) => {
    if (!sel) return;
    if (sel.clase === "mesa") aplicar({ mesas: [{ id: sel.id, ...(campos as Partial<Mesa>) }], objetos: [] }, clave);
    else aplicar({ mesas: [], objetos: [{ id: sel.id, ...(campos as Partial<PlanoObjeto>) }] }, clave);
  };

  const mesaSel = sel?.clase === "mesa" ? mesas.find((m) => m.id === sel.id) ?? null : null;
  const objSel = sel?.clase === "objeto" ? objetos.find((o) => o.id === sel.id) ?? null : null;

  /* ---------- añadir ---------- */
  const centroLibre = () => {
    // Centro del lienzo, desplazado un poco para no apilar varios altas seguidas.
    const n = mesas.filter((m) => esNuevo(m.id)).length + objetos.filter((o) => esNuevo(o.id)).length;
    return { x: r1(lienzo.ancho / 2 + (n % 5) * 2), y: r1(lienzo.alto / 2 + (n % 5) * 2) };
  };

  /** Siguiente número libre en la sala (las otras salas las comprueba el servidor al guardar). */
  const siguienteNumero = () => {
    const usados = new Set(mesas.map((m) => numeroMesa(m).trim().toLowerCase()));
    const nums = mesas.map((m) => parseInt(numeroMesa(m), 10)).filter((n) => Number.isFinite(n));
    let n = nums.length ? Math.max(...nums) + 1 : 1;
    while (usados.has(String(n))) n++;
    return String(n);
  };

  const anadirMesa = () => {
    recordar();
    const nombre = siguienteNumero();
    const { x, y } = centroLibre();
    const m: Mesa = {
      id: idNuevo(), cuenta_id: sala.cuenta_id, sala_id: sala.id, nombre, cap_min: 1, cap_max: 2, forma: "cuadrada", tipo: "mesa",
      pos_x: x, pos_y: y, ancho: 6, alto: 6, rotacion: 0, color: null, etiqueta: null, reservable_online: true, activa: true, unible: true, prioridad: 100,
    };
    setMesas((ms) => [...ms, m]);
    setSel({ clase: "mesa", id: m.id });
  };

  const anadirObjeto = (p: (typeof PALETA)[number]) => {
    recordar();
    const { x, y } = centroLibre();
    const o: PlanoObjeto = {
      id: idNuevo(), cuenta_id: sala.cuenta_id, sala_id: sala.id, tipo: p.tipo, pos_x: x, pos_y: y, ancho: p.ancho, alto: p.alto,
      rotacion: 0, texto: null, color: null, creado_en: new Date().toISOString(), ...p.extra,
    };
    setObjetos((os) => [...os, o]);
    setSel({ clase: "objeto", id: o.id });
  };

  /* ---------- acciones sobre la selección ---------- */
  const rotar = () => {
    const it = mesaSel ?? objSel;
    if (!it) return;
    editarSel({ rotacion: ((Number(it.rotacion) || 0) + 90) % 360 });
  };

  const duplicar = () => {
    if (mesaSel) {
      recordar();
      const copia: Mesa = { ...mesaSel, id: idNuevo(), nombre: siguienteNumero(), etiqueta: null, pos_x: r1(Number(mesaSel.pos_x) + 3), pos_y: r1(Number(mesaSel.pos_y) + 3) };
      setMesas((ms) => [...ms, copia]);
      setSel({ clase: "mesa", id: copia.id });
    } else if (objSel) {
      recordar();
      const copia: PlanoObjeto = { ...objSel, id: idNuevo(), pos_x: r1(Number(objSel.pos_x) + 3), pos_y: r1(Number(objSel.pos_y) + 3) };
      setObjetos((os) => [...os, copia]);
      setSel({ clase: "objeto", id: copia.id });
    }
  };

  const borrar = () => {
    if (mesaSel) {
      recordar();
      // Una mesa con historial no se borra: se desactiva (deja de reservarse y de verse en sala).
      if (esNuevo(mesaSel.id)) setMesas((ms) => ms.filter((m) => m.id !== mesaSel.id));
      else setMesas((ms) => ms.map((m) => (m.id === mesaSel.id ? { ...m, activa: false } : m)));
      setSel(null);
    } else if (objSel) {
      recordar();
      setObjetos((os) => os.filter((o) => o.id !== objSel.id));
      setSel(null);
    }
  };

  const alinear = () => {
    const paso = rejilla > 0 ? rejilla : 1;
    const ajusta = (v: number) => r1(Math.round(Number(v) / paso) * paso);
    recordar();
    if (sel) {
      if (mesaSel) setMesas((ms) => ms.map((m) => (m.id === mesaSel.id ? { ...m, pos_x: ajusta(m.pos_x), pos_y: ajusta(m.pos_y) } : m)));
      if (objSel) setObjetos((os) => os.map((o) => (o.id === objSel.id ? { ...o, pos_x: ajusta(o.pos_x), pos_y: ajusta(o.pos_y) } : o)));
      return;
    }
    setMesas((ms) => ms.map((m) => ({ ...m, pos_x: ajusta(m.pos_x), pos_y: ajusta(m.pos_y) })));
    setObjetos((os) => os.map((o) => ({ ...o, pos_x: ajusta(o.pos_x), pos_y: ajusta(o.pos_y) })));
  };

  const mover = (dx: number, dy: number) => {
    const it = mesaSel ?? objSel;
    if (!it) return;
    const x = r1(Math.max(0, Math.min(lienzo.ancho, Number(it.pos_x) + dx)));
    const y = r1(Math.max(0, Math.min(lienzo.alto, Number(it.pos_y) + dy)));
    editarSel({ pos_x: x, pos_y: y }, `mover:${it.id}`);
  };

  /* ---------- guardar / descartar ---------- */
  const guardar = async () => {
    if (soloLectura || !nCambios || guardando) return;
    if (bloqueaGuardar) { setError(problemas.textos.join(" · ")); return; }
    setGuardando(true);
    setError(null);
    const l = lienzoValido(lienzo);
    // Posiciones dentro del lienzo, igual que hará el servidor: lo enviado es exactamente lo que queda guardado.
    const dentro = <T extends { pos_x: number; pos_y: number }>(x: T): T => {
      const px = r1(Math.max(0, Math.min(l.ancho, Number(x.pos_x))));
      const py = r1(Math.max(0, Math.min(l.alto, Number(x.pos_y))));
      return px === Number(x.pos_x) && py === Number(x.pos_y) ? x : { ...x, pos_x: px, pos_y: py };
    };
    // Foto de lo que se envía: lo que se edite mientras responde el servidor sigue contando como pendiente.
    const enviado: Foto = { mesas: mesas.map(dentro), objetos: objetos.map(dentro) };
    setMesas((ms) => ms.map(dentro));
    setObjetos((os) => os.map(dentro));
    setLienzo(l);
    const conLienzo = l.ancho !== lienzoBase.ancho || l.alto !== lienzoBase.alto;
    const res = await guardarPlano(sala.id, calcularDelta(origen.current, enviado), conLienzo ? { lienzo: l } : undefined);
    setGuardando(false);

    // Aunque haya errores parciales, los ids que sí se insertaron se sustituyen (en el estado actual,
    // en el historial y en la selección) para no duplicarlos al reintentar.
    const ids = res.data?.idsNuevos ?? {};
    const sust = <T extends { id: string }>(x: T): T => (ids[x.id] ? { ...x, id: ids[x.id] } : x);
    setMesas((ms) => ms.map(sust));
    setObjetos((os) => os.map(sust));
    historialRef.current = historialRef.current.map((f) => ({ ...f, mesas: f.mesas.map(sust), objetos: f.objetos.map(sust) }));
    setSel((s) => (s && ids[s.id] ? { ...s, id: ids[s.id] } : s));
    // Con `data` el lienzo ya se escribió (va antes que todo lo demás en el servidor).
    if (res.data && conLienzo) setLienzoBase(l);

    if (!res.ok) {
      // Lo insertado pasa a «existente» en el origen: sus ediciones o borrados posteriores entran en el delta.
      const insertadas = enviado.mesas.filter((m) => ids[m.id]).map(sust);
      const insertados = enviado.objetos.filter((o) => ids[o.id]).map(sust);
      origen.current = { mesas: [...origen.current.mesas, ...insertadas], objetos: [...origen.current.objetos, ...insertados] };
      setError(res.error ?? "No se pudo guardar el plano");
      avisar?.(res.error ?? "No se pudo guardar el plano");
      return;
    }
    const guardado: Foto = { mesas: enviado.mesas.map(sust), objetos: enviado.objetos.map(sust) };
    origen.current = guardado;
    historialRef.current = [];
    setNHistorial(0);
    avisar?.(res.data?.aviso ?? "Plano guardado");
    if (res.data?.aviso) setError(res.data.aviso);
    props.onGuardado?.({ sala: { ...sala, ancho: l.ancho, alto: l.alto, mesas: guardado.mesas }, objetos: guardado.objetos });
  };

  const descartar = () => {
    setMesas(origen.current.mesas);
    setObjetos(origen.current.objetos);
    setLienzo(lienzoBase);
    historialRef.current = [];
    setNHistorial(0);
    setSel(null);
    setError(null);
  };

  const cerrar = () => {
    if (nCambios && !window.confirm(`Hay ${nCambios} cambio${nCambios === 1 ? "" : "s"} sin guardar. ¿Salir sin guardar?`)) return;
    props.onCerrar?.();
  };

  /* ---------- teclado ---------- */
  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (soloLectura) return;
    const t = ev.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    const meta = ev.metaKey || ev.ctrlKey;
    if (meta && ev.key.toLowerCase() === "z") { ev.preventDefault(); deshacer(); return; }
    if (meta && ev.key.toLowerCase() === "d") { ev.preventDefault(); duplicar(); return; }
    if (meta && ev.key.toLowerCase() === "s") { ev.preventDefault(); void guardar(); return; }
    if (ev.key === "Escape") { setSel(null); return; }
    if (!sel || meta || ev.altKey) return; // ⌘R / Ctrl+R es recargar el navegador, no rotar
    const paso = ev.shiftKey ? (rejilla > 0 ? rejilla * 2 : 2) : rejilla > 0 ? rejilla : 0.5;
    if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); borrar(); }
    else if (ev.key.toLowerCase() === "r") { ev.preventDefault(); rotar(); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); mover(-paso, 0); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); mover(paso, 0); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); mover(0, -paso); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); mover(0, paso); }
  };

  // Aviso al salir con cambios sin guardar.
  useEffect(() => {
    if (!nCambios) return;
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [nCambios]);

  const tam = mesaSel ? tamanoMesa(mesaSel) : null;
  const giro = (v: number) => ((Math.round(v) % 360) + 360) % 360;

  return (
    <div ref={envRef} className={`ple${soloLectura ? " solo-lectura" : ""}`} data-tema={tema} onKeyDown={onKeyDown} tabIndex={-1}>
      {/* ---- barra de herramientas ---- */}
      {soloLectura ? (
        props.onCerrar ? (
          <div className="ple-barra">
            <span className="ple-estado">Solo lectura</span>
            <div className="ple-grupo ple-derecha"><button type="button" onClick={props.onCerrar}>Cerrar</button></div>
          </div>
        ) : null
      ) : (
        <div className="ple-barra">
          <div className="ple-grupo">
            <button type="button" onClick={rotar} disabled={!sel} title="Rotar 90° (R)">↻ Rotar</button>
            <button type="button" onClick={duplicar} disabled={!sel} title="Duplicar (⌘D)">⧉ Duplicar</button>
            <button type="button" onClick={borrar} disabled={!sel} className="peligro" title="Borrar (Supr)">✕ {mesaSel && !esNuevo(mesaSel.id) ? "Desactivar" : "Borrar"}</button>
          </div>
          <div className="ple-grupo">
            <label className="ple-rejilla">
              Rejilla
              <select value={rejilla} onChange={(e) => cambiarRejilla(Number(e.target.value))}>
                {REJILLAS.map((r) => <option key={r} value={r}>{r === 0 ? "sin" : r}</option>)}
              </select>
            </label>
            <button type="button" onClick={alinear} title={sel ? "Alinear el elemento a la rejilla" : "Alinear todo a la rejilla"}>⊞ Alinear{sel ? "" : " todo"}</button>
            <button type="button" onClick={deshacer} disabled={!nHistorial} title="Deshacer (⌘Z)">↶ Deshacer</button>
          </div>
          <div className="ple-grupo ple-derecha">
            <span className={`ple-estado${nCambios ? " pendiente" : ""}`}>{nCambios ? `${nCambios} cambio${nCambios === 1 ? "" : "s"} sin guardar` : "Sin cambios"}</span>
            <button type="button" onClick={descartar} disabled={!nCambios || guardando}>Descartar</button>
            <button
              type="button"
              className="primaria"
              onClick={guardar}
              disabled={!nCambios || guardando || bloqueaGuardar}
              title={bloqueaGuardar ? problemas.textos.join(" · ") : "Guardar (⌘S)"}
            >
              {guardando ? "Guardando…" : "Guardar plano"}
            </button>
            {props.onCerrar ? <button type="button" onClick={cerrar} title="Cerrar el editor">Cerrar</button> : null}
          </div>
        </div>
      )}
      {!soloLectura && bloqueaGuardar ? <div className="ple-error">{problemas.textos.join(" · ")}</div> : null}
      {error && !(bloqueaGuardar && error === problemas.textos.join(" · ")) ? <div className="ple-error">{error}</div> : null}

      <div className="ple-cuerpo">
        {/* ---- paleta + propiedades ---- */}
        <aside className="ple-lateral">
          {soloLectura ? null : (
            <section className="ple-seccion">
              <h4>Añadir</h4>
              <div className="ple-paleta">
                <button type="button" className="mesa" onClick={anadirMesa}>+ Mesa</button>
                {PALETA.map((p) => (
                  <button key={p.texto} type="button" onClick={() => anadirObjeto(p)}>{p.texto}</button>
                ))}
              </div>
            </section>
          )}

          {mesaSel && soloLectura ? (
            <section className="ple-seccion">
              <h4>Mesa {numeroMesa(mesaSel)}</h4>
              <dl className="ple-ficha">
                <dt>Capacidad</dt><dd>{mesaSel.cap_min === mesaSel.cap_max ? mesaSel.cap_max : `${mesaSel.cap_min} a ${mesaSel.cap_max}`} personas</dd>
                <dt>Forma</dt><dd>{mesaSel.forma} · {mesaSel.tipo}</dd>
                <dt>Online</dt><dd>{mesaSel.reservable_online ? "Se reserva online" : "Solo desde el panel"}</dd>
                <dt>Unir</dt><dd>{mesaSel.unible ? "Se puede unir" : "No se une"}</dd>
              </dl>
            </section>
          ) : mesaSel ? (
            <section className="ple-seccion">
              <h4>Mesa {numeroMesa(mesaSel)}{esNuevo(mesaSel.id) ? " (nueva)" : ""}</h4>
              <div className="ple-campos">
                <label>Número<input value={mesaSel.nombre} className={problemas.repetidas.has(mesaSel.id) || !mesaSel.nombre.trim() ? "mal" : undefined} onChange={(e) => editarSel({ nombre: e.target.value }, `nombre:${mesaSel.id}`)} maxLength={40} /></label>
                <div className="ple-fila">
                  <label>Mín.<CampoNum key={`cmin-${mesaSel.id}`} valor={mesaSel.cap_min} min={1} max={99} entero mal={problemas.malCap.has(mesaSel.id)} onValor={(n) => editarSel({ cap_min: n }, `capmin:${mesaSel.id}`)} /></label>
                  <label>Máx.<CampoNum key={`cmax-${mesaSel.id}`} valor={mesaSel.cap_max} min={1} max={99} entero mal={problemas.malCap.has(mesaSel.id)} onValor={(n) => editarSel({ cap_max: n }, `capmax:${mesaSel.id}`)} /></label>
                </div>
                {problemas.malCap.has(mesaSel.id) ? <small className="ple-nota-mal">La mínima no puede superar la máxima.</small> : null}
                <div className="ple-fila">
                  <label>Forma
                    <select value={mesaSel.forma} onChange={(e) => editarSel({ forma: e.target.value })}>
                      <option value="redonda">Redonda</option>
                      <option value="cuadrada">Cuadrada</option>
                      <option value="rectangular">Rectangular</option>
                    </select>
                  </label>
                  <label>Tipo
                    <select value={mesaSel.tipo} onChange={(e) => editarSel({ tipo: e.target.value })}>
                      <option value="mesa">Mesa</option>
                      <option value="barra">Barra</option>
                      <option value="alta">Alta</option>
                    </select>
                  </label>
                </div>
                <div className="ple-fila">
                  <label>Ancho<CampoNum key={`an-${mesaSel.id}`} valor={tam?.w} min={2} max={60} paso={0.5} normalizar={r1} onValor={(n) => editarSel({ ancho: n, alto: tam?.h ?? 6 }, `ancho:${mesaSel.id}`)} /></label>
                  <label>Alto<CampoNum key={`al-${mesaSel.id}`} valor={tam?.h} min={2} max={60} paso={0.5} normalizar={r1} onValor={(n) => editarSel({ alto: n, ancho: tam?.w ?? 6 }, `alto:${mesaSel.id}`)} /></label>
                  <label>Giro<CampoNum key={`gi-${mesaSel.id}`} valor={mesaSel.rotacion} paso={90} entero normalizar={giro} onValor={(n) => editarSel({ rotacion: n }, `rot:${mesaSel.id}`)} /></label>
                </div>
                <label>Número visible (si distinto)<input value={mesaSel.etiqueta ?? ""} className={problemas.repetidas.has(mesaSel.id) ? "mal" : undefined} onChange={(e) => editarSel({ etiqueta: e.target.value || null }, `etiqueta:${mesaSel.id}`)} maxLength={30} /></label>
                <label className="ple-color">Color libre
                  <span>
                    <input type="color" value={mesaSel.color || "#6b3d2e"} onChange={(e) => editarSel({ color: e.target.value }, `color:${mesaSel.id}`)} />
                    {mesaSel.color ? <button type="button" onClick={() => editarSel({ color: null })}>Quitar</button> : <small>por defecto</small>}
                  </span>
                </label>
                <label className="ple-check"><input type="checkbox" checked={mesaSel.reservable_online} onChange={(e) => editarSel({ reservable_online: e.target.checked })} /> Reservable online</label>
                <label className="ple-check"><input type="checkbox" checked={mesaSel.unible} onChange={(e) => editarSel({ unible: e.target.checked })} /> Se puede unir</label>
                <label className="ple-check"><input type="checkbox" checked={mesaSel.activa} onChange={(e) => editarSel({ activa: e.target.checked })} /> Activa</label>
                <div className="ple-pos">Posición {r1(Number(mesaSel.pos_x))} × {r1(Number(mesaSel.pos_y))}</div>
              </div>
            </section>
          ) : objSel && !soloLectura ? (
            <section className="ple-seccion">
              <h4>{PALETA.find((p) => p.tipo === objSel.tipo)?.texto ?? objSel.tipo}</h4>
              <div className="ple-campos">
                <label>Tipo
                  <select value={objSel.tipo} onChange={(e) => editarSel({ tipo: e.target.value })}>
                    {["planta", "pared", "barra", "texto", "puerta", "columna", "ventana", "escalera", "cocina"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label>Texto<input value={objSel.texto ?? ""} placeholder={objSel.tipo === "planta" ? "«redonda» = arbusto" : "Texto visible"} onChange={(e) => editarSel({ texto: e.target.value || null }, `texto:${objSel.id}`)} maxLength={60} /></label>
                <div className="ple-fila">
                  <label>Ancho<CampoNum key={`oan-${objSel.id}`} valor={objSel.ancho} min={0.5} max={400} paso={0.5} normalizar={r1} onValor={(n) => editarSel({ ancho: n }, `ancho:${objSel.id}`)} /></label>
                  <label>Alto<CampoNum key={`oal-${objSel.id}`} valor={objSel.alto} min={0.5} max={400} paso={0.5} normalizar={r1} onValor={(n) => editarSel({ alto: n }, `alto:${objSel.id}`)} /></label>
                  <label>Giro<CampoNum key={`ogi-${objSel.id}`} valor={objSel.rotacion} paso={90} entero normalizar={giro} onValor={(n) => editarSel({ rotacion: n }, `rot:${objSel.id}`)} /></label>
                </div>
                <label className="ple-color">Color
                  <span>
                    <input type="color" value={objSel.color || "#4db6ac"} onChange={(e) => editarSel({ color: e.target.value }, `color:${objSel.id}`)} />
                    {objSel.color ? <button type="button" onClick={() => editarSel({ color: null })}>Quitar</button> : <small>por defecto</small>}
                  </span>
                </label>
                <div className="ple-pos">Posición {r1(Number(objSel.pos_x))} × {r1(Number(objSel.pos_y))}</div>
              </div>
            </section>
          ) : soloLectura ? (
            <section className="ple-seccion ple-ayuda">
              <h4>Solo lectura</h4>
              <p>Pulsa una mesa para ver su ficha. Para mover mesas hace falta el permiso «editar plano».</p>
            </section>
          ) : (
            <section className="ple-seccion ple-ayuda">
              <h4>Cómo se usa</h4>
              <p>Pulsa una mesa u objeto para seleccionarlo. Arrástralo para moverlo; el cuadrito de la esquina cambia el tamaño.</p>
              <p>Teclas: <b>R</b> rotar · <b>Supr</b> borrar · <b>flechas</b> mover · <b>⌘Z</b> deshacer · <b>⌘S</b> guardar.</p>
              <p>Rueda o pellizco para el zoom; arrastra el fondo para desplazarte.</p>
            </section>
          )}

          {soloLectura ? null : (
            <section className="ple-seccion">
              <h4>Lienzo</h4>
              <div className="ple-fila">
                <label>Ancho<CampoNum valor={lienzo.ancho} min={40} max={400} entero onValor={(n) => setLienzo((l) => ({ ...l, ancho: n }))} /></label>
                <label>Alto<CampoNum valor={lienzo.alto} min={30} max={400} entero onValor={(n) => setLienzo((l) => ({ ...l, alto: n }))} /></label>
              </div>
              <small className="ple-nota">{lienzoCambia ? "El tamaño nuevo se guarda con «Guardar plano»." : "Unidades del plano (40–400 × 30–400)."}</small>
            </section>
          )}
        </aside>

        {/* ---- plano ---- */}
        <div className="ple-plano">
          {soloLectura ? (
            <Plano
              sala={salaLocal}
              objetos={objetos}
              reservasPorMesa={{}}
              modo="sala"
              tema={tema}
              seleccionada={mesaSel?.id ?? null}
              onMesaClick={(id) => setSel({ clase: "mesa", id })}
              onFondoClick={() => setSel(null)}
            />
          ) : (
            <Plano
              sala={salaLocal}
              objetos={objetos}
              reservasPorMesa={{}}
              modo="edicion"
              tema={tema}
              rejilla={rejilla}
              seleccionada={mesaSel?.id ?? null}
              objetoSeleccionado={objSel?.id ?? null}
              onMesaClick={(id) => setSel({ clase: "mesa", id })}
              onObjetoClick={(id) => setSel({ clase: "objeto", id })}
              onFondoClick={() => setSel(null)}
              onCambios={(c) => aplicar(c)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default PlanoEditor;
