import {
  clasificar,
  sumasYSaldos,
  balance,
  perdidasYGanancias,
  calcularPeriodo,
  type ApunteInforme,
} from "../lib/contabilidad.ts";

let fallos = 0;
function comprueba(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${ok ? "" : " -> " + detalle}`);
}

// ------------------------------------------------------------ clasificación

comprueba("430 clientes es activo corriente", clasificar("4300001").masa === "activo-corriente");
comprueba("400 proveedores es pasivo corriente", clasificar("400000001").masa === "pasivo-corriente");
comprueba("570 caja es activo corriente", clasificar("570").masa === "activo-corriente");
comprueba("100 capital es patrimonio neto", clasificar("100").masa === "patrimonio-neto");
comprueba("170 deuda a l/p es pasivo no corriente", clasificar("1700").masa === "pasivo-no-corriente");

// El caso que más se falla: dentro del 47 conviven activo y pasivo.
comprueba("472 IVA soportado es activo", clasificar("472").masa === "activo-corriente");
comprueba("477 IVA repercutido es pasivo", clasificar("477").masa === "pasivo-corriente");
comprueba("473 retenciones es activo", clasificar("4730").masa === "activo-corriente");
comprueba("475 Hacienda acreedora es pasivo", clasificar("475100").masa === "pasivo-corriente");

// Correctoras: van en el activo aunque su saldo sea acreedor.
comprueba("2813 amortización acumulada va en el activo", clasificar("2813").masa === "activo-no-corriente");
comprueba("290 deterioro va en el activo", clasificar("290").masa === "activo-no-corriente");

comprueba("600 compras es resultado/gasto", clasificar("600").naturaleza === "gasto");
comprueba("700 ventas es resultado/ingreso", clasificar("700").naturaleza === "ingreso");
comprueba("681 dotación es gasto", clasificar("681").naturaleza === "gasto");

// Lo dudoso NO se coloca a ojo.
comprueba("551 socios queda sin clasificar", clasificar("551").masa === "sin-clasificar");
comprueba("una cuenta inventada queda sin clasificar", clasificar("999999").masa === "sin-clasificar");
comprueba("código vacío no revienta", clasificar("").masa === "sin-clasificar");

// ------------------------------------------------------------ sumas y saldos

const diario: ApunteInforme[] = [
  // Enero: aportación de capital
  { codigo: "570", nombre: "Caja", fecha: "2026-01-02", debe: 10000, haber: 0 },
  { codigo: "100", nombre: "Capital social", fecha: "2026-01-02", debe: 0, haber: 10000 },
  // Marzo: una venta de 1.000 + 21 %
  { codigo: "430", nombre: "Clientes", fecha: "2026-03-10", debe: 1210, haber: 0 },
  { codigo: "700", nombre: "Ventas", fecha: "2026-03-10", debe: 0, haber: 1000 },
  { codigo: "477", nombre: "HP IVA repercutido", fecha: "2026-03-10", debe: 0, haber: 210 },
  // Marzo: un gasto de personal pagado en efectivo
  { codigo: "640", nombre: "Sueldos y salarios", fecha: "2026-03-25", debe: 400, haber: 0 },
  { codigo: "570", nombre: "Caja", fecha: "2026-03-25", debe: 0, haber: 400 },
  // Marzo: amortización
  { codigo: "681", nombre: "Amortización del inmovilizado material", fecha: "2026-03-31", debe: 50, haber: 0 },
  { codigo: "2813", nombre: "Amortización acumulada maquinaria", fecha: "2026-03-31", debe: 0, haber: 50 },
];

const marzo = calcularPeriodo(2026, "mes", { mes: 3 });
const filasMarzo = sumasYSaldos(diario, marzo.desde, marzo.hasta);

const caja = filasMarzo.find((f) => f.codigo === "570")!;
comprueba("la caja arrastra 10.000 de antes del periodo", caja.debeAnterior === 10000, String(caja.debeAnterior));
comprueba("la caja mueve 400 al haber en marzo", caja.haberPeriodo === 400, String(caja.haberPeriodo));
comprueba("el saldo de caja es 9.600", caja.saldo === 9600, String(caja.saldo));

comprueba("las cuentas salen ordenadas por código", filasMarzo[0].codigo === "100", filasMarzo[0].codigo);
comprueba("solo salen cuentas con movimiento", filasMarzo.length === 8, String(filasMarzo.length));

// Cuadre del diario: la suma del debe iguala la del haber.
const sumaDebe = filasMarzo.reduce((s, f) => s + f.debeTotal, 0);
const sumaHaber = filasMarzo.reduce((s, f) => s + f.haberTotal, 0);
comprueba("el diario cuadra en sumas", sumaDebe === sumaHaber, `${sumaDebe} vs ${sumaHaber}`);

// ------------------------------------------------------------ balance

const bal = balance(filasMarzo);

// Activo: caja 9.600 + clientes 1.210 − amortización acumulada 50 = 10.760
comprueba("el total del activo es 10.760", bal.totalActivo === 10760, String(bal.totalActivo));
// Pasivo y neto: capital 10.000 + resultado 550 + IVA repercutido 210 = 10.760
comprueba("el total del pasivo es 10.760", bal.totalPasivo === 10760, String(bal.totalPasivo));
comprueba("el balance cuadra", bal.descuadre === 0, String(bal.descuadre));
comprueba("el resultado del ejercicio es 550", bal.resultado === 550, String(bal.resultado));
comprueba("no hay cuentas sin clasificar", bal.sinClasificar.length === 0);

// La correctora tiene que RESTAR dentro del activo, no aparecer en el pasivo.
const anc = bal.activo.find((b) => b.masa === "activo-no-corriente")!;
comprueba("la amortización acumulada resta en el activo", anc.total === -50, String(anc.total));
comprueba(
  "la amortización acumulada no está en el pasivo",
  !bal.pasivo.some((b) => b.lineas.some((l) => l.codigo === "2813")),
);

// El resultado se incorpora al patrimonio neto.
const neto = bal.pasivo.find((b) => b.masa === "patrimonio-neto")!;
comprueba("el neto suma capital y resultado", neto.total === 10550, String(neto.total));

// Una cuenta rara tiene que verse, no colarse en una masa.
const conRara = sumasYSaldos(
  [...diario, { codigo: "5510", nombre: "Cuenta con socios", fecha: "2026-03-11", debe: 0, haber: 300 },
             { codigo: "570", nombre: "Caja", fecha: "2026-03-11", debe: 300, haber: 0 }],
  marzo.desde,
  marzo.hasta,
);
const balRara = balance(conRara);
comprueba("la cuenta dudosa aparece en «sin clasificar»", balRara.sinClasificar.length === 1);
comprueba("y por eso el balance acusa descuadre", balRara.descuadre === 300, String(balRara.descuadre));

// ------------------------------------------------------------ pérdidas y ganancias

const pyg = perdidasYGanancias(filasMarzo);
comprueba("ingresos de marzo: 1.000", pyg.totalIngresos === 1000, String(pyg.totalIngresos));
comprueba("gastos de marzo: 450", pyg.totalGastos === 450, String(pyg.totalGastos));
comprueba("resultado de marzo: 550", pyg.resultado === 550, String(pyg.resultado));
comprueba("los gastos salen en dos subgrupos (64 y 68)", pyg.gastos.length === 2, String(pyg.gastos.length));
comprueba("el subgrupo 64 se llama Gastos de personal", pyg.gastos[0].titulo === "Gastos de personal");
comprueba("los importes de gasto salen en positivo", pyg.gastos[0].total === 400, String(pyg.gastos[0].total));
comprueba("los importes de ingreso salen en positivo", pyg.ingresos[0].total === 1000, String(pyg.ingresos[0].total));

// En enero no hubo ni ingresos ni gastos: la PyG del mes tiene que salir a cero
// aunque el balance a 31 de enero sí tenga saldos.
const enero = calcularPeriodo(2026, "mes", { mes: 1 });
const pygEnero = perdidasYGanancias(sumasYSaldos(diario, enero.desde, enero.hasta));
comprueba("la PyG de enero es cero", pygEnero.resultado === 0, String(pygEnero.resultado));
const balEnero = balance(sumasYSaldos(diario, enero.desde, enero.hasta));
comprueba("el balance de enero sí tiene los 10.000", balEnero.totalActivo === 10000, String(balEnero.totalActivo));

// ------------------------------------------------------------ periodos

const feb24 = calcularPeriodo(2024, "mes", { mes: 2 });
comprueba("febrero de un bisiesto acaba el 29", feb24.hasta === "2024-02-29", feb24.hasta);
const feb26 = calcularPeriodo(2026, "mes", { mes: 2 });
comprueba("febrero normal acaba el 28", feb26.hasta === "2026-02-28", feb26.hasta);

const t4 = calcularPeriodo(2026, "trimestre", { trimestre: 4 });
comprueba("el 4.º trimestre va de octubre a diciembre",
  t4.desde === "2026-10-01" && t4.hasta === "2026-12-31", `${t4.desde} ${t4.hasta}`);

const acum = calcularPeriodo(2026, "anual", { mes: 3 });
comprueba("el acumulado anual empieza el 1 de enero", acum.desde === "2026-01-01", acum.desde);
comprueba("y termina al final del mes elegido", acum.hasta === "2026-03-31", acum.hasta);
comprueba("su título lo dice", acum.titulo.includes("enero a marzo"), acum.titulo);

const anio = calcularPeriodo(2026, "anual", {});
comprueba("sin mes, el año entero", anio.desde === "2026-01-01" && anio.hasta === "2026-12-31");

const rango = calcularPeriodo(2026, "rango", { desde: "2026-05-04", hasta: "2026-06-17" });
comprueba("el rango libre se respeta", rango.desde === "2026-05-04" && rango.hasta === "2026-06-17");
comprueba("y el título va en formato español", rango.titulo === "del 04/05/2026 al 17/06/2026", rango.titulo);

// Un mes fuera de rango no debe reventar ni inventar fechas.
const raro = calcularPeriodo(2026, "mes", { mes: 99 });
comprueba("un mes imposible se acota", raro.hasta === "2026-12-31", raro.hasta);

console.log(fallos === 0 ? "\nTODO CORRECTO" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
