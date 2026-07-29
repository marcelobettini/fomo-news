# Research: Alta, confirmación y baja de suscriptores por correo electrónico

Todas las incógnitas del Technical Context quedan resueltas abajo; no quedan marcadores `NEEDS
CLARIFICATION`. El stack base (Node/TypeScript/Fastify/MongoDB Atlas/VM ARM64) y varias
decisiones de seguridad fueron especificados directamente por el usuario en el input de
`/speckit-plan`; las secciones siguientes documentan el "cómo" concreto para los puntos que el
input dejó a criterio del plan, y resuelven explícitamente el conflicto de permisos y la
tensión de datos personales que el usuario pidió no dejar implícitos.

## 1. Proveedor de correo transaccional: Resend

**Decision**: Resend como proveedor detrás del adaptador propio (research.md §10).

**Rationale**: entre las dos opciones planteadas por el usuario, Resend ofrece verificación de
firma de webhooks basada en un esquema HMAC-SHA256 estándar (compatible con Svix) que se puede
verificar a mano con `node:crypto` sin sumar una dependencia, un flujo de verificación de
dominio + registros DNS (SPF/DKIM/DMARC) bien documentado y una API HTTP simple (JSON sobre
`fetch`) sin necesidad de su SDK oficial para el envío. Esto encaja directamente con la
restricción de dependencias mínimas del input ("sin cliente HTTP de terceros... en caso
contrario, fetch nativo").

**Alternatives considered**: Brevo (rechazado para esta decisión: históricamente su verificación
de firma de webhooks es menos uniforme entre tipos de evento y su superficie de API es más
amplia de lo que este feature necesita; no hay una razón de peso para preferirlo sobre Resend
dado que el usuario dejó la elección abierta). SMTP directo desde la VM: descartado
explícitamente por el usuario (IPs de nube en listas de bloqueo, puerto saliente
frecuentemente cerrado).

## 2. Envío HTTP sin cliente de terceros: `fetch` nativo

**Decision**: el adaptador de envío (`src/adapters/emailSender.ts`) llama a la API HTTP de
Resend con `fetch` nativo (disponible en Node LTS ≥18) y la clave del proveedor en el
encabezado `Authorization`. No se instala el paquete oficial `resend`.

**Rationale**: el input es explícito — "el cliente oficial... es aceptable si simplifica la
verificación de firmas; en caso contrario, fetch nativo". El SDK oficial de Resend es, en los
hechos, un envoltorio delgado sobre `fetch` para el envío; no aporta nada para la verificación
de firmas de webhook (eso lo resuelve `node:crypto`, ver research.md §3). Sumarlo solo para el
envío violaría la restricción de "sin cliente HTTP de terceros" sin ganar nada a cambio.

**Alternatives considered**: paquete oficial `resend` (rechazado por lo anterior); `undici`
explícito (rechazado: `fetch` nativo de Node ya usa `undici` internamente, agregarlo aparte
sería una dependencia redundante).

## 3. Verificación de firma de webhooks: HMAC-SHA256 manual, sin paquete `svix`

**Decision**: los webhooks de Resend llegan firmados con el esquema de Svix (encabezados
`svix-id`, `svix-timestamp`, `svix-signature`; firma = `HMAC-SHA256` del secreto de firma sobre
`{svix-id}.{svix-timestamp}.{cuerpo crudo}`, codificada en base64). Se verifica reimplementando
ese cálculo con `node:crypto` (`createHmac`, `timingSafeEqual` para la comparación) contra
`EMAIL_WEBHOOK_SIGNING_SECRET`, sin instalar el paquete `svix`.

**Rationale**: el esquema es HMAC simple y público; reimplementarlo con la biblioteca estándar
evita una dependencia entera solo para una comparación de hash, coherente con "dependencias
mínimas y justificadas". `timingSafeEqual` evita que una comparación byte a byte filtre
información por tiempo de respuesta — requisito de seguridad implícito en "DEBE verificar la
firma del proveedor antes de actuar".

**Alternatives considered**: paquete `svix` oficial (rechazado: resuelve exactamente lo mismo
que una función de ~15 líneas sobre `node:crypto`, sin ninguna ventaja que justifique la
dependencia); confiar en el payload sin verificar firma (rechazado explícitamente por el
usuario y por el Artículo IV — "cualquiera podría desactivar suscriptores").

**Nota de implementación**: el nombre exacto de los campos del payload y encabezados debe
verificarse contra la documentación vigente de Resend al implementar (research.md no fija
nombres de campo no confirmados); la decisión arquitectónica (HMAC-SHA256 manual,
`timingSafeEqual`, rechazo con `401` ante firma inválida) no depende de esos detalles.

## 4. Segunda credencial de MongoDB, acotada a las colecciones de suscriptores

**Decision**: una tercera credencial de Atlas (además de `MONGODB_URI` del ingestor y
`MONGODB_READONLY_URI` de la feature 2), con un rol personalizado de Atlas que otorga
`find`/`insert`/`update`/`remove` **únicamente** sobre las colecciones `subscribers` y
`suppressions`, sin ningún privilegio sobre `news`, `runs`, `categories`, `state` ni
`raw_snapshots`. Se expone como `MONGODB_SUBSCRIBERS_URI`, una cadena de conexión propia y
distinta de las otras dos. El proceso HTTP mantiene entonces **dos** conexiones de Mongo
simultáneas: la de solo lectura de la feature 2 (exclusiva de `GET /news`) y esta nueva, de
lectura-escritura acotada (exclusiva de las rutas de suscriptores).

**Rationale**: resuelve explícitamente el conflicto de permisos planteado por el usuario. El
Artículo III dice "el endpoint público NUNCA escribe... [criterio de verificación] si una ruta
de lectura ejecuta... escrituras" — está acotado a la vía de lectura de noticias, no prohíbe
que el mismo proceso tenga rutas de escritura sobre otros datos (razonamiento explícito del
usuario, compartido). Ampliar la credencial existente a lectura-escritura general habría hecho
que la garantía de Artículo III volviera a depender solo de disciplina de código — exactamente
lo que esa credencial de solo lectura fue creada para evitar (research.md §4 de la feature 2).
Una credencial nueva y acotada por colección mantiene la garantía de infraestructura intacta
para `news` y la extiende, de forma igualmente verificable por infraestructura, a "nunca puede
tocar `news`" para las rutas de suscriptores.

**Alternatives considered**: reusar `MONGODB_READONLY_URI` con permisos ampliados (rechazada:
exactamente la regresión que el Artículo III busca evitar); usar `MONGODB_URI` del ingestor,
que ya tiene lectura-escritura (rechazada: acoplaría un proceso de larga vida expuesto
públicamente a la misma credencial que usa el ingestor, ampliando innecesariamente el radio de
impacto de una fuga de credencial); base de datos separada por completo para suscriptores
(rechazada: complejidad operativa — un cluster/base adicional — no pedida y no justificada
para dos colecciones pequeñas; un rol acotado dentro del mismo cluster ya da el aislamiento
requerido).

## 5. Vencimiento de tokens de confirmación: chequeo explícito en código + TTL de Mongo como red de limpieza

**Decision**: cada documento de suscriptor pendiente guarda `confirmationTokenExpiresAt`. Al
validar un token, el código compara explícitamente `now` contra ese campo para decidir "vencido"
(FR-005) de forma determinística. Un índice TTL de Mongo sobre el mismo campo
(`expireAfterSeconds: 0`) purga en segundo plano los documentos pendientes abandonados —igual
patrón que `news.expiresAt` y `raw_snapshots.expiresAt` en `src/adapters/repository.ts`—, sin
que el proceso HTTP necesite ningún job propio de limpieza (Artículo II: sin planificador en
proceso). El campo se elimina (`$unset`) al activarse la suscripción, así el TTL de Mongo deja
de aplicarle a un documento ya activo (los índices TTL de Mongo ignoran documentos sin el
campo).

**Rationale**: el TTL de Mongo por sí solo no alcanza para cumplir FR-005 ("comunicar el
motivo") porque el barrido en segundo plano de Mongo no es instantáneo (~60s) y, sobre todo,
borrar el documento entero destruye la distinción entre "vencido" y "nunca existió" que el
requisito pide comunicar. Por eso la decisión de negocio se toma siempre en código a partir de
una comparación de instantes explícita (mismo principio que Artículo VI aplica a "día en
curso" en la feature 2, aquí aplicado a vencimiento de token); el TTL de Mongo cumple
exclusivamente el rol de housekeeping para documentos abandonados a largo plazo, exactamente
como el usuario lo planteó ("puede resolverse con índice TTL").

**Alternatives considered**: depender únicamente del TTL de Mongo y tratar "documento no
encontrado" como la señal de vencimiento (rechazada: no distingue de forma confiable "vencido"
de "token inválido/inexistente", y el requisito pide comunicar el motivo explícitamente); un
job propio de limpieza periódico (rechazada: reintroduce un planificador en el proceso,
prohibido por el Artículo II, y el TTL de Mongo ya resuelve el housekeeping sin él).

## 6. Solicitudes repetidas: un cooldown de reenvío hace de límite de tasa por dirección de destino

**Decision**: cada documento de suscriptor pendiente guarda `lastRequestAt`. Una nueva
solicitud de alta para una dirección ya pendiente **no** envía correo si
`now - lastRequestAt < SIGNUP_RESEND_COOLDOWN_MS`; si el cooldown ya pasó, se emite un nuevo
token de confirmación (invalidando el anterior) y se reenvía, actualizando `lastRequestAt`. Una
dirección ya activa nunca genera un nuevo envío por una solicitud de alta repetida. Este mismo
mecanismo cumple, a la vez, "no debe producir un mensaje por cada intento" (FR-015) y
"limitación de tasa... por dirección de destino" (FR-016): al estar respaldado por la propia
colección de Mongo, funciona igual sin importar cuántas instancias del proceso HTTP haya, a
diferencia de un limitador en memoria.

**Rationale**: evita introducir un segundo mecanismo de límite de tasa (además de
`@fastify/rate-limit` por IP) solo para la dimensión "por dirección de destino"; la propia
regla de negocio de reenvío ya provee esa protección como efecto natural, sin nueva
dependencia ni estado en memoria adicional. Un cooldown (en vez de bloquear el reenvío para
siempre) respeta el criterio de aceptación de la spec de permitir un nuevo enlace si la
persona legítimamente perdió o no recibió el mensaje original (spec.md, sección Assumptions).

**Alternatives considered**: una segunda instancia de `@fastify/rate-limit` con `keyGenerator`
sobre el correo del cuerpo (rechazada: el plugin aplica una sola configuración de límite por
ruta; forzar dos límites independientes en la misma ruta requeriría lógica adicional para
lograr lo que el propio modelo de datos ya resuelve de forma más simple y ya persistida);
bloquear reenvío de forma permanente mientras el documento pendiente exista (rechazada:
contradice la posibilidad de reenviar tras un enfriamiento razonable, documentada como
assumption en spec.md).

## 7. Identificador de supresión no reversible: HMAC-SHA256 con secreto propio, no un hash simple

**Decision**: al eliminar un suscriptor (baja propia o desactivación automática), se guarda en
la colección `suppressions` un identificador `HMAC-SHA256(correo normalizado, EMAIL_SUPPRESSION_HASH_SECRET)`
en hexadecimal, junto con el motivo y el instante. Nunca se guarda el correo en texto claro en
ese documento.

**Rationale**: un hash simple (`sha256(correo)`, sin secreto) sería técnicamente "no reversible"
en el sentido criptográfico estricto, pero sí **derivable por diccionario**: cualquiera con
acceso a la base podría tomar una dirección candidata, hashearla y comparar, reconstruyendo
igual quién estuvo suscripto — exactamente la fuga de FR-010 ("no derivable del correo
original") que la spec pide evitar. Un HMAC con secreto propio del sistema hace que ese ataque
de diccionario sea inviable sin el secreto, que nunca se persiste junto a los datos.

**Alternatives considered**: `sha256` simple sin secreto (rechazada por lo anterior); cifrado
reversible del correo (rechazada: viola directamente el requisito de "eliminar efectivamente
los datos personales" — un valor descifrable no es una eliminación efectiva); no guardar nada
tras la baja (rechazada: es exactamente el escenario de "reenvío por error" que FR-010 pide
evitar, ya que un envío en curso en el momento de la baja no tendría forma de detectarse).

## 8. Baja de un clic (RFC 8058): una sola ruta acepta `GET` y `POST`, sin dependencia nueva de parsing

**Decision**: `GET /subscribers/unsubscribe/:token` (enlace visible del cuerpo, abierto por una
persona) y `POST /subscribers/unsubscribe/:token` (invocado automáticamente por el cliente de
correo vía el encabezado `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) ejecutan la misma
acción idempotente. Para aceptar el `POST` de un cliente de correo (que llega con
`Content-Type: application/x-www-form-urlencoded` y cuerpo `List-Unsubscribe=One-Click`, sin
que el valor del cuerpo importe para la decisión) se registra un content-type parser propio,
trivial, que resuelve sin intentar parsear el cuerpo — no se instala `@fastify/formbody`.

**Rationale**: RFC 8058 exige que la baja de un clic sea un único `POST` sin interacción de la
persona, a la misma URL publicada en `List-Unsubscribe`; el usuario lo señala explícitamente
("la baja de un clic la invoca el cliente de correo... el enlace del cuerpo lo abre una persona
en un navegador: ambos caminos deben funcionar"). El cuerpo del `POST` de una cliente de correo
nunca se necesita para decidir nada — el token ya está en la ruta —, así que un parser que
solo evita que Fastify falle al no reconocer el content-type es suficiente y no requiere sumar
una dependencia de parsing de formularios.

**Alternatives considered**: `@fastify/formbody` (rechazada: resolvería un parseo que este
feature no necesita — el valor del cuerpo es irrelevante para la decisión de negocio);
exigir un único método (rechazada: contradice el requisito explícito de que ambos caminos
funcionen).

## 9. Verificación de dominio y registros DNS: tarea operativa temprana, fuera del código

**Decision**: verificar el dominio propio en el panel de Resend y publicar los registros DNS
resultantes (SPF, DKIM, DMARC) en el proveedor de DNS del dominio es un paso de configuración
externo al repositorio, sin código asociado. Debe ubicarse al comienzo del orden de ejecución
(`tasks.md`), antes de cualquier tarea que dependa de un envío real, porque la propagación DNS
tiene demora variable (minutos a horas) y bloquea cualquier prueba de extremo a extremo con
correo real.

**Rationale**: instrucción explícita del usuario. Documentado aquí para que `/speckit-tasks`
lo capture como la primera tarea (o de las primeras) del plan de ejecución, evitando que quede
enterrado entre tareas de código y descubierto tarde, cuando ya bloquearía trabajo posterior.

**Alternatives considered**: N/A — es un requisito operativo explícito, no una decisión de
diseño con alternativas de igual mérito.

## 10. Separación núcleo/adaptador para el envío de correo (Artículo V)

**Decision**: `src/core/confirmationEmail.ts` construye, de forma pura y sin I/O, el contenido
del mensaje de confirmación (asunto, texto, HTML, y los encabezados `List-Unsubscribe` /
`List-Unsubscribe-Post`) a partir de las URLs de confirmación y de baja ya calculadas.
`src/adapters/emailSender.ts` define la interfaz `EmailSender` (una sola operación: enviar un
mensaje ya construido a una dirección) y su única implementación de producción, sobre la API de
Resend. El núcleo nunca importa el adaptador ni conoce que el proveedor es Resend.

**Rationale**: exigencia explícita del Artículo V ("el núcleo NO DEBE conocer el medio de
entrega... agregar un canal nuevo no puede requerir cambios en el núcleo") y del propio input
del usuario ("la feature siguiente reutilizará esa misma interfaz para el resumen periódico,
así que debe quedar diseñada para eso y no acoplada al mensaje de confirmación"). Con esta
separación, la feature de envío periódico solo necesita agregar su propio constructor de
contenido puro (p. ej. `digestEmail.ts`) y reutilizar `EmailSender.send()` sin tocar el
adaptador ni el núcleo de esta feature.

**Alternatives considered**: construir el mensaje de confirmación dentro del propio adaptador
de Resend (rechazada: acopla la composición del contenido al proveedor concreto, justo lo que
el Artículo V prohíbe, y obligaría a la feature siguiente a duplicar o parchear ese código para
un canal que en este alcance ya se sabe reutilizable).

## 11. Pruebas sin envíos reales: `EmailSender` sustituible por un doble en memoria

**Decision**: los tests HTTP inyectan una implementación de `EmailSender` en memoria (guarda
los mensajes "enviados" en un arreglo, no hace ninguna llamada de red) en vez de la
implementación real de Resend. Igual patrón que `mongodb-memory-server` en la feature 2:
`src/http/app.ts` recibe el `EmailSender` como parte de su configuración en vez de construirlo
internamente, así los tests pueden sustituirlo sin mockear módulos.

**Rationale**: requisito explícito — "el adaptador de correo debe ser sustituible en pruebas".
Como `EmailSender` es una interfaz con una sola operación (research.md §10), un doble de
prueba es trivial y no requiere ninguna librería de mocking.

**Alternatives considered**: mockear el módulo `emailSender.ts` con herramientas de mocking de
módulos (rechazada: más frágil y menos explícito que inyectar una implementación alternativa de
una interfaz ya diseñada para eso); apuntar los tests al modo sandbox/test del proveedor real
(rechazada: sigue dependiendo de red y credenciales durante los tests, exactamente lo que se
quiere evitar, y el propio proveedor es intercambiable por diseño gracias a research.md §10).
