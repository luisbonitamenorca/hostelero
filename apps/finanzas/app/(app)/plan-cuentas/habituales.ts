// Fuera de nueva-cuenta.tsx (cliente) para que la página del servidor pueda
// leer la lista y preguntar a la base SOLO por estos códigos, en vez de
// traerse el plan entero (6.000+ cuentas, cortadas además a 1.000 filas).

/** Con el plan de A3 cargado (17-08-2026) todas estas existen y la lista se
 *  autooculta. Se queda por si algún día se borra o desactiva una básica: el
 *  hueco reaparece solo. Códigos de 9 dígitos, como el plan. */
export const HABITUALES = [
  { codigo: "570000000", nombre: "Caja, euros" },
  { codigo: "572000000", nombre: "Bancos c/c vista, euros" },
  { codigo: "430000000", nombre: "Clientes" },
  { codigo: "472000021", nombre: "Hacienda Pública, IVA soportado 21%" },
  { codigo: "477000021", nombre: "Hacienda Pública, IVA repercutido 21%" },
  { codigo: "600000000", nombre: "Compras de mercaderías" },
  { codigo: "621000000", nombre: "Alquiler" },
  { codigo: "640000000", nombre: "Salarios" },
  { codigo: "642000000", nombre: "Seguridad Social" },
  { codigo: "700000000", nombre: "Ventas" },
];
