"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./acciones";
import { guardarPref, leerPref, type Ctx } from "./lib-rrhh";
import SecHoy from "./secciones/hoy";
import SecPlanificacion from "./secciones/planificacion";
import SecFichajes from "./secciones/fichajes";
import SecAusencias from "./secciones/ausencias";
import SecContadores from "./secciones/contadores";
import SecInformes from "./secciones/informes";
import SecEmpleados from "./secciones/empleados";
import SecAjustes from "./secciones/ajustes";

/* Registro de pestañas (orden y nombres que Sílvia reconoce de Skello). */
const TABS = [
  { id: "hoy", nombre: "Hoy", Sec: SecHoy, soloGestor: false },
  { id: "planificacion", nombre: "Planificación", Sec: SecPlanificacion, soloGestor: false },
  { id: "fichajes", nombre: "Fichajes", Sec: SecFichajes, soloGestor: false },
  { id: "ausencias", nombre: "Ausencias", Sec: SecAusencias, soloGestor: false },
  { id: "contadores", nombre: "Contadores", Sec: SecContadores, soloGestor: false },
  { id: "informes", nombre: "Informes", Sec: SecInformes, soloGestor: false },
  { id: "empleados", nombre: "Empleados", Sec: SecEmpleados, soloGestor: false },
  { id: "ajustes", nombre: "Ajustes", Sec: SecAjustes, soloGestor: true },
] as const;

type Tab = (typeof TABS)[number]["id"];

const esTab = (v: string): v is Tab => TABS.some((t) => t.id === v);

export default function PanelRrhh() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [tab, setTab] = useState<Tab>("hoy");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    api.contexto().then(setCtx);
    const ultima = leerPref<string>("tab", "hoy");
    if (esTab(ultima)) setTab(ultima);
  }, []);

  const cambiarTab = (id: Tab) => {
    setTab(id);
    guardarPref("tab", id);
  };

  if (!ctx) return <div className="rh"><div className="vacio">Cargando…</div></div>;
  if (!ctx.centros.length) {
    return <div className="rh"><div className="vacio">No tienes ningún centro asignado. Habla con dirección.</div></div>;
  }

  const visibles = TABS.filter((t) => !t.soloGestor || ctx.esGestor);
  const actual = visibles.find((t) => t.id === tab) ?? visibles[0];
  const Sec = actual.Sec;

  return (
    <div className="rh">
      <div className="tabsbar">
        {visibles.map((t) => (
          <button key={t.id} className={actual.id === t.id ? "activa" : ""} onClick={() => cambiarTab(t.id)}>{t.nombre}</button>
        ))}
      </div>
      <main>
        <Sec key={actual.id} ctx={ctx} avisar={avisar} />
      </main>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
