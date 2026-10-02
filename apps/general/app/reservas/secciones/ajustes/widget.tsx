"use client";

/* Ajustes › Widget / front: enlace público por restaurante (con copiar y QR en SVG), código de
   inserción, colores y textos del widget, y vista previa embebida. Las preguntas personalizadas
   tienen su propia pestaña. */

import { useEffect, useMemo, useState } from "react";
import { guardarRestauranteAjustes, listarPreguntas, type Pregunta } from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, Chip, ColorCampo, Interruptor, Panel, PieGuardar, SoloLectura, useAccion, useSucio, type AjProps } from "./comunes";
import { QrSvg, svgQr } from "./qr";

/** Escapa un texto para meterlo en un atributo HTML entre comillas dobles. */
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Form = { color_marca: string | null; mensaje_widget: string; grupos_telefono: string; url_condiciones: string; url_base: string; online_activo: boolean };

export default function AjWidget({ rest, avisar, puedeEditar, onRestaurante, onSucio, irA }: AjProps) {
  const formDe = (): Form => ({
    color_marca: rest.color_marca ?? null,
    mensaje_widget: rest.mensaje_widget ?? "",
    grupos_telefono: rest.grupos_telefono ?? "",
    url_condiciones: rest.url_condiciones ?? "",
    url_base: rest.url_base ?? "",
    online_activo: rest.online_activo,
  });
  const [f, setF] = useState<Form>(formDe);
  const [base, setBase] = useState(() => JSON.stringify(formDe()));
  const [preguntas, setPreguntas] = useState<Pregunta[] | null>(null);
  const [vista, setVista] = useState(false);
  const [origen, setOrigen] = useState("");
  const { ocupado, correr } = useAccion(avisar);
  const ro = !puedeEditar;

  useEffect(() => { setOrigen(window.location.origin); }, []);
  useEffect(() => {
    const nuevo = formDe();
    setF((actual) => (JSON.stringify(actual) === base ? nuevo : actual));
    setBase(JSON.stringify(nuevo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest]);
  useEffect(() => { listarPreguntas(rest.id).then(setPreguntas); }, [rest.id]);

  const cambios = JSON.stringify(f) !== base;
  useSucio(onSucio, cambios && !ro);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const baseUrl = (f.url_base || rest.url_base || origen).replace(/\/+$/, "");
  const enlace = `${baseUrl}/reservar-mesa/${rest.slug}`;
  const enlaceGrupo = `${baseUrl}/reservar-mesa`;
  const embed = useMemo(() => `<iframe src="${attr(enlace)}" title="Reservar mesa en ${attr(rest.nombre)}" style="width:100%;max-width:560px;height:720px;border:0;border-radius:12px" loading="lazy"></iframe>`, [enlace, rest.nombre]);

  const copiar = async (t: string, msg: string) => {
    try { await navigator.clipboard.writeText(t); avisar(msg); } catch { avisar("No se ha podido copiar."); }
  };
  const descargarQr = () => {
    const svg = svgQr(enlace, { color: "#111111" });
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-reservas-${rest.slug}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  async function guardar() {
    const r = await correr(guardarRestauranteAjustes(rest.id, {
      color_marca: f.color_marca,
      mensaje_widget: f.mensaje_widget || null,
      grupos_telefono: f.grupos_telefono || null,
      url_condiciones: f.url_condiciones || null,
      url_base: f.url_base || null,
      online_activo: f.online_activo,
    }), "Widget guardado.");
    if (r.ok && r.data) onRestaurante(r.data);
  }

  return (
    <>
      <Cabecera titulo="Widget / front" texto="La página pública donde reserva el cliente. Comparte el enlace, pon el QR en la mesa o inserta el widget en vuestra web.">
        <Chip color={rest.online_activo ? "#2E9E5B" : "#D32F2F"}>{rest.online_activo ? "Reservas online activadas" : "Reservas online desactivadas"}</Chip>
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      <Panel titulo="Enlace de reservas de este restaurante">
        <div className="aj-form">
          <Campo label={`Enlace directo a ${rest.nombre}`} ancho={2}>
            <div className="aj-enlace">
              <input readOnly value={enlace} onFocus={(e) => e.target.select()} />
              <Boton onClick={() => copiar(enlace, "Enlace copiado.")}>Copiar</Boton>
              <a className="aj-btn sec" href={enlace} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
            </div>
          </Campo>
          <Campo label="Enlace del grupo (elige restaurante)">
            <div className="aj-enlace">
              <input readOnly value={enlaceGrupo} onFocus={(e) => e.target.select()} />
              <Boton onClick={() => copiar(enlaceGrupo, "Enlace copiado.")}>Copiar</Boton>
            </div>
          </Campo>
          <Campo label="Dominio público" ayuda="Si el widget vive en un dominio propio (p. ej. reservas.tudominio.com), ponlo aquí: los enlaces de los mensajes lo usarán." ancho={2}>
            <input value={f.url_base} disabled={ro} onChange={(e) => set("url_base", e.target.value)} placeholder={origen} />
          </Campo>
        </div>
        <div className="aj-qr" style={{ marginTop: 14 }}>
          <QrSvg texto={enlace} />
          <div>
            <div className="aj-label" style={{ marginBottom: 4 }}>QR del enlace</div>
            <div className="mudo" style={{ fontSize: 12.5, marginBottom: 8, maxWidth: 420 }}>Para la mesa, la carta o el escaparate. Se genera aquí mismo, en SVG: imprime a cualquier tamaño sin perder nitidez.</div>
            <div className="aj-linea">
              <Boton onClick={descargarQr}>Descargar SVG</Boton>
              <Boton tipo="fantasma" onClick={() => copiar(svgQr(enlace), "SVG copiado.")}>Copiar SVG</Boton>
            </div>
          </div>
        </div>
      </Panel>

      <Panel titulo="Insertar en vuestra web" texto="Pega este código donde quieras que aparezca el widget.">
        <div className="aj-codigo">{embed}</div>
        <div className="aj-form-pie"><Boton onClick={() => copiar(embed, "Código copiado.")}>Copiar código</Boton></div>
      </Panel>

      <Panel titulo="Colores y textos" texto="Lo mismo que en Restaurante, a mano para no ir y venir.">
        <div className="aj-form">
          <Campo label="Reservas online" ancho={2}><Interruptor on={f.online_activo} disabled={ro} onChange={(v) => set("online_activo", v)} texto={f.online_activo ? "Activadas" : "Desactivadas: el widget muestra el restaurante como no disponible"} /></Campo>
          <Campo label="Color de marca" ayuda="Botones y acentos del widget."><ColorCampo valor={f.color_marca} disabled={ro} permitirVacio onChange={(v) => set("color_marca", v)} /></Campo>
          <Campo label="Mensaje al reservar" ancho="todo"><textarea value={f.mensaje_widget} disabled={ro} onChange={(e) => set("mensaje_widget", e.target.value)} maxLength={600} placeholder="Podrán disfrutar de su mesa durante 2 horas." /></Campo>
          <Campo label="Mensaje para grupos grandes" ancho="todo"><textarea value={f.grupos_telefono} disabled={ro} onChange={(e) => set("grupos_telefono", e.target.value)} maxLength={400} placeholder={`Para más de ${rest.max_pax_online} personas, llámanos al ${rest.telefono ?? "…"}`} /></Campo>
          <Campo label="URL de condiciones" ancho={2}><input value={f.url_condiciones} disabled={ro} onChange={(e) => set("url_condiciones", e.target.value)} placeholder="https://…/condiciones" /></Campo>
        </div>
      </Panel>

      <Panel titulo="Preguntas personalizadas" texto="Lo que se pregunta al cliente en el paso de datos (trona, alergias, ocasión…).">
        {preguntas === null ? <div className="spinner" /> : preguntas.length ? (
          <div className="aj-chips">
            {preguntas.filter((p) => p.activa).map((p) => <Chip key={p.id} color="#4B5057">{p.texto}{p.obligatoria ? " *" : ""}</Chip>)}
            {!preguntas.some((p) => p.activa) ? <span className="mudo">Todas desactivadas.</span> : null}
          </div>
        ) : <span className="mudo">Sin preguntas.</span>}
        <div className="aj-form-pie"><Boton onClick={() => irA("preguntas")}>Gestionar preguntas</Boton></div>
      </Panel>

      <Panel titulo="Vista previa" texto="La misma página que ve el cliente. Lo que reserves aquí es real: gestiónalo después desde Día.">
        <div className="aj-form-pie" style={{ marginTop: 0, justifyContent: "flex-start" }}>
          <Boton onClick={() => setVista((v) => !v)}>{vista ? "Ocultar vista previa" : "Ver aquí"}</Boton>
        </div>
        {vista ? <div className="aj-widget-vista"><iframe src={enlace} title={`Widget de reservas de ${rest.nombre}`} /></div> : null}
      </Panel>

      <PieGuardar cambios={cambios && !ro} ocupado={ocupado} onGuardar={guardar} onDescartar={() => setF(JSON.parse(base) as Form)} />
    </>
  );
}
