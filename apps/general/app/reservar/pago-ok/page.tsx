/**
 * Vuelta del TPV con pago autorizado. Es solo la pantalla amable: la verdad
 * del cobro la establece la notificación servidor-a-servidor del banco, que
 * puede llegar antes o después de que el cliente aterrice aquí.
 */
const TXT = {
  es: { t: "¡Pago recibido!", p: "Tu visita está confirmada. Te llega la confirmación por email.", c: "Código de reserva", v: "Volver a las visitas" },
  en: { t: "Payment received!", p: "Your visit is confirmed. A confirmation email is on its way.", c: "Booking code", v: "Back to visits" },
  fr: { t: "Paiement reçu !", p: "Votre visite est confirmée. Un email de confirmation arrive.", c: "Code de réservation", v: "Retour aux visites" },
} as const;

export default async function PagoOk({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string; lang?: string }>;
}) {
  const sp = await searchParams;
  const t = TXT[(sp.lang as keyof typeof TXT) ?? "es"] ?? TXT.es;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F7F6F3", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "40px 36px", maxWidth: 420, textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,.07)" }}>
        <div style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: "50%", background: "#0F6E56", color: "#fff", display: "grid", placeItems: "center", fontSize: 28 }}>✓</div>
        <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>{t.t}</h1>
        <p style={{ margin: "0 0 16px", color: "#5F6B65" }}>{t.p}</p>
        {sp.codigo ? (
          <p style={{ margin: "0 0 20px", fontWeight: 600 }}>
            {t.c}: <span style={{ letterSpacing: 1 }}>{sp.codigo}</span>
          </p>
        ) : null}
        <a href={`/reservar?lang=${sp.lang ?? "es"}`} style={{ color: "#0F6E56", fontWeight: 600, textDecoration: "none" }}>{t.v}</a>
      </div>
    </main>
  );
}
