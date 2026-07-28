<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Modified principles: N/A (initial ratification from template placeholders)
- Added sections:
  - I. Integridad del flujo de noticias
  - II. Componentes desacoplados con relojes independientes
  - III. Separación estricta de lectura y escritura
  - IV. Consentimiento verificado y entrega responsable
  - V. Los canales de entrega son adaptadores
  - VI. Manejo explícito del tiempo
  - VII. Fallo ruidoso y degradación antes que bloqueo
  - VIII. El sistema no genera contenido
  - Restricción de stack (Section 2)
  - Governance
- Removed sections: none (first concrete ratification)
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md (Constitution Check gate is generic, references constitution file — no changes needed)
  - ✅ .specify/templates/spec-template.md (generic, no principle-specific references — no changes needed)
  - ✅ .specify/templates/tasks-template.md (generic, no principle-specific references — no changes needed)
  - ✅ .claude/skills/speckit-constitution/SKILL.md (this command, generic — no changes needed)
- Follow-up TODOs: none
-->

# Agregador de Noticias de Tandil Constitution

## Core Principles

### I. Integridad del flujo de noticias

Ninguna noticia elegible puede perderse entre la publicación en la fuente y la entrega al
suscriptor. La cadencia de ingesta se determina EXCLUSIVAMENTE por la ventana de la fuente,
NUNCA por conveniencia del usuario, costo o preferencia de notificación; ingesta y
notificación son perillas independientes. Lo pendiente de entregar se calcula como resta de
conjuntos contra un registro de entregas persistente, NUNCA por marca de agua temporal.
Ninguna noticia se elimina antes de haber sido entregada a todos los suscriptores activos.

**Fundamento**: la fuente expone una ventana deslizante de tamaño fijo en ítems; lo que no
se captura a tiempo desaparece sin dejar rastro.

**Criterio de verificación**: detener el plan si aparece lógica de "procesar lo publicado
desde la última corrida", si la frecuencia de ingesta se justifica por comodidad del usuario,
o si una purga puede eliminar noticias no entregadas.

### II. Componentes desacoplados con relojes independientes

Ingestor, endpoint y notificador no se conocen entre sí. Cada uno tiene su propia cadencia y
ninguno se la impone a los otros. El planificador DEBE ser externo al proceso servidor.

**Fundamento**: permite cambiar la frecuencia de cualquiera de los tres sin tocar los demás,
y migrar de plataforma de despliegue sin rediseñar.

**Criterio de verificación**: detener si un componente invoca directamente a otro, o si la
ejecución periódica depende de que el proceso HTTP esté vivo.

### III. Separación estricta de lectura y escritura

El endpoint público NUNCA escribe, NUNCA dispara ingesta y DEBE responder aunque la fuente de
origen esté caída.

**Fundamento**: si la lectura dispara captura, N consultas se convierten en N accesos a la
fuente; la disponibilidad de lectura no puede depender de terceros.

**Criterio de verificación**: detener si una ruta de lectura ejecuta descargas, escrituras o
llamadas a servicios externos.

### IV. Consentimiento verificado y entrega responsable

Ninguna entrega ocurre sin consentimiento previo verificado (doble opt-in confirmado). La
entrega se registra DESPUÉS de la confirmación del canal, NUNCA antes; ante confirmación
ambigua se reintenta, prefiriendo un duplicado ocasional a una pérdida silenciosa. La
deduplicación se hace por la combinación de noticia, suscriptor y canal. Las señales
negativas del canal desactivan la suscripción automáticamente, sin intervención manual. La
baja está siempre disponible y elimina los datos personales efectivamente. Se recolecta el
mínimo dato personal necesario y NUNCA se registra en logs.

**Fundamento**: la entrega a un canal no confirmado o mal identificado convierte un
agregador en una fuente de spam y un riesgo de privacidad.

**Criterio de verificación**: detener si se marca una entrega antes de confirmarla, si
existe una vía de envío a una dirección no confirmada, o si un identificador personal
aparece en logs.

### V. Los canales de entrega son adaptadores

El núcleo NO DEBE conocer el medio de entrega. El formato del mensaje es una transformación
aplicada sobre la lista de noticias, nunca un atributo de la noticia. Agregar un canal nuevo
no puede requerir cambios en el núcleo.

**Fundamento**: hay canales adicionales comprometidos a futuro; el costo de la abstracción
hoy es una interfaz, y el costo de retrofitearla es rediseñar.

**Criterio de verificación**: detener si aparecen campos específicos de un canal en el
modelo de noticia, o si la lógica de pendientes conoce el medio.

### VI. Manejo explícito del tiempo

Las zonas horarias se expresan SIEMPRE por nombre de región, NUNCA por offset fijo. Los
instantes se almacenan en UTC; las decisiones de negocio (qué día es, si estamos en ventana
de envío) se toman en hora local.

**Fundamento**: los offsets cambian por decisión política y un valor fijo desplaza todo el
sistema en silencio.

**Criterio de verificación**: detener ante cualquier offset numérico embebido, o ante una
comparación de fechas de negocio hecha en UTC.

### VII. Fallo ruidoso y degradación antes que bloqueo

Ninguna corrida puede terminar en cero resultados en silencio; toda anomalía definida DEBE
emitir una alarma distinguible de la operación normal. El fallo de una fuente o dependencia
externa degrada el servicio pero no lo detiene, y NUNCA propaga la caída a los otros
componentes. Toda condición conocida de pérdida de datos DEBE ser detectable en tiempo de
ejecución.

**Fundamento**: los sistemas de captura no fallan con errores, fallan devolviendo nada
mientras aparentan estar sanos.

**Criterio de verificación**: detener si existe un camino de ejecución donde un resultado
vacío o un error de dependencia se registra como éxito.

### VIII. El sistema no genera contenido

Se sirve título, resumen tal como lo publica la fuente, y link al original. El sistema NUNCA
reescribe, resume, genera ni republica el cuerpo de las notas.

**Fundamento**: define el proyecto como agregador y no como republicador, y mantiene el uso
de material de terceros dentro de límites defendibles.

**Criterio de verificación**: detener ante cualquier propuesta de generar o reescribir texto
de la noticia, incluyendo generación asistida por modelos de lenguaje.

## Restricción de stack

Node LTS con TypeScript en modo estricto. Cada dependencia DEBE justificarse explícitamente;
se DEBE preferir la biblioteca estándar cuando alcance.

## Governance

Esta constitution prevalece sobre cualquier otra práctica o convención del proyecto. Toda
enmienda requiere: documentación del cambio, versión incrementada según semver (MAJOR para
remoción o redefinición incompatible de un principio, MINOR para agregar o expandir un
principio, PATCH para aclaraciones sin cambio de sentido) y actualización de esta fecha de
enmienda. Todo plan (`/speckit-plan`) DEBE incluir una verificación explícita contra estos
ocho principios antes de la Fase 0, y de nuevo tras el diseño de la Fase 1; cualquier
violación no justificable detiene el plan en vez de documentarse como excepción. Los
criterios de verificación de cada artículo son vinculantes: si una condición descrita en
ellos se cumple, el plan o la implementación se detienen hasta resolverla.

**Version**: 1.0.0 | **Ratified**: 2026-07-28 | **Last Amended**: 2026-07-28
