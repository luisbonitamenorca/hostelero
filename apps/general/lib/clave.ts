/**
 * Contraseñas: reglas comunes, textos de error compartidos y el generador de
 * contraseñas temporales. Sin "use client" ni nada de servidor a propósito:
 * lo importan el componente CampoClave (navegador) y las acciones de
 * servidor (reglas y textos), y así no se duplica nada.
 */

export const CLAVE_MIN = 8;
/** Supabase guarda la contraseña con bcrypt, que solo usa los primeros 72 bytes. */
export const CLAVE_MAX_BYTES = 72;

/** ¿Longitud aceptable? Mínimo en caracteres; máximo en bytes (una tilde ocupa 2). */
export function longitudValida(clave: string): boolean {
  return clave.length >= CLAVE_MIN && new TextEncoder().encode(clave).length <= CLAVE_MAX_BYTES;
}

export const MENSAJE_CLAVE_LONGITUD = `La contraseña necesita al menos ${CLAVE_MIN} caracteres (y no más de ${CLAVE_MAX_BYTES}).`;

/**
 * Supabase rechaza (weak_password) las contraseñas que aparecen en listas de
 * filtraciones (HaveIBeenPwned) o que son demasiado fáciles. Las que se le
 * ocurren a cualquiera suelen estar ahí: por eso se ofrece «Generar».
 */
export const MENSAJE_CLAVE_DEBIL =
  "Esa contraseña es demasiado fácil o aparece en filtraciones conocidas de internet. Pulsa «Generar» para crear una segura, o pon otra más larga (por ejemplo, tres palabras y un número).";

/**
 * Palabras para las contraseñas generadas: comunes, neutras, de 4 a 7 letras,
 * sin tildes ni eñes (se teclean igual en cualquier móvil) y sin repetidas.
 * 900 y pico palabras: tres al azar + 4 cifras dan unos 43 bits, de sobra
 * para una contraseña temporal que además no está en ninguna filtración.
 */
const PALABRAS: readonly string[] = [
  "abanico", "abeja", "abeto", "abrazo", "abrigo", "abril", "abuela", "abuelo", "acacia", "aceite", "acelga",
  "acero", "actor", "agenda", "agosto", "agua", "aguja", "aire", "ajedrez", "alambre", "alarma", "alba",
  "alce", "aldea", "alegre", "alga", "aliento", "altavoz", "alto", "alumno", "amable", "amapola", "amargo",
  "amigo", "ancho", "anchoa", "ancla", "anillo", "antena", "antiguo", "anzuelo", "apio", "apodo", "archivo",
  "arco", "ardilla", "arena", "armario", "aroma", "arpa", "arroyo", "arroz", "artista", "asado", "asiento",
  "astro", "atajo", "atlas", "aurora", "autor", "avena", "avenida", "avispa", "azada", "azotea", "azul",
  "azulejo", "bacalao", "baile", "bajo", "balanza", "balde", "ballena", "banco", "banda", "bandeja",
  "bandera", "baraja", "barca", "barco", "barniz", "barra", "barrica", "barril", "barrio", "barro", "bata",
  "batido", "batuta", "bazar", "bellota", "bici", "biombo", "bisonte", "blanco", "bloque", "blusa", "bocado",
  "bocata", "bocina", "bodega", "boina", "bolero", "bolsa", "bondad", "bordado", "borde", "bosque", "bota",
  "bote", "botella", "botijo", "boya", "brasa", "bravo", "brillo", "brindis", "brisa", "brocha", "broche",
  "bronce", "bruma", "buey", "bufanda", "buzo", "caballo", "cabello", "cable", "cacao", "cactus", "cadena",
  "caja", "cala", "calamar", "caldo", "calle", "calma", "cama", "camello", "camino", "camisa", "campana",
  "campo", "canal", "canario", "cancha", "candado", "canela", "canguro", "canica", "canoa", "cantera",
  "canto", "cantor", "capa", "caracol", "cardo", "carpa", "carpeta", "carreta", "carro", "carta", "cartel",
  "casa", "cascada", "casco", "castor", "cauce", "caudal", "cava", "cazo", "cazuela", "cebada", "cebolla",
  "cebra", "cedro", "celeste", "ceniza", "centro", "cepillo", "cereal", "cereza", "cerro", "cerveza", "cesta",
  "cetro", "chaleco", "charco", "chispa", "chiste", "choza", "chuleta", "cielo", "ciervo", "cifra", "cigarra",
  "cincel", "cine", "cinta", "circo", "ciruela", "cisne", "ciudad", "claro", "clavel", "clavo", "clima",
  "cobalto", "cobijo", "cobre", "coche", "cocido", "cocina", "cofre", "cohete", "colina", "collar", "colmena",
  "colono", "color", "columna", "comarca", "comedor", "cometa", "comino", "conejo", "cono", "copa", "coral",
  "corbata", "corcho", "cordel", "cordero", "coro", "corona", "corral", "cortijo", "cortina", "corto",
  "cosecha", "costa", "costero", "crema", "cristal", "cruce", "cuadra", "cuadro", "cuarzo", "cubeta", "cubo",
  "cuchara", "cuenta", "cuento", "cuerda", "cuervo", "cueva", "cumbre", "cuna", "curva", "dado", "dalia",
  "danza", "dardo", "decena", "dedal", "delta", "destino", "diadema", "diario", "dibujo", "dique", "disco",
  "doble", "docena", "domingo", "dorada", "dorado", "dorso", "ducha", "duende", "dulce", "duna", "encaje",
  "encanto", "enchufe", "encina", "enero", "enigma", "enorme", "equipo", "erizo", "escoba", "escudo",
  "esfera", "esmalte", "espejo", "espiral", "espuma", "establo", "estadio", "estante", "este", "estela",
  "estepa", "estuche", "etapa", "fachada", "falda", "fanal", "faro", "farol", "farola", "febrero", "fecha",
  "feliz", "feria", "ficha", "fideo", "fiel", "fiesta", "figura", "filete", "firme", "flan", "flauta",
  "flecha", "flor", "folio", "forja", "forma", "foto", "fragua", "frasco", "frase", "fregona", "freno",
  "fresa", "fresco", "fritura", "fruta", "fuego", "fuelle", "fuente", "fuerte", "fuerza", "funda", "gacela",
  "gafas", "gaita", "galleta", "gallo", "galope", "gamba", "ganso", "garaje", "garza", "gato", "gaviota",
  "gesto", "gigante", "girasol", "glaciar", "globo", "golf", "gorra", "gorro", "gracia", "grado", "granate",
  "grande", "granero", "granito", "granizo", "granja", "grano", "grifo", "grillo", "gris", "grulla", "grupo",
  "gruta", "guante", "guiso", "gusto", "haba", "hacha", "hada", "hamaca", "hangar", "harina", "haya",
  "hebilla", "helado", "helecho", "hermano", "hiedra", "hielo", "hierba", "hierro", "hilo", "himno", "hogar",
  "hoguera", "hoja", "hora", "horario", "hormiga", "horno", "hostal", "hotel", "hucha", "huella", "huerto",
  "humo", "humor", "idea", "idioma", "iguana", "imagen", "ingenio", "isla", "jade", "jaguar", "jalea",
  "jarra", "jaula", "jersey", "jinete", "jirafa", "jota", "joven", "joya", "juego", "jueves", "jugoso",
  "juguete", "julio", "junco", "junio", "justo", "kayak", "kiwi", "koala", "ladera", "lado", "lagarto",
  "lago", "laguna", "lana", "lancha", "largo", "latido", "latitud", "laurel", "lavanda", "lazo", "leal",
  "lechuga", "lechuza", "lector", "legado", "lema", "lente", "lenteja", "lento", "letra", "leyenda",
  "libreta", "libro", "liebre", "lienzo", "ligero", "lila", "lima", "limpio", "lince", "lirio", "listo",
  "llanura", "llave", "llavero", "lluvia", "lobo", "logro", "loma", "lomo", "loro", "loseta", "lubina",
  "lucero", "luna", "lunar", "lunes", "lupa", "madeja", "madera", "maestro", "magia", "mago", "maleta",
  "malla", "malva", "mando", "manga", "mango", "manta", "mantel", "manzana", "mapa", "mapache", "maqueta",
  "marco", "marea", "marfil", "marino", "martes", "marzo", "masa", "mascota", "mayo", "mazo", "medalla",
  "medusa", "mensaje", "menta", "menudo", "mercado", "merluza", "mesa", "meseta", "meta", "metal", "metro",
  "miel", "migas", "millar", "mimbre", "minuto", "mirador", "mirlo", "mitad", "mochila", "modelo", "moderno",
  "molde", "molino", "momento", "moneda", "monte", "morado", "morsa", "mosaico", "mostaza", "motivo", "moto",
  "motor", "mueble", "muelle", "mural", "muro", "museo", "musgo", "naipe", "naranja", "nata", "natilla",
  "nave", "nevera", "nido", "niebla", "nieve", "nivel", "noble", "noche", "noria", "norte", "nota", "novela",
  "nube", "nudo", "nuevo", "nuez", "nutria", "oasis", "obra", "ocaso", "ocelote", "ocre", "octubre", "oeste",
  "oficio", "oliva", "olivo", "olla", "olmo", "onda", "orden", "orilla", "oscuro", "ostra", "oveja", "paella",
  "paisaje", "pala", "palabra", "palanca", "palco", "paleta", "palma", "palmera", "paloma", "panal", "panda",
  "pandero", "panel", "pantano", "pantera", "papel", "parada", "pared", "pareja", "parque", "partido",
  "pasaje", "paseo", "pasillo", "pasta", "pastel", "pastor", "patata", "patio", "pato", "pauta", "pavo",
  "pedal", "peine", "pelota", "peonza", "pepino", "pepita", "pera", "perdiz", "perejil", "perfil", "perla",
  "perro", "pesca", "piano", "picante", "piedra", "pieza", "pijama", "pila", "pilar", "piloto", "pincel",
  "pincho", "pino", "pintor", "pintura", "pinza", "pipa", "pirata", "piscina", "piso", "pista", "pizarra",
  "plan", "plancha", "planeta", "planta", "plata", "plato", "playa", "plaza", "pliego", "pluma", "podio",
  "poema", "poeta", "polar", "polea", "polilla", "pollo", "pomelo", "poncho", "popa", "portal", "posada",
  "postal", "postre", "potro", "pozo", "pradera", "prado", "premio", "prenda", "primo", "prisma", "proa",
  "propina", "puchero", "pueblo", "puente", "puerro", "puerta", "puerto", "pulpo", "pulsera", "pulso", "puma",
  "punta", "punto", "puro", "queso", "quilla", "quiosco", "radar", "radio", "rama", "ramo", "rampa", "rana",
  "ranura", "raqueta", "rastro", "rayo", "rayuela", "recado", "receta", "recreo", "recta", "reflejo",
  "refugio", "regalo", "regla", "reina", "reino", "relieve", "reloj", "remo", "reserva", "resorte", "resta",
  "retrato", "revista", "ribera", "risa", "risco", "ritmo", "rizo", "roble", "roca", "rodillo", "rojo",
  "rombo", "romero", "rosa", "rosal", "rotonda", "rubio", "rueda", "ruleta", "rumba", "rumbo", "rural",
  "ruta", "sabana", "sabio", "sabor", "sabroso", "saco", "salado", "salero", "salina", "salsa", "salto",
  "salud", "salvia", "sapo", "sardina", "sauce", "sello", "selva", "semana", "semilla", "senda", "sendero",
  "sepia", "sereno", "serie", "seta", "sidra", "sierra", "siesta", "siglo", "silbato", "silla", "simple",
  "sirena", "sitio", "sobre", "socio", "solapa", "solar", "sombra", "sonata", "sonda", "sonido", "sonrisa",
  "sopa", "sorbete", "suave", "suela", "suelo", "suerte", "suma", "surf", "susurro", "tabla", "tablero",
  "taladro", "talla", "taller", "tambor", "tango", "tapa", "tapiz", "tarde", "tarima", "tarjeta", "tarta",
  "taxi", "taza", "teatro", "techo", "tejado", "telar", "tenedor", "tenis", "ternera", "terraza", "tesoro",
  "tetera", "tiempo", "tienda", "tierno", "tierra", "tiesto", "tigre", "tijera", "timbre", "tinaja", "tinta",
  "tintero", "tiza", "toalla", "toldo", "tomate", "tomillo", "tonel", "topacio", "topo", "torneo", "toro",
  "torre", "tortuga", "total", "trazo", "tren", "trigo", "trineo", "triple", "trofeo", "trompo", "tronco",
  "trucha", "trueno", "trufa", "tuerca", "tundra", "turbina", "turno", "umbral", "urbano", "urraca",
  "vajilla", "valla", "valle", "valor", "vals", "vapor", "varita", "vasija", "vaso", "vecino", "vector",
  "vela", "velero", "veleta", "venado", "ventana", "verano", "verbena", "verde", "vereda", "verja", "verso",
  "vestido", "viaje", "viajero", "vidrio", "viento", "viernes", "vinagre", "vinilo", "vino", "violeta",
  "visera", "visita", "volante", "yate", "yegua", "yeso", "yogur", "yunque", "zafiro", "zapato", "zarza",
  "zorro", "zumo",
];

/**
 * Entero uniforme en [0, n) con crypto.getRandomValues. Sin sesgo de módulo:
 * los valores del último tramo incompleto de 2^32 se descartan y se repite
 * el sorteo (rechazo), en vez de hacer `% n` a pelo.
 */
function aleatorio(n: number): number {
  const limite = Math.floor(0x100000000 / n) * n;
  const caja = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(caja);
    if (caja[0] < limite) return caja[0] % n;
  }
}

const conMayuscula = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

/**
 * Contraseña fácil de dictar y teclear en el móvil: tres palabras distintas
 * con mayúscula inicial, separadas por guiones, y 4 cifras al final
 * (p. ej. «Mesa-Olivo-Faro-4821»). Trae mayúsculas, minúsculas, cifras y
 * símbolo, así que pasa cualquier regla de «tipos de carácter».
 */
export function generarClave(): string {
  const elegidas: string[] = [];
  while (elegidas.length < 3) {
    const palabra = PALABRAS[aleatorio(PALABRAS.length)];
    if (!elegidas.includes(palabra)) elegidas.push(palabra);
  }
  const cifras = String(aleatorio(10000)).padStart(4, "0");
  return [...elegidas.map(conMayuscula), cifras].join("-");
}
