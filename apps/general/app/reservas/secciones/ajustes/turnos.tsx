"use client";

/* Ajustes › Turnos y cupos: lista de turnos editable y calendario de excepciones por fecha
   (cerrar día o turno, aforo especial, nota). Los cierres del esquema antiguo se listan y se quitan. */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Turno } from "../../tipos";
import { hoyISO } from "../../tipos";
import { fmtFecha, rangoMes, sumarDias } from "../../lib-reservas";
import {
  borrarCierreAjustes, borrarCupo, borrarTurno, guardarCupoAjustes, guardarTurnoAjustes, listarCupos,
  type CamposCupo, type CamposTurno, type Cierre, type Cupo,
} from "../../acciones/ajustes";
import {
  Boton, Cabecera, Campo, Chip, ColorCampo, Confirmar, DIAS_SEMANA, DiasCampo, Interruptor, ModalForm, Panel, SoloLectura,
  Vacio, hhmm, textoDias, useAccion, type AjProps,
} from "./comunes";

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SIN_TURNO = "__dia__";

/* ==================== Turnos ==================== */

type FormTurno = {
  nombre: string; hora_inicio: string; hora_fin: string; fin_servicio: string; intervalo_min: string; duracion_min: string;
  dias_semana: number[]; max_pax_online: string; max_pax_total: string; max_reservas_intervalo: string; color: string | null; activo: boolean;
};
const formTurno = (t: Turno | null): FormTurno => ({
  nombre: t?.nombre ?? "",
  hora_inicio: t ? hhmm(t.hora_inicio) : "13:00",
  hora_fin: t ? hhmm(t.hora_fin) : "15:30",
  fin_servicio: t?.fin_servicio ? hhmm(t.fin_servicio) : "",
  intervalo_min: String(t?.intervalo_min ?? 15),
  duracion_min: String(t?.duracion_min ?? 120),
  dias_semana: t?.dias_semana ?? [1, 2, 3, 4, 5, 6, 7],
  max_pax_online: String(t?.max_pax_online ?? 8),
  max_pax_total: t?.max_pax_total != null ? String(t.max_pax_total) : "",
  max_reservas_intervalo: t?.max_reservas_intervalo != null ? String(t.max_reservas_intervalo) : "",
  color: t?.color ?? null,
  activo: t ? t.activo : true,
});

function ModalTurno({ turno, restId, avisar, cerrar, guardado, puedeBorrar }: { turno: Turno | null; restId: string; avisar: (m: string) => void; cerrar: () => void; guardado: () => void; puedeBorrar: boolean }) {
  const [f, setF] = useState<FormTurno>(() => formTurno(turno));
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);
  const set = <K extends keyof FormTurno>(k: K, v: FormTurno[K]) => setF((x) => ({ ...x, [k]: v }));

  async function guardar() {
    const c: CamposTurno = {
      nombre: f.nombre,
      hora_inicio: f.hora_inicio,
      hora_fin: f.hora_fin,
      fin_servicio: f.fin_servicio || null,
      intervalo_min: parseInt(f.intervalo_min) || 15,
      duracion_min: parseInt(f.duracion_min) || 120,
      dias_semana: f.dias_semana,
      max_pax_online: parseInt(f.max_pax_online) || 8,
      max_pax_total: f.max_pax_total === "" ? null : parseInt(f.max_pax_total) || null,
      max_reservas_intervalo: f.max_reservas_intervalo === "" ? null : parseInt(f.max_reservas_intervalo) || null,
      color: f.color,
      activo: f.activo,
    };
    const r = await correr(guardarTurnoAjustes(turno?.id ?? null, restId, c), turno ? "Turno guardado." : "Turno creado.");
    if (r.ok) guardado();
  }

  return (
    <>
      <ModalForm soloLectura={!puedeBorrar}
        titulo={turno ? `Turno · ${turno.nombre}` : "Nuevo turno"}
        onCerrar={cerrar}
        onGuardar={guardar}
        ocupado={ocupado}
        guardarTexto={turno ? "Guardar" : "Crear turno"}
        extra={turno && puedeBorrar ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>Borrar</Boton> : null}
      >
        <div className="aj-form">
          <Campo label="Nombre" ancho={2}><input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Comida / Cena" maxLength={40} /></Campo>
          <Campo label="Color" ayuda="Para el cronograma y el mes."><ColorCampo valor={f.color} onChange={(v) => set("color", v)} permitirVacio /></Campo>
          <Campo label="Primera hora de reserva"><input type="time" value={f.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} /></Campo>
          <Campo label="Última hora de reserva"><input type="time" value={f.hora_fin} onChange={(e) => set("hora_fin", e.target.value)} /></Campo>
          <Campo label="Fin de servicio" ayuda="Cuándo cierra la cocina; se usa para el no-show automático."><input type="time" value={f.fin_servicio} onChange={(e) => set("fin_servicio", e.target.value)} /></Campo>
          <Campo label="Intervalo entre horas"><div className="aj-con-unidad"><input type="number" min={5} max={120} step={5} value={f.intervalo_min} onChange={(e) => set("intervalo_min", e.target.value)} /><span>min</span></div></Campo>
          <Campo label="Duración por defecto" ayuda="Si no hay tramo por personas en Restaurante."><div className="aj-con-unidad"><input type="number" min={15} max={600} step={15} value={f.duracion_min} onChange={(e) => set("duracion_min", e.target.value)} /><span>min</span></div></Campo>
          <Campo label="Días de la semana" ancho="todo"><DiasCampo valor={f.dias_semana} onChange={(v) => set("dias_semana", v)} /></Campo>
          <Campo label="Máx. personas por reserva online"><input type="number" min={1} max={500} value={f.max_pax_online} onChange={(e) => set("max_pax_online", e.target.value)} /></Campo>
          <Campo label="Aforo total del turno" ayuda="Personas en todo el turno. Vacío = sin límite (manda el plano)."><input type="number" min={1} max={5000} value={f.max_pax_total} placeholder="sin límite" onChange={(e) => set("max_pax_total", e.target.value)} /></Campo>
          <Campo label="Máx. reservas por hora" ayuda="Reservas que entran en cada intervalo. Vacío = sin límite."><input type="number" min={1} max={500} value={f.max_reservas_intervalo} placeholder="sin límite" onChange={(e) => set("max_reservas_intervalo", e.target.value)} /></Campo>
          <Campo label="Estado"><Interruptor on={f.activo} onChange={(v) => set("activo", v)} texto={f.activo ? "Activo" : "Inactivo (no se ofrece)"} /></Campo>
        </div>
      </ModalForm>
      {confirmar && turno ? (
        <Confirmar
          texto={`¿Borrar el turno «${turno.nombre}»?`}
          detalle="Si tiene reservas, se desactiva en vez de borrarse para no perder el historial."
          confirmarTexto="Borrar"
          peligro
          ocupado={ocupado}
          onNo={() => setConfirmar(false)}
          onSi={async () => {
            const r = await correr(borrarTurno(turno.id));
            if (r.ok) { avisar(r.data?.desactivado ? "El turno tenía reservas: se ha desactivado." : "Turno borrado."); guardado(); }
            setConfirmar(false);
          }}
        />
      ) : null}
    </>
  );
}

/* ==================== Cupos (excepciones por fecha) ==================== */

type FormCupo = { cerrado: boolean; max_pax_online: string; max_pax_total: string; nota: string };

function ModalCupo({ fecha, turnos, cupos, restId, avisar, cerrar, guardado }: { fecha: string; turnos: Turno[]; cupos: Cupo[]; restId: string; avisar: (m: string) => void; cerrar: () => void; guardado: () => void }) {
  const [turnoId, setTurnoId] = useState<string>(SIN_TURNO);
  const existente = useMemo(() => cupos.find((c) => c.fecha === fecha && (turnoId === SIN_TURNO ? !c.turno_id : c.turno_id === turnoId)) ?? null, [cupos, fecha, turnoId]);
  const [f, setF] = useState<FormCupo>({ cerrado: false, max_pax_online: "", max_pax_total: "", nota: "" });
  const { ocupado, correr } = useAccion(avisar);
  useEffect(() => {
    setF({
      cerrado: existente?.cerrado ?? false,
      max_pax_online: existente?.max_pax_online != null ? String(existente.max_pax_online) : "",
      max_pax_total: existente?.max_pax_total != null ? String(existente.max_pax_total) : "",
      nota: existente?.nota ?? "",
    });
  }, [existente]);
  const set = <K extends keyof FormCupo>(k: K, v: FormCupo[K]) => setF((x) => ({ ...x, [k]: v }));
  const diaCompleto = turnoId === SIN_TURNO;
  const turnoSel = diaCompleto ? null : turnos.find((t) => t.id === turnoId) ?? null;
  const placeholderTotal = diaCompleto
    ? "el de cada turno"
    : turnoSel?.max_pax_total != null ? `${turnoSel.max_pax_total} (el del turno)` : "sin límite";

  async function guardar() {
    const c: CamposCupo = {
      cerrado: f.cerrado,
      max_pax_online: f.max_pax_online === "" ? null : parseInt(f.max_pax_online) || 0,
      max_pax_total: f.max_pax_total === "" ? null : parseInt(f.max_pax_total) || 0,
      nota: f.nota || null,
    };
    const r = await correr(guardarCupoAjustes(restId, fecha, turnoId === SIN_TURNO ? null : turnoId, c), "Excepción guardada.");
    if (r.ok) guardado();
  }

  return (
    <ModalForm
      titulo={`Excepción · ${fmtFecha(fecha)}`}
      onCerrar={cerrar}
      onGuardar={guardar}
      ocupado={ocupado}
      ancho={520}
      extra={existente ? (
        <Boton tipo="peligro" disabled={ocupado} onClick={async () => { const r = await correr(borrarCupo(existente.id), "Excepción quitada."); if (r.ok) guardado(); }}>Quitar excepción</Boton>
      ) : null}
    >
      <div className="aj-form">
        <Campo label="Alcance" ancho="todo">
          <select value={turnoId} onChange={(e) => setTurnoId(e.target.value)}>
            <option value={SIN_TURNO}>Día completo</option>
            {turnos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Estado" ancho="todo">
          <Interruptor on={f.cerrado} onChange={(v) => set("cerrado", v)} texto={f.cerrado ? "Cerrado: no se admiten reservas" : "Abierto"} />
        </Campo>
        {/* reservas_cupo_motivo: el cupo del turno manda; si no hay, el del día se aplica a CADA turno
            por separado. El online es un tope de personas online (el turno no tiene uno propio). */}
        <Campo
          label={diaCompleto ? "Aforo online por turno" : "Aforo online del turno"}
          ayuda={diaCompleto ? "Personas que pueden entrar por la web en cada turno del día. Vacío = sin límite online." : "Personas que pueden entrar por la web en este turno. Vacío = sin límite online."}
        >
          <input type="number" min={0} value={f.max_pax_online} placeholder="sin límite" disabled={f.cerrado} onChange={(e) => set("max_pax_online", e.target.value)} />
        </Campo>
        <Campo
          label={diaCompleto ? "Aforo total por turno" : "Aforo total del turno"}
          ayuda={diaCompleto ? "Se aplica a cada turno del día (no se reparte entre ellos). Vacío = el aforo de cada turno." : "Vacío = el aforo normal del turno."}
        >
          <input type="number" min={0} value={f.max_pax_total} placeholder={placeholderTotal} disabled={f.cerrado} onChange={(e) => set("max_pax_total", e.target.value)} />
        </Campo>
        <Campo label="Nota" ancho="todo" ayuda="Se ve en Mes y en Día (p. ej. «Boda 80 pax», «Festivo»)."><input value={f.nota} onChange={(e) => set("nota", e.target.value)} maxLength={200} /></Campo>
      </div>
    </ModalForm>
  );
}

/* ==================== Sección ==================== */

export default function AjTurnos({ rest, turnos, avisar, puedeEditar, recargarBase, fecha }: AjProps) {
  const [modalTurno, setModalTurno] = useState<{ turno: Turno | null } | null>(null);
  const [mes, setMes] = useState(() => fecha.slice(0, 7));
  const [cupos, setCupos] = useState<Cupo[]>([]);
  const [cierres, setCierres] = useState<Cierre[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalCupo, setModalCupo] = useState<string | null>(null);
  const { correr } = useAccion(avisar);
  const ro = !puedeEditar;
  const hoy = hoyISO();

  const { desde, hasta } = rangoMes(`${mes}-01`);
  const cargarCupos = useCallback(async () => {
    setCargando(true);
    const r = await listarCupos(rest.id, desde, hasta);
    setCupos(r.cupos);
    setCierres(r.cierres);
    setCargando(false);
  }, [rest.id, desde, hasta]);
  useEffect(() => { cargarCupos(); }, [cargarCupos]);

  const porTurno = useMemo(() => Object.fromEntries(turnos.map((t) => [t.id, t])), [turnos]);
  const cuposPorFecha = useMemo(() => {
    const m: Record<string, Cupo[]> = {};
    for (const c of cupos) (m[c.fecha] ??= []).push(c);
    return m;
  }, [cupos]);
  const cierresPorFecha = useMemo(() => {
    const m: Record<string, Cierre[]> = {};
    for (const c of cierres) (m[c.fecha] ??= []).push(c);
    return m;
  }, [cierres]);

  /* rejilla del mes */
  const celdas = useMemo(() => {
    const [a, m] = mes.split("-").map(Number);
    const primero = new Date(a, m - 1, 1);
    const hueco = (primero.getDay() + 6) % 7;
    const dias = new Date(a, m, 0).getDate();
    const out: (string | null)[] = Array(hueco).fill(null);
    for (let d = 1; d <= dias; d++) out.push(`${mes}-${String(d).padStart(2, "0")}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [mes]);
  const moverMes = (n: number) => {
    const [a, m] = mes.split("-").map(Number);
    const d = new Date(a, m - 1 + n, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const resumenCupo = (c: Cupo) => {
    const nombre = c.turno_id ? porTurno[c.turno_id]?.nombre ?? "Turno" : "Día";
    if (c.cerrado) return { texto: `${nombre}: cerrado`, clase: "cerrado" };
    const partes: string[] = [];
    if (c.max_pax_online != null) partes.push(`online ${c.max_pax_online}`);
    if (c.max_pax_total != null) partes.push(`aforo ${c.max_pax_total}`);
    return { texto: `${nombre}: ${partes.join(" · ") || "nota"}`, clase: partes.length ? "aforo" : "" };
  };

  const [confirmarCierre, setConfirmarCierre] = useState<Cierre | null>(null);

  return (
    <>
      <Cabecera titulo="Turnos y cupos" texto="Los turnos definen a qué horas se reserva y cuánta gente entra. Las excepciones por fecha cierran un día o un turno, o cambian su aforo.">
        {!ro ? <Boton tipo="primario" onClick={() => setModalTurno({ turno: null })}>+ Nuevo turno</Boton> : null}
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      <Panel titulo="Turnos">
        {turnos.length ? (
          <div className="aj-lista">
            {turnos.map((t) => (
              <div key={t.id} className={`aj-item${t.activo ? "" : " inactiva"}`}>
                <div className="barra-color" style={{ background: t.color ?? "var(--aj-borde)" }} />
                <div className="cuerpo">
                  <div className="tit">
                    {t.nombre}
                    {!t.activo ? <Chip color="#8A9199">inactivo</Chip> : null}
                    <span className="mudo" style={{ fontWeight: 600, fontSize: 13 }}>{hhmm(t.hora_inicio)}–{hhmm(t.hora_fin)}{t.fin_servicio ? ` · servicio hasta ${hhmm(t.fin_servicio)}` : ""}</span>
                  </div>
                  <div className="det">
                    cada {t.intervalo_min} min · {t.duracion_min} min por mesa · máx. {t.max_pax_online} pax por reserva online
                    {t.max_pax_total != null ? ` · aforo ${t.max_pax_total} pax` : ""}
                    {t.max_reservas_intervalo != null ? ` · ${t.max_reservas_intervalo} reservas por hora` : ""}
                    {" · "}{textoDias(t.dias_semana)}
                  </div>
                </div>
                <div className="acc">
                  <Boton className="mini" onClick={() => setModalTurno({ turno: t })}>{ro ? "Ver" : "Editar"}</Boton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Vacio>Sin turnos. Crea al menos uno (p. ej. Comida 13:00–15:30 y Cena 20:00–22:30) para que el restaurante admita reservas.</Vacio>
        )}
      </Panel>

      <Panel titulo="Excepciones por fecha" texto="Pulsa un día para cerrarlo, cerrar solo un turno, poner un aforo especial o una nota. Para cerrar muchos días de golpe usa la pestaña Mes.">
        <div className="aj-cupos-cab">
          <Boton className="icono" onClick={() => moverMes(-1)} title="Mes anterior">‹</Boton>
          <b style={{ textTransform: "capitalize", minWidth: 150, textAlign: "center" }}>{NOMBRES_MES[parseInt(mes.slice(5)) - 1]} {mes.slice(0, 4)}</b>
          <Boton className="icono" onClick={() => moverMes(1)} title="Mes siguiente">›</Boton>
          <Boton className="mini" onClick={() => setMes(hoy.slice(0, 7))}>Hoy</Boton>
          <span className="mudo" style={{ marginLeft: "auto", fontSize: 12 }}>{cargando ? "Cargando…" : `${cupos.length} excepciones este mes`}</span>
        </div>
        <div className="mes-grid" style={{ opacity: cargando ? 0.6 : 1 }}>
          {DIAS_SEMANA.map((d) => <div key={d} className="dsem">{d}</div>)}
          {celdas.map((f, i) => {
            if (!f) return <div key={`v${i}`} className="mes-celda vacia" />;
            const cs = cuposPorFecha[f] ?? [];
            const zs = cierresPorFecha[f] ?? [];
            const pasado = f < hoy;
            const diaCerrado = cs.some((c) => !c.turno_id && c.cerrado) || zs.some((z) => !z.turno_id);
            return (
              <div
                key={f}
                className={`mes-celda${f === hoy ? " eshoy" : ""}`}
                style={{ opacity: pasado ? 0.55 : 1, minHeight: 64 }}
                role="button"
                tabIndex={0}
                onClick={() => !ro && setModalCupo(f)}
                onKeyDown={(e) => { if (e.key === "Enter" && !ro) setModalCupo(f); }}
              >
                <div className="num">{parseInt(f.slice(8))}{diaCerrado ? " 🔒" : ""}</div>
                {cs.map((c) => { const r = resumenCupo(c); return <div key={c.id} className={`mes-turno aj-cupo-estado ${r.clase}`} style={{ fontSize: 11 }}>{r.texto}</div>; })}
                {zs.filter((z) => z.turno_id).map((z) => <div key={z.id} className="mes-turno aj-cupo-estado cerrado" style={{ fontSize: 11 }}>{z.reservas_turnos?.nombre ?? "Turno"}: cerrado</div>)}
                {cs.find((c) => c.nota)?.nota ? <div className="mudo" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cs.find((c) => c.nota)!.nota}</div> : null}
              </div>
            );
          })}
        </div>
        {cierres.length ? (
          <div style={{ marginTop: 12 }}>
            <div className="aj-label" style={{ marginBottom: 6 }}>Cierres antiguos este mes</div>
            <div className="aj-lista">
              {cierres.map((z) => (
                <div key={z.id} className="aj-item" style={{ minHeight: 44, padding: "6px 12px" }}>
                  <div className="cuerpo">
                    <div className="tit" style={{ fontSize: 13 }}>{fmtFecha(z.fecha)} · {z.reservas_turnos?.nombre ?? "Día completo"}</div>
                    {z.motivo ? <div className="det">{z.motivo}</div> : null}
                  </div>
                  {!ro ? <Boton className="mini" tipo="peligro" onClick={() => setConfirmarCierre(z)}>Quitar</Boton> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mudo" style={{ fontSize: 11.5, marginTop: 8 }}>Mañana: {fmtFecha(sumarDias(hoy, 1))}. Los cambios de cupo afectan a la disponibilidad online al momento.</div>
      </Panel>

      {modalTurno ? (
        <ModalTurno
          turno={modalTurno.turno}
          restId={rest.id}
          avisar={avisar}
          puedeBorrar={!ro}
          cerrar={() => setModalTurno(null)}
          guardado={async () => { setModalTurno(null); await recargarBase(); }}
        />
      ) : null}
      {modalCupo ? (
        <ModalCupo fecha={modalCupo} turnos={turnos} cupos={cupos} restId={rest.id} avisar={avisar} cerrar={() => setModalCupo(null)} guardado={async () => { setModalCupo(null); await cargarCupos(); }} />
      ) : null}
      {confirmarCierre ? (
        <Confirmar
          texto={`¿Quitar el cierre del ${fmtFecha(confirmarCierre.fecha)}?`}
          detalle="El día (o turno) vuelve a admitir reservas."
          confirmarTexto="Quitar"
          onNo={() => setConfirmarCierre(null)}
          onSi={async () => { const r = await correr(borrarCierreAjustes(confirmarCierre.id), "Cierre quitado."); setConfirmarCierre(null); if (r.ok) cargarCupos(); }}
        />
      ) : null}
    </>
  );
}
