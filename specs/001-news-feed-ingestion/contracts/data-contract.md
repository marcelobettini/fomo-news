# Contract: superficie de datos hacia features futuras

Este feature no expone HTTP, pero sí deja una superficie de datos que el endpoint de
lectura y el notificador (features futuras, Artículo II) van a consumir sin conocer al
ingestor. El detalle completo de campos está en [data-model.md](../data-model.md); este
documento fija qué parte de ese modelo es contrato estable y qué parte es implementación
interna.

## Estable (features futuras pueden depender de esto)

- Colección `news`: todos los campos listados en data-model.md son el contrato de lectura.
  En particular, `_id`/`link` es el identificador estable de una noticia entre features.
- La eliminación de un documento de `news` significa, para cualquier lector, que la noticia
  ya no está disponible — no hay "borrado lógico" en este feature.

## Costura conocida, no estable todavía

- El TTL de `news` purga por tiempo, sin conocer si hubo entrega. El notificador (futuro)
  necesitará que ninguna noticia se borre antes de ser entregada (Artículo I). Este feature
  **no** implementa esa condición: cuando exista el notificador, el mecanismo de purga de
  `news` deberá revisarse (ver research.md §11). Un futuro feature de notificaciones puede
  requerir cambiar cómo se calcula o aplica `expiresAt`.

## Interno (no es contrato, puede cambiar sin aviso)

- Colecciones `runs`, `categories`, `raw_snapshots`, `state`, `locks`: son bookkeeping del
  ingestor. Ningún componente futuro debe leerlas para su funcionamiento normal; a lo sumo,
  una herramienta de operación/observabilidad podría inspeccionar `runs` para diagnóstico
  humano, pero eso no las convierte en un contrato versionado.
