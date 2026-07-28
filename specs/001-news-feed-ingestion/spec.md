# Feature Specification: Captura periódica de noticias con retención acotada y detección de pérdidas

**Feature Branch**: `001-news-feed-ingestion`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "Captura periódica de noticias locales desde el feed de un diario de Tandil, con retención acotada y detección de pérdidas. El sistema debe mantener disponible, en todo momento, el conjunto completo de noticias recientes de una categoría específica publicadas por la fuente, sin que ninguna se pierda. De forma periódica y sin intervención humana, el sistema consulta el feed de la fuente, identifica las noticias que aún no conoce y las incorpora, de forma idempotente. Conserva únicamente título, resumen tal como lo publica la fuente, enlace al artículo original, fecha de publicación, fecha de última actualización y categoría, solo para la categoría configurada. Las actualizaciones de una noticia ya conocida se reflejan sin volver a contarla como nueva. Las noticias se eliminan pasado un período de retención rodante que debe cubrir el cruce entre el fin de un día local y el comienzo del siguiente. La fuente expone una ventana deslizante de tamaño fijo en ítems (las últimas 20 publicaciones); lo que sale de esa ventana desaparece sin dejar rastro, por lo que la frecuencia de consulta debe evitar que la ventana rote completa entre corridas. El sistema debe hacer ruido ante: rotación completa de la ventana entre corridas, ausencia prolongada de noticias de la categoría objetivo, y aparición de categorías nunca vistas. Cada corrida registra su resultado (momento, entradas vistas, entradas nuevas, antigüedad de la entrada más antigua, errores) y una corrida sin resultados nunca se registra como exitosa. Ante fallas de la fuente, el sistema se degrada de forma visible sin corromper el estado existente y se recupera solo. Se conserva por pocos días una copia cruda de cada respuesta, solo para diagnóstico. Fuera de alcance: exposición HTTP, suscriptores, notificaciones, múltiples fuentes, extracción desde HTML."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Captura idempotente y filtrada por categoría (Priority: P1)

Como operador del sistema, necesito que cada consulta periódica a la fuente incorpore
únicamente las noticias nuevas de la categoría configurada, con los campos correctos y sin
duplicados, para que el conjunto disponible de noticias recientes sea siempre completo y
confiable.

**Why this priority**: es el mecanismo central del que depende la promesa de "no perder
ninguna noticia". Sin una captura correcta e idempotente, ningún otro comportamiento
(retención, alarmas) tiene sentido.

**Independent Test**: se puede validar ejecutando la corrida dos veces seguidas sobre el
mismo estado de la fuente y verificando que el conjunto de noticias almacenadas es idéntico
en ambos casos, y que solo contiene noticias de la categoría configurada con los campos
esperados.

**Acceptance Scenarios**:

1. **Given** una fuente con noticias nuevas de la categoría objetivo, **When** se ejecuta una
   corrida, **Then** las noticias nuevas quedan almacenadas con título normalizado, resumen
   sin marcado HTML ni imagen inicial, enlace, fecha de publicación, fecha de última
   actualización y categoría.
2. **Given** una corrida ya ejecutada sin cambios nuevos en la fuente, **When** se ejecuta una
   segunda corrida, **Then** el estado almacenado permanece idéntico al de la primera corrida.
3. **Given** una noticia ya almacenada cuyo contenido fue actualizado en la fuente, **When** se
   ejecuta una corrida, **Then** el contenido almacenado se actualiza sin que la noticia se
   cuente como nueva.
4. **Given** entradas de categorías distintas a la configurada, **When** se ejecuta una
   corrida, **Then** ninguna de esas entradas queda almacenada.
5. **Given** una entrada con fecha de publicación de madrugada en UTC, **When** se procesa
   para decisiones de negocio, **Then** se le atribuye el día local de Argentina que
   corresponde a esa fecha convertida.

---

### User Story 2 - Retención acotada que protege las noticias de fin de día (Priority: P2)

Como operador del sistema, necesito que las noticias se retengan el tiempo suficiente para
cubrir el cruce entre el cierre de un día local y la apertura del siguiente, para que ninguna
noticia publicada tarde en el día desaparezca antes de estar disponible al día siguiente.

**Why this priority**: sin esta protección, la promesa de integridad del flujo de noticias se
rompe específicamente en el borde de cada día, un caso que ocurre todos los días.

**Independent Test**: se puede validar publicando (o simulando) una noticia cerca del cierre
de un día local y verificando que sigue presente en el conjunto de noticias en la primera
consulta del día local siguiente, y que noticias más antiguas que el período de retención ya
no lo están.

**Acceptance Scenarios**:

1. **Given** una noticia publicada cerca del final de un día local, **When** transcurre el
   cruce hacia el día siguiente, **Then** la noticia continúa disponible en el conjunto
   almacenado.
2. **Given** una noticia cuyo período de retención configurado ya venció, **When** se ejecuta
   una corrida posterior a ese vencimiento, **Then** la noticia deja de estar disponible en el
   conjunto almacenado.

---

### User Story 3 - Detección de pérdidas y alarmas (Priority: P3)

Como operador del sistema, necesito recibir una señal distinguible cuando ocurra una
condición que indique pérdida de noticias o un cambio en la fuente que la fuente no explicita
por sí sola, para poder actuar antes de que el sistema falle en silencio.

**Why this priority**: complementa a las historias anteriores como red de seguridad: aun con
una cadencia de ingesta bien calibrada, la fuente puede comportarse de forma inesperada, y el
sistema no debe aparentar salud mientras deja de capturar noticias.

**Independent Test**: se puede validar forzando escenarios de fuente (ventana completamente
nueva entre corridas, ausencia total de la categoría objetivo, categoría nunca vista) y
verificando que cada uno produce una señal distinguible de una corrida normal, junto con el
registro correspondiente de la corrida.

**Acceptance Scenarios**:

1. **Given** una corrida en la que el cien por ciento de las entradas vistas son nuevas,
   **When** finaliza la corrida, **Then** se emite una alarma de pérdida de datos confirmada.
2. **Given** un período prolongado sin ninguna entrada de la categoría objetivo, **When** se
   cumple ese período, **Then** se emite una alarma distinguible de la operación normal.
3. **Given** una entrada con una categoría nunca antes observada, **When** se procesa esa
   entrada, **Then** el sistema registra la nueva categoría y emite una señal de novedad.
4. **Given** una corrida que no encuentra ninguna entrada nueva ni existente, **When**
   finaliza, **Then** esa corrida nunca queda registrada como exitosa.
5. **Given** una fuente que no responde o responde de forma inválida, **When** se ejecuta una
   corrida, **Then** la corrida se registra como fallida de forma visible, las noticias ya
   almacenadas permanecen intactas y disponibles, y la corrida siguiente puede recuperarse
   automáticamente.
6. **Given** más publicaciones nuevas entre dos corridas que el tamaño de la ventana de la
   fuente, **When** se detecta esa condición, **Then** el sistema la reporta como pérdida de
   datos.

---

### Edge Cases

- ¿Qué ocurre si una entrada no incluye fecha de última actualización? Se asume igual a la
  fecha de publicación (ver Assumptions).
- ¿Qué ocurre si el resumen de una entrada no contiene marcado HTML? Se conserva tal cual, sin
  transformación adicional.
- ¿Qué ocurre si la fuente publica varias noticias con el mismo minuto de publicación (ráfaga)?
  Todas deben procesarse individualmente sin que la simultaneidad afecte la detección de
  duplicados ni el conteo de nuevas.
- ¿Qué ocurre si la fuente estuvo caída durante varias corridas y, al recuperarse, su ventana
  ya rotó por completo respecto de la última captura exitosa? Se reporta como pérdida de datos
  (ver User Story 3, escenario 6), no como una corrida exitosa con cero novedades.
- ¿Qué ocurre si la categoría declarada en una entrada y la categoría presente en la ruta de
  su enlace no coinciden? La entrada se almacena o descarta según su categoría declarada (como
  cualquier otra entrada); la inconsistencia se registra como señal de anomalía, sin bloquear
  la captura ni escalar a alarma de pérdida.
- ¿Qué ocurre en la primera corrida de la vida del sistema, cuando no existe ningún registro
  de entregas previo y por lo tanto el cien por ciento de las entradas vistas son
  necesariamente nuevas? Esa primera corrida se trata como inicialización y no dispara la
  alarma de "ventana rotada por completo"; la alarma queda activa desde la segunda corrida en
  adelante.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE consultar periódicamente la fuente configurada, con una cadencia
  suficiente para que la ventana de últimos ítems de la fuente no rote por completo entre dos
  corridas consecutivas.
- **FR-002**: El sistema DEBE identificar y almacenar únicamente las noticias que no haya
  almacenado previamente, sin generar duplicados aunque una corrida se repita sobre el mismo
  estado de la fuente.
- **FR-003**: El sistema DEBE conservar, por cada noticia almacenada, únicamente: título
  normalizado, resumen tal como lo publica la fuente sin marcado HTML ni la imagen inicial,
  enlace al artículo original, fecha de publicación, fecha de última actualización y
  categoría.
- **FR-004**: El sistema NUNCA DEBE conservar el cuerpo completo del artículo.
- **FR-005**: El sistema DEBE descartar, sin almacenar, cualquier entrada cuya categoría no
  coincida con la categoría configurada como objetivo.
- **FR-006**: El sistema DEBE normalizar espacios en blanco y saltos de línea en título y
  nombre de autor antes de almacenar o comparar una entrada.
- **FR-007**: Cuando la fuente publique una actualización sobre una noticia ya almacenada, el
  sistema DEBE reflejar el contenido actualizado sin volver a contarla como nueva ni disparar
  de nuevo los efectos asociados a una noticia nueva.
- **FR-008**: El sistema DEBE eliminar automáticamente una noticia almacenada una vez
  transcurrido el período de retención configurado, medido de forma rodante desde su fecha de
  publicación.
- **FR-009**: El período de retención DEBE cubrir, como mínimo, el intervalo entre el último
  evento de entrega de un día local y el primero del día local siguiente, de modo que una
  noticia publicada al final de un día siga disponible al comienzo del siguiente.
- **FR-010**: El sistema DEBE convertir toda fecha de publicación provista en UTC a la fecha y
  hora local de Argentina antes de tomar cualquier decisión de negocio basada en el día
  calendario.
- **FR-011**: El sistema DEBE validar la categoría declarada de cada entrada contra la
  categoría indicada en la ruta de su enlace, y DEBE registrar una señal de anomalía cuando no
  coincidan, sin que esto impida almacenar o descartar la entrada según su categoría
  declarada ni escale a alarma de pérdida de datos.
- **FR-012**: El sistema DEBE registrar toda categoría observada en la fuente, incluidas las
  descartadas por no ser la categoría objetivo.
- **FR-013**: El sistema DEBE emitir una alarma de pérdida de datos confirmada cuando el cien
  por ciento de las entradas vistas en una corrida resulten nuevas, excepto en la primera
  corrida de la vida del sistema (sin registro de entregas previo), que se trata como
  inicialización y no dispara esta alarma.
- **FR-014**: El sistema DEBE emitir una alarma distinguible de la operación normal cuando
  transcurra un período prolongado sin registrar ninguna entrada de la categoría objetivo.
- **FR-015**: El sistema DEBE emitir una señal de novedad, distinguible de una alarma de
  pérdida, cuando aparezca una categoría nunca antes observada en la fuente.
- **FR-016**: Cada corrida DEBE registrar como mínimo: momento de ejecución, cantidad total de
  entradas vistas, cantidad de entradas nuevas, antigüedad de la entrada más antigua presente
  en el feed en ese momento, y los errores ocurridos si los hubo.
- **FR-017**: Una corrida que no produzca ningún resultado NUNCA DEBE registrarse como
  exitosa.
- **FR-018**: Cuando la fuente no responda o responda de forma inválida, el sistema DEBE
  registrar la corrida como fallida de forma visible, sin alterar ni eliminar las noticias ya
  almacenadas.
- **FR-019**: Tras una corrida fallida, las corridas siguientes DEBEN poder recuperarse
  automáticamente sin intervención manual.
- **FR-020**: El sistema DEBE conservar una copia sin procesar de cada respuesta de la fuente
  durante un período acotado, con el único propósito de diagnóstico, sin exponerla como dato
  ni como fuente histórica.
- **FR-021**: Dos corridas consecutivas que no encuentren noticias nuevas DEBEN dejar el
  sistema en un estado idéntico al de una sola corrida.
- **FR-022**: El sistema DEBE detectar y reportar como pérdida de datos la situación en la que
  se publicaron, entre dos corridas, más noticias que el tamaño de la ventana de la fuente.

### Key Entities

- **Noticia capturada**: una publicación de la fuente ya filtrada por categoría; conserva
  título normalizado, resumen sin marcado, enlace original (identificador estable), fecha de
  publicación, fecha de última actualización y categoría.
- **Registro de corrida de ingesta**: resultado de una ejecución periódica de captura;
  conserva momento de ejecución, entradas vistas, entradas nuevas, antigüedad de la entrada
  más antigua del feed en ese momento, errores ocurridos y si la corrida fue exitosa.
- **Categoría observada**: nombre de categoría visto alguna vez en la fuente, sea o no la
  categoría objetivo; permite detectar cambios en el vocabulario de la fuente.
- **Copia cruda de respuesta**: snapshot temporal de una respuesta de la fuente asociada a una
  corrida, con fin exclusivamente diagnóstico y vida corta.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las noticias de la categoría objetivo presentes en la fuente en el
  momento de una corrida exitosa quedan reflejadas en el conjunto almacenado tras esa corrida.
- **SC-002**: Una noticia publicada en cualquier momento de un día local permanece disponible
  en el conjunto de noticias al menos hasta la primera corrida del día local siguiente.
- **SC-003**: Ejecutar la misma corrida repetidas veces sobre un estado sin cambios de la
  fuente no incrementa la cantidad de noticias almacenadas ni genera duplicados.
- **SC-004**: El 100% de las corridas que no producen ningún resultado quedan marcadas de
  forma distinguible de una corrida exitosa, sin excepción.
- **SC-005**: Toda condición de rotación completa de la ventana entre corridas queda detectada
  y señalada dentro de la misma corrida en la que ocurre, sin demora hasta corridas
  posteriores.
- **SC-006**: El 0% de las noticias almacenadas en cualquier momento pertenece a una categoría
  distinta de la configurada como objetivo.
- **SC-007**: Ante una falla de la fuente, el conjunto de noticias ya almacenado permanece
  accesible sin pérdida ni corrupción, y la primera corrida exitosa posterior a la falla
  retoma la captura sin intervención manual.

## Assumptions

- El enlace al artículo original es un identificador estable y único de cada noticia dentro de
  la fuente.
- Si una entrada no provee fecha de última actualización, se asume igual a su fecha de
  publicación.
- La categoría objetivo y el período de retención son parámetros de configuración del sistema;
  sus valores concretos no forman parte de esta especificación.
- El período de conservación de la copia cruda de diagnóstico es un parámetro de configuración
  independiente del período de retención de noticias, y por diseño es breve.
- La validación cruzada de categoría (declarada vs. ruta del enlace) opera sobre el texto de
  categoría ya normalizado, con el mismo tratamiento de espacios y saltos de línea que título y
  autor.
- Esta especificación cubre exclusivamente el componente de captura periódica (ingestor). La
  exposición de lectura, los suscriptores, las notificaciones, el soporte de múltiples fuentes
  y la extracción desde HTML quedan fuera de alcance y se definirán en features posteriores.
- Una inconsistencia entre la categoría declarada de una entrada y la categoría de la ruta de
  su enlace se registra como señal de anomalía, pero no cambia si la entrada se almacena
  (eso lo decide únicamente la categoría declarada) ni escala a alarma de pérdida de datos.
- La alarma de "ventana rotada por completo" no se dispara en la primera corrida de la vida
  del sistema, ya que en ausencia de un registro de entregas previo el cien por ciento de
  entradas nuevas es esperable y no indica pérdida.
