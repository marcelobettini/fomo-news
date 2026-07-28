# Feature Specification: Endpoint público de solo lectura de noticias del día

**Feature Branch**: `002-public-news-endpoint`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "Exposición pública y de solo lectura del conjunto de noticias del día, consultable por cualquiera en cualquier momento. Cualquier persona o sistema, sin credenciales, puede obtener las noticias de la categoría configurada publicadas durante el día local en curso hasta el momento de la consulta. La consulta devuelve las noticias del día calendario local de Argentina transcurrido hasta ese instante, ordenadas de más reciente a más antigua. De cada noticia se expone título, resumen, enlace al artículo original y fecha de publicación. No se exponen datos internos del sistema. Consultar es una operación estrictamente de lectura: nunca desencadena consultas a la fuente externa, ni escrituras, ni ningún efecto sobre el estado del sistema. La cantidad de consultas recibidas no debe influir de ninguna manera sobre la fuente de noticias. El servicio responde aunque la fuente externa esté caída y aunque el proceso de captura esté fallando: entrega lo último que se haya capturado con éxito. Un día sin noticias todavía —situación normal en las primeras horas de la mañana— es una respuesta válida y vacía, no un error ni una ausencia de recurso. Dos consultas consecutivas sin captura intermedia devuelven exactamente el mismo resultado; el servicio debe permitir que los clientes eviten transferencias redundantes cuando el contenido no cambió. Requisito crítico: una respuesta vacía significa 'todavía no hubo noticias hoy'; si el sistema no puede acceder a los datos almacenados, debe fallar de forma explícita y distinguible, jamás devolver un conjunto vacío — confundir ambas situaciones haría que una caída del almacenamiento se leyera como una mañana tranquila. Acceso público sin identificación; al ser abierto, debe protegerse contra consultas abusivas desde un mismo origen, con rechazo explícito y distinguible de un fallo del servicio. Debe definirse si el servicio será consumido desde páginas web alojadas en otros dominios. El conjunto que devuelve esta consulta no coincide con el que se entrega por notificaciones en una feature posterior (que incluye noticias del final del día anterior todavía no notificadas); la divergencia es deliberada y no debe corregirse. Fuera de alcance: autenticación, suscriptores, envío de notificaciones, filtros por categoría o fecha arbitraria, paginación, histórico más allá del día en curso, y cualquier interfaz visual."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta pública de las noticias del día (Priority: P1)

Como visitante o sistema externo, sin necesidad de credenciales, quiero poder consultar en
cualquier momento el conjunto de noticias de la categoría configurada publicadas durante el
día local en curso, para conocer la actualidad sin registrarme ni autenticarme.

**Why this priority**: es la razón de ser de esta feature; sin esta consulta básica no hay
servicio que ofrecer.

**Independent Test**: se puede validar consultando el servicio en distintos momentos del día
y verificando que devuelve exactamente las noticias de la categoría objetivo publicadas en el
día local en curso hasta ese instante, ordenadas de más reciente a más antigua, sin exigir
ninguna credencial.

**Acceptance Scenarios**:

1. **Given** noticias ya capturadas hoy en la categoría objetivo, **When** se consulta el
   servicio sin credenciales, **Then** se recibe ese conjunto ordenado de más reciente a más
   antigua, con título, resumen, enlace al artículo original y fecha de publicación por cada
   noticia.
2. **Given** una consulta realizada en la madrugada antes de la primera publicación del día,
   **When** se consulta el servicio, **Then** se recibe un conjunto vacío marcado como
   respuesta exitosa, nunca como error.
3. **Given** una noticia publicada de madrugada en UTC pero correspondiente al día local
   anterior, **When** se consulta el servicio en el día en curso, **Then** esa noticia no
   aparece en el resultado.

---

### User Story 2 - Un fallo nunca se confunde con un día sin noticias (Priority: P2)

Como consumidor del servicio (persona o sistema automatizado), necesito poder distinguir con
certeza entre "todavía no hubo noticias hoy" y "el servicio no puede acceder a los datos",
para no interpretar una caída del almacenamiento como una mañana tranquila.

**Why this priority**: sin esta distinción, una falla real del sistema puede pasar
inadvertida indefinidamente detrás de un resultado vacío aparentemente normal.

**Independent Test**: se puede validar forzando por separado los dos escenarios (fuente
externa caída con datos ya capturados disponibles, y almacenamiento inaccesible) y
verificando que producen respuestas distinguibles entre sí y respecto de una consulta normal.

**Acceptance Scenarios**:

1. **Given** la fuente externa inaccesible pero con noticias ya capturadas en corridas
   previas, **When** se consulta el servicio, **Then** se recibe el conjunto ya capturado, sin
   error atribuible a la caída de la fuente.
2. **Given** el proceso de captura fallando en su corrida más reciente, **When** se consulta
   el servicio, **Then** el resultado refleja lo último capturado con éxito, no un vacío
   causado por ese fallo.
3. **Given** el almacenamiento del que depende el servicio inaccesible, **When** se consulta,
   **Then** la respuesta es un fallo explícito y distinguible, nunca un conjunto vacío
   exitoso.

---

### User Story 3 - Consultas repetidas evitan transferencias redundantes (Priority: P3)

Como consumidor automatizado que sondea el servicio con frecuencia, necesito poder detectar
cuándo el contenido no cambió desde mi última consulta, para evitar transferir datos
redundantes.

**Why this priority**: reduce la carga sobre el servicio y la red para consumidores que
sondean periódicamente, sin comprometer la actualidad de los datos.

**Independent Test**: se puede validar consultando dos veces seguidas sin que medie una nueva
captura de noticias, y verificando que el cliente puede confirmar que el resultado no cambió
sin recibir de nuevo el conjunto completo.

**Acceptance Scenarios**:

1. **Given** dos consultas consecutivas sin ninguna captura de noticias entre medio, **When**
   se comparan sus resultados, **Then** son exactamente iguales.
2. **Given** una consulta repetida sobre contenido sin cambios, **When** el cliente indica que
   ya posee el resultado de una consulta anterior, **Then** el servicio se lo confirma sin
   reenviarle el conjunto completo.

---

### User Story 4 - Acceso público protegido contra abuso (Priority: P4)

Como operador del sistema, necesito que el servicio público sin autenticación esté protegido
contra volúmenes abusivos de consultas desde un mismo origen, para que siga disponible para el
resto de los consumidores.

**Why this priority**: al no requerir credenciales, el servicio es un blanco natural de uso
abusivo o de sondeos mal configurados; sin protección, un solo origen podría degradar el
servicio para todos.

**Independent Test**: se puede validar generando un volumen de consultas desde un mismo origen
por encima del umbral definido y verificando que las consultas en exceso son rechazadas de
forma distinguible de un fallo del servicio, mientras otros orígenes siguen siendo atendidos
con normalidad.

**Acceptance Scenarios**:

1. **Given** un origen que supera el umbral de consultas permitido, **When** continúa
   consultando, **Then** las consultas en exceso son rechazadas con una señal distinguible de
   un fallo del servicio.
2. **Given** un origen que respeta el umbral, **When** consulta, **Then** recibe respuesta
   normal sin importar el volumen de consultas de otros orígenes.

---

### Edge Cases

- ¿Qué ocurre en la madrugada, antes de la primera publicación del día? Se devuelve un
  conjunto vacío y exitoso, no un error.
- ¿Qué ocurre en el instante exacto en que cambia el día local? A partir de ese instante la
  consulta refleja el nuevo día en curso (posiblemente vacío) y deja de incluir noticias del
  día anterior, sin importar cuán reciente haya sido su publicación.
- ¿Qué ocurre si nunca hubo una captura exitosa desde que el sistema existe? Es equivalente a
  "sin noticias todavía": conjunto vacío y exitoso. El fallo explícito es exclusivamente por
  inaccesibilidad del almacenamiento, no por ausencia de datos capturados.
- ¿Qué ocurre si varias noticias del día comparten el mismo minuto de publicación (ráfaga)?
  Todas deben aparecer, en un orden estable entre consultas sucesivas, para que dos consultas
  sin captura intermedia sigan devolviendo el mismo resultado.
- ¿Qué ocurre si distintos orígenes exceden el umbral de abuso al mismo tiempo? Cada origen se
  evalúa de forma independiente; rechazar a uno no debe afectar la disponibilidad del servicio
  para los demás.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE exponer una consulta pública, sin requerir identificación ni
  credenciales, que devuelva las noticias de la categoría configurada publicadas durante el
  día calendario local de Argentina en curso, hasta el instante de la consulta.
- **FR-002**: El sistema DEBE ordenar el resultado de más reciente a más antigua según fecha
  de publicación.
- **FR-003**: El sistema DEBE exponer, por cada noticia, únicamente título, resumen, enlace al
  artículo original y fecha de publicación; NUNCA debe exponer datos internos del sistema de
  captura (estado de bloqueo, registro de corridas, copias crudas de diagnóstico).
- **FR-004**: La consulta DEBE ser una operación estrictamente de lectura: no debe escribir en
  el almacenamiento, ni disparar una consulta a la fuente externa, ni producir ningún otro
  efecto sobre el estado del sistema, sin importar la cantidad de consultas recibidas.
- **FR-005**: El sistema DEBE responder con éxito aunque la fuente externa esté caída o el
  proceso de captura esté fallando, entregando el conjunto de noticias capturado con éxito más
  recientemente.
- **FR-006**: Un día en el que todavía no se capturó ninguna noticia DEBE producir una
  respuesta exitosa con un conjunto vacío, nunca un error ni la ausencia de un recurso.
- **FR-007**: Cuando el sistema no pueda acceder a los datos almacenados, DEBE responder con
  un fallo explícito y distinguible de un conjunto vacío exitoso; ambas situaciones NUNCA
  deben resultar indistinguibles para quien consulta.
- **FR-008**: Dos consultas consecutivas sin que medie una nueva captura de noticias DEBEN
  devolver exactamente el mismo resultado.
- **FR-009**: El sistema DEBE permitir a quien consulta determinar que el contenido no cambió
  desde una consulta anterior, sin necesidad de recibir de nuevo el conjunto completo.
- **FR-010**: El sistema DEBE proteger la consulta pública contra volúmenes abusivos de
  consultas desde un mismo origen; el rechazo por exceso DEBE ser explícito y distinguible de
  un fallo del servicio.
- **FR-011**: El sistema DEBE convertir toda fecha de publicación a la fecha y hora local de
  Argentina antes de decidir si una noticia pertenece al día en curso, nunca comparando fechas
  en UTC directamente.
- **FR-012**: Una noticia publicada durante el día local anterior NUNCA debe aparecer en el
  resultado del día en curso, incluso si su fecha de publicación en UTC cae en la madrugada
  del día en curso.
- **FR-013**: El sistema NUNCA debe reescribir, resumir ni generar contenido de una noticia;
  el resumen expuesto es el mismo ya capturado por el sistema de ingesta.
- **FR-014**: El sistema DEBE permitir que la consulta sea consumida desde cualquier origen
  web (cualquier dominio), sin restricción de lista de dominios autorizados, consistente con
  el carácter público y sin identificación del servicio.

### Key Entities

- **Noticia expuesta**: subconjunto de la noticia ya capturada por el sistema de ingesta
  (feature 001), limitado a título, resumen, enlace al artículo original y fecha de
  publicación; no incluye la categoría (siempre la configurada), la fecha de última
  actualización, ni ningún dato interno de bookkeeping del sistema de captura.
- **Día en curso**: el día calendario local de Argentina vigente en el instante de la
  consulta; determina qué subconjunto del total de noticias almacenadas se expone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las consultas realizadas durante una caída de la fuente externa
  siguen respondiendo con éxito, entregando el último conjunto de noticias capturado.
- **SC-002**: El 0% de las respuestas ante una falla real de acceso a los datos almacenados se
  confunde con una respuesta vacía y exitosa.
- **SC-003**: Dos consultas consecutivas sin captura intermedia devuelven resultados
  idénticos el 100% de las veces.
- **SC-004**: Una noticia publicada durante el día local en curso queda disponible en la
  consulta pública sin demora adicional atribuible a este servicio, más allá del tiempo que ya
  toma el sistema de captura en almacenarla.
- **SC-005**: Ninguna cantidad de consultas públicas produce un acceso adicional a la fuente
  externa de noticias.
- **SC-006**: Un origen que excede el umbral de consultas definido recibe un rechazo explícito
  el 100% de las veces, sin afectar la disponibilidad del servicio para otros orígenes.

## Clarifications

### Session 2026-07-28

- Q: ¿el servicio acepta consultas desde cualquier dominio web, o solo desde una lista
  específica de dominios autorizados? → A: cualquier origen, sin restricción de dominio.

## Assumptions

- Esta consulta lee del mismo almacenamiento que alimenta el sistema de captura periódica
  (feature 001); no introduce una fuente de datos propia ni una copia independiente.
- El conjunto de campos expuestos (título, resumen, enlace, fecha de publicación) es
  exactamente el definido en la descripción de esta feature; no se expone la categoría (es
  siempre la configurada, conocida de antemano) ni la fecha de última actualización.
- El umbral cuantitativo de consultas que constituye "uso abusivo" es un parámetro de
  configuración del sistema; su valor concreto no forma parte de esta especificación (mismo
  tratamiento que los umbrales de la feature 001).
- El mecanismo exacto por el cual un cliente detecta que el contenido no cambió sin recibir de
  nuevo el conjunto completo es una decisión de diseño técnico, fuera del alcance de esta
  especificación.
- El conjunto que devuelve esta consulta (solo el día local en curso) es deliberadamente
  distinto del conjunto que consumirá una futura feature de notificaciones (que además
  necesitará la cola pendiente de entrega del final del día anterior); esta divergencia es
  intencional y no debe resolverse unificando ambos conjuntos.
- Fuera de alcance: autenticación, suscriptores, envío de notificaciones, filtros por
  categoría o fecha arbitraria, paginación, histórico más allá del día en curso, y cualquier
  interfaz visual.
