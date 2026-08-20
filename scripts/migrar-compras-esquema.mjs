/**
 * Port de Compras, paso 2: el ESQUEMA. El guion de mudanza (66 KB: tablas,
 * secuencias, constraints, índices, 35 funciones, vistas y triggers) lo
 * ensambló el propio Postgres de origen en la tabla _ddl_export; este script
 * lo trae, lo adapta a la casa y lo aplica vía la función ejecutar_ddl
 * (service-role) del Supabase de Hostelero. Los datos van en otro paso.
 *
 * Adaptaciones: extensiones de búsqueda difusa, cuenta_id con DEFAULT Bonita
 * en cada tabla (para no tocar el código de la app), RLS patrón de la casa
 * (+ anon SOLO en compras_correo_adjunto, que es la bandeja del front móvil),
 * y grants de funciones/secuencias a authenticated (los triggers corren como
 * quien inserta).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORIGEN_URL = "https://qjfraquadsvtfwolfbkb.supabase.co";
const ORIGEN_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqZnJhcXVhZHN2dGZ3b2xmYmtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTYxNzIsImV4cCI6MjA5NTYzMjE3Mn0.3XidwXSbZPWKdlQD7vPOnqc96oY7sEVq7Bc74KF3okk";
const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd";

const TABLAS = ["compras_centro_coste","compras_correo","compras_correo_adjunto","compras_cuenta_a3",
  "compras_cups","compras_doc","compras_doc_reparto","compras_linea","compras_producto",
  "compras_proveedor","compras_regla","compras_terminal","compras_tipo_iva"];

const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

async function ddlOrigen() {
  const r = await fetch(`${ORIGEN_URL}/rest/v1/_ddl_export?select=orden,seccion,texto&order=orden`, {
    headers: { apikey: ORIGEN_KEY, Authorization: `Bearer ${ORIGEN_KEY}` },
  });
  if (!r.ok) throw new Error(`lectura del guion: ${r.status}`);
  return r.json();
}

async function ejecutar(nombre, sql) {
  const r = await fetch(`${env.HOSTELERO_URL}/rest/v1/rpc/ejecutar_ddl`, {
    method: "POST",
    headers: {
      apikey: env.HOSTELERO_SERVICE_KEY,
      Authorization: `Bearer ${env.HOSTELERO_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_sql: sql }),
  });
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${(await r.text()).slice(0, 600)}`);
  console.log(`${nombre} ✓ (${(sql.length / 1024).toFixed(1)} KB)`);
}

const secciones = await ddlOrigen();
const de = (n) => secciones.find((s) => s.seccion === n)?.texto ?? "";

// tablas: cuenta_id de la casa como primera columna extra
const tablas = de("tablas").replace(/create table (\w+) \(\n/g,
  (m, t) => `${m}  cuenta_id uuid not null default '${CUENTA_ID}' references cuentas(id),\n`);

const rls = TABLAS.map((t) => `
alter table ${t} enable row level security;
create policy ${t}_select on ${t} for select to authenticated using (cuenta_id = cuenta_actual() or es_operador());
create policy ${t}_insert on ${t} for insert to authenticated with check (cuenta_id = cuenta_actual() or es_operador());
create policy ${t}_update on ${t} for update to authenticated using (cuenta_id = cuenta_actual() or es_operador()) with check (cuenta_id = cuenta_actual() or es_operador());
create policy ${t}_delete on ${t} for delete to authenticated using (cuenta_id = cuenta_actual() or es_operador());`).join("\n")
+ `
-- La bandeja del front móvil público (/subir-facturas): anon puede dejar el
-- fichero y consultar cómo va — la misma exposición que tenía el origen.
create policy compras_correo_adjunto_anon_insert on compras_correo_adjunto for insert to anon with check (true);
create policy compras_correo_adjunto_anon_select on compras_correo_adjunto for select to anon using (true);`;

const grants = `
do $g$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('aplicar_reparto_cups','borrar_producto','buscar_albaran_hermano','buscar_cuenta_a3',
      'canal_canonico','cif_valido','clave_producto','cod_iva_de_pct','compras_next_codigo','cups_reparto',
      'exportar_a3','fusionar_paginas_sueltas','fusionar_producto','fusionar_productos_duplicados',
      'fusionar_productos_por_clave','fusionar_proveedor','irpf_modelo_de_pct','irpf_pct_de_documento',
      'limpia_desc_producto','nombre_de_codigo_a3','norm_desc_interna','norm_nif','norm_nom',
      'norm_nom_compacto','puntua_nombre','recalcular_estado_facturas','regenerar_reparto_iva',
      'terminal_canal','tipo_iva_de')
  loop
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $g$;
grant usage on all sequences in schema public to authenticated;`;

// reanudable: `node ... <seccion>` salta hasta esa sección
const DESDE = process.argv[2];
let saltando = Boolean(DESDE);
const ejecutarDesde = async (nombre, sql) => {
  if (saltando && nombre !== DESDE) { console.log(`${nombre} (saltada)`); return; }
  saltando = false;
  await ejecutar(nombre, sql);
};
await ejecutarDesde("extensiones", "create extension if not exists pg_trgm; create extension if not exists fuzzystrmatch;");
await ejecutarDesde("secuencias", de("secuencias"));
await ejecutarDesde("tablas", tablas);
await ejecutarDesde("constraints", de("constraints"));
await ejecutarDesde("indices", de("indices"));
// check_function_bodies off: el volcado va en orden alfabético y una función
// SQL valida sus dependencias al crearse (pg_dump hace exactamente esto).
await ejecutarDesde("funciones", "set local check_function_bodies = off;\n" + de("funciones"));
// Las vistas se referencian entre sí y el volcado va por orden alfabético:
// se crean una a una, reintentando las que fallen hasta que el grafo de
// dependencias quede resuelto (dos pasadas bastan; el tope evita bucles).
if (!saltando || DESDE === "vistas") {
  saltando = false;
  let pendientes = de("vistas").split(/\n\n(?=create or replace view )/);
  for (let ronda = 1; pendientes.length && ronda <= 5; ronda++) {
    const fallidas = [];
    for (const v of pendientes) {
      try { await ejecutar(`vista ${v.match(/view (\w+)/)[1]}`, v); }
      catch { fallidas.push(v); }
    }
    if (fallidas.length === pendientes.length) {
      throw new Error(`vistas sin resolver: ${fallidas.map((v) => v.match(/view (\w+)/)[1]).join(", ")}`);
    }
    pendientes = fallidas;
  }
} else console.log("vistas (saltada)");
await ejecutarDesde("triggers", de("triggers"));
await ejecutarDesde("rls", rls);
await ejecutarDesde("grants", grants);
console.log("ESQUEMA PORTADO");
