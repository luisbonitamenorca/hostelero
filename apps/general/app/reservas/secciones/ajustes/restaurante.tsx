"use client";

/* Ajustes › Restaurante: datos del local, marca (logo y color), textos del widget, antelaciones,
   reglas de la reserva online y duración por número de personas. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Restaurante } from "../../tipos";
import { guardarRestauranteAjustes, prepararSubidaLogo, quitarLogo, registrarLogo, type CamposRestaurante } from "../../acciones/ajustes";
import {
  Boton, Cabecera, Campo, ColorCampo, IDIOMAS, Interruptor, Panel, PieGuardar, SoloLectura, TRAMOS_DEFECTO,
  tramosDeJson, useAccion, useSucio, type AjProps, type TramoDuracion,
} from "./comunes";

const ZONAS = ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "Europe/Rome", "Europe/Berlin"];

type Form = {
  nombre: string;
  descripcion: string;
  direccion: string;
  ubicacion: string;
  telefono: string;
  telefono_whatsapp: string;
  email: string;
  email_reservas: string;
  idiomas: string[];
  color_marca: string | null;
  mensaje_widget: string;
  url_condiciones: string;
  url_resena_google: string;
  zona_horaria: string;
  prefijo_localizador: string;
  online_activo: boolean;
  antelacion_min_horas: string;
  antelacion_max_dias: string;
  max_pax_online: string;
  grupos_telefono: string;
  confirmar_online_auto: boolean;
  liberar_tras_min: string;
  tramos: TramoDuracion[];
};

function formDe(r: Restaurante): Form {
  return {
    nombre: r.nombre ?? "",
    descripcion: r.descripcion ?? "",
    direccion: r.direccion ?? "",
    ubicacion: r.ubicacion ?? "",
    telefono: r.telefono ?? "",
    telefono_whatsapp: r.telefono_whatsapp ?? "",
    email: r.email ?? "",
    email_reservas: r.email_reservas ?? "",
    idiomas: r.idiomas?.length ? r.idiomas : ["es", "en"],
    color_marca: r.color_marca ?? null,
    mensaje_widget: r.mensaje_widget ?? "",
    url_condiciones: r.url_condiciones ?? "",
    url_resena_google: r.url_resena_google ?? "",
    zona_horaria: r.zona_horaria || "Europe/Madrid",
    prefijo_localizador: r.prefijo_localizador ?? "",
    online_activo: r.online_activo,
    antelacion_min_horas: String(r.antelacion_min_horas ?? 0),
    antelacion_max_dias: String(r.antelacion_max_dias ?? 60),
    max_pax_online: String(r.max_pax_online ?? 8),
    grupos_telefono: r.grupos_telefono ?? "",
    confirmar_online_auto: r.confirmar_online_auto,
    liberar_tras_min: String(r.liberar_tras_min ?? 20),
    tramos: tramosDeJson(r.duracion_por_pax),
  };
}

export default function AjRestaurante({ rest, avisar, puedeEditar, onRestaurante, onSucio }: AjProps) {
  const [f, setF] = useState<Form>(() => formDe(rest));
  const [base, setBase] = useState<string>(() => JSON.stringify(formDe(rest)));
  const { ocupado, correr } = useAccion(avisar);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const fichero = useRef<HTMLInputElement>(null);
  const ro = !puedeEditar;

  // Si el restaurante cambia desde fuera (otra pestaña lo guardó), se recarga el formulario si no hay edición a medias.
  useEffect(() => {
    const nuevo = formDe(rest);
    setF((actual) => (JSON.stringify(actual) === base ? nuevo : actual));
    setBase(JSON.stringify(nuevo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest]);

  const cambios = useMemo(() => JSON.stringify(f) !== base, [f, base]);
  useSucio(onSucio, cambios && !ro);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function guardar() {
    if (!f.nombre.trim()) { avisar("El restaurante necesita un nombre."); return; }
    if (!f.idiomas.length) { avisar("Deja al menos un idioma activo."); return; }
    const campos: CamposRestaurante = {
      nombre: f.nombre,
      descripcion: f.descripcion || null,
      direccion: f.direccion || null,
      ubicacion: f.ubicacion || null,
      telefono: f.telefono || null,
      telefono_whatsapp: f.telefono_whatsapp || null,
      email: f.email || null,
      email_reservas: f.email_reservas || null,
      idiomas: f.idiomas,
      color_marca: f.color_marca,
      mensaje_widget: f.mensaje_widget || null,
      url_condiciones: f.url_condiciones || null,
      url_resena_google: f.url_resena_google || null,
      zona_horaria: f.zona_horaria,
      prefijo_localizador: f.prefijo_localizador || null,
      online_activo: f.online_activo,
      antelacion_min_horas: parseInt(f.antelacion_min_horas) || 0,
      antelacion_max_dias: parseInt(f.antelacion_max_dias) || 60,
      max_pax_online: parseInt(f.max_pax_online) || 8,
      grupos_telefono: f.grupos_telefono || null,
      confirmar_online_auto: f.confirmar_online_auto,
      liberar_tras_min: parseInt(f.liberar_tras_min) || 0,
      duracion_por_pax: f.tramos,
    };
    const r = await correr(guardarRestauranteAjustes(rest.id, campos), "Restaurante guardado.");
    if (r.ok && r.data) onRestaurante(r.data);
  }

  async function subirLogo(file: File) {
    setSubiendoLogo(true);
    try {
      const prep = await prepararSubidaLogo(rest.id, file.name, file.size, file.type || null);
      if (!prep.ok || !prep.data) { avisar(prep.error || "No se ha podido preparar la subida."); return; }
      const up = await fetch(prep.data.urlSubida, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!up.ok) { avisar("No se ha podido subir el logo."); return; }
      const reg = await registrarLogo(rest.id, prep.data.ruta);
      if (!reg.ok || !reg.data) { avisar(reg.error || "No se ha podido guardar el logo."); return; }
      onRestaurante({ ...rest, logo_url: reg.data.logo_url });
      avisar("Logo actualizado.");
    } finally {
      setSubiendoLogo(false);
      if (fichero.current) fichero.current.value = "";
    }
  }

  /* ---- tramos de duración ---- */
  const tramos = f.tramos;
  const setTramo = (i: number, t: Partial<TramoDuracion>) => set("tramos", tramos.map((x, j) => (j === i ? { ...x, ...t } : x)));
  const quitarTramo = (i: number) => set("tramos", tramos.filter((_, j) => j !== i));
  const anadirTramo = () => {
    const ultimo = tramos[tramos.length - 1];
    const desde = ultimo ? (ultimo.hasta ?? ultimo.desde) + 1 : 1;
    set("tramos", [...tramos.map((t, i) => (i === tramos.length - 1 && t.hasta === null ? { ...t, hasta: t.desde } : t)), { desde, hasta: null, min: ultimo?.min ?? 120 }]);
  };
  const avisoTramos = useMemo(() => {
    for (let i = 0; i < tramos.length; i++) {
      const t = tramos[i];
      if (t.hasta !== null && t.hasta < t.desde) return "Hay un tramo con «hasta» menor que «desde».";
      if (i > 0) {
        const p = tramos[i - 1];
        if (p.hasta === null) return "Solo el último tramo puede ser abierto («o más»).";
        if (t.desde <= p.hasta) return "Los tramos se solapan.";
        if (t.desde > p.hasta + 1) return `Faltan personas entre ${p.hasta} y ${t.desde}: se usará la duración del turno.`;
      }
    }
    return null;
  }, [tramos]);

  return (
    <>
      <Cabecera titulo={rest.nombre} texto="Datos del local, marca y reglas de la reserva online. Lo que cambies aquí lo ve el cliente en el widget y en los mensajes." />
      {ro ? <SoloLectura /> : null}

      <Panel titulo="Datos del restaurante">
        <div className="aj-form">
          <Campo label="Nombre"><input value={f.nombre} disabled={ro} onChange={(e) => set("nombre", e.target.value)} maxLength={80} /></Campo>
          <Campo label="Teléfono"><input value={f.telefono} disabled={ro} onChange={(e) => set("telefono", e.target.value)} placeholder="+34 971 …" /></Campo>
          <Campo label="WhatsApp" ayuda="Número al que escribe el cliente desde el panel y el widget."><input value={f.telefono_whatsapp} disabled={ro} onChange={(e) => set("telefono_whatsapp", e.target.value)} placeholder="+34 6…" /></Campo>
          <Campo label="Dirección" ancho={2}><input value={f.direccion} disabled={ro} onChange={(e) => set("direccion", e.target.value)} placeholder="Calle, número, población" /></Campo>
          <Campo label="Ubicación (enlace a mapa)"><input value={f.ubicacion} disabled={ro} onChange={(e) => set("ubicacion", e.target.value)} placeholder="https://maps.app.goo.gl/…" /></Campo>
          <Campo label="Email de reservas" ayuda="Remitente de los correos al cliente y donde llegan las respuestas."><input type="email" value={f.email_reservas} disabled={ro} onChange={(e) => set("email_reservas", e.target.value)} placeholder="reservas@…" /></Campo>
          <Campo label="Email de contacto"><input type="email" value={f.email} disabled={ro} onChange={(e) => set("email", e.target.value)} /></Campo>
          <Campo label="Zona horaria">
            <select value={f.zona_horaria} disabled={ro} onChange={(e) => set("zona_horaria", e.target.value)}>
              {[...new Set([f.zona_horaria, ...ZONAS])].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Campo>
          <Campo label="Descripción (visible en la web)" ancho="todo"><textarea value={f.descripcion} disabled={ro} onChange={(e) => set("descripcion", e.target.value)} maxLength={600} /></Campo>
        </div>
      </Panel>

      <Panel titulo="Marca" texto="Logo y color que usa el widget público y las confirmaciones.">
        <div className="aj-form">
          <Campo label="Logo" ancho={2}>
            <div className="aj-logo">
              {rest.logo_url ? <img className="aj-logo-img" src={rest.logo_url} alt="Logo" /> : <div className="aj-logo-vacio">Sin logo</div>}
              <div className="aj-linea">
                <input ref={fichero} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => { const x = e.target.files?.[0]; if (x) subirLogo(x); }} />
                <Boton onClick={() => fichero.current?.click()} disabled={ro || subiendoLogo}>{subiendoLogo ? "Subiendo…" : rest.logo_url ? "Cambiar logo" : "Subir logo"}</Boton>
                {rest.logo_url ? (
                  <Boton tipo="fantasma" disabled={ro || subiendoLogo} onClick={async () => { const r = await correr(quitarLogo(rest.id), "Logo retirado."); if (r.ok) onRestaurante({ ...rest, logo_url: null }); }}>Quitar</Boton>
                ) : null}
              </div>
            </div>
            <span className="aj-ayuda">PNG, JPG o WebP, hasta 2 MB. Mejor con fondo transparente.</span>
          </Campo>
          <Campo label="Color de marca" ayuda="Botones y acentos del widget. Vacío = color de la casa.">
            <ColorCampo valor={f.color_marca} onChange={(v) => set("color_marca", v)} permitirVacio disabled={ro} />
          </Campo>
          <Campo label="Idiomas del widget y los mensajes" ancho="todo">
            <div className="aj-idiomas">
              {IDIOMAS.map((i) => {
                const on = f.idiomas.includes(i.id);
                return (
                  <label key={i.id} className={on ? "on" : ""}>
                    <input type="checkbox" checked={on} disabled={ro} onChange={(e) => set("idiomas", e.target.checked ? [...f.idiomas, i.id] : f.idiomas.filter((x) => x !== i.id))} />
                    {i.texto}
                  </label>
                );
              })}
            </div>
            <span className="aj-ayuda">El primero es el idioma por defecto. El cliente elige el suyo al reservar; los mensajes salen en ese idioma si hay plantilla.</span>
          </Campo>
        </div>
      </Panel>

      <Panel titulo="Textos y enlaces para el cliente">
        <div className="aj-form">
          <Campo label="Mensaje del widget" ancho="todo" ayuda="Se muestra al reservar y entra en los mensajes como {{mensaje}}. P. ej. «Podrán disfrutar de su mesa durante 2 horas».">
            <textarea value={f.mensaje_widget} disabled={ro} onChange={(e) => set("mensaje_widget", e.target.value)} maxLength={600} />
          </Campo>
          <Campo label="Mensaje para grupos grandes" ancho="todo" ayuda="Lo ve quien pide más personas de las que admite la reserva online.">
            <textarea value={f.grupos_telefono} disabled={ro} onChange={(e) => set("grupos_telefono", e.target.value)} maxLength={400} placeholder="Para grupos de más de 8 personas llámanos al …" />
          </Campo>
          <Campo label="URL de condiciones"><input value={f.url_condiciones} disabled={ro} onChange={(e) => set("url_condiciones", e.target.value)} placeholder="https://…/condiciones" /></Campo>
          <Campo label="URL de reseña en Google" ayuda="Se ofrece tras una valoración de 4 o más estrellas."><input value={f.url_resena_google} disabled={ro} onChange={(e) => set("url_resena_google", e.target.value)} placeholder="https://g.page/r/…/review" /></Campo>
          <Campo label="Prefijo del localizador" ayuda="Letras delante del localizador (p. ej. BIN-7K3P2). Vacío = sin prefijo."><input value={f.prefijo_localizador} disabled={ro} onChange={(e) => set("prefijo_localizador", e.target.value.toUpperCase())} maxLength={6} /></Campo>
        </div>
      </Panel>

      <Panel titulo="Reserva online" texto="Reglas del widget público. Los cupos por turno se ajustan en «Turnos y cupos».">
        <div className="aj-form estrecho">
          <Campo label="Reservas online" ancho={2}>
            <div className="aj-interruptores">
              <Interruptor on={f.online_activo} disabled={ro} onChange={(v) => set("online_activo", v)} texto={f.online_activo ? "Activadas: el restaurante aparece en el widget" : "Desactivadas: solo se reserva desde el panel"} />
              <Interruptor on={f.confirmar_online_auto} disabled={ro} onChange={(v) => set("confirmar_online_auto", v)} texto={f.confirmar_online_auto ? "Las reservas online entran confirmadas" : "Las reservas online entran pendientes (las confirma la sala)"} />
            </div>
          </Campo>
          <Campo label="Antelación mínima" ayuda="Horas antes de la hora de la reserva.">
            <div className="aj-con-unidad"><input type="number" min={0} max={720} value={f.antelacion_min_horas} disabled={ro} onChange={(e) => set("antelacion_min_horas", e.target.value)} /><span>horas</span></div>
          </Campo>
          <Campo label="Antelación máxima" ayuda="Hasta cuántos días vista se puede reservar.">
            <div className="aj-con-unidad"><input type="number" min={1} max={730} value={f.antelacion_max_dias} disabled={ro} onChange={(e) => set("antelacion_max_dias", e.target.value)} /><span>días</span></div>
          </Campo>
          <Campo label="Máximo de personas online" ayuda="Por encima se muestra el mensaje de grupos.">
            <div className="aj-con-unidad"><input type="number" min={1} max={200} value={f.max_pax_online} disabled={ro} onChange={(e) => set("max_pax_online", e.target.value)} /><span>personas</span></div>
          </Campo>
          <Campo label="Marcar «a revisar» tras" ayuda="Minutos sin llegar desde la hora de la reserva. 0 = nunca.">
            <div className="aj-con-unidad"><input type="number" min={0} max={240} value={f.liberar_tras_min} disabled={ro} onChange={(e) => set("liberar_tras_min", e.target.value)} /><span>min</span></div>
          </Campo>
        </div>
      </Panel>

      <Panel titulo="Duración por personas" texto="Cuánto ocupa la mesa según el tamaño de la reserva. Si no hay tramo que encaje, se usa la duración del turno.">
        {tramos.length ? (
          <div className="aj-tramos">
            {tramos.map((t, i) => (
              <div key={i} className="aj-tramo">
                <span>De</span>
                <input type="number" min={1} max={999} value={t.desde} disabled={ro} onChange={(e) => setTramo(i, { desde: parseInt(e.target.value) || 1 })} />
                <span>a</span>
                <input type="number" min={1} max={999} value={t.hasta ?? ""} placeholder="∞" disabled={ro} onChange={(e) => setTramo(i, { hasta: e.target.value === "" ? null : parseInt(e.target.value) || 1 })} />
                <span>personas →</span>
                <input type="number" min={15} max={600} step={15} value={t.min} disabled={ro} onChange={(e) => setTramo(i, { min: parseInt(e.target.value) || 15 })} />
                <span>min</span>
                <Boton tipo="fantasma" className="mini" disabled={ro} onClick={() => quitarTramo(i)} title="Quitar tramo">✕</Boton>
              </div>
            ))}
          </div>
        ) : (
          <div className="aj-vacio">Sin tramos: todas las reservas duran lo que diga el turno.</div>
        )}
        {avisoTramos ? <div className="aj-aviso" style={{ marginTop: 10 }}>{avisoTramos}</div> : null}
        <div className="aj-form-pie">
          {!tramos.length ? <Boton disabled={ro} onClick={() => set("tramos", TRAMOS_DEFECTO)}>Usar tramos habituales (1–2: 90 · 3–4: 120 · 5–8: 150 · 9+: 180)</Boton> : null}
          <Boton disabled={ro} onClick={anadirTramo}>+ Añadir tramo</Boton>
        </div>
      </Panel>

      <PieGuardar cambios={cambios && !ro} ocupado={ocupado} onGuardar={guardar} onDescartar={() => setF(JSON.parse(base) as Form)} />
    </>
  );
}
