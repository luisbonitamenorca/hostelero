"use client";

/* Ajustes › Mensajes: canales activos por restaurante, horas de recordatorio/reconfirmación/
   valoración y plantillas por tipo × canal × idioma con editor, variables, vista previa
   (RPC reservas_renderizar) y envío de prueba. Las plantillas de la cuenta son la base; al guardar
   desde aquí se crea (o actualiza) la propia del restaurante, que tiene prioridad. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Restaurante } from "../../tipos";
import {
  borrarPlantilla, enviarPruebaPlantilla, estadoProveedores, guardarPlantilla, guardarRestauranteAjustes, listarPlantillas, previsualizarPlantilla,
  type Plantilla,
} from "../../acciones/ajustes";
import {
  Boton, Cabecera, Campo, CANALES, Chip, Confirmar, Interruptor, Panel, SoloLectura, TIPOS_PLANTILLA, VARIABLES_PLANTILLA, nombreIdioma, useAccion, useSucio, type AjProps,
} from "./comunes";

type Horas = { recordatorio_horas: string; reconfirmacion_horas: string; valoracion_horas: string };
const horasDe = (r: Restaurante): Horas => ({ recordatorio_horas: String(r.recordatorio_horas), reconfirmacion_horas: String(r.reconfirmacion_horas), valoracion_horas: String(r.valoracion_horas) });

export default function AjMensajes({ rest, avisar, puedeEditar, puedeEditarCuenta, onRestaurante, onSucio }: AjProps) {
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [tipo, setTipo] = useState("confirmacion");
  const [canal, setCanal] = useState("email");
  const [idioma, setIdioma] = useState(rest.idiomas?.[0] ?? "es");
  const [prov, setProv] = useState<{ email: boolean; sms: boolean; whatsapp: boolean } | null>(null);
  const [horas, setHoras] = useState<Horas>(() => horasDe(rest));
  const { ocupado, correr } = useAccion(avisar);
  const ro = !puedeEditar;

  const cargar = useCallback(async () => setPlantillas(await listarPlantillas(rest.id)), [rest.id]);
  useEffect(() => { setPlantillas(null); cargar(); }, [cargar]);
  useEffect(() => { estadoProveedores().then(setProv); }, []);
  useEffect(() => { setHoras(horasDe(rest)); }, [rest]);
  useEffect(() => { if (!rest.idiomas.includes(idioma)) setIdioma(rest.idiomas[0] ?? "es"); }, [rest.idiomas, idioma]);

  /* plantilla vigente: la del restaurante si existe; si no, la de la cuenta */
  const propia = useMemo(() => (plantillas ?? []).find((p) => p.restaurante_id === rest.id && p.tipo === tipo && p.canal === canal && p.idioma === idioma) ?? null, [plantillas, rest.id, tipo, canal, idioma]);
  const cuenta = useMemo(() => (plantillas ?? []).find((p) => !p.restaurante_id && p.tipo === tipo && p.canal === canal && p.idioma === idioma) ?? null, [plantillas, tipo, canal, idioma]);
  const vigente = propia ?? cuenta;

  /* editor */
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [activa, setActiva] = useState(true);
  const [vista, setVista] = useState<{ asunto: string; cuerpo: string } | null>(null);
  const [confirmarReset, setConfirmarReset] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setAsunto(vigente?.asunto ?? "");
    setCuerpo(vigente?.cuerpo ?? "");
    setActiva(vigente?.activa ?? true);
    setVista(null);
  }, [vigente]);
  const cambios = (vigente?.asunto ?? "") !== asunto || (vigente?.cuerpo ?? "") !== cuerpo || (vigente?.activa ?? true) !== activa;
  /* dónde se guarda: plantilla propia del restaurante o la de la cuenta (todos los restaurantes) */
  const [ambito, setAmbito] = useState<"rest" | "cuenta">("rest");
  /* cambiar de tipo, canal o idioma con el editor modificado: se pregunta antes de perderlo */
  const [preguntaCambio, setPreguntaCambio] = useState<(() => void) | null>(null);
  const cambiarSel = (fn: () => void) => { if (cambios && !ro) setPreguntaCambio(() => fn); else fn(); };

  const insertar = (clave: string) => {
    const ta = areaRef.current;
    const token = `{{${clave}}}`;
    if (!ta) { setCuerpo((c) => c + token); return; }
    const ini = ta.selectionStart ?? cuerpo.length, fin = ta.selectionEnd ?? cuerpo.length;
    const nuevo = cuerpo.slice(0, ini) + token + cuerpo.slice(fin);
    setCuerpo(nuevo);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ini + token.length, ini + token.length); });
  };

  async function guardar() {
    const comun = { canal, tipo, idioma, asunto: canal === "email" ? asunto : null, cuerpo, activa };
    const r = ambito === "cuenta" && puedeEditarCuenta
      ? await correr(guardarPlantilla(cuenta?.id ?? null, { ...comun, restaurante_id: null }), "Plantilla guardada para todos los restaurantes.")
      : await correr(guardarPlantilla(propia?.id ?? null, { ...comun, restaurante_id: rest.id }), "Plantilla guardada para este restaurante.");
    if (r.ok) await cargar();
  }
  async function previsualizar() {
    const r = await correr(previsualizarPlantilla(rest.id, canal === "email" ? asunto : null, cuerpo));
    if (r.ok && r.data) setVista(r.data);
  }
  async function prueba() {
    const r = await correr(enviarPruebaPlantilla(rest.id, canal === "email" ? asunto : null, cuerpo));
    if (r.ok && r.data) avisar(`Prueba enviada a ${r.data.para}.`);
  }

  /* canales */
  const canalOn = (c: string) => (c === "email" ? rest.envio_email : c === "sms" ? rest.envio_sms : rest.envio_whatsapp);
  async function alternarCanal(c: string, v: boolean) {
    const campos = c === "email" ? { envio_email: v } : c === "sms" ? { envio_sms: v } : { envio_whatsapp: v };
    const r = await correr(guardarRestauranteAjustes(rest.id, campos), v ? "Canal activado." : "Canal desactivado.");
    if (r.ok && r.data) onRestaurante(r.data);
  }
  const horasCambiadas = JSON.stringify(horas) !== JSON.stringify(horasDe(rest));
  useSucio(onSucio, !ro && (cambios || horasCambiadas));
  async function guardarHoras() {
    const r = await correr(guardarRestauranteAjustes(rest.id, { recordatorio_horas: parseInt(horas.recordatorio_horas) || 0, reconfirmacion_horas: parseInt(horas.reconfirmacion_horas) || 0, valoracion_horas: parseInt(horas.valoracion_horas) || 0 }), "Horas guardadas.");
    if (r.ok && r.data) onRestaurante(r.data);
  }

  const nPropias = (t: string) => (plantillas ?? []).filter((p) => p.restaurante_id === rest.id && p.tipo === t).length;
  const tipoDef = TIPOS_PLANTILLA.find((t) => t.id === tipo)!;
  const longitud = cuerpo.length;
  const segmentosSms = Math.ceil(longitud / 160) || 1;

  return (
    <>
      <Cabecera titulo="Mensajes" texto="Qué recibe el cliente y por dónde. Las plantillas de la cuenta valen para todos los restaurantes; si guardas una aquí, este restaurante usa la suya." />
      {ro ? <SoloLectura /> : null}

      <Panel titulo="Canales y tiempos">
        <div className="aj-form">
          <Campo label="Canales activos en este restaurante" ancho={2}>
            <div className="aj-interruptores">
              {CANALES.map((c) => {
                const hay = prov ? prov[c.id as keyof typeof prov] : null;
                return (
                  <div key={c.id} className="aj-linea">
                    <Interruptor on={canalOn(c.id)} disabled={ro || ocupado} onChange={(v) => alternarCanal(c.id, v)} texto={c.texto} />
                    {hay === false ? <Chip color="#8A9199">sin proveedor: los envíos quedan pendientes</Chip> : hay ? <Chip color="#2E9E5B">proveedor listo</Chip> : null}
                  </div>
                );
              })}
            </div>
          </Campo>
          <Campo label="Recordatorio" ayuda="Horas antes de la reserva."><div className="aj-con-unidad"><input type="number" min={0} max={720} value={horas.recordatorio_horas} disabled={ro} onChange={(e) => setHoras({ ...horas, recordatorio_horas: e.target.value })} /><span>h antes</span></div></Campo>
          <Campo label="Reconfirmación" ayuda="Solo con política, garantía o grupos."><div className="aj-con-unidad"><input type="number" min={0} max={720} value={horas.reconfirmacion_horas} disabled={ro} onChange={(e) => setHoras({ ...horas, reconfirmacion_horas: e.target.value })} /><span>h antes</span></div></Campo>
          <Campo label="Valoración" ayuda="Tras la hora de salida."><div className="aj-con-unidad"><input type="number" min={0} max={720} value={horas.valoracion_horas} disabled={ro} onChange={(e) => setHoras({ ...horas, valoracion_horas: e.target.value })} /><span>h después</span></div></Campo>
        </div>
        {horasCambiadas && !ro ? <div className="aj-form-pie"><Boton tipo="fantasma" onClick={() => setHoras(horasDe(rest))}>Descartar</Boton><Boton tipo="primario" disabled={ocupado} onClick={guardarHoras}>Guardar horas</Boton></div> : null}
      </Panel>

      {plantillas === null ? (
        <div className="spinner" />
      ) : (
        <div className="aj-msj">
          <div className="aj-msj-lista">
            {TIPOS_PLANTILLA.map((t) => (
              <button key={t.id} className={tipo === t.id ? "activo" : ""} onClick={() => { if (t.id !== tipo) cambiarSel(() => setTipo(t.id)); }}>
                <span className="n">{t.texto}{nPropias(t.id) ? " ●" : ""}</span>
                <span className="c">{t.cuando}</span>
              </button>
            ))}
          </div>

          <div>
            <div className="aj-msj-canales">
              {CANALES.map((c) => (
                <button key={c.id} className={`${canal === c.id ? "activo" : ""}${canalOn(c.id) ? "" : " apagado"}`} onClick={() => { if (c.id !== canal) cambiarSel(() => setCanal(c.id)); }} title={canalOn(c.id) ? "" : "Canal desactivado en este restaurante"}>
                  {c.texto}{!canalOn(c.id) ? " (off)" : ""}
                </button>
              ))}
              <select className="idioma" value={idioma} onChange={(e) => { const v = e.target.value; cambiarSel(() => setIdioma(v)); }} style={{ width: "auto" }} aria-label="Idioma">
                {rest.idiomas.map((i) => <option key={i} value={i}>{nombreIdioma(i)}</option>)}
              </select>
            </div>

            <Panel className="aj-msj-editor">
              <div className="aj-msj-origen">
                <b>{tipoDef.texto}</b> · {CANALES.find((c) => c.id === canal)?.texto} · {nombreIdioma(idioma)} ·{" "}
                {propia ? <Chip color="#0F6E56">propia de {rest.nombre}</Chip> : cuenta ? <Chip color="#4B5057">plantilla de la cuenta</Chip> : <Chip color="#D99A1E">sin plantilla: no se envía</Chip>}
                {vigente && !vigente.activa ? <Chip color="#8A9199">desactivada</Chip> : null}
              </div>
              <div className="aj-msj-vars">
                {VARIABLES_PLANTILLA.map((v) => <button key={v.clave} type="button" disabled={ro} title={v.texto} onClick={() => insertar(v.clave)}>{`{{${v.clave}}}`}</button>)}
              </div>
              {canal === "email" ? (
                <Campo label="Asunto"><input value={asunto} disabled={ro} onChange={(e) => setAsunto(e.target.value)} maxLength={200} placeholder="Tu reserva en {{restaurante}} · {{fecha}} {{hora}}" /></Campo>
              ) : null}
              <Campo label={canal === "email" ? "Cuerpo" : "Mensaje"} ayuda={canal === "whatsapp" ? "WhatsApp exige plantillas aprobadas por Meta: el texto debe coincidir con el registrado." : undefined}>
                <textarea ref={areaRef} value={cuerpo} disabled={ro} onChange={(e) => setCuerpo(e.target.value)} placeholder="Hola {{nombre}}, …" />
              </Campo>
              <div className={`aj-contador${canal === "sms" && longitud > 480 ? " pasa" : ""}`}>
                {longitud} caracteres{canal === "sms" ? ` · ${segmentosSms} ${segmentosSms === 1 ? "segmento" : "segmentos"} de SMS` : ""}
              </div>
              <div className="aj-form-pie">
                <div className="izq aj-linea">
                  <Interruptor on={activa} disabled={ro} onChange={setActiva} texto={activa ? "Se envía" : "No se envía"} />
                  {propia && !ro ? <Boton tipo="fantasma" onClick={() => setConfirmarReset(true)}>Volver a la de la cuenta</Boton> : null}
                </div>
                <Boton onClick={previsualizar} disabled={ocupado || !cuerpo.trim()}>Vista previa</Boton>
                {canal === "email" ? <Boton onClick={prueba} disabled={ocupado || !cuerpo.trim() || !prov?.email} title={prov?.email ? "Te la envías a tu correo con datos de ejemplo" : "Sin proveedor de email configurado"}>Enviarme una prueba</Boton> : null}
                {!ro && puedeEditarCuenta ? (
                  <select value={ambito} onChange={(e) => setAmbito(e.target.value === "cuenta" ? "cuenta" : "rest")} style={{ width: "auto" }} aria-label="Guardar para">
                    <option value="rest">Guardar para: {rest.nombre}</option>
                    <option value="cuenta">Guardar para: todos los restaurantes</option>
                  </select>
                ) : null}
                {!ro ? <Boton tipo="primario" onClick={guardar} disabled={ocupado || !cambios || !cuerpo.trim()}>{ocupado ? "Guardando…" : ambito === "cuenta" && puedeEditarCuenta ? "Guardar para todos" : propia ? "Guardar" : "Guardar para este restaurante"}</Boton> : null}
              </div>
              {ambito === "cuenta" && puedeEditarCuenta && propia ? (
                <div className="aj-ayuda" style={{ marginTop: 6 }}>{rest.nombre} tiene su propia versión de este mensaje y la seguirá usando. Para que use la común, pulsa «Volver a la de la cuenta».</div>
              ) : null}
            </Panel>

            {vista ? (
              <Panel titulo="Vista previa con datos de ejemplo">
                <div className={`aj-msj-vista${canal !== "email" ? " sms" : ""}`}>
                  {canal === "email" && vista.asunto ? <div className="asunto">{vista.asunto}</div> : null}
                  {vista.cuerpo}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}

      {preguntaCambio ? (
        <Confirmar
          texto="Hay cambios sin guardar en este mensaje. Si cambias de mensaje, canal o idioma se pierden."
          confirmarTexto="Descartar y salir"
          peligro
          onNo={() => setPreguntaCambio(null)}
          onSi={() => { const fn = preguntaCambio; setPreguntaCambio(null); fn(); }}
        />
      ) : null}
      {confirmarReset && propia ? (
        <Confirmar texto="¿Volver a la plantilla de la cuenta?" detalle="Se borra la plantilla propia de este restaurante para este tipo, canal e idioma." confirmarTexto="Volver a la de la cuenta" peligro ocupado={ocupado} onNo={() => setConfirmarReset(false)}
          onSi={async () => { const r = await correr(borrarPlantilla(propia.id), "Plantilla restablecida."); setConfirmarReset(false); if (r.ok) await cargar(); }} />
      ) : null}
    </>
  );
}
