/**
 * Vuelta del TPV con pago no completado (denegado o cancelado por el
 * cliente). La reserva sigue pendiente_pago: puede reintentar desde el
 * calendario — la plaza no se libera aquí, eso es cosa del panel interno.
 */
const TXT = {
  es: { t: "El pago no se completó", p: "No se ha realizado ningún cargo. Puedes intentarlo de nuevo.", v: "Volver a las visitas" },
  en: { t: "Payment not completed", p: "No charge was made. You can try again.", v: "Back to visits" },
  fr: { t: "Paiement non abouti", p: "Aucun débit n'a été effectué. Vous pouvez réessayer.", v: "Retour aux visites" },
} as const;

export default async function PagoKo({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string; lang?: string }>;
}) {
  const sp = await searchParams;
  const t = TXT[(sp.lang as keyof typeof TXT) ?? "es"] ?? TXT.es;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F7F6F3", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "40px 36px", maxWidth: 420, textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,.07)" }}>
        <div style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: "50%", background: "#B4423A", color: "#fff", display: "grid", placeItems: "center", fontSize: 28 }}>✕</div>
        <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>{t.t}</h1>
        <p style={{ margin: "0 0 20px", color: "#5F6B65" }}>{t.p}</p>
        <a href={`/reservar?lang=${sp.lang ?? "es"}`} style={{ color: "#0F6E56", fontWeight: 600, textDecoration: "none" }}>{t.v}</a>
      </div>
    </main>
  );
}
