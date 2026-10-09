// Política de privacidad de la plataforma interna. Existe, sobre todo, porque
// Google exige un enlace público de privacidad para publicar la app OAuth de
// los agentes (bonita-agentes). Es honesta y corta: esto es una herramienta
// interna de Bonita Menorca, no un producto que recoja datos de terceros.
export const metadata = { title: "Política de privacidad · Hostelero" };

export default function Privacidad() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.6, color: "#2A3B36" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Política de privacidad</h1>
      <p style={{ color: "#5F6B65", marginBottom: 24 }}>Hostelero · Bonita Menorca SL · última revisión: octubre de 2026</p>

      <p>
        Hostelero es la plataforma de gestión interna de <strong>Bonita Menorca SL</strong> (CIF B01996826,
        Camí de Ses Barraques s/n, 07710 Sant Lluís, Illes Balears). La usan exclusivamente personas
        del equipo de Bonita Menorca para operar el negocio: compras, contabilidad, reservas y
        atención a clientes.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Qué datos tratamos</h2>
      <p>
        Datos operativos del propio negocio: facturas de proveedores, movimientos bancarios de las
        cuentas de la empresa, reseñas públicas de nuestros establecimientos y mensajes dirigidos a
        nuestras cuentas oficiales. Cuando la plataforma se conecta con servicios de Google
        (Perfil de Empresa de Google), accede únicamente a las fichas de negocio de Bonita Menorca
        para leer y responder reseñas, con la autorización de la cuenta administradora. Cuando se
        conecta con servicios de Meta (Facebook, Instagram y WhatsApp), accede únicamente a las
        páginas, cuentas profesionales y números de WhatsApp de Bonita Menorca para leer y responder
        los mensajes, comentarios y menciones que recibimos en ellos.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Qué no hacemos</h2>
      <p>
        No vendemos ni cedemos datos a terceros, no hacemos publicidad ni perfilado, y no usamos los
        datos de servicios de Google o de Meta para nada distinto de gestionar las fichas, reseñas
        y conversaciones de nuestros propios establecimientos.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Conservación y seguridad</h2>
      <p>
        Los datos se almacenan en proveedores europeos o con garantías equivalentes (Supabase,
        Vercel) con acceso restringido al equipo autorizado. Se conservan mientras sean necesarios
        para la gestión del negocio y las obligaciones legales.
      </p>

      <h2 id="eliminacion" style={{ fontSize: 20, marginTop: 28 }}>Eliminación de datos</h2>
      <p>
        Si nos has escrito por Facebook, Instagram o WhatsApp y quieres que eliminemos tus mensajes
        y datos de contacto, envía un correo a{" "}
        <a href="mailto:luis@bonitamenorca.com" style={{ color: "#0F6E56" }}>luis@bonitamenorca.com</a>{" "}
        indicando la plataforma y el nombre de usuario o el número desde el que escribiste. Los
        eliminaremos en un plazo máximo de 30 días y te lo confirmaremos por el mismo medio. También
        puedes retirar el acceso de nuestra aplicación desde la configuración de tu cuenta de Meta.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Contacto</h2>
      <p>
        Para cualquier consulta sobre privacidad:{" "}
        <a href="mailto:luis@bonitamenorca.com" style={{ color: "#0F6E56" }}>luis@bonitamenorca.com</a>.
      </p>
    </main>
  );
}
