"use server";

import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/supabase/server";

/**
 * Módulo Documentos. Todo pasa por el cliente de sesión bajo RLS
 * (cuenta_id = cuenta_actual() OR es_operador()); la política del bucket
 * privado `docs` exige que el primer segmento de la ruta sea el cuenta_id.
 * Los ficheros se sirven SIEMPRE con URL firmada bajo demanda: no se
 * persiste ninguna URL pública (a diferencia del legado).
 */

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

const FIRMA_SEGUNDOS = 300;
const MAX_MB = 25;

function slug(s: string) {
  return (
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "doc"
  );
}

async function ctx() {
  return exigirModulo("docs");
}

/* ================= Ficheros ================= */

/** URL firmada temporal para ver o descargar un documento. */
export async function urlFirmada(
  documentoId: string,
  descargar = false
): Promise<R<{ url: string }>> {
  const { supabase } = await ctx();
  const { data: doc } = await supabase
    .from("docs_documentos")
    .select("archivo_path, archivo_nombre")
    .eq("id", documentoId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Documento no encontrado." };

  const { data, error } = await supabase.storage
    .from("docs")
    .createSignedUrl(doc.archivo_path, FIRMA_SEGUNDOS, {
      download: descargar ? doc.archivo_nombre : undefined,
    });
  if (error || !data) return { ok: false, error: "No se ha podido firmar la URL." };
  return { ok: true, data: { url: data.signedUrl } };
}

/**
 * Prepara una subida: genera la ruta (cuenta_id/<categoria>/<uuid>-<fichero>)
 * y devuelve una URL firmada de subida para que el navegador suba el fichero
 * directo al bucket, sin pasar el binario por el servidor de Next.
 */
export async function prepararSubida(entrada: {
  categoriaId: string;
  nombreFichero: string;
  tamano: number;
}): Promise<R<{ path: string; urlSubida: string }>> {
  const { supabase, cuenta } = await ctx();

  if (!entrada.nombreFichero) return { ok: false, error: "Falta el fichero." };
  if (!(entrada.tamano > 0) || entrada.tamano > MAX_MB * 1024 * 1024) {
    return { ok: false, error: `El fichero supera el máximo de ${MAX_MB} MB.` };
  }
  const { data: cat } = await supabase
    .from("docs_categorias")
    .select("id, nombre")
    .eq("id", entrada.categoriaId)
    .maybeSingle();
  if (!cat) return { ok: false, error: "Categoría no válida." };

  const path = `${cuenta.id}/${slug(cat.nombre)}/${crypto.randomUUID()}-${slug(entrada.nombreFichero)}`;
  const { data, error } = await supabase.storage.from("docs").createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "No se ha podido preparar la subida." };
  return { ok: true, data: { path: data.path, urlSubida: data.signedUrl } };
}

/** Registra la fila una vez subido el fichero. */
export async function registrarDocumento(entrada: {
  nombre: string;
  descripcion: string | null;
  categoriaId: string;
  subcategoriaId: string | null;
  centroId: string | null;
  path: string;
  nombreFichero: string;
  tamano: number;
  tipo: string | null;
}): Promise<R> {
  const { supabase, cuenta, perfil } = await ctx();

  if (!entrada.nombre.trim()) return { ok: false, error: "Falta el nombre." };
  // La ruta debe colgar de la cuenta: el aislamiento del bucket depende de esto.
  if (!entrada.path.startsWith(`${cuenta.id}/`)) {
    return { ok: false, error: "Ruta de fichero no válida." };
  }

  const { error } = await supabase.from("docs_documentos").insert({
    cuenta_id: cuenta.id,
    categoria_id: entrada.categoriaId,
    subcategoria_id: entrada.subcategoriaId,
    centro_id: entrada.centroId,
    nombre: entrada.nombre.trim(),
    descripcion: entrada.descripcion?.trim() || null,
    archivo_path: entrada.path,
    archivo_nombre: entrada.nombreFichero,
    archivo_tipo: entrada.tipo,
    archivo_tamano: entrada.tamano,
    subido_por: perfil.id,
  });
  if (error) return { ok: false, error: "No se ha podido registrar el documento." };
  revalidatePath("/docs");
  return { ok: true };
}

export async function borrarDocumento(documentoId: string): Promise<R> {
  const { supabase } = await ctx();
  const { data: doc } = await supabase
    .from("docs_documentos")
    .select("id, archivo_path")
    .eq("id", documentoId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Documento no encontrado." };

  // Primero el fichero; si falla se avisa pero se sigue: la fila es la referencia visible.
  const { error: errStorage } = await supabase.storage.from("docs").remove([doc.archivo_path]);
  const { error } = await supabase.from("docs_documentos").delete().eq("id", doc.id);
  if (error) return { ok: false, error: "No se ha podido eliminar la fila." };
  revalidatePath("/docs");
  return errStorage
    ? { ok: true, error: "Fila eliminada, pero el fichero no se pudo borrar del bucket." }
    : { ok: true };
}

/* ================= Carpetas (categorías y subcategorías) ================= */

export async function crearCategoria(nombre: string): Promise<R> {
  const { supabase, cuenta } = await ctx();
  const n = nombre.trim();
  if (!n) return { ok: false, error: "Falta el nombre." };
  const { data: existentes } = await supabase.from("docs_categorias").select("nombre, orden");
  if ((existentes ?? []).some((c) => c.nombre.toLowerCase() === n.toLowerCase())) {
    return { ok: false, error: "Ya existe una categoría con ese nombre." };
  }
  const orden = Math.max(0, ...(existentes ?? []).map((c) => c.orden || 0)) + 1;
  const { error } = await supabase
    .from("docs_categorias")
    .insert({ cuenta_id: cuenta.id, nombre: n, orden });
  if (error) return { ok: false, error: "No se ha podido crear." };
  revalidatePath("/docs");
  return { ok: true };
}

export async function renombrarCategoria(id: string, nombre: string): Promise<R> {
  const { supabase } = await ctx();
  const n = nombre.trim();
  if (!n) return { ok: false, error: "Falta el nombre." };
  const { error } = await supabase.from("docs_categorias").update({ nombre: n }).eq("id", id);
  if (error) return { ok: false, error: "No se ha podido renombrar." };
  revalidatePath("/docs");
  return { ok: true };
}

export async function borrarCategoria(id: string): Promise<R> {
  const { supabase } = await ctx();
  const { count } = await supabase
    .from("docs_documentos")
    .select("id", { count: "exact", head: true })
    .eq("categoria_id", id);
  if ((count ?? 0) > 0) {
    return { ok: false, error: "La categoría contiene documentos. Muévelos o elimínalos antes." };
  }
  await supabase.from("docs_subcategorias").delete().eq("categoria_id", id);
  const { error } = await supabase.from("docs_categorias").delete().eq("id", id);
  if (error) return { ok: false, error: "No se ha podido eliminar." };
  revalidatePath("/docs");
  return { ok: true };
}

export async function moverCategoria(id: string, dir: -1 | 1): Promise<R> {
  const { supabase } = await ctx();
  const { data } = await supabase.from("docs_categorias").select("id, orden").order("orden");
  const lista = data ?? [];
  const i = lista.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= lista.length) return { ok: true };
  await supabase.from("docs_categorias").update({ orden: lista[j].orden }).eq("id", lista[i].id);
  await supabase.from("docs_categorias").update({ orden: lista[i].orden }).eq("id", lista[j].id);
  revalidatePath("/docs");
  return { ok: true };
}

export async function crearSubcategoria(categoriaId: string, nombre: string): Promise<R> {
  const { supabase, cuenta } = await ctx();
  const n = nombre.trim();
  if (!n) return { ok: false, error: "Falta el nombre." };
  const { data: hermanas } = await supabase
    .from("docs_subcategorias")
    .select("nombre, orden")
    .eq("categoria_id", categoriaId);
  if ((hermanas ?? []).some((s) => s.nombre.toLowerCase() === n.toLowerCase())) {
    return { ok: false, error: "Ya existe una subcategoría con ese nombre en esta categoría." };
  }
  const orden = Math.max(0, ...(hermanas ?? []).map((s) => s.orden || 0)) + 1;
  const { error } = await supabase
    .from("docs_subcategorias")
    .insert({ cuenta_id: cuenta.id, categoria_id: categoriaId, nombre: n, orden });
  if (error) return { ok: false, error: "No se ha podido crear." };
  revalidatePath("/docs");
  return { ok: true };
}

export async function renombrarSubcategoria(id: string, nombre: string): Promise<R> {
  const { supabase } = await ctx();
  const n = nombre.trim();
  if (!n) return { ok: false, error: "Falta el nombre." };
  const { error } = await supabase.from("docs_subcategorias").update({ nombre: n }).eq("id", id);
  if (error) return { ok: false, error: "No se ha podido renombrar." };
  revalidatePath("/docs");
  return { ok: true };
}

export async function borrarSubcategoria(id: string): Promise<R> {
  const { supabase } = await ctx();
  const { count } = await supabase
    .from("docs_documentos")
    .select("id", { count: "exact", head: true })
    .eq("subcategoria_id", id);
  if ((count ?? 0) > 0) {
    return { ok: false, error: "La subcategoría contiene documentos. Muévelos o elimínalos antes." };
  }
  const { error } = await supabase.from("docs_subcategorias").delete().eq("id", id);
  if (error) return { ok: false, error: "No se ha podido eliminar." };
  revalidatePath("/docs");
  return { ok: true };
}

export async function moverSubcategoria(id: string, dir: -1 | 1): Promise<R> {
  const { supabase } = await ctx();
  const { data: fila } = await supabase
    .from("docs_subcategorias")
    .select("categoria_id")
    .eq("id", id)
    .maybeSingle();
  if (!fila) return { ok: false, error: "Subcategoría no encontrada." };
  const { data } = await supabase
    .from("docs_subcategorias")
    .select("id, orden")
    .eq("categoria_id", fila.categoria_id)
    .order("orden");
  const lista = data ?? [];
  const i = lista.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= lista.length) return { ok: true };
  await supabase.from("docs_subcategorias").update({ orden: lista[j].orden }).eq("id", lista[i].id);
  await supabase.from("docs_subcategorias").update({ orden: lista[i].orden }).eq("id", lista[j].id);
  revalidatePath("/docs");
  return { ok: true };
}
