"use client";

/* Ajustes › Códigos promocionales: descuento en % o importe, ligados o no a una experiencia,
   con validez, usos máximos y ámbito (este restaurante o toda la cuenta). */

import { useCallback, useEffect, useState } from "react";
import { fmtFecha } from "../../lib-reservas";
import { borrarCodigo, guardarCodigo, listarCodigos, listarExperiencias, type CamposCodigo, type Codigo, type Experiencia } from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, Chip, Confirmar, Interruptor, ModalForm, SoloLectura, Vacio, fmtEuros, useAccion, type AjProps } from "./comunes";

type Form = { codigo: string; descripcion: string; modo: "pct" | "importe"; valor: string; experiencia_id: string; valido_desde: string; valido_hasta: string; usos_max: string; activo: boolean; ambito: "rest" | "cuenta" };

function Modal({ c, restId, experiencias, avisar, cerrar, guardado, puedeBorrar, puedeCuenta }: { c: Codigo | null; restId: string; experiencias: Experiencia[]; avisar: (m: string) => void; cerrar: () => void; guardado: () => void; puedeBorrar: boolean; puedeCuenta: boolean }) {
  const [f, setF] = useState<Form>({
    codigo: c?.codigo ?? "",
    descripcion: c?.descripcion ?? "",
    modo: c?.descuento_importe != null ? "importe" : "pct",
    valor: c?.descuento_importe != null ? String(c.descuento_importe) : c?.descuento_pct != null ? String(c.descuento_pct) : "",
    experiencia_id: c?.experiencia_id ?? "",
    valido_desde: c?.valido_desde ?? "",
    valido_hasta: c?.valido_hasta ?? "",
    usos_max: c?.usos_max != null ? String(c.usos_max) : "",
    activo: c ? c.activo : true,
    ambito: c ? (c.restaurante_id ? "rest" : "cuenta") : "rest",
  });
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  async function guardar() {
    const valor = f.valor === "" ? null : parseFloat(f.valor.replace(",", "."));
    const campos: CamposCodigo = {
      codigo: f.codigo,
      descripcion: f.descripcion || null,
      descuento_pct: f.modo === "pct" ? valor : null,
      descuento_importe: f.modo === "importe" ? valor : null,
      experiencia_id: f.experiencia_id || null,
      valido_desde: f.valido_desde || null,
      valido_hasta: f.valido_hasta || null,
      usos_max: f.usos_max === "" ? null : parseInt(f.usos_max) || null,
      activo: f.activo,
      restaurante_id: f.ambito === "rest" ? restId : null,
    };
    const r = await correr(guardarCodigo(c?.id ?? null, campos), c ? "Código guardado." : "Código creado.");
    if (r.ok) guardado();
  }

  return (
    <>
      <ModalForm soloLectura={!puedeBorrar} titulo={c ? `Código · ${c.codigo}` : "Nuevo código promocional"} onCerrar={cerrar} onGuardar={guardar} ocupado={ocupado} guardarTexto={c ? "Guardar" : "Crear"}
        extra={c && puedeBorrar ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>Borrar</Boton> : null}>
        <div className="aj-form">
          <Campo label="Código" ayuda="Lo escribe el cliente en el widget. Sin espacios."><input autoFocus value={f.codigo} onChange={(e) => set("codigo", e.target.value.toUpperCase().replace(/\s+/g, ""))} maxLength={30} placeholder="VERANO10" className="mono" /></Campo>
          <Campo label="Ámbito">
            <select value={f.ambito} onChange={(e) => set("ambito", e.target.value as Form["ambito"])}>
              <option value="rest">Solo este restaurante</option>
              <option value="cuenta" disabled={!puedeCuenta}>Todos los restaurantes{puedeCuenta ? "" : " (sin permiso)"}</option>
            </select>
          </Campo>
          <Campo label="Descripción" ancho="todo"><input value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} maxLength={200} placeholder="10 % en la carta durante julio" /></Campo>
          <Campo label="Descuento">
            <select value={f.modo} onChange={(e) => set("modo", e.target.value as Form["modo"])}>
              <option value="pct">Porcentaje</option>
              <option value="importe">Importe fijo</option>
            </select>
          </Campo>
          <Campo label="Valor"><div className="aj-con-unidad"><input type="number" min={0} step={f.modo === "pct" ? 1 : 0.5} value={f.valor} onChange={(e) => set("valor", e.target.value)} /><span>{f.modo === "pct" ? "%" : "€"}</span></div></Campo>
          <Campo label="Experiencia" ayuda="Si se marca, solo vale para esa experiencia." ancho={2}>
            <select value={f.experiencia_id} onChange={(e) => set("experiencia_id", e.target.value)}>
              <option value="">Cualquier reserva</option>
              {experiencias.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Válido desde"><input type="date" value={f.valido_desde} onChange={(e) => set("valido_desde", e.target.value)} /></Campo>
          <Campo label="Hasta"><input type="date" value={f.valido_hasta} onChange={(e) => set("valido_hasta", e.target.value)} /></Campo>
          <Campo label="Usos máximos" ayuda="Vacío = ilimitado."><input type="number" min={1} value={f.usos_max} placeholder="ilimitado" onChange={(e) => set("usos_max", e.target.value)} /></Campo>
          <Campo label="Estado"><Interruptor on={f.activo} onChange={(v) => set("activo", v)} texto={f.activo ? "Activo" : "Inactivo"} /></Campo>
        </div>
      </ModalForm>
      {confirmar && c ? (
        <Confirmar texto={`¿Borrar el código «${c.codigo}»?`} detalle={c.usos ? `Se ha usado ${c.usos} veces: si no se puede borrar, desactívalo.` : undefined} confirmarTexto="Borrar" peligro ocupado={ocupado} onNo={() => setConfirmar(false)}
          onSi={async () => { const r = await correr(borrarCodigo(c.id), "Código borrado."); setConfirmar(false); if (r.ok) guardado(); }} />
      ) : null}
    </>
  );
}

export default function AjCodigos({ rest, avisar, puedeEditar, puedeEditarCuenta }: AjProps) {
  const [lista, setLista] = useState<Codigo[] | null>(null);
  const [experiencias, setExperiencias] = useState<Experiencia[]>([]);
  const [modal, setModal] = useState<{ c: Codigo | null } | null>(null);
  const { correr } = useAccion(avisar);
  const ro = !puedeEditar;
  const hoy = new Date().toLocaleDateString("sv-SE");

  const cargar = useCallback(async () => {
    const [c, x] = await Promise.all([listarCodigos(rest.id), listarExperiencias(rest.id)]);
    setLista(c);
    setExperiencias(x);
  }, [rest.id]);
  useEffect(() => { setLista(null); cargar(); }, [cargar]);

  const estadoDe = (c: Codigo): { texto: string; color: string } => {
    if (!c.activo) return { texto: "inactivo", color: "#8A9199" };
    if (c.valido_hasta && c.valido_hasta < hoy) return { texto: "caducado", color: "#4B5057" };
    if (c.valido_desde && c.valido_desde > hoy) return { texto: "programado", color: "#D99A1E" };
    if (c.usos_max != null && c.usos >= c.usos_max) return { texto: "agotado", color: "#D32F2F" };
    return { texto: "en vigor", color: "#2E9E5B" };
  };

  return (
    <>
      <Cabecera titulo="Códigos promocionales" texto="El cliente los introduce al reservar. El descuento se aplica a la experiencia o a la cuenta, según lo que tengáis pactado en sala.">
        {!ro ? <Boton tipo="primario" onClick={() => setModal({ c: null })}>+ Nuevo código</Boton> : null}
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      {lista === null ? (
        <div className="spinner" />
      ) : (
        <div className="aj-tabla-env">
          <table className="aj-tabla">
            <thead><tr><th>Código</th><th>Descuento</th><th>Validez</th><th className="num">Usos</th><th>Ámbito</th><th>Estado</th><th className="acc" /></tr></thead>
            <tbody>
              {lista.map((c) => {
                const e = estadoDe(c);
                const exp = c.experiencia_id ? experiencias.find((x) => x.id === c.experiencia_id)?.nombre : null;
                return (
                  <tr key={c.id} className={c.activo ? "" : "inactiva"}>
                    <td className="nombre mono">{c.codigo}{c.descripcion ? <span className="det" style={{ fontFamily: "inherit" }}>{c.descripcion}</span> : null}</td>
                    <td>{c.descuento_pct != null ? `${c.descuento_pct} %` : c.descuento_importe != null ? fmtEuros(c.descuento_importe) : <span className="mudo">—</span>}{exp ? <span className="det">solo {exp}</span> : null}</td>
                    <td>{c.valido_desde || c.valido_hasta ? `${c.valido_desde ? fmtFecha(c.valido_desde) : "…"} – ${c.valido_hasta ? fmtFecha(c.valido_hasta) : "…"}` : <span className="mudo">siempre</span>}</td>
                    <td className="num">{c.usos}{c.usos_max != null ? ` / ${c.usos_max}` : ""}</td>
                    <td>{c.restaurante_id ? rest.nombre : <span className="mudo">todos</span>}</td>
                    <td><Chip color={e.color}>{e.texto}</Chip></td>
                    <td className="acc">
                      {!ro ? <Interruptor on={c.activo} pequeno onChange={async (v) => { const r = await correr(guardarCodigo(c.id, { codigo: c.codigo, descripcion: c.descripcion, descuento_pct: c.descuento_pct, descuento_importe: c.descuento_importe, experiencia_id: c.experiencia_id, valido_desde: c.valido_desde, valido_hasta: c.valido_hasta, usos_max: c.usos_max, activo: v, restaurante_id: c.restaurante_id })); if (r.ok) cargar(); }} /> : null}
                      <Boton className="mini" onClick={() => setModal({ c })}>{ro ? "Ver" : "Editar"}</Boton>
                    </td>
                  </tr>
                );
              })}
              {!lista.length ? <tr><td colSpan={7}><Vacio>Sin códigos promocionales.</Vacio></td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {modal ? <Modal c={modal.c} restId={rest.id} experiencias={experiencias} avisar={avisar} puedeBorrar={!ro} puedeCuenta={puedeEditarCuenta} cerrar={() => setModal(null)} guardado={async () => { setModal(null); await cargar(); }} /> : null}
    </>
  );
}
