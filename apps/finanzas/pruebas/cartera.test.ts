import { calcularVencimiento, describirPlazo } from "../lib/cartera.ts";

// [fecha factura, condiciones, vencimiento esperado, nota]
const casos: [string, Parameters<typeof calcularVencimiento>[1], string, string][] = [
  ["2026-10-01", { dias_pago: 30 }, "2026-10-31", "a 30 días"],
  ["2026-10-01", { dias_pago: 0 }, "2026-10-01", "al contado"],
  ["2026-12-15", { dias_pago: 60 }, "2027-02-13", "60 días cruzando el año"],
  ["2026-10-01", { dias_pago: 30, plazo_tipo: "dias", plazo_dia: null }, "2026-10-31", "tipo dias explícito"],
  // 2026-10-31 es sábado → el primer lunes siguiente es el 2 de noviembre
  ["2026-10-01", { dias_pago: 30, plazo_tipo: "dia_semana", plazo_dia: 1 }, "2026-11-02", "primer lunes después de 30 días"],
  // 2026-11-02 ya es lunes: cuenta el mismo día
  ["2026-10-03", { dias_pago: 30, plazo_tipo: "dia_semana", plazo_dia: 1 }, "2026-11-02", "cae en lunes: ese mismo"],
  // 2026-10-31 sábado → primer viernes siguiente 6 de noviembre
  ["2026-10-01", { dias_pago: 30, plazo_tipo: "dia_semana", plazo_dia: 5 }, "2026-11-06", "primer viernes después de 30 días"],
  // 2026-11-30 → día 10 siguiente: 10 de diciembre
  ["2026-10-01", { dias_pago: 60, plazo_tipo: "dia_mes", plazo_dia: 10 }, "2026-12-10", "día 10 tras 60 días"],
  // 2026-10-10 cae justo en el día 10: ese mismo
  ["2026-10-10", { dias_pago: 0, plazo_tipo: "dia_mes", plazo_dia: 10 }, "2026-10-10", "cae en el día: ese mismo"],
  // 2026-10-11 → siguiente día 10 es en noviembre
  ["2026-10-11", { dias_pago: 0, plazo_tipo: "dia_mes", plazo_dia: 10 }, "2026-11-10", "pasado el día: mes siguiente"],
  // 2027-01-31 + 0 → día 31 de febrero no existe: último día de febrero
  ["2027-02-01", { dias_pago: 0, plazo_tipo: "dia_mes", plazo_dia: 31 }, "2027-02-28", "día 31 en febrero: último del mes"],
  // Si el tipo trae un día incoherente, se cae a «a N días» en vez de romper
  ["2026-10-01", { dias_pago: 30, plazo_tipo: "dia_semana", plazo_dia: null }, "2026-10-31", "dia_semana sin día: a N días"],
];

let fallos = 0;
for (const [fecha, cond, esperado, nota] of casos) {
  const v = calcularVencimiento(fecha, cond);
  const ok = v === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? "ok  " : "FALLA"} ${fecha} → ${v.padEnd(10)} (esperado ${esperado})  ${nota}`);
}

console.log("\n-- describirPlazo --");
const textos: [Parameters<typeof describirPlazo>[0], string][] = [
  [{ dias_pago: 30 }, "a 30 días"],
  [{ dias_pago: 0 }, "al contado"],
  [{ dias_pago: 30, plazo_tipo: "dia_semana", plazo_dia: 1 }, "primer lunes tras 30 días"],
  [{ dias_pago: 60, plazo_tipo: "dia_mes", plazo_dia: 10 }, "día 10 tras 60 días"],
];
for (const [cond, esperado] of textos) {
  const t = describirPlazo(cond);
  const ok = t === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? "ok  " : "FALLA"} ${t.padEnd(28)} (esperado ${esperado})`);
}

if (fallos) {
  console.error(`\n${fallos} caso(s) fallan`);
  process.exit(1);
}
console.log("\ncartera: todo ok");
