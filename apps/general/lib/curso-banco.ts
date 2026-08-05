// Banco de preguntas del examen de Manipulador de Alimentos (63 preguntas).
// SOLO SERVIDOR: contiene las respuestas correctas. No importar nunca desde un
// componente cliente — el cliente recibe las preguntas sin la solucion via
// /api/publico/curso/examen, y la correccion la hace el route handler.

export type PreguntaBanco = {
  q: string;
  options: string[];
  correct: number;
};

export const BANCO: PreguntaBanco[] = [
  // MÓDULO 1: NORMATIVA
  {
    q: "¿Quién es responsable de garantizar la formación del manipulador de alimentos?",
    options: ["La administración pública", "La empresa alimentaria", "El propio trabajador", "Sanidad de las Islas Baleares"],
    correct: 1
  },
  {
    q: "Desde el RD 109/2010, el carnet oficial de manipulador de alimentos:",
    options: ["Sigue vigente y lo emite Sanidad", "Ya no existe como tal; se sustituye por el certificado de formación", "Es opcional para las empresas", "Solo se necesita en cocina"],
    correct: 1
  },
  {
    q: "¿Cuál de estas normas es la base europea de la higiene alimentaria?",
    options: ["RD 1021/2022", "Reglamento (CE) 852/2004", "Ley 17/2009", "RD 109/2010"],
    correct: 1
  },
  {
    q: "¿Cada cuánto tiempo se recomienda renovar la formación de manipulador?",
    options: ["Cada año", "Cada 4 años", "Cada 10 años", "Solo una vez en la vida"],
    correct: 1
  },
  {
    q: "Un camarero que sirve platos pero no cocina, ¿necesita formación de manipulador?",
    options: ["No, porque no toca la comida directamente", "Sí, porque participa en el servicio de alimentos", "Solo si trabaja más de 6 meses", "Solo si tiene contacto con productos crudos"],
    correct: 1
  },

  // MÓDULO 2: PELIGROS
  {
    q: "¿Cuáles son los tres tipos de peligros alimentarios?",
    options: ["Frío, calor y humedad", "Biológicos, químicos y físicos", "Visibles, invisibles y mixtos", "Bacterias, virus y hongos"],
    correct: 1
  },
  {
    q: "¿Qué necesitan las bacterias para multiplicarse?",
    options: ["Solo agua", "Alimento, humedad, temperatura adecuada y tiempo", "Solo calor", "Solo oscuridad"],
    correct: 1
  },
  {
    q: "El Anisakis es:",
    options: ["Una bacteria del marisco", "Un parásito que se encuentra en el pescado crudo", "Un virus de las aves", "Un moho de la fruta"],
    correct: 1
  },
  {
    q: "Para evitar el Anisakis, el pescado a consumir crudo o casi crudo debe:",
    options: ["Lavarse con vinagre", "Congelarse a -20 ºC durante al menos 24 horas", "Salarse durante 1 hora", "Hervirse 5 minutos"],
    correct: 1
  },
  {
    q: "¿Cuál de estos es un peligro químico?",
    options: ["Una mosca en la sopa", "Restos de detergente mal aclarado en una sartén", "Una bacteria", "Un cabello"],
    correct: 1
  },
  {
    q: "Un cristal roto cerca de los alimentos es un peligro de tipo:",
    options: ["Biológico", "Químico", "Físico", "No es un peligro si es pequeño"],
    correct: 2
  },
  {
    q: "La Salmonella se asocia frecuentemente con:",
    options: ["Frutas y verduras crudas", "Huevo crudo, mayonesa casera y aves", "El pan", "Los lácteos pasteurizados"],
    correct: 1
  },
  {
    q: "¿Cuál de estos productos NO debe servirse a embarazadas o personas inmunodeprimidas sin precaución?",
    options: ["Pan tostado", "Quesos sin pasteurizar y embutidos crudos (riesgo de Listeria)", "Verdura cocida", "Arroz blanco"],
    correct: 1
  },

  // MÓDULO 3: HIGIENE PERSONAL
  {
    q: "¿Cuándo debes lavarte las manos?",
    options: ["Solo al llegar al trabajo", "Solo después de ir al baño", "Tras el baño, antes de manipular, al cambiar de tarea, tras tocar productos crudos, tras estornudar...", "Solo si las manos están visiblemente sucias"],
    correct: 2
  },
  {
    q: "¿Cuánto debe durar un lavado correcto de manos?",
    options: ["5 segundos", "Entre 40 y 60 segundos", "Más de 5 minutos", "Da igual, lo importante es que entre agua"],
    correct: 1
  },
  {
    q: "¿Los guantes sustituyen al lavado de manos?",
    options: ["Sí, si son de látex", "No: hay que lavarse antes de ponerlos y cambiarlos al cambiar de tarea", "Solo en cocina caliente", "Solo si son nuevos"],
    correct: 1
  },
  {
    q: "Si tienes una pequeña herida en el dedo, debes:",
    options: ["Seguir trabajando sin más", "Cubrirla con apósito impermeable visible y, encima, un guante", "Solo lavarla con agua", "Vendarla con un trapo de cocina"],
    correct: 1
  },
  {
    q: "Si tienes diarrea o vómitos, debes:",
    options: ["Trabajar con guantes y mascarilla", "No manipular alimentos y comunicarlo a tu responsable", "Tomar medicación y seguir trabajando", "Lavarte las manos más a menudo"],
    correct: 1
  },
  {
    q: "Las uñas del manipulador deben estar:",
    options: ["Largas y pintadas para mejor presencia", "Cortas, limpias y sin pintar", "Cortas pero con esmalte transparente", "Da igual, lo importante es el guante"],
    correct: 1
  },
  {
    q: "Durante la manipulación de alimentos, las joyas (anillos, relojes, pulseras):",
    options: ["Se permiten si son de oro", "No se deben llevar", "Solo se prohíben los anillos", "Se permiten bajo el guante"],
    correct: 1
  },
  {
    q: "Después de tocar el móvil en zona de manipulación, ¿qué debes hacer?",
    options: ["Nada, no contamina", "Lavarte las manos antes de volver al alimento", "Limpiar el móvil con lejía", "Cambiar de uniforme"],
    correct: 1
  },

  // MÓDULO 4: LIMPIEZA Y PLAGAS
  {
    q: "Limpieza y desinfección son:",
    options: ["Lo mismo", "Procesos distintos pero complementarios", "Sinónimos en hostelería", "La desinfección no es necesaria si limpias bien"],
    correct: 1
  },
  {
    q: "¿En qué orden se realiza el protocolo correcto?",
    options: ["Desinfección, limpieza, aclarado", "Limpieza, aclarado, desinfección, aclarado, secado", "Solo aclarado", "Desinfección, aclarado, limpieza"],
    correct: 1
  },
  {
    q: "¿Se puede mezclar lejía con amoniaco?",
    options: ["Sí, limpia más", "No, genera gases tóxicos peligrosos", "Solo en pequeñas cantidades", "Sí, si se diluye con agua"],
    correct: 1
  },
  {
    q: "Los productos de limpieza deben almacenarse:",
    options: ["Junto a los alimentos para tenerlos a mano", "En lugar separado, identificados, en su envase original", "En botellas de agua reutilizadas", "En la cámara fría"],
    correct: 1
  },
  {
    q: "Si detectas signos de plaga (excrementos, insectos), debes:",
    options: ["Aplicar insecticida doméstico", "Comunicarlo al responsable y a la empresa de DDD", "Ignorarlo si es algo puntual", "Limpiar y no decir nada"],
    correct: 1
  },
  {
    q: "Los cubos de basura en zona de manipulación deben tener:",
    options: ["Tapa accionada por pedal y bolsa de un solo uso", "Tapa abierta para tirar rápido", "Estar siempre llenos para optimizar bolsas", "Estar junto a los alimentos preparados"],
    correct: 0
  },
  {
    q: "¿Con qué hay que secar las manos tras lavarse?",
    options: ["Con un trapo común de cocina", "Con papel desechable de un solo uso", "Al aire moviéndolas", "Con el delantal"],
    correct: 1
  },

  // MÓDULO 5: CADENA DE FRÍO
  {
    q: "La 'zona de peligro' de las temperaturas es:",
    options: ["Por debajo de 0 ºC", "Entre 5 ºC y 65 ºC", "Por encima de 100 ºC", "Solo a temperatura ambiente"],
    correct: 1
  },
  {
    q: "La temperatura recomendada de refrigeración es:",
    options: ["10–15 ºC", "0–4 ºC", "Cualquier valor por debajo de 20 ºC", "-18 ºC"],
    correct: 1
  },
  {
    q: "La temperatura de congelación debe ser:",
    options: ["0 ºC o menos", "-5 ºC", "≤ -18 ºC", "Solo importa que esté por debajo de 0"],
    correct: 2
  },
  {
    q: "Para que el cocinado sea seguro, en el centro del alimento se deben alcanzar:",
    options: ["50 ºC", "≥ 70 ºC durante al menos 2 minutos", "100 ºC siempre", "Da igual la temperatura del centro"],
    correct: 1
  },
  {
    q: "¿Cuál es un método correcto de descongelación?",
    options: ["Sobre la encimera a temperatura ambiente", "En la cámara de refrigeración", "En agua caliente del grifo", "Al sol"],
    correct: 1
  },
  {
    q: "Un alimento descongelado en crudo:",
    options: ["Se puede volver a congelar sin problema", "No debe volver a congelarse en crudo (sí ya cocinado)", "Solo se puede congelar si se hace rápido", "Se conserva 1 mes en la nevera"],
    correct: 1
  },
  {
    q: "El sistema FIFO significa:",
    options: ["Lo último que entra es lo primero que sale", "Lo primero que entra es lo primero que sale", "Solo aplica a congelados", "First Inspection First Output"],
    correct: 1
  },
  {
    q: "En una cámara mixta, los alimentos crudos se colocan:",
    options: ["Encima de los cocinados", "Debajo de los cocinados o productos listos para consumo", "Da igual", "Junto a los productos lácteos"],
    correct: 1
  },
  {
    q: "Tras cocinar un alimento que se va a refrigerar, hay que:",
    options: ["Esperar a que se enfríe a temperatura ambiente y luego meterlo a la cámara", "Enfriarlo rápido (de 65 a 10 ºC en menos de 2 horas)", "Meterlo caliente directamente al congelador", "Dejarlo toda la noche fuera"],
    correct: 1
  },
  {
    q: "La diferencia entre 'fecha de caducidad' y 'consumo preferente' es:",
    options: ["Son sinónimos", "Caducidad: pasada la fecha no se puede consumir; consumo preferente: puede haber perdido propiedades pero no es peligroso", "La caducidad es solo para los lácteos", "Consumo preferente es más estricto que caducidad"],
    correct: 1
  },
  {
    q: "Al recibir mercancía refrigerada, ¿qué debes verificar?",
    options: ["Solo el precio", "Temperatura del transporte, estado del envase, etiquetado y fecha de caducidad", "Solo que llegue antes del servicio", "Solo el peso"],
    correct: 1
  },

  // MÓDULO 6: CONTAMINACIÓN CRUZADA
  {
    q: "La contaminación cruzada es:",
    options: ["La que se produce en cruceros", "La transferencia de contaminantes de un alimento, superficie o manipulador a otro alimento", "Solo se da entre crudos y cocinados", "Solo afecta a alérgenos"],
    correct: 1
  },
  {
    q: "Para cortar pollo crudo y luego ensalada, lo correcto es:",
    options: ["Usar la misma tabla, aclarada con agua", "Usar tablas/utensilios distintos o limpiar y desinfectar entre uno y otro", "Cortar primero la ensalada y luego el pollo", "Usar guantes y la misma tabla"],
    correct: 1
  },
  {
    q: "El código de colores de las tablas: la tabla ROJA se usa para:",
    options: ["Verduras", "Pescado", "Carne cruda", "Pan"],
    correct: 2
  },
  {
    q: "El código de colores de las tablas: la tabla AZUL se usa para:",
    options: ["Pescado", "Pollo", "Frutas", "Lácteos"],
    correct: 0
  },
  {
    q: "El código de colores de las tablas: la tabla VERDE se usa para:",
    options: ["Carne", "Frutas y verduras", "Pescado cocinado", "Productos lácteos"],
    correct: 1
  },
  {
    q: "Para evitar contaminación cruzada por alérgenos:",
    options: ["Da igual mientras se cocine bien", "Usar utensilios exclusivos, evitar mismo aceite, separar zona de elaboración", "Solo importa avisar al cliente", "Basta con limpiar con agua"],
    correct: 1
  },
  {
    q: "Si te cambias de tarea (de pescado crudo a montar postres), ¿qué haces?",
    options: ["Sigues con los mismos guantes", "Te lavas las manos, cambias guantes y posiblemente delantal", "Solo te aclaras las manos", "No es necesario hacer nada"],
    correct: 1
  },

  // MÓDULO 7: ALÉRGENOS
  {
    q: "¿Cuántos alérgenos son de declaración obligatoria según el Reglamento UE 1169/2011?",
    options: ["8", "10", "14", "20"],
    correct: 2
  },
  {
    q: "¿Cuál de estos NO está entre los 14 alérgenos obligatorios?",
    options: ["Gluten", "Cacahuetes", "Tomate", "Apio"],
    correct: 2
  },
  {
    q: "Los sulfitos están presentes principalmente en:",
    options: ["Carnes", "Vinos, vinagres y conservas", "Lácteos", "Pan"],
    correct: 1
  },
  {
    q: "Si un cliente declara alergia, lo correcto es:",
    options: ["Decirle que cualquier plato vale", "Tomarlo muy en serio, comunicarlo a cocina, preparar el plato con utensilios limpios y servir con precaución", "Darle el plato más simple sin más", "No servirle nada"],
    correct: 1
  },
  {
    q: "Diferencia entre alergia e intolerancia:",
    options: ["Son sinónimos", "Alergia: respuesta inmunitaria, puede ser grave incluso con trazas. Intolerancia: dificultad digestiva, suele depender de la cantidad", "La alergia solo afecta a niños", "La intolerancia es siempre peor"],
    correct: 1
  },
  {
    q: "La anafilaxia:",
    options: ["Es una alergia leve", "Es una reacción alérgica grave que puede ser mortal, requiere llamar al 112 inmediatamente", "Solo causa picor", "Solo se da con cacahuetes"],
    correct: 1
  },
  {
    q: "La información de alérgenos al cliente:",
    options: ["No es obligatoria si el restaurante es pequeño", "Debe estar disponible de forma escrita y/o oral, accesible al cliente que la pida", "Solo se da si hay quejas", "Solo aplica a productos envasados"],
    correct: 1
  },
  {
    q: "Si no estás seguro de los alérgenos de un plato y un cliente te pregunta:",
    options: ["Dices 'creo que no lleva' para no preocuparle", "Preguntas a cocina antes de servir; nunca des información sin verificar", "Lo sirves y luego avisas", "Le pides al cliente que decida"],
    correct: 1
  },

  // MÓDULO 8: APPCC Y TRAZABILIDAD
  {
    q: "APPCC significa:",
    options: ["Asociación Profesional de Cocineros", "Análisis de Peligros y Puntos de Control Crítico", "Aplicación de Procedimientos de Control de Calidad", "Plan de Cocina"],
    correct: 1
  },
  {
    q: "¿Qué es un PCC (Punto de Control Crítico)?",
    options: ["Un día crítico de mucho trabajo", "Una fase del proceso donde el control es esencial para evitar un peligro", "Un puesto de trabajo", "Un protocolo de limpieza"],
    correct: 1
  },
  {
    q: "La trazabilidad permite:",
    options: ["Cocinar más rápido", "Seguir el rastro de un alimento a lo largo de las fases de producción y distribución", "Reducir costes de proveedores", "Mejorar el sabor"],
    correct: 1
  },
  {
    q: "En la práctica diaria, la trazabilidad implica:",
    options: ["No es necesaria en hostelería", "Conservar albaranes, no retirar etiquetas, etiquetar lo que se trasvase con producto/lote/fecha", "Solo identificar al cliente", "Llevar un libro de visitas"],
    correct: 1
  },

  // MÓDULO 9: PARTICULARIDADES BONITA MENORCA
  {
    q: "¿Por qué los sulfitos son relevantes en una bodega como Binifadet?",
    options: ["No son relevantes", "Son alérgenos de declaración obligatoria cuando superan 10 mg/L (caso de todos los vinos comerciales)", "Solo afectan al sabor", "Solo son relevantes en vinos dulces"],
    correct: 1
  },
  {
    q: "El arroz cocido (importante en Casa Tirant) requiere precaución porque:",
    options: ["Se quema fácilmente", "Es propenso a Bacillus cereus si no se enfría rápido y se mantiene mal", "No tiene riesgo alguno", "Solo si se usa arroz integral"],
    correct: 1
  },
  {
    q: "Los cubitos de hielo de las máquinas de barra:",
    options: ["No son alimentos", "Son alimentos y deben manipularse con pinza/cuchara, nunca con la mano o el vaso", "Se cogen con la mano si está limpia", "No requieren limpieza de la máquina"],
    correct: 1
  },
  {
    q: "En Bonita Menorca, una avería en una cámara frigorífica debe:",
    options: ["Esperar al día siguiente para avisar", "Comunicarse de inmediato al responsable y/o al equipo de mantenimiento (vía la app de partes)", "No es problema del manipulador", "Avisar solo si afecta al servicio"],
    correct: 1
  },
  {
    q: "Las mayonesas y alioli con huevo crudo:",
    options: ["Son seguras siempre", "Son producto de riesgo (Salmonella); idealmente usar huevo pasteurizado o producto comercial", "Se conservan 1 semana", "Solo son seguras en invierno"],
    correct: 1
  }
];
