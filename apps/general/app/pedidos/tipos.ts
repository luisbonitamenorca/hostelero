// Tipos compartidos del módulo Pedidos (servidor y cliente).
// SIN directiva ("use server"/"use client"): lo importan las acciones de servidor, page.tsx y los
// componentes de cliente. Solo tipos y constantes de texto; las funciones van en lib-pedidos.ts.
// Contrato funcional: docs/pedidos-plan.md · contratos de ficheros: docs/pedidos-contratos.md.
// Semántica de la base: supabase/migrations/20261004120000_pedidos.sql (aplicada el 04-10-2026).
import type { Tables, TablesInsert } from "@hostelero/db";

/* ═══════════════════════ Resultado de las acciones ═══════════════════════ */

/** Error de una acción: texto claro para enseñar tal cual al usuario. Las acciones NO lanzan. */
export type ErrorAccion = { ok: false; error: string };

/** Resultado de toda acción de servidor de /pedidos: `{ ok: true, …datos }` o `{ ok: false, error }`. */
export type Resultado<T extends object = Record<never, never>> = ({ ok: true } & T) | ErrorAccion;

/* ═══════════════════════ Filas de la base (tipos generados) ═══════════════════════ */

export type FilaPedido = Tables<"compras_pedido">;
export type FilaLineaPedido = Tables<"compras_pedido_linea">;
export type FilaProveedor = Tables<"compras_proveedor">;
export type FilaProducto = Tables<"compras_producto">;
export type FilaAlias = Tables<"compras_pedido_alias">;
export type FilaImportacion = Tables<"compras_catalogo_import">;
export type FilaDoc = Tables<"compras_doc">;
/** Json de Supabase (no lo exporta @hostelero/db): para escribir interpretacion/detalle. */
export type Json = NonNullable<TablesInsert<"compras_pedido">["interpretacion"]>;

/* ═══════════════════════ Catálogos de valores (checks de la base) ═══════════════════════ */

export const ESTADOS_PEDIDO = ["borrador", "enviado", "confirmado", "recibido_parcial", "recibido", "cancelado"] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];
export const ESTADO_PEDIDO_TXT: Record<EstadoPedido, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  confirmado: "Confirmado",
  recibido_parcial: "Recibido en parte",
  recibido: "Recibido",
  cancelado: "Cancelado",
};
/** Estados en los que el pedido ya salió (el trigger fija enviado_en/enviado_por al entrar en el primero). */
export const ESTADOS_ENVIADOS: readonly EstadoPedido[] = ["enviado", "confirmado", "recibido_parcial", "recibido"];

export const CANALES_PEDIDO = ["email", "whatsapp", "telefono", "portal"] as const;
export type CanalPedido = (typeof CANALES_PEDIDO)[number];
export const CANAL_TXT: Record<CanalPedido, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  telefono: "Teléfono",
  portal: "Web del proveedor",
};

export const ORIGENES_PEDIDO = ["voz", "texto", "catalogo", "mixto"] as const;
export type OrigenPedido = (typeof ORIGENES_PEDIDO)[number];

/** Idioma del dictado. En el navegador: es → "es-ES", ca → "ca-ES". Se guarda en compras_pedido.idioma. */
export type IdiomaDictado = "es" | "ca";
export const IDIOMA_TXT: Record<IdiomaDictado, string> = { es: "Castellano", ca: "Menorquí" };

export const ESTADOS_COTEJO_LINEA = ["ok", "falta", "sobra", "cantidad", "precio", "sustituido", "sin_dato"] as const;
export type EstadoCotejoLinea = (typeof ESTADOS_COTEJO_LINEA)[number];
export const ESTADO_COTEJO_LINEA_TXT: Record<EstadoCotejoLinea, string> = {
  ok: "Correcto",
  falta: "Falta",
  sobra: "No pedido",
  cantidad: "Cantidad distinta",
  precio: "Precio distinto",
  sustituido: "Sustituido",
  sin_dato: "Sin dato",
};

export const ESTADOS_COTEJO_PEDIDO = ["pendiente", "ok", "diferencias", "sin_documentos"] as const;
export type EstadoCotejoPedido = (typeof ESTADOS_COTEJO_PEDIDO)[number];
export const ESTADO_COTEJO_PEDIDO_TXT: Record<EstadoCotejoPedido, string> = {
  pendiente: "Sin cotejar",
  ok: "Todo cuadra",
  diferencias: "Con diferencias",
  sin_documentos: "Sin albarán ni factura",
};

/** Unidades canónicas (las mismas que devuelve pedidos_unidad_norm en la base). */
export const UNIDADES = ["unidad", "kg", "g", "litro", "caja", "paquete", "docena", "saco", "garrafa", "botella", "bandeja", "lata", "barril"] as const;
export type UnidadCanonica = (typeof UNIDADES)[number];

/** Roles que ven Ajustes, importan catálogos y gestionan alias. */
export const ROLES_GESTION = ["direccion", "responsable_area"] as const;

/** Clave de grupo para las líneas sin proveedor en la revisión. */
export const SIN_PROVEEDOR = "";

/* Límites compartidos (el servidor los vuelve a comprobar). */
/** Filas por trozo de importación de catálogo (límite de cuerpo de las server actions). */
export const TAM_TROZO_IMPORT = 400;
/** Productos del catálogo del centro que van en el contexto de la IA. */
export const MAX_CATALOGO_IA = 400;
/** Alias aprendidos que van en el contexto de la IA. */
export const MAX_ALIAS_IA = 300;
/** Longitud máxima del texto que se manda a interpretar. */
export const MAX_TEXTO_PEDIDO = 4000;

/* ═══════════════════════ Contexto de la página ═══════════════════════ */

export type Centro = { id: string; nombre: string; direccion: string | null };

/** Proveedor con sus datos de pedido (columnas pedido_* de compras_proveedor). */
export type ProveedorPedido = {
  id: string;
  nombre: string;
  pedido_canal: CanalPedido;
  pedido_email: string | null;
  /** Solo dígitos, con prefijo de país (para wa.me). */
  pedido_whatsapp: string | null;
  pedido_telefono: string | null;
  pedido_minimo: number | null;
  /** Días ISO 1 (lunes) … 7 (domingo). null o [] = cualquier día. */
  pedido_dias_reparto: number[] | null;
  /** "HH:MM:SS" (time de Postgres, hora de Madrid) o null. */
  pedido_hora_corte: string | null;
  pedido_notas: string | null;
  albaranes_por_email: boolean;
  catalogo_actualizado_en: string | null;
  pedible: boolean;
};

/** Columnas para leer un ProveedorPedido (page.tsx, ajustes, envío). Pasar por comoProveedor() de lib-pedidos. */
export const SELECT_PROVEEDOR =
  "id, nombre, pedido_canal, pedido_email, pedido_whatsapp, pedido_telefono, pedido_minimo, pedido_dias_reparto, pedido_hora_corte, pedido_notas, albaranes_por_email, catalogo_actualizado_en, pedible" as const;

/** Lo que page.tsx pasa a PanelPedidos (todo serializable). */
export type ContextoPedidos = {
  perfil: { id: string; nombre: string | null; correo: string; rol: string };
  cuenta: { id: string; nombre: string };
  /** Centros de la cuenta, por nombre. */
  centros: Centro[];
  /** Proveedores pedibles de la cuenta, por nombre. */
  proveedores: ProveedorPedido[];
  /** direccion o responsable_area: ve Ajustes. */
  puedeGestionar: boolean;
  /** ¿Hay ANTHROPIC_API_KEY en el servidor? (solo el booleano, nunca la clave) */
  iaDisponible: boolean;
  /** Hoy en Europe/Madrid (YYYY-MM-DD), calculado en el servidor. */
  hoy: string;
};

/* ═══════════════════════ Catálogo ═══════════════════════ */

/** Producto pedible tal como lo devuelve pedidos_catalogo_centro (las acciones normalizan nulos). */
export type ProductoCatalogo = {
  producto_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  /** Nunca vacío: si la base lo tiene null, la acción pone la referencia o "(sin nombre)". */
  nombre: string;
  ref_proveedor: string | null;
  codigo_interno: string | null;
  unidad: string | null;
  formato: string | null;
  unidades_formato: number | null;
  categoria: string | null;
  precio_catalogo: number | null;
  /** Documentos en los que se compró en este centro (0 = nunca comprado aquí). */
  veces: number;
  cantidad_total: number;
  ultima_cantidad: number | null;
  /** Último precio de compra (o compras_producto.ultimo_precio si no hay líneas). */
  ultimo_precio: number | null;
  ultima_fecha: string | null;
  alias: string[];
};

/* ═══════════════════════ Interpretación por IA ═══════════════════════ */

/** Línea de la interpretación cruda (con uuids), tal como se guarda en compras_pedido.interpretacion. */
export type LineaInterpretacionCruda = {
  producto_id: string | null;
  /** Máx. 3, uuids de productos del contexto. */
  alternativas: string[];
  proveedor_id: string | null;
  texto_original: string;
  descripcion: string | null;
  cantidad: number;
  unidad: string | null;
  /** 0-1 (validado en código). */
  confianza: number;
  nota: string | null;
};

/** Salida de lib/pedidos-ia.ts con los ids cortos ya traducidos a uuids. Va a compras_pedido.interpretacion. */
export type InterpretacionCruda = {
  version: 1;
  /** Modelo que respondió de verdad (puede ser el de reserva si saltó el fallback). */
  modelo: string;
  idioma: IdiomaDictado;
  /** Fecha de hoy (Madrid) que se dio a la IA para resolver «per demà», «dilluns»… */
  fecha_referencia: string;
  centro_id: string;
  texto: string;
  lineas: LineaInterpretacionCruda[];
  fecha_entrega: string | null;
  notas: string | null;
  dudas: string[];
  /** Ids cortos que la IA devolvió y no estaban en el contexto (se pusieron a null). */
  descartados: string[];
  stop_reason: string | null;
  /** Tokens (para vigilar coste); opcional. */
  uso?: { entrada: number; salida: number; cache_lectura: number; cache_escritura: number };
};

/** Línea interpretada lista para la UI: productos completos en vez de ids. */
export type LineaInterpretada = {
  producto: ProductoCatalogo | null;
  alternativas: ProductoCatalogo[];
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  texto_original: string;
  descripcion: string | null;
  cantidad: number;
  unidad: string | null;
  confianza: number;
  nota: string | null;
};

export type EntradaInterpretar = {
  centro_id: string;
  /** Lo dictado o escrito (1..MAX_TEXTO_PEDIDO caracteres). */
  texto: string;
  idioma: IdiomaDictado;
};

/** Lo que devuelve la acción interpretarTexto. */
export type ResultadoInterpretacion = {
  lineas: LineaInterpretada[];
  fecha_entrega: string | null;
  notas: string | null;
  dudas: string[];
  idioma: IdiomaDictado;
  /** Para guardar tal cual en compras_pedido.interpretacion (guardarBorradores). */
  interpretacion: InterpretacionCruda;
};

/* ═══════════════════════ Revisión (cliente) y guardado ═══════════════════════ */

/** Línea en la pantalla de revisión (estado del cliente antes de guardar). */
export type LineaRevision = {
  /** Clave local estable para React (no es un id de la base). */
  clave: string;
  producto: ProductoCatalogo | null;
  alternativas: ProductoCatalogo[];
  /** Del producto si lo hay; si no, el que diga la IA o el usuario (o null). */
  proveedor_id: string | null;
  texto_original: string | null;
  descripcion: string | null;
  cantidad: number;
  unidad: string | null;
  precio_estimado: number | null;
  /** null = la puso el usuario a mano (catálogo, buscador). */
  confianza: number | null;
  nota: string | null;
  /** Lo que propuso la IA (para aprender si el usuario lo cambia). null si no vino de la IA. */
  ia_producto_id: string | null;
  ia_unidad: string | null;
};

/** Fecha de entrega y notas por proveedor en la revisión. Clave: proveedor_id o SIN_PROVEEDOR. */
export type MetaGrupo = { fecha_entrega: string | null; notas: string };

/** Grupo de la revisión, ya ordenado para pintar (agruparRevision de lib-pedidos). */
export type GrupoRevision = {
  /** proveedor_id o SIN_PROVEEDOR: es la clave de MetaGrupo. */
  clave: string;
  proveedor: ProveedorPedido | null;
  /** Solo las líneas CON producto (las sin producto van en sin_identificar). */
  lineas: LineaRevision[];
  /** Σ cantidad × precio_estimado de las líneas con precio; null si ninguna lo tiene. */
  total: number | null;
};

/** Revisión agrupada: «Sin identificar» arriba (producto null, tengan o no proveedor) y después
    un grupo por proveedor (por nombre). Al GUARDAR manda proveedor_id, no esta agrupación. */
export type RevisionAgrupada = {
  sin_identificar: LineaRevision[];
  grupos: GrupoRevision[];
};

/** Línea que se manda a guardar (guardarBorradores / anadirLinea). */
export type LineaGuardar = {
  producto_id: string | null;
  texto_original: string | null;
  descripcion: string | null;
  cantidad: number;
  unidad: string | null;
  /** Si viene null y hay producto, el servidor pone ultimo_precio ?? precio_catalogo. */
  precio_estimado: number | null;
  confianza: number | null;
  nota: string | null;
  /** Para el aprendizaje de alias (opcionales). */
  ia_producto_id?: string | null;
  ia_unidad?: string | null;
};

export type GrupoGuardar = {
  /** null = borrador sin proveedor (no se podrá enviar hasta asignarlo). */
  proveedor_id: string | null;
  fecha_entrega: string | null;
  notas: string | null;
  lineas: LineaGuardar[];
};

export type EntradaGuardarBorradores = {
  centro_id: string;
  origen: OrigenPedido;
  transcripcion: string | null;
  idioma: IdiomaDictado | null;
  interpretacion: InterpretacionCruda | null;
  grupos: GrupoGuardar[];
  /** true: si ya hay un borrador del mismo centro y proveedor, se añaden ahí las líneas (fusionadas). */
  unir_a_borrador: boolean;
};

export type PedidoCreado = {
  id: string;
  numero: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  n_lineas: number;
  /** true si las líneas se añadieron a un borrador que ya existía. */
  unido: boolean;
};

export type CambiosBorrador = {
  proveedor_id?: string | null;
  fecha_entrega?: string | null;
  notas?: string | null;
};

export type CambiosLinea = {
  producto_id?: string | null;
  descripcion?: string | null;
  cantidad?: number;
  unidad?: string | null;
  precio_estimado?: number | null;
  nota?: string | null;
};

/* ═══════════════════════ Pedidos guardados ═══════════════════════ */

/** Datos del producto que se pintan en una línea guardada. */
export type ProductoLinea = {
  id: string;
  nombre: string;
  ref_proveedor: string | null;
  codigo_interno: string | null;
  unidad: string | null;
  formato: string | null;
  proveedor_id: string | null;
};

export type LineaPedido = {
  id: string;
  pedido_id: string;
  orden: number;
  producto_id: string | null;
  producto: ProductoLinea | null;
  texto_original: string | null;
  descripcion: string | null;
  cantidad: number;
  unidad: string | null;
  precio_estimado: number | null;
  confianza: number | null;
  nota: string | null;
  cantidad_albaran: number | null;
  precio_albaran: number | null;
  cantidad_factura: number | null;
  precio_factura: number | null;
  estado_cotejo: EstadoCotejoLinea | null;
};

/** Fila de la lista de pedidos. */
export type PedidoResumen = {
  id: string;
  numero: string;
  estado: EstadoPedido;
  centro_id: string;
  centro_nombre: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  fecha_entrega: string | null;
  creado_en: string;
  enviado_en: string | null;
  canal_envio: CanalPedido | null;
  origen: OrigenPedido;
  total_estimado: number | null;
  n_lineas: number;
  cotejo_estado: EstadoCotejoPedido;
  albaran_doc_id: string | null;
  factura_doc_id: string | null;
};

/** Documento de Compras (albarán o factura) vinculado o sugerido. */
export type DocumentoResumen = {
  id: string;
  tipo: "albaran" | "factura";
  num_documento: string | null;
  fecha: string | null;
  base: number | null;
  total: number | null;
  canal: string | null;
  imagen_url: string | null;
};

export type PedidoCompleto = PedidoResumen & {
  notas: string | null;
  transcripcion: string | null;
  idioma: IdiomaDictado | null;
  interpretacion: InterpretacionCruda | null;
  proveedor: ProveedorPedido | null;
  centro: Centro;
  lineas: LineaPedido[];
  cotejo: CotejoDetalle | null;
  cotejado_en: string | null;
  documentos: { albaran: DocumentoResumen | null; factura: DocumentoResumen | null };
};

export type FiltroPedidos = {
  centro_id?: string | null;
  proveedor_id?: string | null;
  /** Vacío o ausente = todos menos cancelados. */
  estados?: EstadoPedido[];
  /** creado_en desde/hasta, YYYY-MM-DD (Madrid). */
  desde?: string | null;
  hasta?: string | null;
  /** Por defecto 100, máximo 300. */
  limite?: number;
};

/* ═══════════════════════ Envío ═══════════════════════ */

/** Datos con los que lib-pedidos compone el texto / HTML del pedido. */
export type DatosTextoPedido = {
  numero: string;
  cuenta_nombre: string;
  centro_nombre: string;
  centro_direccion: string | null;
  proveedor_nombre: string;
  fecha_entrega: string | null;
  notas: string | null;
  lineas: { ref: string | null; nombre: string; cantidad: number; unidad: string | null; nota: string | null }[];
  /** Quién hace el pedido (firma). */
  contacto: { nombre: string | null; correo: string | null; telefono: string | null };
  /** PEDIDOS_BUZON_ALBARANES; null = el pie no pide albarán a ninguna dirección. */
  buzon_albaranes: string | null;
};

/** Vista previa del envío de un pedido (prepararEnvio). */
export type VistaEnvio = {
  canal: CanalPedido;
  /** email, número de WhatsApp o teléfono según canal; null si falta en Ajustes. */
  destino: string | null;
  asunto: string;
  texto: string;
  html: string;
  enlace_whatsapp: string | null;
  enlace_mailto: string | null;
  enlace_telefono: string | null;
  minimo: { minimo: number; total: number | null; cumple: boolean } | null;
  /** Avisos que no bloquean y no dependen del canal: por debajo del mínimo, líneas sin identificar…
      (los de configuración del servidor, como el buzón de albaranes, solo a quien gestiona). */
  avisos: string[];
  /** Avisos propios de cada canal: la ficha pinta los del canal que el usuario tiene elegido. */
  avisos_canal: Record<CanalPedido, string[]>;
  /** ¿Puede este usuario escribir otra dirección de email? Solo quien gestiona, o cualquiera si el
      proveedor no tiene email guardado (enviarPorEmail aplica la misma regla). */
  email_editable: boolean;
  puede_enviar: boolean;
  /** Por qué no se puede enviar (no es borrador, sin proveedor, sin líneas, sin destino…). */
  motivo_bloqueo: string | null;
};

/** Plan B cuando el email no sale: el usuario lo manda desde su correo y luego marca enviado. */
export type AlternativaEnvio = { para: string | null; asunto: string; texto: string; enlace_mailto: string | null };
export type ErrorConAlternativa = { ok: false; error: string; alternativa: AlternativaEnvio };
/** El correo SALIÓ pero no se pudo marcar enviado: no hay que reenviarlo, solo pulsar «Ya lo he enviado». */
export type ErrorYaEnviado = { ok: false; error: string; ya_enviado: true };

/** Petición estándar al proveedor: catálogo con códigos + albaranes en PDF por email. */
export type PeticionProveedor = { para: string | null; asunto: string; texto: string; html: string; enlace_mailto: string | null };

/* ═══════════════════════ Seguimiento y cotejo ═══════════════════════ */

/** Fila de pedidos_sugerir_documentos (nulos normalizados). */
export type SugerenciaDocumento = {
  doc_id: string;
  tipo: "albaran" | "factura";
  fecha: string | null;
  num_documento: string | null;
  total: number | null;
  canal: string | null;
  mismo_centro: boolean;
  n_lineas: number;
  n_coinciden: number;
  incluye_albaran: boolean;
  /** 0-100. */
  puntuacion: number;
  motivo: string;
  /** Números de otros pedidos que ya lo tienen vinculado (solo facturas). */
  vinculado_a: string | null;
};

/* Resultado de pedidos_cotejar() (jsonb, version 1). La función pasa jsonb_strip_nulls por el
   detalle: TODO campo que pueda ser null llega AUSENTE (por eso los «?:» sin null). En la rama
   «sin documentos» solo vienen version, cotejado_en, motivo, avisos y resumen.n_lineas. */

export type CotejoLado = {
  cantidad?: number;
  precio?: number;
  importe?: number;
  casado_por?: "producto" | "referencia" | "nombre";
  n_lineas?: number;
};

export type CotejoLinea = {
  linea_id: string;
  producto_id?: string;
  nombre?: string;
  estado: EstadoCotejoLinea;
  pedido: { cantidad: number; unidad?: string; precio?: number };
  /** Varias líneas del pedido con el mismo producto y unidad: se cotejan juntas. */
  agrupada?: { n_lineas: number; cantidad_total: number; principal: boolean };
  albaran?: CotejoLado;
  factura?: CotejoLado;
  notas?: string[];
};

/** Línea del documento que no está en el pedido. */
export type CotejoSobra = {
  doc: "albaran" | "factura";
  linea_id: string;
  producto_id?: string;
  ref?: string;
  producto?: string;
  cantidad?: number;
  precio_unit?: number;
  importe?: number;
};

export type CotejoDiferenciaPrecio = {
  linea_id: string;
  producto_id?: string;
  nombre?: string;
  comparacion: "pedido_albaran" | "pedido_factura" | "albaran_factura";
  precio_esperado: number;
  precio_documento: number;
  diferencia_pct: number;
  /** (precio documento − esperado) × cantidad del documento; positivo = pagamos de más. */
  importe: number;
};

export type CotejoDocAlbaran = {
  id: string;
  num?: string;
  fecha?: string;
  base?: number;
  total?: number;
  tiene_lineas: boolean;
  num_conciliado?: string;
};

export type CotejoDocFactura = {
  id: string;
  num?: string;
  fecha?: string;
  base?: number;
  total?: number;
  tiene_lineas: boolean;
  albaranes_que_agrupa: number;
  /** true recoge el albarán · false no lo recoge · ausente = no se puede saber. */
  incluye_albaran?: boolean;
  sin_detalle_albaranes?: boolean;
  importe_albaran_en_factura?: number;
  cuadra_importe?: boolean;
  cuadra_con_albaran?: boolean;
  cuadra_con_pedido?: boolean;
};

export type CotejoResumen = {
  n_lineas: number;
  n_ok?: number;
  n_faltas?: number;
  n_cantidad?: number;
  n_precio?: number;
  n_sustituidos?: number;
  n_sin_dato?: number;
  n_lineas_agrupadas?: number;
  n_sobras?: number;
  importe_sobras?: number;
  n_sobras_factura?: number;
  importe_sobras_factura?: number;
  n_diferencias_precio?: number;
  importe_diferencias_precio?: number;
  n_diferencias_factura?: number;
  n_unidades_distintas?: number;
  /** Líneas con cantidad distinta y producto sin unidad definida: puede ser cosa de unidades. */
  n_unidad_desconocida?: number;
  importe_pedido?: number;
  importe_albaran?: number;
  importe_factura?: number;
};

export type CotejoDetalle = {
  version: 1;
  cotejado_en: string;
  tolerancia_precio?: number;
  /** Documento con el que se comparó producto a producto. Ausente = ninguno tenía líneas. */
  referencia?: "albaran" | "factura";
  motivo?: string;
  documentos?: { albaran?: CotejoDocAlbaran; factura?: CotejoDocFactura };
  resumen: CotejoResumen;
  lineas?: CotejoLinea[];
  sobras?: CotejoSobra[];
  diferencias_precio?: CotejoDiferenciaPrecio[];
  avisos?: string[];
};

/** Estados que se pueden marcar a mano en el seguimiento. */
export type EstadoSeguimiento = "confirmado" | "recibido_parcial" | "recibido";

/* ═══════════════════════ Ajustes ═══════════════════════ */

/** Campos editables de un proveedor en Ajustes. hora "HH:MM"; whatsapp se normaliza a dígitos. */
export type DatosPedidoProveedor = {
  pedido_canal: CanalPedido;
  pedido_email: string | null;
  pedido_whatsapp: string | null;
  pedido_telefono: string | null;
  pedido_minimo: number | null;
  pedido_dias_reparto: number[] | null;
  pedido_hora_corte: string | null;
  pedido_notas: string | null;
  albaranes_por_email: boolean;
  pedible: boolean;
};

export type ProveedorAjustes = ProveedorPedido & {
  /** Productos activos del proveedor en compras_producto. */
  n_productos: number;
  /** De ellos, los que tocó alguna importación de catálogo (catalogo_en no nulo). */
  n_productos_catalogo: number;
};

export type ConfigPedidos = {
  /** PEDIDOS_BUZON_ALBARANES o null (Ajustes avisa de que falta). */
  buzon_albaranes: string | null;
  /** PEDIDOS_REMITENTE o RESEND_REMITENTE; null = el remitente por defecto de lib/correo.ts. */
  remitente: string | null;
  correo_configurado: boolean;
  ia_configurada: boolean;
};

export type AliasAprendido = {
  id: string;
  frase: string;
  producto_id: string;
  producto_nombre: string;
  proveedor_nombre: string | null;
  centro_id: string | null;
  centro_nombre: string | null;
  unidad: string | null;
  idioma: string | null;
  usos: number;
  ultimo_uso: string;
};

/** Alias tal como entra en el contexto de la IA. */
export type AliasContexto = {
  frase: string;
  producto_id: string;
  unidad: string | null;
  usos: number;
  centro_id: string | null;
};

/* ─── Importación de catálogo ─── */

/** Campos que se pueden leer de un catálogo. */
export const CAMPOS_CATALOGO = ["ref", "nombre", "formato", "unidad", "unidades_formato", "precio", "codigo_barras", "categoria"] as const;
export type CampoCatalogo = (typeof CAMPOS_CATALOGO)[number];
export const CAMPO_CATALOGO_TXT: Record<CampoCatalogo, string> = {
  ref: "Código del proveedor",
  nombre: "Nombre / descripción",
  formato: "Formato",
  unidad: "Unidad de venta",
  unidades_formato: "Unidades por formato",
  precio: "Precio (sin IVA)",
  codigo_barras: "Código de barras",
  categoria: "Categoría / familia",
};

/** Índice de columna (0-based) de cada campo en la hoja; null = no está. */
export type MapeoColumnas = Record<CampoCatalogo, number | null>;

/** Una fila del catálogo ya leída y convertida en el navegador. */
export type FilaCatalogo = {
  /** Nº de fila en la hoja (1-based, como la ve el usuario en Excel) para los errores. */
  fila: number;
  ref: string | null;
  nombre: string | null;
  formato: string | null;
  unidad: string | null;
  unidades_formato: number | null;
  precio: number | null;
  codigo_barras: string | null;
  categoria: string | null;
};

export type ErrorFilaCatalogo = { fila: number; ref: string | null; error: string };

export type DetalleImportacion = {
  cabeceras: string[];
  mapeo: MapeoColumnas;
  filas_archivo: number;
  /** Máx. 200 (el resto solo cuenta en «errores»). */
  errores_filas: ErrorFilaCatalogo[];
  avisos: string[];
  sin_cambios: number;
  cerrada: boolean;
  cerrada_en: string | null;
};

export type ImportacionCatalogo = {
  id: string;
  proveedor_id: string;
  archivo: string | null;
  filas: number;
  creados: number;
  actualizados: number;
  errores: number;
  detalle: DetalleImportacion | null;
  creado_en: string;
};

export type EntradaIniciarImportacion = {
  proveedor_id: string;
  archivo: string;
  cabeceras: string[];
  mapeo: MapeoColumnas;
  filas_archivo: number;
};

export type ResultadoTrozo = {
  creados: number;
  actualizados: number;
  sin_cambios: number;
  errores: ErrorFilaCatalogo[];
};

/* ═══════════════════════ Props de secciones y componentes ═══════════════════════
   Todos los ficheros de secciones/ y componentes/ llevan "use client" y `export default function`.
   Las props viven aquí porque cruzan constructores (PanelPedidos de B pinta las secciones de C;
   la ficha de C usa BuscadorProducto de B). */

/** Toast del panel. */
export type Avisar = (mensaje: string, tipo?: "ok" | "error") => void;

/** Lo que PanelPedidos pasa a toda sección de pestaña. */
export type PropsSeccionBase = {
  ctx: ContextoPedidos;
  /** Proveedores pedibles VIVOS (Ajustes los puede cambiar sin recargar la página). */
  proveedores: ProveedorPedido[];
  /** Centro elegido en el selector (recordado en localStorage «ped:centro»). */
  centroId: string;
  avisar: Avisar;
  /** Abre la ficha de un pedido (PanelPedidos la pinta encima de la pestaña). */
  abrirPedido: (pedidoId: string) => void;
};

export type PropsSecNuevo = PropsSeccionBase & {
  /** Sube cuando algo cambia un pedido (ficha): la tarjeta de borradores creados se actualiza. */
  version?: number;
};
export type PropsSecCatalogo = PropsSeccionBase;
export type PropsSecLista = PropsSeccionBase & {
  /** Sube cada vez que algo cambia un pedido (ficha, nuevo borrador): la lista se recarga. */
  version: number;
};
export type PropsSecFicha = {
  ctx: ContextoPedidos;
  proveedores: ProveedorPedido[];
  pedidoId: string;
  avisar: Avisar;
  /** Vuelve a la pestaña de antes. */
  cerrar: () => void;
  /** Avisa al panel de que el pedido cambió (sube `version` de la lista). */
  alCambiar: () => void;
};
export type PropsSecAjustes = {
  ctx: ContextoPedidos;
  proveedores: ProveedorPedido[];
  avisar: Avisar;
  /** Tras guardar un proveedor: el panel lo pone, lo cambia o lo quita (si deja de ser pedible). */
  alGuardarProveedor: (p: ProveedorPedido) => void;
};

/** Dictado continuo (Web Speech API) + campo de texto SIEMPRE editable. Controlado. */
export type PropsDictadoVoz = {
  valor: string;
  onCambio: (texto: string) => void;
  idioma: IdiomaDictado;
  onIdioma: (idioma: IdiomaDictado) => void;
  /** Cómo se ha compuesto el texto: solo voz, solo teclado o las dos (para compras_pedido.origen). */
  onOrigen?: (origen: "voz" | "texto" | "mixto") => void;
  desactivado?: boolean;
  placeholder?: string;
  /** Avisa de si el micro está escuchando (para que «Interpretar» pare antes de leer el texto). */
  onGrabando?: (grabando: boolean) => void;
  /** El componente deja aquí su control (terminar el dictado y leer el texto final). */
  control?: { current: ControlDictado | null };
};

/** Control del dictado para quien lo usa (Nuevo, antes de interpretar). */
export type ControlDictado = {
  /** Para el micro YA: lo provisional pasa al texto, lo que llegue después se ignora y devuelve el
      texto final y cómo se compuso. Sin grabar, devuelve el texto tal cual. */
  terminar: () => { texto: string; origen: "voz" | "texto" | "mixto" };
};

/** Revisión agrupada (sin identificar arriba, luego por proveedor) con fecha y notas por grupo. */
export type PropsRevisionLineas = {
  lineas: LineaRevision[];
  onLineas: (lineas: LineaRevision[]) => void;
  /** Clave: proveedor_id o SIN_PROVEEDOR. Si falta un grupo, se pinta con metaPorDefecto(). */
  meta: Record<string, MetaGrupo>;
  onMeta: (clave: string, meta: MetaGrupo) => void;
  proveedores: ProveedorPedido[];
  centroId: string;
  /** Catálogo del centro (para el buscador local). */
  catalogo: ProductoCatalogo[];
  hoy: string;
  /** Fecha que dijo el empleado (interpretación), por defecto para todos los grupos. */
  fechaDicha?: string | null;
  /** Notas generales que dijo el empleado (interpretación): por defecto en la nota de cada grupo. */
  notasDichas?: string | null;
  desactivado?: boolean;
};

/** Buscador de productos: filtra al momento el catálogo local y, con ≥ 2 letras y 300 ms de
    pausa, completa con buscarProductos (sin repetir producto_id). */
export type PropsBuscadorProducto = {
  centroId: string;
  /** Limita al proveedor (líneas de un pedido con proveedor). */
  proveedorId?: string | null;
  catalogo?: ProductoCatalogo[];
  onElegir: (p: ProductoCatalogo) => void;
  onCerrar?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
};

/** Selector del centro. Con un solo centro pinta su nombre sin desplegable. */
export type PropsSelectorCentro = {
  centros: Centro[];
  valor: string;
  onCambio: (centroId: string) => void;
};

/** Tabla pedido / albarán / factura con diferencias resaltadas, avisos y sobras. */
export type PropsTablaCotejo = {
  cotejo: CotejoDetalle;
  /** Líneas guardadas (para unidad/ref y para saber cuál está marcada «sustituido»). */
  lineas: LineaPedido[];
  /** true: enseña el interruptor «sustituido» en las líneas falta/sustituido. */
  editable: boolean;
  onSustituido?: (lineaId: string, sustituido: boolean) => void;
  ocupado?: boolean;
};

/** Importador de catálogo CSV/XLSX (lectura en el navegador, envío por trozos en serie). */
export type PropsImportadorCatalogo = {
  proveedor: ProveedorPedido;
  avisar: Avisar;
  onTerminado: (importacion: ImportacionCatalogo) => void;
  onCancelar: () => void;
};
