-- APLICADA 15-09-2026 desde Code (MCP Supabase), registrada como 20260915110850.
-- Visitas: el histórico real viene de Codetickets (ventas online/taquilla) y de
-- invitaciones. Dos métodos de pago nuevos para no disfrazarlos de stripe/tpv.
alter type visitas_metodo_pago add value if not exists 'codetickets';
alter type visitas_metodo_pago add value if not exists 'invitacion';
