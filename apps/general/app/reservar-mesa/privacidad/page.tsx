import "../reservar-mesa.css";
import type { Metadata } from "next";
import { esLang } from "../textos";

export const metadata: Metadata = {
  title: "Privacidad de las reservas",
  robots: { index: false, follow: true },
};

/**
 * Información de privacidad del widget de reservas (enlace por defecto de «condiciones y
 * privacidad» cuando el restaurante no tiene url_condiciones). No es la /privacidad de la
 * plataforma interna: aquí sí se recogen datos de clientes (contacto, alergias, marketing).
 * El email para ejercer derechos sale de RESERVAS_PRIVACIDAD_EMAIL (sin él, se remite al
 * restaurante). ca → texto en español; fr/de → texto en inglés.
 */
type Bloque = { t: string; p: string[] };

const ES: { titulo: string; sub: string; bloques: Bloque[]; contacto: (email: string | null) => string; volver: string } = {
  titulo: "Privacidad de las reservas",
  sub: "Información sobre el tratamiento de los datos que nos das al reservar mesa.",
  bloques: [
    { t: "Responsable", p: ["Bonita Menorca S.L. (CIF B01996826), titular de los restaurantes en los que reservas."] },
    {
      t: "Qué datos tratamos",
      p: [
        "Nombre y apellidos, teléfono, email, idioma, país del prefijo, comentarios y respuestas que añadas, código promocional y, si nos lo indicas, alergias o intolerancias.",
        "Las alergias e intolerancias son datos de salud: solo se tratan si tú nos las indicas y únicamente para preparar tu servicio con seguridad.",
      ],
    },
    {
      t: "Para qué y con qué base",
      p: [
        "Gestionar tu reserva: confirmación, recordatorio, cambios, cancelación, lista de espera y, si hace falta, garantía o pago. Base: la propia reserva que nos pides.",
        "Pedirte tu opinión después de la visita. Base: nuestro interés legítimo en mejorar el servicio; puedes oponerte en cualquier momento.",
        "Enviarte novedades y ofertas solo si marcas la casilla correspondiente. Base: tu consentimiento, que puedes retirar cuando quieras.",
      ],
    },
    {
      t: "Quién más los ve",
      p: [
        "El equipo del restaurante y los proveedores tecnológicos que nos prestan el servicio (alojamiento de la aplicación y de la base de datos, envío de emails y, en su caso, la pasarela de pago del banco), siempre por cuenta nuestra. No cedemos tus datos a terceros salvo obligación legal.",
      ],
    },
    {
      t: "Cuánto tiempo",
      p: ["El necesario para gestionar la reserva y tu historial como cliente, y después durante los plazos que marca la ley. Los datos de marketing, hasta que retires el consentimiento."],
    },
  ],
  contacto: (email) =>
    `Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad ${email ? `escribiendo a ${email}` : "dirigiéndote al restaurante en el que reservaste (teléfono y email en tu confirmación)"}. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).`,
  volver: "Volver a la reserva",
};

const EN: typeof ES = {
  titulo: "Booking privacy",
  sub: "How we handle the details you give us when you book a table.",
  bloques: [
    { t: "Data controller", p: ["Bonita Menorca S.L. (tax ID B01996826), owner of the restaurants you book with."] },
    {
      t: "What we process",
      p: [
        "First and last name, phone, email, language, country code, any comments and answers you add, promo code and, if you tell us, allergies or intolerances.",
        "Allergies and intolerances are health data: we only process them if you give them to us, and solely to prepare your meal safely.",
      ],
    },
    {
      t: "Why and on what basis",
      p: [
        "To manage your booking: confirmation, reminder, changes, cancellation, waiting list and, where needed, card guarantee or payment. Basis: the booking you ask us for.",
        "To ask for your feedback after your visit. Basis: our legitimate interest in improving; you can object at any time.",
        "To send you news and offers only if you tick the box. Basis: your consent, which you can withdraw whenever you like.",
      ],
    },
    {
      t: "Who else sees it",
      p: [
        "The restaurant team and the technology providers that run the service for us (application and database hosting, email delivery and, where applicable, the bank's payment gateway), always on our behalf. We don't share your data with third parties unless the law requires it.",
      ],
    },
    {
      t: "How long",
      p: ["As long as needed to manage the booking and your customer history, and then for the periods required by law. Marketing data, until you withdraw your consent."],
    },
  ],
  contacto: (email) =>
    `You can exercise your rights of access, rectification, erasure, objection, restriction and portability ${email ? `by writing to ${email}` : "by contacting the restaurant you booked with (phone and email in your confirmation)"}. You can also complain to the Spanish Data Protection Agency (www.aepd.es).`,
  volver: "Back to booking",
};

export default async function PrivacidadReservasPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const sp = await searchParams;
  const lang = esLang(sp.lang) ? sp.lang : "es";
  const tx = lang === "es" || lang === "ca" ? ES : EN;
  const email = process.env.RESERVAS_PRIVACIDAD_EMAIL?.trim() || null;
  return (
    <div className="rme">
      <div className="wrap legal">
        <header className="top">
          <div className="marca"><span>{tx.titulo}</span></div>
        </header>
        <p className="sub">{tx.sub}</p>
        <div className="card">
          {tx.bloques.map((b) => (
            <section key={b.t}>
              <h3 className="sec">{b.t}</h3>
              {b.p.map((p, i) => (
                <p key={i} className="texto">{p}</p>
              ))}
            </section>
          ))}
          <h3 className="sec">{lang === "es" || lang === "ca" ? "Tus derechos" : "Your rights"}</h3>
          <p className="texto">{tx.contacto(email)}</p>
        </div>
        <p className="pie"><a href={`/reservar-mesa?lang=${lang}`} style={{ color: "var(--acento)", fontWeight: 600 }}>{tx.volver}</a></p>
      </div>
    </div>
  );
}
