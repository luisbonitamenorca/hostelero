import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";
import { cerrarSesion } from "../acciones";
import EmpleadoApp from "./EmpleadoApp";
import "./empleado.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bonita Equipo",
  description: "Tus turnos, fichajes y vacaciones en Bonita Menorca",
  manifest: "/empleado-manifest.json",
  themeColor: "#0E7C86",
  icons: { apple: "/empleado-icon-192.png" },
};

export default async function EmpleadoPage() {
  const sb = await crearClienteServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Primer login: vincula la cuenta con la ficha por email y autoprovisiona el perfil.
  await sb.rpc("vincular_mi_empleado");

  const { data: emp } = await sb
    .from("empleados")
    .select("id, nombre, apellidos, fichaje_movil, centro_principal_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp) {
    return (
      <div className="emp" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 20 }}>
        <div className="tarjeta" style={{ maxWidth: 380, textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Bonita <span style={{ color: "var(--mar)" }}>Equipo</span></div>
          <p style={{ color: "var(--tinta-suave)", fontSize: 14 }}>
            Tu email no coincide con ninguna ficha de empleado. Habla con tu encargado para que lo añadan a tu ficha.
          </p>
          <form action={cerrarSesion} style={{ marginTop: 14 }}>
            <button className="btn btn-primario" type="submit">Salir</button>
          </form>
        </div>
      </div>
    );
  }

  // Mis centros: el principal + asignaciones vigentes (selector de fichaje, huecos y festivos locales).
  // «Hoy» en hora española: el servidor de Vercel va en UTC y de 00:00 a 02:00 aún cree que es ayer.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [{ data: asigs }, { data: principal }] = await Promise.all([
    sb
      .from("rrhh_asignaciones")
      .select("centro_id, centros(id, nombre)")
      .eq("empleado_id", emp.id)
      .or(`fecha_fin.is.null,fecha_fin.gte.${hoy}`)
      .or(`fecha_inicio.is.null,fecha_inicio.lte.${hoy}`),
    emp.centro_principal_id ? sb.from("centros").select("id, nombre").eq("id", emp.centro_principal_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const vistos = new Set<string>();
  const centros = [principal, ...(asigs ?? []).map((r) => r.centros as { id: string; nombre: string } | null)].filter(
    (c): c is { id: string; nombre: string } => !!c && !vistos.has(c.id) && !!vistos.add(c.id),
  );

  return (
    <EmpleadoApp
      empleado={{ id: emp.id, nombre: emp.nombre, fichajeMovil: !!emp.fichaje_movil, centroPrincipal: emp.centro_principal_id }}
      centros={centros}
    />
  );
}
