// Contenido del curso de Manipulador de Alimentos — 9 módulos.
// Portado literal del front legado (bonita-formacion-manipulador-alimentos).
// Basado en: RD 1021/2022, Reglamento (CE) 852/2004, UE 1169/2011.

export type ModuloCurso = {
  id: number;
  title: string;
  eyebrow: string;
  description: string;
  content: string;
};

export const MODULOS: ModuloCurso[] = [
  {
    id: 1,
    title: "Introducción y normativa",
    eyebrow: "Módulo 1 de 9",
    description: "Por qué la formación de manipulador es obligatoria y qué dice la ley.",
    content: `
      <div class="content-block">
        <h2>¿Qué es un manipulador de alimentos?</h2>
        <p>Un <strong>manipulador de alimentos</strong> es toda persona que, por su actividad laboral, tiene contacto directo con los alimentos durante cualquier fase de su preparación, fabricación, transformación, elaboración, envasado, almacenamiento, transporte, distribución, venta, suministro o servicio.</p>
        <p>En Bonita Menorca, esto incluye prácticamente a todo el personal de los restaurantes (Binifadet, Tamarindos, Casa Tirant, El Bar), del equipo de cocina central, de producción de bodega y de tienda y visitas.</p>

        <div class="callout">
          <div class="label">Importante</div>
          <p>No importa si tu contacto con el alimento es directo (cocinero) o indirecto (camarero, personal de limpieza de zonas de manipulación). La normativa te aplica igual.</p>
        </div>

        <h2>Marco normativo aplicable</h2>
        <p>La formación obligatoria de los manipuladores de alimentos se rige por la siguiente normativa, en orden jerárquico:</p>

        <table class="data-table">
          <thead>
            <tr><th style="width: 35%;">Norma</th><th>Qué establece</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Reglamento (CE) 852/2004</strong></td>
              <td>Norma europea base. Obliga a las empresas alimentarias a garantizar la formación de sus manipuladores (Anexo II, Capítulo XII).</td>
            </tr>
            <tr>
              <td><strong>Reglamento (UE) 1169/2011</strong></td>
              <td>Información alimentaria al consumidor. Obliga a informar sobre los 14 alérgenos.</td>
            </tr>
            <tr>
              <td><strong>RD 109/2010</strong></td>
              <td>Suprime el "carnet" oficial y traslada la responsabilidad formativa a la empresa.</td>
            </tr>
            <tr>
              <td><strong>RD 1021/2022</strong></td>
              <td>Norma actual sobre higiene en establecimientos de comercio al por menor (incluye hostelería). Deroga normas sectoriales anteriores.</td>
            </tr>
            <tr>
              <td><strong>Ley 1/2025</strong></td>
              <td>Prevención de las pérdidas y el desperdicio alimentario en hostelería y restauración.</td>
            </tr>
          </tbody>
        </table>

        <h2>¿Quién es responsable de la formación?</h2>
        <p>Desde la entrada en vigor del RD 109/2010, la responsabilidad de la formación es de la <strong>empresa alimentaria</strong>, no de la administración. Esto significa que <em>Bonita Menorca SL</em> es responsable de:</p>
        <ul>
          <li>Garantizar que todo el personal tenga formación adecuada al puesto.</li>
          <li>Documentar dicha formación.</li>
          <li>Acreditarla ante una inspección sanitaria.</li>
          <li>Mantener la formación actualizada (recomendable cada 4 años).</li>
        </ul>

        <div class="callout warning">
          <div class="label">Inspección de Sanidad</div>
          <p>En caso de inspección, deberás poder mostrar tu certificado de formación. Las multas a la empresa por personal sin formación acreditada pueden ser cuantiosas.</p>
        </div>

        <h2>Objetivos de este curso</h2>
        <ol>
          <li>Conocer los peligros alimentarios y cómo prevenirlos.</li>
          <li>Aplicar buenas prácticas de higiene personal y de manipulación.</li>
          <li>Identificar los 14 alérgenos y comunicarlos correctamente al cliente.</li>
          <li>Comprender los principios del APPCC y la trazabilidad.</li>
          <li>Aplicar las particularidades de los establecimientos de Bonita Menorca.</li>
        </ol>
      </div>
    `
  },

  {
    id: 2,
    title: "Peligros alimentarios",
    eyebrow: "Módulo 2 de 9",
    description: "Tres tipos de peligros que pueden contaminar los alimentos y enfermar al cliente.",
    content: `
      <div class="content-block">
        <h2>Tres tipos de peligros</h2>
        <p>Un peligro alimentario es cualquier agente que, presente en un alimento, pueda causar daño a la salud del consumidor. Existen tres categorías principales:</p>

        <h3>1. Peligros biológicos</h3>
        <p>Son los más frecuentes y los responsables de la mayoría de las toxiinfecciones alimentarias. Incluyen:</p>
        <ul>
          <li><strong>Bacterias:</strong> Salmonella, Listeria monocytogenes, E. coli, Campylobacter, Staphylococcus aureus, Clostridium...</li>
          <li><strong>Virus:</strong> Norovirus, Hepatitis A.</li>
          <li><strong>Parásitos:</strong> Anisakis (en pescado crudo), Toxoplasma.</li>
          <li><strong>Hongos y mohos:</strong> productores de micotoxinas.</li>
        </ul>

        <div class="callout">
          <div class="label">Las bacterias necesitan 4 cosas para multiplicarse</div>
          <p><strong>1) Alimento</strong> (especialmente proteínas), <strong>2) Humedad</strong>, <strong>3) Temperatura</strong> entre 5 ºC y 65 ºC (zona de peligro) y <strong>4) Tiempo</strong>. Si controlas al menos uno de estos cuatro factores, frenas la multiplicación.</p>
        </div>

        <h3>Patógenos clave en hostelería mediterránea</h3>
        <table class="data-table">
          <thead>
            <tr><th>Patógeno</th><th>Alimentos de riesgo</th><th>Síntomas</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>Salmonella</strong></td><td>Huevo crudo, mayonesa casera, aves</td><td>Diarrea, fiebre, vómitos (12-72h)</td></tr>
            <tr><td><strong>Anisakis</strong></td><td>Pescado crudo, marinado, ahumado en frío</td><td>Dolor abdominal severo, alergia</td></tr>
            <tr><td><strong>Listeria</strong></td><td>Quesos sin pasteurizar, embutidos, pescado ahumado</td><td>Grave en embarazadas e inmunodeprimidos</td></tr>
            <tr><td><strong>Vibrio</strong></td><td>Marisco crudo, especialmente ostras</td><td>Gastroenteritis</td></tr>
            <tr><td><strong>Norovirus</strong></td><td>Marisco bivalvo, alimentos manipulados por persona enferma</td><td>Vómitos, diarrea (24-48h)</td></tr>
          </tbody>
        </table>

        <div class="callout warning">
          <div class="label">Anisakis — obligación legal</div>
          <p>Todo pescado destinado a consumo crudo, marinado, en escabeche, ahumado en frío o "casi crudo" (boquerones, ceviche, sushi, sashimi, tartar...) <strong>debe congelarse a -20 ºC durante al menos 24 horas</strong> antes de servirse. En Casa Tirant, donde trabajamos con pescado fresco, este protocolo es imprescindible.</p>
        </div>

        <h3>2. Peligros químicos</h3>
        <ul>
          <li><strong>Productos de limpieza</strong> mal almacenados o mal aclarados.</li>
          <li><strong>Plaguicidas</strong> en frutas y verduras.</li>
          <li><strong>Metales pesados</strong> (mercurio en pescado azul grande, plomo).</li>
          <li><strong>Migración de envases</strong> (plásticos no aptos para alimentación, latas oxidadas).</li>
          <li><strong>Aceites quemados</strong> reutilizados (acroleína).</li>
          <li><strong>Sulfitos</strong> en vino y otros conservantes (también son alérgenos).</li>
        </ul>

        <h3>3. Peligros físicos</h3>
        <p>Son objetos extraños que pueden caer en el alimento:</p>
        <ul>
          <li>Cristales rotos, esquirlas de metal.</li>
          <li>Trozos de plástico o madera.</li>
          <li>Pelos, uñas, joyas.</li>
          <li>Restos de envases (grapas, plásticos).</li>
          <li>Insectos, piedras.</li>
        </ul>

        <div class="callout success">
          <div class="label">Buena práctica</div>
          <p>No uses joyas, anillos ni relojes durante la manipulación. Lleva el pelo recogido. Si rompes un vaso o un plato, retira <em>todos</em> los alimentos próximos antes de servir nada más.</p>
        </div>
      </div>
    `
  },

  {
    id: 3,
    title: "Higiene personal",
    eyebrow: "Módulo 3 de 9",
    description: "Tu higiene es la primera barrera contra la contaminación.",
    content: `
      <div class="content-block">
        <h2>El manipulador como vehículo de contaminación</h2>
        <p>El manipulador es la <strong>fuente de contaminación más frecuente</strong> en hostelería. Tu cuerpo, tu ropa y tus hábitos pueden trasladar microorganismos al alimento. Por eso la higiene personal no es una recomendación: es una obligación legal.</p>

        <h2>Lavado de manos</h2>
        <p>Es la medida higiénica más importante. Las manos deben lavarse:</p>
        <ul>
          <li>Al incorporarse al puesto de trabajo.</li>
          <li>Después de ir al baño (siempre).</li>
          <li>Después de toser, estornudar, sonarse, tocarse el pelo o la cara.</li>
          <li>Después de manipular productos crudos (carne, pescado, huevo, vegetales sin lavar) y antes de tocar productos listos para consumo.</li>
          <li>Después de manipular basura o productos de limpieza.</li>
          <li>Después de fumar, comer o beber.</li>
          <li>Después de usar el móvil.</li>
          <li>Tras cualquier interrupción del trabajo.</li>
        </ul>

        <h3>Técnica correcta de lavado (40-60 segundos)</h3>
        <ol>
          <li>Mojarse las manos con agua templada.</li>
          <li>Aplicar jabón bactericida.</li>
          <li>Frotar palmas, dorsos, entre los dedos, dorso de los dedos contra la palma opuesta.</li>
          <li>Frotar pulgares y yemas en círculos.</li>
          <li>Limpiar uñas y muñecas.</li>
          <li>Aclarar bien con agua.</li>
          <li>Secar con papel desechable de un solo uso (nunca con trapos).</li>
          <li>Cerrar el grifo con el papel si no es de pedal o sensor.</li>
        </ol>

        <div class="callout warning">
          <div class="label">Guantes ≠ excusa para no lavarse</div>
          <p>Los guantes no sustituyen al lavado de manos. Hay que lavarse las manos antes de ponerlos y cambiarlos cada vez que se cambien de tarea o se contaminen. Los guantes mal usados son peor que las manos limpias.</p>
        </div>

        <h2>Estado de salud</h2>
        <p>Si presentas alguno de estos síntomas, <strong>no debes manipular alimentos</strong> y debes comunicarlo a tu responsable inmediatamente:</p>
        <ul>
          <li>Diarrea, vómitos, fiebre.</li>
          <li>Heridas o quemaduras en las manos sin proteger adecuadamente.</li>
          <li>Infecciones de piel (forúnculos, abscesos).</li>
          <li>Enfermedades respiratorias agudas con mucha tos o estornudos.</li>
          <li>Infecciones de garganta o de boca.</li>
          <li>Conjuntivitis o infecciones oculares.</li>
        </ul>
        <p>Las heridas pequeñas en las manos deben cubrirse con apósito impermeable de color visible (azul, normalmente) y, sobre el apósito, un guante.</p>

        <h2>Aseo, ropa y hábitos personales</h2>

        <div class="compare-grid">
          <div class="compare-card do">
            <h4>✓ Sí</h4>
            <ul>
              <li>Ducha diaria antes del turno.</li>
              <li>Uniforme limpio cada día.</li>
              <li>Pelo recogido y/o gorro/redecilla.</li>
              <li>Uñas cortas, limpias y sin pintar.</li>
              <li>Calzado de uso exclusivo en cocina.</li>
              <li>Beber agua en zonas autorizadas.</li>
            </ul>
          </div>
          <div class="compare-card dont">
            <h4>✗ No</h4>
            <ul>
              <li>Joyas, anillos, pulseras, relojes.</li>
              <li>Esmalte de uñas, uñas postizas.</li>
              <li>Maquillaje excesivo, perfume fuerte.</li>
              <li>Comer, fumar o mascar chicle en zona de manipulación.</li>
              <li>Usar el uniforme fuera del trabajo.</li>
              <li>Tocarse cara, pelo, móvil, dinero y luego alimentos.</li>
            </ul>
          </div>
        </div>

        <div class="callout">
          <div class="label">Móviles</div>
          <p>El móvil es uno de los objetos más contaminados que llevamos. Si tocas el móvil durante el servicio (consultas, fotos, comandas digitales), <strong>lávate las manos antes de volver al alimento</strong>. En la medida de lo posible, evítalo en zonas de manipulación.</p>
        </div>
      </div>
    `
  },

  {
    id: 4,
    title: "Limpieza, desinfección y plagas",
    eyebrow: "Módulo 4 de 9",
    description: "Mantener limpios los locales, equipos y utensilios para evitar contaminación.",
    content: `
      <div class="content-block">
        <h2>Limpieza ≠ desinfección</h2>
        <p>Son dos procesos distintos y <strong>complementarios</strong>. Hay que hacer los dos, en este orden:</p>

        <table class="data-table">
          <thead>
            <tr><th></th><th>Limpieza</th><th>Desinfección</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Qué elimina</strong></td>
              <td>Suciedad visible: grasa, restos de comida, polvo</td>
              <td>Microorganismos invisibles</td>
            </tr>
            <tr>
              <td><strong>Producto</strong></td>
              <td>Detergente</td>
              <td>Desinfectante (lejía, amonio cuaternario...)</td>
            </tr>
            <tr>
              <td><strong>Cuándo</strong></td>
              <td>Primero</td>
              <td>Después de la limpieza</td>
            </tr>
          </tbody>
        </table>

        <h3>Las 6 fases del protocolo L+D</h3>
        <ol>
          <li><strong>Pre-lavado:</strong> retirar restos sólidos en seco o con agua.</li>
          <li><strong>Limpieza:</strong> aplicar detergente y frotar.</li>
          <li><strong>Aclarado intermedio:</strong> con agua para retirar el detergente.</li>
          <li><strong>Desinfección:</strong> aplicar desinfectante, respetando el tiempo de actuación indicado por el fabricante.</li>
          <li><strong>Aclarado final:</strong> con agua potable abundante (excepto si el desinfectante no lo requiere).</li>
          <li><strong>Secado:</strong> al aire o con papel desechable.</li>
        </ol>

        <div class="callout warning">
          <div class="label">Mezclas peligrosas</div>
          <p><strong>NUNCA</strong> mezcles lejía con amoniaco ni con productos ácidos (vinagre, salfumán, descalcificadores). Genera gases tóxicos. Usa siempre un solo producto cada vez y aclara entre uno y otro.</p>
        </div>

        <h2>Productos de limpieza: almacenamiento</h2>
        <ul>
          <li>En un local o armario <strong>separado</strong> de la zona de alimentos, cerrado con llave si es posible.</li>
          <li><strong>Identificados</strong> en su envase original. Nunca trasvasar a botellas de agua o de bebidas.</li>
          <li>Con sus <strong>fichas técnicas y de seguridad</strong> accesibles.</li>
          <li>Bayetas, estropajos y trapos: separados por colores según zona/uso.</li>
        </ul>

        <h2>Control de plagas</h2>
        <p>Las plagas (insectos, roedores, aves) son un foco enorme de contaminación. La gestión se basa en tres pilares:</p>

        <h3>1. Prevención</h3>
        <ul>
          <li><strong>Barreras físicas:</strong> mosquiteras en ventanas, burletes en puertas, rejillas en desagües.</li>
          <li><strong>Limpieza:</strong> no dejar restos de comida ni agua estancada, vaciar basuras frecuentemente.</li>
          <li><strong>Almacenamiento correcto:</strong> productos elevados del suelo y separados de la pared.</li>
          <li><strong>Mantenimiento:</strong> sellar grietas, reparar tuberías que goteen.</li>
        </ul>

        <h3>2. Vigilancia</h3>
        <p>Detección activa de signos de plagas: excrementos, pelos, restos de comida roída, insectos vivos o muertos, telarañas, suciedad inusual.</p>

        <h3>3. Tratamiento</h3>
        <p>Si se detecta una plaga, contactar con la empresa de DDD (Desinfección, Desinsectación y Desratización) autorizada. <strong>Nunca uses insecticidas domésticos en cocina.</strong></p>

        <div class="callout success">
          <div class="label">En Bonita Menorca</div>
          <p>Tenemos contrato con empresa de DDD que realiza visitas periódicas y deja un informe. Si detectas signos de plaga, comunícalo a tu responsable y al equipo de mantenimiento (parte vía la app de mantenimiento).</p>
        </div>

        <h2>Gestión de residuos</h2>
        <ul>
          <li>Cubos con tapa accionada por pedal y bolsa de un solo uso.</li>
          <li>Vaciado frecuente, antes de que rebosen.</li>
          <li>Separación por fracciones (orgánico, envases, vidrio, papel, aceite).</li>
          <li>Limpieza diaria de los cubos.</li>
          <li>Almacén de residuos separado de zonas de manipulación, refrigerado si hay restos cárnicos en verano.</li>
        </ul>
      </div>
    `
  },

  {
    id: 5,
    title: "Cadena de frío y conservación",
    eyebrow: "Módulo 5 de 9",
    description: "Temperaturas correctas para evitar la multiplicación de microorganismos.",
    content: `
      <div class="content-block">
        <h2>La zona de peligro: 5 ºC – 65 ºC</h2>
        <p>Entre estos dos valores las bacterias se multiplican rápidamente. El objetivo de la conservación es mantener los alimentos <strong>fuera de esta franja</strong>: muy fríos o muy calientes.</p>

        <table class="data-table">
          <thead>
            <tr><th>Tramo</th><th>Temperatura</th><th>Qué pasa</th></tr>
          </thead>
          <tbody>
            <tr><td>Congelación</td><td>≤ -18 ºC</td><td>Multiplicación detenida</td></tr>
            <tr><td>Refrigeración</td><td>0 a 4 ºC</td><td>Multiplicación muy lenta</td></tr>
            <tr style="background: rgba(196, 89, 58, 0.1);"><td><strong>Zona de peligro</strong></td><td><strong>5 a 65 ºC</strong></td><td><strong>Multiplicación rápida</strong></td></tr>
            <tr><td>Cocinado seguro</td><td>≥ 70 ºC en el centro del producto</td><td>Destrucción de la mayoría de patógenos</td></tr>
            <tr><td>Mantenimiento en caliente</td><td>≥ 65 ºC</td><td>Sin multiplicación</td></tr>
          </tbody>
        </table>

        <h2>Temperaturas de referencia por producto</h2>
        <table class="data-table">
          <thead>
            <tr><th>Producto</th><th>Refrigeración</th><th>Congelación</th></tr>
          </thead>
          <tbody>
            <tr><td>Carne fresca</td><td>0 a 4 ºC</td><td>≤ -18 ºC</td></tr>
            <tr><td>Pescado fresco</td><td>0 a 2 ºC (en hielo)</td><td>≤ -18 ºC (-20 ºC para anisakis)</td></tr>
            <tr><td>Lácteos</td><td>0 a 4 ºC</td><td>—</td></tr>
            <tr><td>Frutas y verduras</td><td>4 a 8 ºC</td><td>—</td></tr>
            <tr><td>Helados</td><td>—</td><td>≤ -18 ºC</td></tr>
            <tr><td>Productos cocinados refrigerados</td><td>0 a 4 ºC</td><td>—</td></tr>
          </tbody>
        </table>

        <h2>Recepción de mercancía</h2>
        <p>El control empieza en la entrada. Al recibir un pedido:</p>
        <ol>
          <li>Comprobar que la <strong>temperatura del transporte</strong> es correcta.</li>
          <li>Verificar el estado del envase y el etiquetado (lote, fecha de caducidad / consumo preferente).</li>
          <li>Inspeccionar visual y olfativamente el producto.</li>
          <li>Almacenar de inmediato a la temperatura adecuada.</li>
          <li>Registrar la incidencia si la hay.</li>
        </ol>

        <div class="callout warning">
          <div class="label">Rechazo</div>
          <p>Rechaza la mercancía si la temperatura es incorrecta, el envase está roto, hay olor anómalo, hay signos de descongelación previa (cristales de hielo, manchas de líquido) o la fecha de caducidad ha pasado o está muy próxima.</p>
        </div>

        <h2>Almacenamiento en cámara</h2>
        <ul>
          <li>Productos elevados del suelo (≥ 10 cm) y separados de la pared.</li>
          <li>Sistema <strong>FIFO</strong> (First In, First Out): lo primero que entra es lo primero que sale.</li>
          <li>En cámaras mixtas, los crudos siempre <strong>debajo</strong> de los productos cocinados o listos para consumo.</li>
          <li>Pescado y carne en bandejas que recojan los líquidos.</li>
          <li>Todo etiquetado con fecha de elaboración o de apertura del envase.</li>
        </ul>

        <h2>Descongelación</h2>
        <p>La descongelación es un punto crítico. Solo hay <strong>cuatro métodos seguros</strong>:</p>
        <ol>
          <li>En la <strong>cámara de refrigeración</strong> (lo más recomendable, lleva tiempo: planificar).</li>
          <li>Bajo agua corriente fría (en envase estanco).</li>
          <li>En el microondas, usándolo inmediatamente.</li>
          <li>Cocinándolo directamente desde congelado (si la receta lo permite).</li>
        </ol>

        <div class="callout warning">
          <div class="label">Nunca</div>
          <p>Nunca descongeles a temperatura ambiente sobre la encimera. Y un alimento descongelado <strong>no se puede volver a congelar</strong> en crudo (sí se puede, una vez cocinado, congelar el plato terminado).</p>
        </div>

        <h2>Cocinado y enfriamiento</h2>
        <ul>
          <li>Cocinar hasta alcanzar <strong>70 ºC en el centro</strong> del alimento (al menos 2 minutos).</li>
          <li>Para productos críticos (huevo, aves, hamburguesa, cerdo, pescado para cocinar), no servir si el centro está rosado o crudo.</li>
          <li>Si el producto se va a refrigerar tras cocinar: <strong>enfriar rápido</strong>, pasando de 65 ºC a 10 ºC en menos de 2 horas (idealmente con abatidor).</li>
          <li>El recalentado debe alcanzar de nuevo <strong>≥ 70 ºC</strong> en todo el producto.</li>
        </ul>

        <h2>Fechas: caducidad vs consumo preferente</h2>
        <ul>
          <li><strong>"Fecha de caducidad" / "Consumir antes de":</strong> producto microbiológicamente sensible. Pasada esta fecha, <em>no se puede consumir</em>.</li>
          <li><strong>"Consumo preferente" / "Consumir preferentemente antes de":</strong> producto que pasada esa fecha puede haber perdido propiedades organolépticas (sabor, textura) pero no es peligroso si está bien conservado.</li>
        </ul>
      </div>
    `
  },

  {
    id: 6,
    title: "Contaminación cruzada",
    eyebrow: "Módulo 6 de 9",
    description: "El paso de contaminantes entre alimentos, superficies y manipuladores.",
    content: `
      <div class="content-block">
        <h2>Qué es la contaminación cruzada</h2>
        <p>Es la transferencia de microorganismos, alérgenos o sustancias químicas desde un alimento, superficie o manipulador contaminado a otro alimento que está limpio o listo para consumo.</p>

        <h3>Tres tipos</h3>
        <ol>
          <li><strong>Directa:</strong> contacto entre alimento crudo y cocinado (p. ej. pollo crudo que toca la ensalada).</li>
          <li><strong>Indirecta:</strong> a través de superficies, utensilios, tablas, cuchillos.</li>
          <li><strong>Por el manipulador:</strong> manos, ropa, paños.</li>
        </ol>

        <div class="callout warning">
          <div class="label">Caso típico</div>
          <p>Cortar pollo crudo en una tabla, no limpiarla bien, y luego cortar tomate para ensalada en la misma tabla. La Salmonella del pollo pasa al tomate, que se sirve sin cocinar. Resultado: posible toxiinfección.</p>
        </div>

        <h2>Cómo prevenirla</h2>

        <h3>Separación de productos</h3>
        <ul>
          <li>Crudos y cocinados en zonas/cámaras distintas si es posible.</li>
          <li>Si comparten cámara: cocinados <strong>arriba</strong>, crudos <strong>abajo</strong>.</li>
          <li>Bandejas con bordes para que no goteen.</li>
          <li>Envoltorios o tapas siempre.</li>
        </ul>

        <h3>Código de colores en utensilios</h3>
        <p>Es muy recomendable usar tablas de cortar y, en algunos casos, cuchillos por colores según el producto:</p>
        <table class="data-table">
          <thead>
            <tr><th>Color</th><th>Producto</th></tr>
          </thead>
          <tbody>
            <tr><td>Rojo</td><td>Carne cruda</td></tr>
            <tr><td>Azul</td><td>Pescado crudo</td></tr>
            <tr><td>Amarillo</td><td>Aves crudas</td></tr>
            <tr><td>Verde</td><td>Frutas y verduras</td></tr>
            <tr><td>Blanco</td><td>Lácteos, panadería, cocinados</td></tr>
            <tr><td>Marrón</td><td>Verduras cocinadas</td></tr>
          </tbody>
        </table>

        <h3>Higiene del manipulador</h3>
        <ul>
          <li>Lavarse las manos al cambiar de tarea.</li>
          <li>No usar el mismo paño para diferentes superficies; mejor papel desechable.</li>
          <li>Cambiar de delantal o uniforme si se ensucia con productos crudos.</li>
          <li>Cambiar guantes al cambiar de tarea.</li>
        </ul>

        <h3>Limpieza de superficies entre tareas</h3>
        <p>Entre la elaboración de un producto crudo y otro cocinado, las superficies, tablas y cuchillos deben <strong>limpiarse y desinfectarse</strong>, no solo aclararse con agua.</p>

        <h2>Contaminación cruzada por alérgenos</h2>
        <p>Es un caso especial y muy importante. Trazas mínimas de un alérgeno pueden causar reacciones graves en una persona alérgica.</p>
        <ul>
          <li>Usar utensilios y tablas <strong>exclusivos</strong> para el plato sin alérgeno.</li>
          <li>Cocinar primero los platos sin alérgeno o cambiar el aceite/agua de cocción.</li>
          <li>No usar el mismo aceite de freidora para empanados con gluten y para productos sin gluten.</li>
          <li>Almacenar productos sin gluten/sin lactosa <strong>arriba</strong> en la cámara, lejos de los productos que los contienen.</li>
          <li>Comunicar verbalmente al equipo cuando hay un comensal con alergia.</li>
        </ul>

        <div class="callout">
          <div class="label">En el módulo siguiente</div>
          <p>Los 14 alérgenos obligatorios y cómo gestionarlos en sala y cocina.</p>
        </div>
      </div>
    `
  },

  {
    id: 7,
    title: "Alérgenos e intolerancias",
    eyebrow: "Módulo 7 de 9",
    description: "Los 14 alérgenos del Reglamento UE 1169/2011 que debes conocer y comunicar.",
    content: `
      <div class="content-block">
        <h2>Reglamento (UE) 1169/2011</h2>
        <p>Es la norma europea que obliga a informar al consumidor sobre la presencia de los <strong>14 alérgenos de declaración obligatoria</strong> en cualquier alimento, incluidos los servidos sin envasar (en restaurantes, bares, comedores).</p>

        <div class="callout warning">
          <div class="label">Obligación legal</div>
          <p>Toda persona en sala o barra debe poder informar al cliente, de forma fiable, sobre los alérgenos de cada plato. Si no lo sabes, <strong>pregunta a cocina antes de servir</strong>. Nunca digas "creo que no lleva". La duda salva vidas.</p>
        </div>

        <h2>Los 14 alérgenos obligatorios</h2>
        <table class="data-table">
          <thead>
            <tr><th style="width: 5%;">#</th><th>Alérgeno</th><th>Ejemplos en hostelería</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td><strong>Gluten</strong> (cereales)</td><td>Trigo, espelta, kamut, centeno, cebada, avena. Pan, pasta, harinas, salsas, rebozados.</td></tr>
            <tr><td>2</td><td><strong>Crustáceos</strong></td><td>Gambas, langostinos, cigalas, langosta, cangrejo. Caldos.</td></tr>
            <tr><td>3</td><td><strong>Huevos</strong></td><td>Mayonesa, alioli, salsas, rebozados, postres, pasta fresca.</td></tr>
            <tr><td>4</td><td><strong>Pescado</strong></td><td>Salsas (anchoa en salsa César, Worcestershire), caldos.</td></tr>
            <tr><td>5</td><td><strong>Cacahuetes</strong></td><td>Aceite de cacahuete, salsas asiáticas, snacks.</td></tr>
            <tr><td>6</td><td><strong>Soja</strong></td><td>Salsa de soja, tofu, lecitina (aditivo en muchos productos).</td></tr>
            <tr><td>7</td><td><strong>Lácteos</strong></td><td>Leche, queso, mantequilla, nata. Lactosa.</td></tr>
            <tr><td>8</td><td><strong>Frutos de cáscara</strong></td><td>Almendras, avellanas, nueces, anacardos, pistachos, macadamias, pacanas, brasileñas.</td></tr>
            <tr><td>9</td><td><strong>Apio</strong></td><td>Sopas, caldos, ensaladas. La sal de apio.</td></tr>
            <tr><td>10</td><td><strong>Mostaza</strong></td><td>Vinagretas, salsas, aderezos.</td></tr>
            <tr><td>11</td><td><strong>Sésamo</strong></td><td>Tahini, hummus, panes con semillas, aceite de sésamo.</td></tr>
            <tr><td>12</td><td><strong>Sulfitos</strong> (>10 mg/kg)</td><td>Vinos, vinagres, frutos secos tratados, conservas.</td></tr>
            <tr><td>13</td><td><strong>Altramuces</strong></td><td>Harina de altramuz en panes y pastas.</td></tr>
            <tr><td>14</td><td><strong>Moluscos</strong></td><td>Mejillones, almejas, ostras, calamar, pulpo, navajas.</td></tr>
          </tbody>
        </table>

        <h2>Alergia vs intolerancia</h2>
        <table class="data-table">
          <thead>
            <tr><th></th><th>Alergia</th><th>Intolerancia</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Mecanismo</strong></td>
              <td>Respuesta del sistema inmune</td>
              <td>Dificultad digestiva (falta de enzimas)</td>
            </tr>
            <tr>
              <td><strong>Cantidad</strong></td>
              <td>Trazas mínimas pueden ser graves</td>
              <td>Suele depender de la cantidad ingerida</td>
            </tr>
            <tr>
              <td><strong>Síntomas</strong></td>
              <td>Urticaria, hinchazón, anafilaxia (potencialmente mortal)</td>
              <td>Molestias digestivas, dolor abdominal, diarrea</td>
            </tr>
            <tr>
              <td><strong>Ejemplo</strong></td>
              <td>Alergia al cacahuete</td>
              <td>Intolerancia a la lactosa</td>
            </tr>
          </tbody>
        </table>

        <h2>Protocolo en Bonita Menorca cuando un cliente declara alergia</h2>
        <ol>
          <li><strong>Tomar la alergia muy en serio.</strong> Confirmarla con el cliente: "¿Es alergia o intolerancia? ¿Trazas también?"</li>
          <li><strong>Comunicarlo a cocina</strong> verbalmente y marcarlo en el TPV/comanda. No asumir.</li>
          <li><strong>Cocina prepara el plato con utensilios limpios</strong> y procesos diferenciados.</li>
          <li><strong>Servir con precaución:</strong> usar plato distintivo si el local lo tiene, llevarlo aparte.</li>
          <li>Si tienes <strong>cualquier duda</strong>, no sirvas. Pregunta primero.</li>
        </ol>

        <div class="callout warning">
          <div class="label">Anafilaxia</div>
          <p>Una reacción anafiláctica puede ser mortal en minutos. Síntomas: hinchazón rápida de cara, lengua o garganta; dificultad para respirar; pérdida de conocimiento. Si lo ves: <strong>llamar al 112 inmediatamente</strong> y avisar al responsable.</p>
        </div>

        <h2>Información al cliente</h2>
        <p>La información de alérgenos debe estar disponible:</p>
        <ul>
          <li><strong>De forma escrita</strong> en la carta o en un documento accesible al cliente que lo pida.</li>
          <li>De <strong>forma oral</strong>, debiendo poder remitirse a la documentación si el cliente lo pide.</li>
          <li>Actualizada en cada cambio de receta o proveedor.</li>
        </ul>

        <p>En Bonita Menorca, las matrices de alérgenos por plato están disponibles para cocina y sala. Si una receta cambia, hay que actualizar la matriz.</p>
      </div>
    `
  },

  {
    id: 8,
    title: "APPCC y trazabilidad",
    eyebrow: "Módulo 8 de 9",
    description: "Sistema de autocontrol y capacidad de seguir el rastro a un alimento.",
    content: `
      <div class="content-block">
        <h2>¿Qué es el APPCC?</h2>
        <p><strong>APPCC = Análisis de Peligros y Puntos de Control Crítico.</strong> En inglés, HACCP. Es el sistema preventivo, basado en datos, que toda empresa alimentaria debe tener implantado para garantizar la seguridad de los alimentos que produce.</p>

        <p>Su lógica es muy simple: en lugar de inspeccionar el producto final (cuando ya es tarde), se identifican los <em>puntos del proceso</em> donde puede producirse contaminación, se establece cómo controlarlos, y se documenta.</p>

        <h3>Los 7 principios del APPCC</h3>
        <ol>
          <li><strong>Analizar los peligros</strong> en cada fase del proceso.</li>
          <li><strong>Identificar los Puntos de Control Crítico (PCC)</strong>: las fases donde el control es esencial para evitar el peligro.</li>
          <li><strong>Establecer límites críticos</strong> en cada PCC (p. ej. temperatura ≥ 70 ºC).</li>
          <li><strong>Establecer un sistema de vigilancia</strong> de cada PCC.</li>
          <li><strong>Definir acciones correctivas</strong> cuando un límite se incumple.</li>
          <li><strong>Verificar</strong> periódicamente que el sistema funciona.</li>
          <li><strong>Documentar</strong> todo el proceso.</li>
        </ol>

        <h3>PCC típicos en restauración</h3>
        <table class="data-table">
          <thead>
            <tr><th>Fase</th><th>PCC</th><th>Límite crítico</th></tr>
          </thead>
          <tbody>
            <tr><td>Recepción</td><td>Temperatura del transporte</td><td>Refrigerados ≤ 4 ºC, congelados ≤ -18 ºC</td></tr>
            <tr><td>Almacenamiento</td><td>Temperatura de cámaras</td><td>Refrigeración 0–4 ºC, congelación ≤ -18 ºC</td></tr>
            <tr><td>Cocinado</td><td>Temperatura del centro</td><td>≥ 70 ºC durante ≥ 2 min</td></tr>
            <tr><td>Mantenimiento caliente</td><td>Temperatura</td><td>≥ 65 ºC</td></tr>
            <tr><td>Enfriamiento</td><td>Velocidad</td><td>De 65 a 10 ºC en menos de 2 h</td></tr>
            <tr><td>Pescado crudo</td><td>Congelación previa</td><td>-20 ºC, mínimo 24 h</td></tr>
          </tbody>
        </table>

        <h2>Planes Generales de Higiene (PGH)</h2>
        <p>Son los pre-requisitos del APPCC. Bonita Menorca, como toda empresa alimentaria, debe tener documentados:</p>
        <ul>
          <li>Plan de control de agua.</li>
          <li>Plan de Limpieza y Desinfección.</li>
          <li>Plan de control de plagas (DDD).</li>
          <li>Plan de mantenimiento de instalaciones, equipos y útiles.</li>
          <li>Plan de buenas prácticas de manipulación.</li>
          <li>Plan de formación de manipuladores (este curso).</li>
          <li>Plan de control de proveedores.</li>
          <li>Plan de control de la trazabilidad.</li>
          <li>Plan de control de alérgenos.</li>
          <li>Plan de gestión de residuos.</li>
          <li>Plan de prevención del desperdicio alimentario (Ley 1/2025).</li>
        </ul>

        <h2>Trazabilidad</h2>
        <p>Es la capacidad de <strong>seguir el rastro</strong> a un alimento a lo largo de todas las fases de su producción y distribución. Si hay un problema sanitario, hay que poder reconstruir de dónde vino el lote y a quién se sirvió.</p>

        <h3>Tres tipos de trazabilidad</h3>
        <ol>
          <li><strong>Hacia atrás:</strong> de qué proveedor vino cada producto, cuándo, qué lote.</li>
          <li><strong>Interna:</strong> qué se hizo con ese producto dentro del establecimiento (en qué platos se usó).</li>
          <li><strong>Hacia adelante:</strong> a quién se sirvió (más relevante en producción industrial; en hostelería, fecha y servicio).</li>
        </ol>

        <h3>En el día a día significa</h3>
        <ul>
          <li>Conservar albaranes y facturas de proveedores.</li>
          <li>No retirar las etiquetas de los productos hasta que se hayan consumido completamente.</li>
          <li>Etiquetar todo lo que se trasvase a otro envase con: producto, lote, fecha de elaboración o apertura, fecha de caducidad.</li>
          <li>Registrar incidencias.</li>
        </ul>

        <div class="callout">
          <div class="label">En Bonita Menorca</div>
          <p>La trazabilidad se gestiona principalmente vía Yurest (compras) y Ágora (escandallos). Para los vinos, el código de lote permite trazar desde la viña hasta la botella servida.</p>
        </div>
      </div>
    `
  },

  {
    id: 9,
    title: "Particularidades de Bonita Menorca",
    eyebrow: "Módulo 9 de 9",
    description: "Especificidades de nuestros locales: vinos, mariscos, arroces, visitas.",
    content: `
      <div class="content-block">
        <h2>Una empresa, varios entornos</h2>
        <p>Bonita Menorca opera distintos tipos de establecimientos, cada uno con sus particularidades higiénicas:</p>

        <h3>Bodega Binifadet (producción de vino)</h3>
        <p>Aunque el vino no es un producto de "alto riesgo" microbiológico una vez embotellado, durante la producción hay que controlar:</p>
        <ul>
          <li><strong>Limpieza y desinfección</strong> de depósitos, mangueras y equipos antes de cada uso.</li>
          <li><strong>Sulfitos</strong>: declaración obligatoria como alérgeno cuando superan 10 mg/L (todos los vinos comerciales lo hacen).</li>
          <li><strong>Trazabilidad por lote</strong>: cada botella debe poder rastrearse hasta la viña.</li>
          <li><strong>Tienda y visitas</strong>: las catas con maridaje deben respetar las normas de manipulación de alimentos como cualquier servicio de restauración.</li>
        </ul>

        <h3>Restaurante Binifadet, Restaurante Tamarindos y Casa Tirant</h3>
        <p>Cocinas con producto fresco (pescado, marisco, carne), aplican plenamente todo lo visto en este curso. Atención especial a:</p>
        <ul>
          <li><strong>Pescado y marisco fresco</strong>: cadena de frío estricta, congelación preventiva para anisakis si se sirve crudo o casi crudo.</li>
          <li><strong>Arroces</strong> (Casa Tirant): el arroz cocido es un producto de riesgo (Bacillus cereus). Si no se consume al momento, enfriar rápido y refrigerar; recalentar a ≥ 70 ºC.</li>
          <li><strong>Mayonesas y alioli</strong>: si se elaboran con huevo crudo, gestionarse con extrema precaución (alternativamente, usar huevo pasteurizado o productos comerciales).</li>
          <li><strong>Quesos artesanos de Menorca</strong>: muchos son de leche cruda; control de fechas y trazabilidad rigurosos.</li>
        </ul>

        <h3>Bar Tamarindos y zonas de barra</h3>
        <ul>
          <li><strong>Hielo</strong>: es un alimento. La máquina de hielo se limpia con la frecuencia indicada en el plan L+D.</li>
          <li><strong>Cubitos con cuchara o pinza</strong>, nunca con la mano ni con el vaso.</li>
          <li><strong>Bebidas con guarnición</strong> (limón, hierbabuena): manipuladas con pinzas, no con dedos.</li>
          <li><strong>Tablas y cócteles con productos crudos</strong> (ostras, ceviche): protocolo de pescado fresco aplicable.</li>
        </ul>

        <h3>Tienda y Visitas Binifadet</h3>
        <ul>
          <li>Si se ofrecen <strong>maridajes</strong> con productos alimenticios, aplican las normas de hostelería.</li>
          <li>Higiene de los <strong>utensilios de cata</strong> (copas, cuberterías).</li>
          <li>Información de alérgenos disponible para cualquier cliente que lo pida.</li>
        </ul>

        <h2>Comunicación interna</h2>
        <p>Cualquier incidencia higiénica debe comunicarse:</p>
        <ul>
          <li><strong>Al responsable directo del centro</strong>: Sonia/Xiscu/Rafa (Binifadet), Vanesa/Marta (Tamarindos), Marcos/Leandro (Bodega), Mercè/Mabel/Matías (Casa Tirant), Lena/Charo (El Bar).</li>
          <li>Si requiere intervención técnica (avería de cámara, fuga de agua, plaga): vía la <strong>app de partes de mantenimiento</strong>.</li>
          <li>Si afecta a la seguridad alimentaria del cliente (sospecha de toxiinfección, alergia mal gestionada): comunicación inmediata a Dirección.</li>
        </ul>

        <h2>Lecciones que solo aprendes con la práctica</h2>
        <ul>
          <li><strong>El verano en Menorca aprieta</strong>: con calor, las cámaras trabajan al límite. Vigila las temperaturas y comunica fallos al instante.</li>
          <li><strong>Servicios largos</strong>: en bodas y eventos largos, el riesgo crece con el tiempo. Producción "en oleadas" mejor que cocinarlo todo a la vez y mantener.</li>
          <li><strong>Personal de temporada</strong>: muchas incorporaciones rápidas. Esta formación es <em>obligatoria antes</em> del primer servicio en sala o cocina.</li>
          <li><strong>Pequeñas distracciones, grandes consecuencias</strong>: una sola mala práctica (no lavarse manos al cambiar de tarea) puede provocar un brote. Mantén el rigor cuando hay prisa.</li>
        </ul>

        <div class="callout success">
          <div class="label">Listo para el examen</div>
          <p>Has completado los 9 módulos. Cuando estés preparado, accede al examen final. Recuerda: 20 preguntas, 15 correctas para aprobar, 3 intentos disponibles.</p>
        </div>
      </div>
    `
  }
];
