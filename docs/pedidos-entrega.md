# Pedidos · Entrega del 04-10-2026

Para Luis. Qué es el módulo **Pedidos** (`/pedidos`), cómo se usa, qué hay que conseguir de los
proveedores, qué tienes que configurar tú y qué queda pendiente.

**Estado:** el módulo está terminado y compila sin errores (`tsc` y `next build`). La base de datos
ya está preparada. Pero **todavía no está subido** (no hay commit) y **la IA no se ha probado de
verdad**, porque su clave solo está en Vercel.

## 1. Qué es

Pedidos a proveedores desde el móvil. Tres piezas:

- **Dictar el pedido** como se diría por teléfono, en castellano o en menorquín: «una caixa de pa
  blanc i dues dotzenes d'ous per demà». Hostelero lo convierte en líneas con los productos reales
  de cada proveedor. La persona revisa y envía.
- **Pedir por catálogo**: eliges proveedor y marcas cantidades. Arriba sale lo que más se pide en
  ese centro.
- **Seguimiento y cotejo**: cada pedido tiene su ficha. Cuando el albarán (y después la factura)
  está en Compras, se vincula al pedido y Hostelero compara pedido, albarán y factura línea a línea.

Cada pedido lleva número (P-2026-0001) y pasa por: Borrador → Enviado → Confirmado → Recibido en
parte → Recibido. También se puede cancelar.

## 2. Cómo se usa

Arriba se elige el centro (se recuerda). Pestañas: **Nuevo · Catálogo · Pedidos · Ajustes**.
Ajustes solo lo ven dirección y responsables de área.

### 2.1 Nuevo: dictar o escribir

1. Elegir idioma: **Castellano** o **Menorquí** (se recuerda).
2. Tocar el micrófono grande y decir qué, cuánto y para cuándo. El texto sale en pantalla mientras
   se habla y se puede corregir a mano. También se puede escribir sin dictar.
3. **Interpretar**. Tarda unos 15 segundos.
4. Revisar:
   - **Sin identificar**, arriba: lo que la IA no ha encontrado. Se elige el producto o se pide con
     su descripción.
   - El resto, agrupado por proveedor: fecha de entrega, nota para el proveedor, total estimado y
     aviso si no llega al pedido mínimo.
   - En cada línea: cantidad con − y +, unidad, nivel de confianza de la IA, «¿O era…?» con otras
     opciones, cambiar producto o quitar.
   - **Añadir más**, para dictar lo que se olvidó.
5. **Guardar borradores**: sale un borrador por proveedor. Si ya había un borrador del mismo centro
   y proveedor, se suma a ese.
6. **Revisar y enviar →** abre la ficha de cada borrador.

La fecha de entrega por defecto es el siguiente día de reparto del proveedor, respetando su hora
límite. Mientras no tengamos los días de reparto, sale mañana.

**Lo aprendido.** Cuando alguien corrige una línea (otro producto u otra unidad) o confirma una
dudosa, Hostelero apunta «esta frase = este producto». La próxima vez acierta. Se puede ver y borrar
en Ajustes › Lo aprendido.

### 2.2 Catálogo

**Pedir por catálogo** → elegir proveedor (arriba, los que más se piden en ese centro) → primero
«Lo que pedís aquí» y después el resto del catálogo, con buscador → + y − (propone la última
cantidad pedida) → fecha y nota → **Crear borrador**.

### 2.3 Enviar (desde la ficha del borrador)

Antes de enviar se pueden cambiar productos, cantidades, fecha y notas. **Enviar al proveedor**
funciona según el canal de cada proveedor:

- **Email.** Sale desde Hostelero con una tabla (código del proveedor, producto, cantidad, unidad,
  nota), la dirección de entrega del centro, la firma de quien pide y, al pie, «Por favor, envíen el
  albarán en PDF a …». Si el proveedor responde, la respuesta llega al correo de quien hizo el
  pedido. Si el correo no sale, el pedido **no** se marca como enviado: se ofrece «Copiar texto» o
  «Abrir en mi correo» y después «Ya lo he enviado».
- **WhatsApp.** Abre WhatsApp en el móvil con el texto ya escrito. Se manda y se pulsa «Ya lo he
  enviado».
- **Teléfono.** Llama y enseña el texto para leerlo. Después, «Hecho, ya lo he pedido».
- **Web del proveedor.** Copiar el texto, pedir en su web y pulsar «Hecho, ya lo he pedido».

Antes de enviar, la ficha avisa si el pedido no llega al mínimo, si hay líneas sin identificar o sin
precio, si falta la fecha o si ese día el proveedor no reparte. Son avisos: no bloquean.

Si el proveedor no tiene email guardado, quien envía lo escribe en ese momento. Si lo tiene, solo
dirección y responsables pueden mandarlo a otra dirección. Tope: 30 pedidos por email por persona y
hora.

Un pedido enviado ya no vuelve a borrador.

### 2.4 Pedidos: seguimiento y cotejo

Pestaña **Pedidos**: Borradores · Enviados · Recibidos · Todos · Cancelados, con filtro de centro y
de proveedor. Tocar un pedido abre su ficha.

En la ficha de un pedido enviado:

- **¿Cómo va?** Confirmado / Recibido en parte / Recibido. También «Cancelar pedido» (al proveedor
  le avisas tú).
- **Albarán y factura** → «Buscar albarán y factura». Hostelero propone albaranes y facturas de
  Compras del mismo proveedor, desde 3 días antes hasta 10 días después de la entrega, con su
  parecido al pedido. Se elige con «Es este».
- **Cotejar.** Tabla Pedido | Albarán | Factura, línea a línea: Correcto, Falta, Cantidad distinta,
  Precio distinto (más de un 2 %), No pedido o Sin dato. Si trajeron otro producto en su lugar, se
  marca «Lo trajeron cambiado». También compara la factura con el albarán y dice cuánto pagamos de
  más o de menos por diferencias de precio.
- Si todo cuadra, la ficha ofrece **Marcar como recibido**.

El albarán tiene que estar en Compras, como hoy (PDF por correo o foto). Con el PDF del proveedor no
hace falta foto. Foto solo para los albaranes con incidencias o corregidos a boli.

## 3. Qué hay que conseguir de cada proveedor

Cómo está hoy la base (04-10): 265 proveedores, **ninguno** con email o WhatsApp de pedidos, días
de reparto ni hora límite. 2.166 productos, **ninguno** con la unidad definida y 445 sin el código
del proveedor.

De cada proveedor hace falta:

1. **Su catálogo completo en Excel o CSV**, con su código de artículo, la descripción, el formato
   (por ejemplo «caja 20 u»), la unidad de venta y el precio sin IVA. Cuando cambie la tarifa, el
   archivo nuevo.
2. **Dónde mandarle los pedidos**: email o WhatsApp (o si se le pide por teléfono o en su web).
3. **Los albaranes en PDF por email** al buzón de albaranes, el mismo día de la entrega.

Y de paso: días de reparto, hora límite para pedir y pedido mínimo.

**Cómo pedirlo con el botón.** Ajustes › Proveedores › el proveedor › «Pedir catálogo y albaranes
por email» › «Preparar el correo». Pones su email en «Para», revisas el texto y pulsas «Enviar». El
correo pide las tres cosas, va con tu nombre y las respuestas te llegan a ti. Si el proveedor no
tenía email de pedidos, se guarda el que has usado. También puedes «Abrir en mi correo» o «Copiar
texto» (por ejemplo, para mandarlo por WhatsApp).

**Cuando contesten**, en la misma ficha del proveedor:

- Datos de pedido: canal, email, WhatsApp, teléfono, pedido mínimo, días de reparto, hora límite,
  notas y «Ya envía los albaranes en PDF por email». Después, «Guardar». Si a un proveedor no se le
  pide nunca, se desmarca «Aparece en Pedidos».
- **Importar catálogo (Excel o CSV)**: eliges el archivo, Hostelero adivina qué columna es cada
  cosa, tú lo confirmas, ves 10 filas de muestra e importas. Al final te dice cuántos productos son
  nuevos, cuántos se han actualizado, cuántos no tenían cambios y cuántos han dado error.

Qué hace la importación y qué no:

- Casa cada fila con nuestro producto por el código del proveedor (sin mirar mayúsculas). Si la
  fila no trae código, por el nombre.
- En los productos que ya teníamos, actualiza unidad, formato, unidades por formato, precio de
  catálogo, categoría y código de barras.
- **Nunca cambia el nombre** de un producto que ya existe, porque eso reescribiría todo su histórico
  de compras. Si el catálogo lo llama distinto, ese nombre se guarda como «otro nombre» y la IA
  también lo reconoce.
- Nunca cambia un código del proveedor que ya existe.
- Crea los productos nuevos con su código interno P-NNNNN, igual que Compras.
- No da de baja los productos que no vengan en el catálogo.

Conviene empezar por los 10 o 15 proveedores a los que más se pide.

## 4. Qué tienes que configurar tú

**Variables en Vercel** (proyecto de Hostelero). Después de cambiarlas hay que volver a desplegar.

| Variable | ¿Hace falta? | Para qué |
|---|---|---|
| `PEDIDOS_BUZON_ALBARANES` | Muy recomendable | El email al que los proveedores mandan los albaranes en PDF. Sale al pie de cada pedido y en la petición de catálogo. Sin ella, el pie no pide el albarán y Ajustes avisa de que falta. |
| `PEDIDOS_REMITENTE` | Opcional | Quién aparece como remitente de los pedidos, por ejemplo `Pedidos Bonita Menorca <pedidos@tu-dominio>`. El dominio tiene que estar verificado en Resend. Sin ella, sale el remitente general de Hostelero (`RESEND_REMITENTE` o, si no existe, «Bodegas Binifadet»). |
| `ANTHROPIC_API_KEY` | Ya está | La IA (la misma clave que usa Compras). |
| `RESEND_API_KEY` | Ya está | Los emails. |

**Claves IMAP de Infotelecom.** Para que los PDF de los proveedores entren solos en Compras, el
buzón de `PEDIDOS_BUZON_ALBARANES` tiene que ser el mismo que lee la ingesta de correo de Compras.
Faltan sus claves en Vercel: `IMAP_HOST`, `IMAP_PORT` (993), `IMAP_USER` e `IMAP_PASS`. La
ingesta pasa una vez al día, de madrugada. Sin esas claves, los albaranes llegan al buzón pero
alguien tiene que subirlos a Compras a mano.

**Resend.** El dominio del remitente tiene que estar verificado (en verde en Resend). Si no lo está,
el correo no sale y la app ofrece mandarlo desde el correo de cada uno.

## 5. Quién lo ve

| Quién | Qué puede hacer |
|---|---|
| Dirección | Todo, Ajustes incluido |
| Responsables de área | Todo, Ajustes incluido |
| Jefes de sala | Nuevo, Catálogo y Pedidos: crear, editar, enviar y cotejar. Sin Ajustes. |
| Empleados | Solo si se les da el permiso del módulo Pedidos en **Usuarios**. Entonces, lo mismo que un jefe de sala. |

- Ajustes, importar catálogos, pedir catálogos y borrar lo aprendido: solo dirección y responsables
  de área.
- Si en Usuarios se le quita el módulo a alguien (veto), no entra aunque su rol lo tenga.
- Ojo: los empleados todavía **no tienen el botón** en su app (`/empleado`). De momento entran con el
  enlace directo a `/pedidos` (se puede guardar en la pantalla de inicio del móvil).

## 6. La IA

- **Modelo:** Claude Opus 5.5 de Anthropic (`claude-opus-5-5`), con esfuerzo bajo, porque solo
  tiene que entender el pedido y buscar los productos.
- **Reintento automático:** están activados los fallbacks del servidor. Si el modelo principal
  rechaza una petición por sus normas, la propia API la repite en un modelo alternativo y Hostelero
  se queda con esa respuesta. Si también se rechaza, sale «No se ha podido interpretar. Escríbelo de
  otra forma o añade los productos a mano».
- **Qué ve:** los 400 productos más pedidos en ese centro, lo aprendido (hasta 300 frases, primero
  las del centro), los proveedores con sus días de reparto y un glosario de menorquín a castellano
  (caixa, tomàtiga, dotzena, mitja, per demà…).
- **Nunca inventa productos:** lo que no está en el catálogo sale como «Sin identificar». Solo
  propone: siempre revisa una persona antes de enviar.
- **Privacidad:** lo dictado no se escribe en ningún registro del servidor. Se guarda en el propio
  pedido (texto e interpretación) para poder revisarlo y aprender.
- **Coste:** las instrucciones y el catálogo del centro van en la caché de Anthropic, así que los
  pedidos seguidos del mismo centro salen más rápidos y más baratos.
- **Freno al gasto:** 6 interpretaciones por minuto y 40 por hora por persona, y 200 por hora por
  cuenta. Es aproximado, porque cada servidor de Vercel cuenta por su lado.
- **Si la IA falla o no está**, se puede pedir igual con el buscador o por catálogo.
- **El dictado lo hace el móvil**, no Claude (Claude no recibe audio). Si el navegador no deja
  dictar, se usa el micrófono del teclado del móvil. Algunos navegadores no dictan en menorquí:
  entonces se dicta en castellano o se escribe.

## 7. Límites conocidos de la v1

- **Un solo albarán por pedido.** Si una entrega llega en dos albaranes, se vincula uno y el resto
  se marca a mano («Recibido en parte» o «Recibido»).
- **Unidades sin definir.** Hoy ningún producto tiene unidad. Hasta importar los catálogos, si el
  pedido va en cajas y el albarán en unidades, el cotejo no puede comparar esa línea y avisa
  «Algunas diferencias pueden ser de unidades».
- **Género al peso.** La cantidad se compara exacta: pedir 2 kg y recibir 2,150 kg sale como
  «Cantidad distinta». El precio sí tiene un margen del 2 %.
- **La IA solo reconoce lo que ya se compra en ese centro** (los 400 productos más pedidos) o lo
  aprendido. Lo demás se añade con el buscador, que encuentra todo.
- Un pedido enviado no vuelve a borrador.
- No queda guardado a qué dirección exacta se envió cada pedido.
- En pedidos muy largos, «Abrir en mi correo» puede cortar el texto. Para eso está «Copiar texto».
- La importación no da de baja los productos que el proveedor ya no tenga.

## 8. Dos decisiones para ti

1. **Códigos vacíos al importar.** Si una fila del catálogo trae código y casa por nombre con un
   producto nuestro que no tenía código (hay 445, que vienen de facturas sin referencia), se le pone
   ese código en vez de crear un producto repetido. Es la misma regla que usa Compras al enlazar las
   líneas de un albarán. Riesgo: si dos artículos distintos se llaman igual, uno puede quedarse con
   el código del otro para siempre. **Recomendación:** dejarlo así y mirar el resumen de cada
   importación. Si prefieres no correr ese riesgo, se quita y esas filas crean un producto nuevo (con
   el duplicado correspondiente).
2. **Librería que lee los Excel.** La versión instalada (xlsx 0.18.5) tiene dos fallos de seguridad
   conocidos. Aquí solo lee el archivo en el navegador de quien importa, con límites (20 MB, 100.000
   filas, 100 columnas), y solo importan dirección y responsables. El riesgo es bajo. Subir a la
   versión 0.20.3 (se descarga de la web oficial de SheetJS, no de npm) lo decides tú.

## 9. Siguientes pasos

1. **Subir el código**: commit y push a `main`. Vercel despliega solo.
2. **Nada más desplegar, probar la IA** en `/pedidos` con una frase, por ejemplo «una caixa de pa
   blanc i dues dotzenes d'ous per demà». Si sale «La IA no está bien configurada…», avisar a Code:
   la llamada se ha comprobado con los tipos del SDK, no contra la API real.
3. Poner `PEDIDOS_BUZON_ALBARANES` (y `PEDIDOS_REMITENTE` si lo quieres) en Vercel y volver a
   desplegar.
4. Conseguir las claves IMAP de Infotelecom y ponerlas en Vercel.
5. Decidir los dos puntos del apartado 8.
6. En Ajustes, rellenar los datos de pedido de los 10 o 15 proveedores principales y mandarles
   «Pedir catálogo y albaranes por email».
7. Importar los catálogos según lleguen.
8. Probar una semana con un cocinero y un camarero de un centro. Dar el permiso en Usuarios a los
   empleados que vayan a pedir.

Pendiente técnico (para Code, en sesiones aparte):

- Botón «Pedidos» en la app del empleado (`/empleado`) para quien tenga el permiso.
- Que la base de datos también exija el rol. Hoy el rol y el módulo los comprueban las pantallas y
  las acciones del servidor; la base solo comprueba la cuenta (igual que en Compras). Necesita una
  migración nueva.
- Guardar a qué dirección se envió cada pedido (columna nueva, con migración).
- Varios albaranes por pedido.
- Margen en el cotejo para el género al peso.
- Opcional: al importar, dar de baja lo que el proveedor ya no tenga.

## 10. Para Code: dónde está cada cosa

- Pantallas y acciones: `apps/general/app/pedidos/` (`page.tsx`, `PanelPedidos.tsx`, `secciones/`,
  `componentes/`, `acciones/`).
- IA: `apps/general/lib/pedidos-ia.ts` (llamada con `beta.messages.create`, betas
  `server-side-fallback-2026-07-01` y `structured-outputs-2025-12-15`, `fallbacks: "default"`,
  parseo a mano tras mirar `stop_reason`).
- Base: `apps/general/supabase/migrations/20261004120000_pedidos.sql` (ya aplicada).
- Cambios fuera del módulo: `lib/correo.ts` (`texto`, `responderA`, `remitente`, compatible con lo
  anterior), `lib/modulos.ts`, `lib/supabase/server.ts` (`pedidos` para `responsable_area` y
  `jefe_sala`), `package.json` (`@anthropic-ai/sdk`, `zod`) y `packages/db/types.ts`.
- Diseño y reglas: `docs/pedidos-plan.md` y `docs/pedidos-contratos.md`.
