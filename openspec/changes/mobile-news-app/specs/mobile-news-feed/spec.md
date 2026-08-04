## ADDED Requirements

### Requirement: Carga inicial de noticias del día
La app SHALL obtener las noticias del día desde `GET /news` al montar la pantalla y
mostrarlas en una lista ordenada tal como las devuelve el backend (más reciente primero).

#### Scenario: Hay noticias publicadas hoy
- **WHEN** la pantalla se monta y `GET /news` responde `200` con `news` no vacío
- **THEN** la app muestra cada noticia (título, resumen, link, fecha de publicación) en una
  lista

#### Scenario: No hay noticias publicadas hoy
- **WHEN** la pantalla se monta y `GET /news` responde `200` con `news: []`
- **THEN** la app muestra un estado de "no hay noticias hoy", distinguible visualmente de un
  error

#### Scenario: El backend no puede servir noticias
- **WHEN** la pantalla se monta y `GET /news` responde `503`
- **THEN** la app muestra un estado de error explícito, distinto del estado vacío, sin
  exponer el código HTTP ni el cuerpo crudo de la respuesta

### Requirement: Pull to refresh condicional
La app SHALL permitir refrescar la lista mediante pull to refresh, reenviando el `ETag` de la
última respuesta exitosa como `If-None-Match`.

#### Scenario: No hay noticias nuevas desde el último fetch
- **WHEN** el usuario hace pull to refresh y `GET /news` responde `304` porque el `ETag`
  enviado coincide
- **THEN** la app deja de mostrar el indicador de carga sin modificar la lista actual

#### Scenario: Hay noticias nuevas desde el último fetch
- **WHEN** el usuario hace pull to refresh y `GET /news` responde `200` con un `ETag`
  distinto al enviado
- **THEN** la app reemplaza la lista con el contenido de la nueva respuesta y guarda el nuevo
  `ETag` para el próximo refresh

#### Scenario: El refresh falla
- **WHEN** el usuario hace pull to refresh y la petición falla (`503`, timeout, sin red)
- **THEN** la app deja de mostrar el indicador de carga, conserva la lista previa visible, y
  comunica que el refresh no se pudo completar
