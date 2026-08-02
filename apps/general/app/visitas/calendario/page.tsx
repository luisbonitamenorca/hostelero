import Link from "next/link";
import { crearClienteServidor } from "@/lib/supabase/server";
import {
  addDaysISO,
  DOW_FULL,
  esMaridaje,
  fDate,
  fHora,
  langLabel,
  startOfWeek,
  todayISO,
  type SesionVista,
} from "../comun";
import GenerarSesiones from "../_ui/GenerarSesiones";
import Sesion from "../_ui/Sesion";

export const dynamic = "force-dynamic";

type Vista = "lista" | "mes" | "semana";

function rango(vista: Vista, sp: { desde?: string; hasta?: string; anchor?: string }) {
  if (vista === "mes") {
    const a = new Date((sp.anchor || todayISO()) + "T00:00:00");
    const desde = new Date(a.getFullYear(), a.getMonth(), 1).toISOString().slice(0, 10);
    const hasta = new Date(a.getFullYear(), a.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { desde, hasta };
  }
  if (vista === "semana") {
    const ws = startOfWeek(sp.anchor || todayISO());
    return { desde: ws, hasta: addDaysISO(ws, 6) };
  }
  return { desde: sp.desde || todayISO(), hasta: sp.hasta || addDaysISO(todayISO(), 30) };
}

function ocPill(s: SesionVista) {
  if (s.libre <= 0) return "red";
  if (s.libre <= Math.max(1, s.aforo * 0.2)) return "amber";
  return "green";
}

export default async function Calendario({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; desde?: string; hasta?: string; anchor?: string }>;
}) {
  const sp = await searchParams;
  const vista: Vista = sp.vista === "mes" || sp.vista === "semana" ? sp.vista : "lista";
  const anchor = sp.anchor || todayISO();
  const { desde, hasta } = rango(vista, sp);

  const sb = await crearClienteServidor();
  const [{ data: ses }, { data: prods }, { data: centros }] = await Promise.all([
    sb
      .from("visitas_sesiones")
      .select("*, visitas_productos(nombre_es, idioma, precio)")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha")
      .order("hora_inicio"),
    sb
      .from("visitas_productos")
      .select("id, nombre_es, idioma, aforo_default")
      .eq("tipo", "visita_experiencia")
      .eq("activo", true)
      .order("nombre_es"),
    sb.from("centros").select("id, nombre").order("nombre"),
  ]);

  // Ocupación por sesión (reservas vivas).
  const ids = (ses ?? []).map((s) => s.id);
  const ocup: Record<string, number> = {};
  if (ids.length) {
    const { data: rs } = await sb
      .from("visitas_reservas")
      .select("sesion_id, num_personas, estado")
      .in("sesion_id", ids);
    (rs ?? []).forEach((r) => {
      if (r.estado === "pendiente_pago" || r.estado === "pagada") {
        ocup[r.sesion_id] = (ocup[r.sesion_id] || 0) + r.num_personas;
      }
    });
  }

  const sesiones: SesionVista[] = (ses ?? []).map((s) => {
    const oc = ocup[s.id] || 0;
    const nombre = s.visitas_productos?.nombre_es || "";
    return {
      id: s.id,
      producto_id: s.producto_id,
      nombre,
      precio: Number(s.visitas_productos?.precio || 0),
      fecha: s.fecha,
      hora: fHora(s.hora_inicio),
      aforo: s.aforo,
      oc,
      libre: s.aforo - oc,
      estado: s.estado,
      nota: s.nota,
      visible_web: s.visible_web,
      maridaje: esMaridaje(nombre),
      idiomaLabel: langLabel(nombre),
    };
  });

  const porDia: Record<string, SesionVista[]> = {};
  sesiones.forEach((s) => {
    (porDia[s.fecha] = porDia[s.fecha] || []).push(s);
  });

  const centrosList = centros ?? [];
  const centroDefecto =
    centrosList.find((c) => c.nombre === "Binifadet Bodega")?.id || centrosList[0]?.id || "";

  const base = "/visitas/calendario";
  const seg = (v: Vista) => `${base}?vista=${v}${v === "lista" ? "" : `&anchor=${anchor}`}`;
  const navAnchor = (delta: number) => {
    const a = new Date(anchor + "T00:00:00");
    if (vista === "mes") a.setMonth(a.getMonth() + delta);
    else a.setDate(a.getDate() + delta * 7);
    return `${base}?vista=${vista}&anchor=${a.toISOString().slice(0, 10)}`;
  };
  const labelNav =
    vista === "mes"
      ? new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(anchor + "T00:00:00"))
      : `${fDate(startOfWeek(anchor))} – ${fDate(addDaysISO(startOfWeek(anchor), 6))}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Calendario</h2>
          <p>Programa la temporada, ajusta aforos y añade reservas. Tres vistas: lista, mes y semana.</p>
        </div>
        <GenerarSesiones productos={prods ?? []} centros={centrosList} centroDefecto={centroDefecto} />
      </div>

      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="seg">
          <Link href={seg("lista")} className={vista === "lista" ? "on" : ""}>Lista</Link>
          <Link href={seg("mes")} className={vista === "mes" ? "on" : ""}>Mes</Link>
          <Link href={seg("semana")} className={vista === "semana" ? "on" : ""}>Semana</Link>
        </div>
        {vista === "lista" ? (
          <form method="get" style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <input type="hidden" name="vista" value="lista" />
            <div className="field"><label>Desde</label><input type="date" name="desde" defaultValue={desde} /></div>
            <div className="field"><label>Hasta</label><input type="date" name="hasta" defaultValue={hasta} /></div>
            <button className="btn" type="submit">Ver</button>
          </form>
        ) : (
          <div className="calnav">
            <Link href={navAnchor(-1)}>‹</Link>
            <span className="lbl">{labelNav}</span>
            <Link href={navAnchor(1)}>›</Link>
          </div>
        )}
      </div>

      {vista === "lista" ? (
        <VistaLista sesiones={sesiones} />
      ) : vista === "mes" ? (
        <VistaMes anchor={anchor} porDia={porDia} />
      ) : (
        <VistaSemana anchor={anchor} porDia={porDia} />
      )}
    </>
  );
}

function VistaLista({ sesiones }: { sesiones: SesionVista[] }) {
  if (!sesiones.length) {
    return <div className="card"><div className="empty">No hay sesiones en ese rango. Usa «Generar sesiones».</div></div>;
  }
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th><th>Día</th><th>Hora</th><th>Producto</th>
              <th className="right">Ocupación</th><th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sesiones.map((s) => {
              const dow = new Date(s.fecha + "T00:00:00").getDay();
              return (
                <tr key={s.id}>
                  <td className="nowrap"><strong>{fDate(s.fecha)}</strong></td>
                  <td className="nowrap">{DOW_FULL[dow === 0 ? 7 : dow]}</td>
                  <td className="nowrap">{s.hora}</td>
                  <td>
                    {s.nombre}
                    {s.idiomaLabel ? <span className="muted"> · {s.idiomaLabel}</span> : null}
                    {s.maridaje ? <span className="dot mar" /> : null}
                    {s.nota ? <span className="dot note" /> : null}
                  </td>
                  <td className="right nowrap"><span className={`pill ${ocPill(s)}`}>{s.oc}/{s.aforo}</span></td>
                  <td>{s.estado === "cancelada" ? <span className="pill red">Cancelada</span> : <span className="pill green">Activa</span>}</td>
                  <td className="right nowrap"><Sesion s={s} variant="fila" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VistaMes({ anchor, porDia }: { anchor: string; porDia: Record<string, SesionVista[]> }) {
  const d = new Date(anchor + "T00:00:00");
  const y = d.getFullYear();
  const m = d.getMonth();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const hoy = todayISO();

  const cells: React.ReactNode[] = DOW_FULL.slice(1).map((x) => <div key={"h" + x} className="dow">{x}</div>);
  for (let i = 0; i < firstDow; i++) cells.push(<div key={"o" + i} className="cell out" />);
  for (let day = 1; day <= dim; day++) {
    const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const list = (porDia[ds] || []).slice().sort((a, b) => a.hora.localeCompare(b.hora));
    cells.push(
      <div key={ds} className={`cell ${ds === hoy ? "today" : ""}`}>
        <div className="dn">{day}</div>
        {list.map((s) => <Sesion key={s.id} s={s} variant="chip" />)}
      </div>,
    );
  }

  return (
    <div className="card">
      <div className="card-body">
        <div className="mes">{cells}</div>
        <div className="callegend">
          <span><span className="sw" style={{ background: "#eef7f0" }} />Vacía</span>
          <span><span className="sw" style={{ background: "#c9e9d5" }} />Con inscritos</span>
          <span><span className="sw" style={{ background: "var(--red-soft)" }} />Completa</span>
          <span><span className="sw" style={{ background: "#efeae1" }} />Cancelada</span>
          <span><span className="dot mar" />Maridaje</span>
          <span><span className="dot note" />Con comentario</span>
        </div>
      </div>
    </div>
  );
}

function VistaSemana({ anchor, porDia }: { anchor: string; porDia: Record<string, SesionVista[]> }) {
  const ws = startOfWeek(anchor);
  const hoy = todayISO();
  const cols: React.ReactNode[] = [];
  for (let i = 0; i < 7; i++) {
    const ds = addDaysISO(ws, i);
    const dd = new Date(ds + "T00:00:00");
    const list = (porDia[ds] || []).slice().sort((a, b) => a.hora.localeCompare(b.hora));
    cols.push(
      <div key={ds} className="col">
        <div className={`col-h ${ds === hoy ? "today" : ""}`}>
          <div className="d">{DOW_FULL[i + 1]}</div>
          <div className="n">{dd.getDate()}</div>
        </div>
        <div className="col-b">
          {list.length ? list.map((s) => <Sesion key={s.id} s={s} variant="chip" />) : <div className="muted" style={{ fontSize: 11, textAlign: "center", padding: "10px 0" }}>—</div>}
        </div>
      </div>,
    );
  }
  return <div className="card"><div className="card-body"><div className="sem">{cols}</div></div></div>;
}
