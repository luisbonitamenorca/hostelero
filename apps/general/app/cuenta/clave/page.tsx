import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";
import FormMiClave from "./form-mi-clave";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mi contraseña · Hostelero" };

/**
 * «Mi contraseña»: cualquiera con sesión cambia la suya. Solo exige sesión
 * (el middleware ya manda a /login sin ella): ni perfil, ni módulo, ni rol,
 * porque la usan dirección, empleados (cuya portada es /empleado: «Inicio»
 * les lleva allí desde /) y operadores que quizá no tienen perfil de cuenta.
 */
export default async function MiClave() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="pantalla-login">
      <div className="caja-login" style={{ maxWidth: 440 }}>
        <div style={{ marginBottom: 6 }}>
          <span className="marca" style={{ color: "var(--verde)" }}>
            Mi contraseña
          </span>
        </div>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--gris)" }}>
          Cambia la contraseña con la que entras{user.email ? <> como <strong>{user.email}</strong></> : null}.
          Si te dieron una temporal, pon aquí una tuya.
        </p>
        <FormMiClave />
        <p style={{ margin: "20px 0 0", fontSize: 14 }}>
          <Link href="/" style={{ color: "var(--gris)" }}>
            ← Volver a Inicio
          </Link>
        </p>
      </div>
    </main>
  );
}
