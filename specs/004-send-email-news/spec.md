# Feature Specification: Entrega de noticias por correo a suscriptores

**Feature Branch**: `004-send-email-news`

**Created**: 2026-07-29

**Status**: Draft

**Input**: User description: "Determinación y entrega, en horarios configurables, del conjunto de noticias que corresponde a cada suscriptor activo, sin repeticiones y sin omisiones."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recepción confiable del resumen de noticias (Priority: P1)

Como suscriptor activo, en cada momento de envío recibo exactamente las noticias de la
categoría configurada publicadas desde que confirmé mi suscripción que todavía no había
recibido, con su título, resumen tal como lo publica la fuente y enlace al artículo original —
sin repeticiones y sin que se me pase ninguna.

**Why this priority**: es la promesa central del sistema hecha observable; sin esto no hay
producto. Todo lo demás (ventana horaria, tope por mensaje, reintentos) son refinamientos sobre
este comportamiento base.

**Independent Test**: sembrar un suscriptor activo con `activatedAt` conocido y noticias
elegibles (algunas anteriores y otras posteriores a esa fecha), ejecutar un envío, y verificar
que el mensaje resultante contiene exactamente las noticias posteriores a la activación y que
queda un registro de entrega por cada una.

**Acceptance Scenarios**:

1. **Given** un suscriptor activo sin entregas previas y tres noticias elegibles publicadas
   después de su activación, **When** se ejecuta un envío, **Then** el suscriptor recibe un
   mensaje con las tres noticias y queda un registro de entrega por cada combinación
   noticia/suscriptor/canal.
2. **Given** un suscriptor cuyo `activatedAt` es posterior a la publicación de una noticia,
   **When** se ejecuta un envío, **Then** esa noticia no aparece en su mensaje.
3. **Given** dos suscriptores activados en momentos distintos, **When** se ejecuta el mismo
   envío para ambos, **Then** cada uno recibe el conjunto de noticias que corresponde a su
   propio historial, y esos conjuntos pueden ser distintos entre sí.
4. **Given** un suscriptor sin noticias pendientes, **When** se ejecuta un envío, **Then** no
   se le envía ningún mensaje.

---

### User Story 2 - Continuidad tras una interrupción del envío (Priority: P2)

Como operador del sistema, si el proceso de envío no corrió durante un tiempo (caída, error,
mantenimiento) o una noticia entró tarde al sistema con fecha de publicación anterior a la
última corrida, quiero que en el siguiente envío exitoso se entregue todo lo que sigue vigente,
sin que la interrupción se traduzca en una pérdida silenciosa ni en un reenvío de lo que ya se
entregó.

**Why this priority**: es lo que distingue a este cálculo de un enfoque ingenuo basado en
"desde la última corrida", y es la garantía que sostiene la promesa de no pérdida del sistema
completo, no solo de este componente.

**Independent Test**: incorporar una noticia con fecha de publicación anterior a la última
corrida de envío registrada, ejecutar un nuevo envío, y verificar que se entrega igual; luego
ejecutar el envío otra vez sin cambios y verificar que no se genera un segundo mensaje.

**Acceptance Scenarios**:

1. **Given** una noticia incorporada al sistema con fecha de publicación anterior al último
   envío ejecutado, **When** corre el siguiente envío, **Then** esa noticia se entrega a los
   suscriptores para quienes es elegible.
2. **Given** un envío ya ejecutado sin cambios posteriores en noticias ni suscriptores,
   **When** se ejecuta el envío una segunda vez, **Then** ningún suscriptor recibe un mensaje
   duplicado.
3. **Given** un envío que alcanza a algunos suscriptores y falla para otros, **When** corre el
   siguiente envío, **Then** solo quienes no lo recibieron reciben el contenido; quienes ya lo
   recibieron no lo reciben de nuevo.
4. **Given** un intento de envío cuyo resultado para una noticia es ambiguo (ni confirmación ni
   error claro), **When** corre el siguiente envío, **Then** esa noticia se reintenta para ese
   suscriptor.

---

### User Story 3 - Protección de noticias pendientes frente a la retención (Priority: P2)

Como operador del sistema, no quiero que la purga automática de noticias antiguas (feature de
ingesta) elimine una noticia que todavía no le llegó a algún suscriptor activo, aunque haya
superado el período de retención general.

**Why this priority**: sin esta protección, una caída prolongada del envío combinada con la
purga de retención produce exactamente la pérdida silenciosa que el sistema entero promete
evitar — es un requisito de integridad, no una optimización.

**Independent Test**: marcar una noticia como pendiente de entrega para un suscriptor activo,
ejecutar el proceso de retención, y verificar que la noticia sobrevive aunque su antigüedad
supere el período configurado; luego completar su entrega (o dejar que expire su elegibilidad
de envío) y verificar que la siguiente ejecución de retención sí puede eliminarla.

**Acceptance Scenarios**:

1. **Given** una noticia pendiente de entrega para al menos un suscriptor activo y más antigua
   que el período de retención, **When** corre el proceso de retención, **Then** la noticia no
   se elimina.
2. **Given** una noticia ya entregada a todos los suscriptores activos para quienes era
   elegible, **When** corre el proceso de retención y superó el período configurado, **Then** la
   noticia queda disponible para ser eliminada.
3. **Given** una noticia que superó el período máximo de antigüedad para envío sin haber sido
   entregada a algún suscriptor, **When** se evalúa si sigue pendiente, **Then** deja de contar
   como pendiente para ese suscriptor (se descarta en vez de enviarse tarde) y por lo tanto deja
   de bloquear su retención.

---

### User Story 4 - Mensajes acotados, dentro de horario y con baja disponible (Priority: P3)

Como suscriptor, si en un momento dado tengo muchas noticias pendientes recibo un mensaje de
tamaño razonable con las más recientes y una indicación de dónde ver el resto, únicamente
dentro del horario permitido, y siempre puedo darme de baja desde el propio mensaje.

**Why this priority**: protege la experiencia del canal (mensajes desmedidos, horarios
inoportunos) sin afectar la garantía central de no pérdida — las noticias no incluidas por el
tope siguen pendientes, no se pierden.

**Independent Test**: sembrar más noticias pendientes que el tope configurado y ejecutar un
envío fuera y dentro de la ventana horaria permitida; verificar que fuera de ventana no se envía
nada, y que dentro de ventana el mensaje contiene solo las más recientes hasta el tope, indica
que hay más disponibles en la consulta pública, e incluye la vía de baja.

**Acceptance Scenarios**:

1. **Given** un suscriptor con más noticias pendientes que el tope configurado por mensaje,
   **When** se le envía el mensaje, **Then** contiene solo las más recientes hasta el tope y
   una indicación de que el resto está disponible en la consulta pública.
2. **Given** un momento fuera de la ventana horaria permitida, **When** se invoca el envío,
   **Then** no se envía ningún mensaje a nadie, y lo pendiente sigue disponible para el próximo
   envío dentro de la ventana.
3. **Given** cualquier mensaje enviado, **When** el suscriptor lo recibe, **Then** incluye la
   vía de baja definida por la feature de suscripción.

---

### Edge Cases

- Una noticia ya entregada que luego se actualiza (feature de ingesta) NO genera un nuevo envío
  — la identidad de la noticia, no su contenido, determina si ya fue entregada.
- Un suscriptor que se da de baja o es desactivado por señal negativa del canal deja de recibir
  envíos de inmediato, aunque tuviera pendientes; al eliminarse, su historial de entregas se
  elimina con él (una resuscripción posterior empieza sin ese historial y sin acceso a noticias
  previas a la nueva activación).
- Dos procesos de envío no pueden ejecutarse a la vez sobre el mismo conjunto de suscriptores.
- El primer envío del día no tiene una regla especial: es más extenso solo porque acumuló más
  horas, resuelto por el mismo cálculo que cualquier otro envío del día.
- El conjunto entregado por correo diverge intencionalmente del que devuelve la consulta
  pública de noticias del día (esta última se limita al día calendario en curso); no debe
  "corregirse" esa diferencia.
- Una caída prolongada del envío no vuelca todo lo acumulado sin límite: el período máximo de
  antigüedad y el tope por mensaje acotan lo que efectivamente se entrega; lo que queda fuera de
  esos límites se descarta en vez de entregarse tarde — es la única excepción explícita y
  acotada a la promesa de no pérdida, y queda documentada como tal, no como una omisión.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE calcular, en cada corrida de envío, el conjunto de noticias
  pendientes de forma individual por suscriptor activo, nunca como un cálculo global compartido.
- **FR-002**: Una noticia es elegible para un suscriptor si pertenece a la categoría
  configurada, fue publicada después del momento de activación de ese suscriptor, y no es más
  antigua que un período máximo configurable.
- **FR-003**: El sistema DEBE mantener un registro persistente de entregas asociado a la
  combinación noticia/suscriptor/canal; una noticia cuenta como pendiente para un suscriptor
  únicamente si es elegible y no existe un registro de entrega para esa combinación.
- **FR-004**: El cálculo de lo pendiente DEBE hacerse restando el registro de entregas del
  conjunto de elegibles en cada corrida; NO DEBE depender del instante de la última corrida de
  envío para decidir qué es nuevo.
- **FR-005**: Los envíos solo DEBEN ocurrir dentro de una ventana horaria permitida configurable,
  expresada en hora local de Argentina; una invocación fuera de esa ventana NO DEBE enviar nada,
  y lo pendiente queda disponible para la siguiente corrida dentro de la ventana.
- **FR-006**: Toda corrida de envío DEBE resolverse con el mismo procedimiento, sin importar la
  hora del día ni el tiempo transcurrido desde la corrida anterior; no existe un comportamiento
  especial para el primer envío del día.
- **FR-007**: Si el conjunto de pendientes de un suscriptor está vacío, el sistema NO DEBE
  enviarle ningún mensaje.
- **FR-008**: Cada mensaje DEBE incluir, por cada noticia, título, resumen tal como lo publica
  la fuente y enlace al artículo original; el sistema NO DEBE generar ni reescribir contenido.
- **FR-009**: Si el conjunto de pendientes de un suscriptor supera una cantidad máxima
  configurable por mensaje, el sistema DEBE incluir solo las más recientes hasta ese máximo e
  indicar que el resto está disponible en la consulta pública; las noticias excluidas por el
  tope permanecen pendientes (no se registran como entregadas) y son candidatas al envío
  siguiente si siguen siendo elegibles.
- **FR-010**: Cada mensaje DEBE incluir la vía de baja definida por la feature de ciclo de vida
  de suscriptores.
- **FR-011**: El sistema DEBE crear el registro de entrega de una combinación
  noticia/suscriptor/canal únicamente después de que el canal confirme el envío, nunca antes de
  intentarlo.
- **FR-012**: Si la confirmación del canal es ambigua (ni éxito claro ni error claro), el
  sistema DEBE tratar esa noticia como no entregada a ese suscriptor y reintentarla en la
  corrida siguiente.
- **FR-013**: El sistema NO DEBE permitir un segundo registro de entrega para la misma
  combinación noticia/suscriptor/canal, de modo que corridas repetidas o duplicadas no reenvíen
  lo ya confirmado.
- **FR-014**: El seguimiento del resultado de entrega DEBE ser individual por suscriptor: una
  falla parcial en una corrida no debe provocar un reenvío a quienes ya recibieron el mensaje, y
  debe dejar pendiente el contenido para quienes no lo recibieron.
- **FR-015**: El sistema DEBE impedir que dos corridas de envío se ejecuten a la vez sobre el
  mismo conjunto de suscriptores.
- **FR-016**: Una actualización de una noticia ya entregada NO DEBE generar un nuevo envío de
  esa noticia.
- **FR-017**: Un suscriptor que no esté activo (pendiente de confirmación, dado de baja o
  eliminado por señal negativa del canal) NO DEBE recibir ningún envío, aunque tenga pendientes.
- **FR-018**: Un suscriptor recién activado NO DEBE recibir noticias publicadas antes de su
  propio momento de activación.
- **FR-019**: Al eliminarse un suscriptor (baja o supresión), su historial de entregas DEBE
  eliminarse junto con él.
- **FR-020**: Una noticia NO DEBE purgarse por el proceso de retención mientras siga pendiente
  de entrega (elegible y no entregada) para al menos un suscriptor activo. Una noticia deja de
  contar como pendiente para ese propósito cuando se entregó a todos los suscriptores activos
  para quienes era elegible, o cuando supera el período máximo de antigüedad para envío —lo que
  ocurra primero—; esto último es la única excepción explícita y acotada a "ninguna noticia se
  pierde", documentada como tal y no como un vacío del diseño.
- **FR-021**: El sistema DEBE poder ejercitarse de punta a punta en un entorno de desarrollo
  local, sin dominio propio, sin proveedor de correo real y sin ningún servicio de pago,
  siguiendo el mismo patrón ya usado por el endpoint público y la feature de suscripción. En
  particular, DEBE ser posible controlar el paso del tiempo desde las pruebas automatizadas
  (para verificar el comportamiento a lo largo de varias corridas, los límites de la ventana
  horaria, el vencimiento de pendientes por antigüedad y la recuperación tras una caída
  prolongada sin depender del reloj real) y simular cada uno de los tres resultados posibles del
  canal (confirmación exitosa, falla, resultado ambiguo) sin red ni credenciales reales.

### Key Entities

- **Registro de entrega**: asocia una noticia, un suscriptor y un canal; existe únicamente tras
  la confirmación del canal, nunca antes; su ausencia es lo que hace pendiente a una noticia
  para un suscriptor; se elimina junto con el suscriptor al que pertenece.
- **Suscriptor activo** *(reutilizado de la feature de ciclo de vida de suscriptores)*: relevante
  aquí por su estado (`active`) y su momento de activación, que acota qué noticias le
  corresponden.
- **Noticia** *(reutilizada de la feature de ingesta)*: relevante aquí por su categoría, fecha de
  publicación e identidad estable (para que una actualización posterior no cuente como una
  noticia distinta a efectos de entrega).
- **Envío**: el conjunto de mensajes producidos por una corrida dada; no es una entidad
  persistente por sí misma, es el resultado observable de aplicar el cálculo de pendientes en un
  momento dentro de la ventana horaria permitida.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las noticias que corresponden a un suscriptor activo (categoría,
  posteriores a su activación, dentro del período máximo configurado) le llegan sin ninguna
  acción manual de su parte.
- **SC-002**: Bajo operación normal (sin fallas del canal), ningún suscriptor recibe una copia
  repetida de la misma noticia.
- **SC-003**: Tras una interrupción del envío de hasta el período máximo configurado de
  antigüedad, el 100% de lo acumulado que sigue vigente llega en el primer envío posterior a la
  recuperación, sin intervención manual.
- **SC-004**: Ejecutar la misma corrida de envío más de una vez (por error o reintento manual)
  no genera copias adicionales para ningún suscriptor.
- **SC-005**: Ninguna noticia se elimina del sistema mientras siga pendiente de entrega para al
  menos un suscriptor activo.
- **SC-006**: El comportamiento a lo largo de múltiples envíos, los límites de la ventana
  horaria y la recuperación tras una caída prolongada puede verificarse por completo en un
  entorno de desarrollo local, sin dominio propio, proveedor de correo real ni servicios de
  pago.

## Assumptions

- El canal de entrega en este alcance es exclusivamente correo electrónico; el modelo de datos
  (noticia/suscriptor/canal) permite otros canales a futuro sin cambios al núcleo, pero ninguno
  se implementa aquí.
- Los valores concretos (ventana horaria permitida, horarios de envío dentro de ella, período
  máximo de antigüedad para envío, tope de noticias por mensaje) son configuración externa
  explícita, sin valor por defecto embebido — mismo patrón que las variables de entorno de las
  features de ingesta, endpoint público y suscripción ya existentes.
- El ciclo de vida de suscriptores (alta, confirmación, baja, señales negativas del canal) ya
  existe y se reutiliza sin cambios; esta feature solo lee el estado `active` y el momento de
  activación.
- El proceso de purga por retención de noticias (feature de ingesta) requiere ser modificado
  para consultar el estado de "pendiente de entrega" antes de eliminar una noticia; ese cambio
  está dentro del alcance de esta feature, aunque el código de purga resida en el componente de
  ingesta.
- Igual que el ingestor y el endpoint público, este proceso no se programa a sí mismo: la
  invocación periódica dentro de la ventana permitida la provee un mecanismo externo al proceso.
