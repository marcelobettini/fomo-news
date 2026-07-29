# Feature Specification: Alta, confirmación y baja de suscriptores por correo electrónico

**Feature Branch**: `003-subscriber-lifecycle`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "Alta, confirmación y baja de suscriptores que reciben las noticias por correo electrónico, con consentimiento verificable y protección frente al abuso. Objetivo: El sistema debe poder mantener un conjunto de destinatarios que dieron consentimiento explícito y verificado para recibir noticias, permitirles darse de baja en cualquier momento sin fricción, y desactivar automáticamente a quienes el canal de correo indique como inválidos o disconformes. Ninguna persona puede recibir un envío sin haber confirmado activamente su suscripción; esto es una condición de operación (reputación del remitente compartida) y no una decisión de producto. Alta: cualquier persona puede solicitar el alta indicando un correo; la solicitud crea una suscripción pendiente de confirmación, nunca activa. El sistema envía un enlace de confirmación de un solo uso y vencimiento corto; la suscripción se activa únicamente al usarlo; un enlace vencido o ya usado no activa nada y comunica el motivo. Al activarse se registra el instante de activación, que determina desde cuándo la persona empieza a recibir noticias (nunca noticias publicadas antes de suscribirse). Baja: disponible siempre, desde un enlace en cada mensaje y desde una vía directa; un solo paso, sin confirmación adicional, sin credenciales, sin sesión. La baja elimina efectivamente los datos personales, conservando solo lo mínimo indispensable para no reenviar por error. Quien se da de baja puede volver a suscribirse pasando de nuevo por confirmación. Desactivación automática por señales del canal: dirección permanentemente inválida o queja de no deseado desactivan la suscripción sin intervención humana; un fallo transitorio de entrega no desactiva a nadie. Restricciones y casos límite: el alta es la única superficie donde alguien no autenticado puede provocar un envío, por lo que es la principal superficie de abuso. Solicitudes repetidas para la misma dirección no deben generar un mensaje por intento ni acumular solicitudes pendientes. Debe existir limitación de tasa por origen y por dirección de destino. La respuesta al alta debe ser idéntica sin importar si la dirección ya estaba registrada, no estaba, o estaba pendiente. Los enlaces de confirmación y de baja deben ser imposibles de adivinar o derivar del correo. Una dirección con formato inválido se rechaza sin generar envío. Sobre datos personales: se conserva lo estrictamente necesario para operar y para acreditar consentimiento; las direcciones no deben quedar registradas en bitácoras de operación; existe una tensión real entre acreditar consentimiento y minimizar datos, que la especificación debe resolver explícitamente. Costura con la feature siguiente: el envío periódico de noticias es una feature aparte; esta feature define el ciclo de vida del suscriptor y la capacidad de enviarle un mensaje individual (necesaria para la confirmación), pero no qué noticias recibe, cuándo, ni cómo se calcula lo pendiente de entregar; el instante de activación registrado aquí es el dato del que dependerá esa feature siguiente. Fuera de alcance: composición del resumen de noticias, horarios de envío, cálculo de lo pendiente de entregar, registro de entregas, canales distintos del correo electrónico, autenticación de usuarios, preferencias por suscriptor, e interfaz web de administración."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Alta con consentimiento verificado (doble opt-in) (Priority: P1)

Como persona interesada en recibir las noticias, quiero poder indicar mi correo electrónico y
confirmar activamente mediante un enlace que me llega a esa misma dirección, para que mi
suscripción quede activa únicamente cuando yo lo haya confirmado y nunca antes.

**Why this priority**: es la razón de ser de la feature; sin consentimiento verificado no hay
base legítima para enviar correo a nadie, y el resto del sistema (incluida la reputación de
envío compartida) depende de que esto se cumpla siempre.

**Independent Test**: se puede validar solicitando el alta con una dirección de correo,
verificando que no se activa ninguna suscripción hasta usar el enlace recibido, y que al
usarlo la suscripción pasa a estar activa con un instante de activación registrado.

**Acceptance Scenarios**:

1. **Given** una dirección de correo válida que nunca solicitó el alta, **When** se solicita
   el alta, **Then** se crea una suscripción en estado pendiente (no activa) y se envía un
   mensaje con un enlace de confirmación de un solo uso y vencimiento corto.
2. **Given** una suscripción pendiente de confirmación, **When** no se usa el enlace recibido,
   **Then** esa dirección nunca recibe un envío de noticias.
3. **Given** un enlace de confirmación válido y no vencido, **When** se lo usa, **Then** la
   suscripción pasa a estar activa y se registra el instante exacto de esa activación.
4. **Given** un enlace de confirmación ya usado una vez, **When** se lo intenta usar de nuevo,
   **Then** la suscripción no se activa (ni se reactiva ni se altera) y se comunica que el
   enlace ya fue utilizado.
5. **Given** un enlace de confirmación cuyo vencimiento ya pasó, **When** se lo intenta usar,
   **Then** la suscripción no se activa y se comunica claramente que el enlace venció.

---

### User Story 2 - Baja sin fricción (Priority: P2)

Como suscriptor activo, quiero poder darme de baja en un solo paso, sin necesidad de
credenciales ni de iniciar sesión, para dejar de recibir correo de inmediato cuando ya no lo
quiera.

**Why this priority**: es un requisito de operación impuesto por los proveedores de correo
(no una preferencia de diseño); sin una baja de un solo paso el sistema arriesga su capacidad
de envío completa.

**Independent Test**: se puede validar usando el enlace de baja presente en un mensaje
recibido (o la vía directa equivalente) y verificando que, sin pedir ninguna credencial ni
paso adicional, la suscripción deja de estar activa y los datos personales asociados dejan de
estar almacenados.

**Acceptance Scenarios**:

1. **Given** una suscripción activa, **When** se usa el enlace de baja incluido en un mensaje
   recibido, **Then** la baja se completa en ese único paso, sin pedir credenciales ni
   confirmación adicional.
2. **Given** una baja recién completada, **When** se intenta acceder a los datos personales de
   esa persona, **Then** ya no están almacenados (solo persiste lo mínimo no reversible
   necesario para no reenviar por error).
3. **Given** una persona que se dio de baja, **When** solicita el alta nuevamente más
   adelante, **Then** vuelve a quedar en estado pendiente y debe confirmar de nuevo mediante un
   nuevo enlace.

---

### User Story 3 - Desactivación automática por señales del canal (Priority: P3)

Como operador del sistema, necesito que las suscripciones se desactiven automáticamente
cuando el canal de correo informe que una dirección es permanentemente inválida o que su
titular se quejó de correo no deseado, para no seguir enviando a quien no corresponde y
proteger la capacidad de envío de todo el sistema.

**Why this priority**: ignorar estas señales pone en riesgo la posibilidad de enviar correo
para todos los suscriptores, no solo para la dirección afectada; es una condición de
supervivencia operativa del sistema, aunque de menor frecuencia que el alta y la baja.

**Independent Test**: se puede validar simulando por separado una notificación de dirección
permanentemente inválida, una queja de no deseado y un fallo transitorio, y verificando que
solo las dos primeras desactivan la suscripción, sin intervención humana.

**Acceptance Scenarios**:

1. **Given** una suscripción activa, **When** el canal de correo informa que la dirección es
   permanentemente inválida, **Then** la suscripción se desactiva automáticamente, sin
   intervención humana.
2. **Given** una suscripción activa, **When** el canal de correo informa una queja de correo
   no deseado sobre un mensaje enviado a esa dirección, **Then** la suscripción se desactiva
   de inmediato.
3. **Given** una suscripción activa, **When** el canal de correo informa un fallo de entrega
   transitorio, **Then** la suscripción permanece activa, sin ningún cambio de estado.

---

### User Story 4 - Protección contra abuso en el alta (Priority: P4)

Como operador del sistema, necesito que la solicitud de alta —el único punto donde alguien no
autenticado puede provocar un envío— esté protegida contra abuso, para que no pueda usarse
para hostigar a terceros ni para averiguar quién está suscripto.

**Why this priority**: sin estas protecciones, la superficie de alta puede convertirse en una
herramienta de hostigamiento hacia direcciones ajenas y en un mecanismo de enumeración de
suscriptores; ambos daños recaen sobre la reputación y la privacidad que sostienen a todo el
sistema.

**Independent Test**: se puede validar solicitando el alta repetidamente para la misma
dirección desde el mismo origen y verificando que no se generan mensajes ni suscripciones
pendientes adicionales, que la tasa de solicitudes está limitada por origen y por dirección de
destino, y que la respuesta observable es idéntica sin importar el estado previo de la
dirección solicitada.

**Acceptance Scenarios**:

1. **Given** una dirección con una suscripción ya pendiente o ya activa, **When** se solicita
   el alta repetidamente para esa misma dirección, **Then** no se envía un mensaje de
   confirmación por cada solicitud ni se acumula más de una solicitud pendiente por dirección.
2. **Given** un volumen de solicitudes de alta que excede el umbral permitido desde un mismo
   origen, o hacia una misma dirección de destino, **When** continúan las solicitudes,
   **Then** las solicitudes en exceso son rechazadas.
3. **Given** tres solicitudes de alta para direcciones en estados distintos (activa, pendiente,
   nunca registrada), **When** se comparan las respuestas recibidas, **Then** son idénticas
   entre sí y no permiten inferir en qué estado estaba cada dirección.
4. **Given** una dirección con formato de correo electrónico inválido, **When** se solicita el
   alta con ella, **Then** la solicitud se rechaza sin generar ningún envío.

---

### Edge Cases

- ¿Qué ocurre si alguien solicita el alta para una dirección que ya está activa? La respuesta
  observable es idéntica a la de cualquier otra solicitud de alta y no se genera un nuevo
  mensaje de confirmación ni se altera la suscripción activa existente.
- ¿Qué ocurre si el enlace de confirmación se usa exactamente en el instante de su
  vencimiento? Se resuelve a favor de un único criterio consistente (vencido o vigente) de
  modo que el resultado sea determinístico y nunca ambiguo entre "vencido" y "ya usado".
- ¿Qué ocurre si llega una señal de dirección permanentemente inválida para una dirección que
  ya estaba dada de baja o que nunca existió como suscripción activa? La señal no tiene efecto
  adicional; no hay una suscripción activa que desactivar.
- ¿Qué ocurre si llegan una queja de no deseado y una notificación de fallo transitorio para
  la misma dirección en un orden arbitrario? La queja desactiva la suscripción
  independientemente del orden; el fallo transitorio nunca revierte esa desactivación.
- ¿Qué ocurre si alguien intenta usar el enlace de baja de un mensaje después de haberse dado
  de baja por ese mismo enlace? La baja ya fue efectiva; los datos personales ya fueron
  eliminados y una segunda ejecución de la vía de baja no produce ningún efecto adicional ni
  error visible que revele el estado previo.
- ¿Qué ocurre si se solicita el alta para una dirección con formato válido pero con un dominio
  al que el sistema nunca podrá enviarle correo? Queda fuera del alcance de esta feature
  distinguir ese caso del de una dirección de dominio operativo; se trata igual que cualquier
  otra alta hasta que el canal de correo, tras el intento de envío, informe una señal de
  dirección permanentemente inválida.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir que cualquier persona, sin credenciales ni sesión
  iniciada, solicite el alta indicando únicamente una dirección de correo electrónico.
- **FR-002**: Una solicitud de alta NUNCA debe crear ni activar una suscripción directamente;
  DEBE crear (o reutilizar, si ya existe) una suscripción en estado pendiente de confirmación.
- **FR-003**: Tras una solicitud de alta válida para una dirección sin suscripción pendiente
  vigente, el sistema DEBE enviar a esa dirección un mensaje con un enlace de confirmación de
  un solo uso y de vencimiento corto.
- **FR-004**: Un enlace de confirmación ya utilizado exitosamente NUNCA debe volver a activar
  ni alterar la suscripción en usos posteriores.
- **FR-005**: Un enlace de confirmación vencido NUNCA debe activar la suscripción; el sistema
  DEBE comunicar de forma explícita que el motivo fue el vencimiento, distinguible de otros
  motivos de rechazo (por ejemplo, enlace ya usado).
- **FR-006**: Al usarse por primera vez un enlace de confirmación válido y no vencido, el
  sistema DEBE activar la suscripción y registrar el instante exacto de esa activación con
  precisión suficiente para que una feature posterior pueda excluir sin ambigüedad cualquier
  noticia publicada antes de ese instante.
- **FR-007**: Mientras una suscripción esté en estado pendiente, eliminado, o dada de baja, la
  dirección asociada NUNCA debe recibir un envío de noticias; el único mensaje permitido en
  estado pendiente es el propio mensaje de confirmación.
- **FR-008**: El sistema DEBE ofrecer una vía de baja disponible en todo momento: un enlace
  presente en cada mensaje enviado y una vía directa independiente de haber recibido un
  mensaje previo.
- **FR-009**: La baja DEBE completarse en un único paso, sin requerir confirmación adicional,
  sin credenciales y sin sesión iniciada.
- **FR-010**: Al completarse una baja (ya sea solicitada por la persona o por desactivación
  automática por señales del canal), el sistema DEBE eliminar de forma efectiva los datos
  personales asociados a esa dirección, conservando únicamente un identificador no reversible
  y no derivable del correo original, suficiente para evitar reenviar mensajes por error a esa
  misma dirección.
- **FR-011**: Una persona cuya suscripción fue dada de baja (por su propia solicitud o por
  desactivación automática) DEBE poder solicitar el alta nuevamente en el futuro, y esa nueva
  solicitud DEBE pasar otra vez por el proceso completo de confirmación, sin excepción.
- **FR-012**: El sistema DEBE desactivar automáticamente, sin intervención humana, una
  suscripción activa cuando el canal de correo informe que la dirección asociada es
  permanentemente inválida.
- **FR-013**: El sistema DEBE desactivar automáticamente, sin intervención humana, una
  suscripción activa cuando el canal de correo informe una queja de correo no deseado sobre un
  mensaje enviado a esa dirección.
- **FR-014**: Un fallo de entrega transitorio informado por el canal de correo NUNCA debe
  desactivar ninguna suscripción.
- **FR-015**: Mientras exista una suscripción pendiente o activa para una dirección,
  solicitudes de alta adicionales para esa misma dirección NUNCA deben generar un nuevo
  mensaje de confirmación por cada solicitud ni acumular más de una solicitud pendiente por
  dirección.
- **FR-016**: El sistema DEBE limitar la tasa de solicitudes de alta tanto por origen de la
  solicitud como por dirección de destino, rechazando el exceso por encima del umbral
  definido.
- **FR-017**: La respuesta observable a una solicitud de alta DEBE ser idéntica en su forma sin
  importar si la dirección ya tenía una suscripción activa, pendiente, o no tenía ninguna, de
  modo que no sea posible inferir el estado de una dirección a partir de esa respuesta.
- **FR-018**: Los identificadores utilizados en los enlaces de confirmación y de baja DEBEN
  ser generados de forma que resulte imposible adivinarlos o derivarlos a partir de la
  dirección de correo asociada.
- **FR-019**: Una dirección de correo con formato inválido DEBE rechazarse en la solicitud de
  alta sin generar ningún envío.
- **FR-020**: El sistema NUNCA debe registrar la dirección de correo electrónico de un
  suscriptor en bitácoras de operación; cualquier referencia a un suscriptor en dichas
  bitácoras DEBE hacerse mediante un identificador que no sea la dirección ni permita
  reconstruirla.
- **FR-021**: El sistema DEBE conservar, para cada suscripción activa, evidencia suficiente
  para acreditar que hubo consentimiento verificado (como mínimo, el instante de activación),
  sin retener datos personales adicionales más allá de los estrictamente indispensables para
  operar el envío.
- **FR-022**: El sistema DEBE exponer la capacidad de enviar un mensaje individual a una
  dirección de correo determinada (usada por esta misma feature para el mensaje de
  confirmación), sin definir con ella qué noticias componen un envío periódico ni cuándo este
  ocurre.

### Key Entities

- **Suscriptor**: representa a una dirección de correo electrónico y su relación con el
  sistema a lo largo del tiempo. Atributos relevantes: estado (pendiente de confirmación,
  activo, o sin suscripción vigente), instante de activación (presente solo mientras está
  activo), e identificadores opacos y no derivables usados para confirmar o dar de baja. Tras
  una baja o desactivación, el suscriptor deja de existir como tal, salvo por un registro de
  supresión mínimo.
- **Solicitud de confirmación**: representa el enlace de un solo uso emitido tras una
  solicitud de alta. Atributos relevantes: vencimiento corto, estado (vigente, usado, o
  vencido), y asociación exclusiva a una única dirección. Como máximo una solicitud de
  confirmación vigente existe por dirección en un momento dado.
- **Registro de supresión**: identificador no reversible y no derivable de la dirección
  original que persiste después de una baja o una desactivación automática, con el único
  propósito de impedir reenvíos accidentales a esa dirección; no contiene la dirección de
  correo en texto claro ni ningún otro dato personal.
- **Señal del canal**: evento recibido desde el canal de envío de correo respecto de un
  mensaje ya enviado, clasificado como fallo permanente, queja de no deseado, o fallo
  transitorio; determina si corresponde o no desactivar automáticamente la suscripción
  asociada.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las direcciones que solicitaron el alta sin haber confirmado nunca
  reciben un envío de noticias.
- **SC-002**: El 0% de los enlaces de confirmación usados una segunda vez logran activar o
  alterar una suscripción.
- **SC-003**: El 100% de los intentos de uso de un enlace de confirmación vencido son
  rechazados con el motivo de vencimiento comunicado explícitamente.
- **SC-004**: El 100% de las bajas se completan en un único paso, sin credenciales, y a partir
  de ese instante esa dirección no recibe ningún envío posterior.
- **SC-005**: El 100% de las bajas dejan de tener la dirección de correo original almacenada
  en forma identificable, dentro de un plazo no mayor a la propia operación de baja.
- **SC-006**: El 100% de las personas dadas de baja que vuelven a solicitar el alta requieren
  una nueva confirmación antes de recibir cualquier envío.
- **SC-007**: Ninguna secuencia de solicitudes de alta repetidas para la misma dirección
  produce más de un mensaje de confirmación vigente a la vez.
- **SC-008**: El 100% de las respuestas a solicitudes de alta son indistinguibles entre sí
  respecto del estado previo de la dirección solicitada.
- **SC-009**: El 100% de las notificaciones de dirección permanentemente inválida
  desactivan la suscripción correspondiente sin intervención humana.
- **SC-010**: El 100% de las quejas de correo no deseado desactivan la suscripción
  correspondiente de inmediato.
- **SC-011**: El 0% de los fallos de entrega transitorios desactivan una suscripción.
- **SC-012**: El 100% de las suscripciones activadas registran un instante de activación
  utilizable por la feature de envío para excluir noticias anteriores a ese instante.

## Assumptions

- **Vencimiento del enlace de confirmación**: se asume un plazo corto estándar (del orden de
  24 horas) como vencimiento por defecto, calibrable operativamente sin cambiar el
  comportamiento funcional descrito.
- **Umbrales de limitación de tasa**: los valores concretos (cantidad de solicitudes por
  origen y por dirección de destino en una ventana de tiempo dada) son un parámetro operativo
  a calibrar, no una decisión de producto; el requisito funcional es la existencia de ambos
  límites, no un número específico.
- **Resolución de la tensión entre acreditar consentimiento y minimizar datos**: se resuelve
  reteniendo, mientras la suscripción está activa, solo la dirección de correo y el instante
  de activación (evidencia mínima y suficiente de consentimiento verificado). Al darse de baja
  (por cualquier vía), la dirección en texto claro se elimina y se reemplaza por un
  identificador no reversible y no derivable de ella, cuyo único propósito es evitar reenvíos
  accidentales; ese identificador no permite reconstruir la dirección original ni sirve como
  evidencia de consentimiento hacia el pasado.
- **Reintento de solicitud de alta durante el período pendiente**: solicitar el alta
  nuevamente mientras ya existe una solicitud de confirmación vigente para la misma dirección
  no genera un mensaje adicional; se asume que, pasado un período de enfriamiento razonable,
  una nueva solicitud sí puede emitir un nuevo enlace (invalidando el anterior), en vez de
  bloquear indefinidamente a alguien que legítimamente no recibió o perdió el mensaje original.
- **Clasificación de señales del canal**: se asume que el canal de envío de correo (proveedor
  o servicio de correo saliente) ya entrega las notificaciones de rebote y queja clasificadas
  (permanente vs. transitorio, queja vs. fallo); esta feature reacciona a esa clasificación ya
  resuelta y no implementa lógica propia de interpretación de encabezados o códigos de
  protocolo de correo.
- **Capacidad de envío individual**: esta feature requiere poder enviar un mensaje a una
  dirección puntual (para el propio flujo de confirmación); esa capacidad de envío es un
  requisito de esta feature, pero su uso para el envío periódico de noticias, la composición
  del contenido y el cálculo de lo pendiente de entregar pertenecen a la feature siguiente.
- **Formato de correo válido**: se asume validación de formato según los estándares habituales
  de direcciones de correo electrónico (sintaxis general aceptada), sin verificar en esta
  etapa si el dominio existe o acepta correo; esa determinación queda en manos del canal de
  correo al intentar la entrega real.
