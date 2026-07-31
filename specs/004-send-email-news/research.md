# Research: Entrega de noticias por correo a suscriptores

El stack, el modelo de ejecución, el criterio de exclusión mutua, la forma del cálculo de
pendientes, la resolución elegida para el conflicto con la retención y el patrón de pruebas
locales fueron especificados directamente por el usuario en el input de `/speckit-plan`. Las
secciones siguientes documentan el "cómo" concreto para los puntos que el input dejó a criterio
del plan, y resuelven explícitamente **dos conflictos reales** descubiertos al diseñar esta
feature sobre lo ya construido en la feature 3 — ninguno estaba mencionado en el input, y ambos
bloquean el requisito "cada mensaje incluye la vía de baja" si no se resuelven.

## 1. Modelo de ejecución: proceso de una sola pasada, entrypoint propio

**Decision**: `src/notifier.ts`, mismo molde que `src/main.ts` (feature 1) — conecta, hace una
corrida completa, cierra y termina con código de salida explícito. Ningún temporizador, ningún
`setInterval`, ninguna reprogramación interna (Artículo II). Invocado por cron del sistema en
cada horario de envío configurado externamente en la propia entrada de crontab.

**Rationale**: instrucción explícita del usuario, y es el mismo molde ya validado por la
feature 1 — no hay razón para un diseño distinto.

**Alternatives considered**: integrar el envío como una ruta HTTP interna o un job dentro del
proceso `server.ts` (feature 2/3) — rechazado explícitamente por el usuario y por el Artículo
II ("el planificador DEBE ser externo al proceso servidor").

## 2. Reloj inyectable: `now: Date` explícito, no una clase `Clock`

**Decision**: ninguna función de `src/core` ni la orquestación de `src/notifier.ts` llama a
`new Date()` internamente salvo en un único punto de entrada (`main()`, igual que
`startedAt = new Date()` en `main.ts` de la feature 1). Todo lo demás recibe `now: Date` como
parámetro explícito — el mismo patrón que ya usan `localTime.ts`, `alarms.ts` y
`subscriberLifecycle.ts` en las features 1-3.

**Rationale**: el requisito es que el tiempo sea sustituible desde las pruebas, no que exista
un objeto "reloj" per se. Pasar `now: Date` explícito ya cumple exactamente eso — un test llama
la función de orquestación (`runDigestOnce`, research.md §13) tantas veces como quiera con
cualquier `now` arbitrario, sin esperar ningún reloj real, y sin que ninguna función de negocio
pueda "hacer trampa" leyendo la hora del sistema por su cuenta. Introducir una clase/interfaz
`Clock` inyectada agregaría una abstracción sin ganar nada sobre lo que ya hace este patrón, y
violaría "dependencias mínimas y justificadas" y la coherencia con las tres features anteriores.

**Alternatives considered**: interfaz `Clock` con `now(): Date` inyectada por constructor/DI —
rechazada: mismo poder expresivo que un parámetro `now: Date`, con una capa de indirección de
más que ninguna otra feature del repositorio usa.

## 3. Registro de entregas: colección `deliveries`, índice único compuesto

**Decision**: colección nueva `deliveries`, un documento por combinación
(`subscriberId`, `newsId`, `channel`) efectivamente entregada, con índice único compuesto sobre
esos tres campos (data-model.md). La escritura es `insertOne` envuelto en el mismo patrón de
`isDuplicateKeyError` que ya usa `src/adapters/lock.ts` (código Mongo `11000`): un intento de
insertar una combinación ya existente no lanza, se trata como éxito idempotente.

**Rationale**: instrucción explícita del usuario — "el índice hace imposible el registro
duplicado a nivel de motor, en lugar de depender de que el código lo verifique — mismo criterio
que las credenciales de solo lectura de la feature 2". Un `insertOne` fallido por índice único
es además la implementación más simple posible de "no permitir un segundo registro para la
misma combinación" (FR-013): no hace falta un `findOne` previo ni una transacción.

**Alternatives considered**: `updateOne` con `upsert: true` (rechazada: un upsert no distingue
"ya estaba" de "se acaba de crear", y no necesitamos esa distinción — solo necesitamos que la
segunda escritura no falle de forma visible ni duplique nada); `_id` compuesto como string
(`` `${subscriberId}:${newsId}:${channel}` ``) en vez de índice secundario (rechazada: el usuario
pidió explícitamente un índice único compuesto sobre los tres campos, no una clave natural
compuesta a mano — y un `_id` compuesto por concatenación de string es más frágil ante
caracteres especiales en `subscriberId`/`newsId` que un índice sobre los campos tal cual).

## 4. Cálculo de pendientes: resta en memoria, sin `$lookup`

**Decision**: por cada suscriptor activo, se traen (a) las noticias elegibles (ya acotadas por
categoría porque `news` solo contiene la categoría objetivo — mismo razonamiento que
`newsReader.ts` de la feature 2, que "no vuelve a filtrar por categoría" — y por el vencimiento
máximo de antigüedad) y (b) los `newsId` ya entregados a ese suscriptor por ese canal
(`getDeliveredNewsIds`), y se resta el segundo conjunto del primero con un `Set` en memoria de
JavaScript.

**Rationale**: instrucción explícita del usuario — "NO construir agregaciones con etapas de
unión entre colecciones: el volumen es de decenas de noticias y unos pocos suscriptores, y la
versión simple es más clara y más fácil de probar". Una resta en memoria es además más fácil de
testear como función pura de `src/core` (sin Mongo) que una etapa `$lookup`.

**Alternatives considered**: agregación con `$lookup` entre `news` y `deliveries` (rechazada
explícitamente por el usuario); una colección de "pendientes" materializada y mantenida
incrementalmente (rechazada: reintroduce exactamente el riesgo de watermark que el Artículo I
prohíbe — un pendiente materializado que no se recalculó a tiempo es indistinguible de una
pérdida silenciosa).

## 5. Ventana horaria permitida: `Intl.DateTimeFormat`, sin librería de fechas

**Decision**: `src/core/sendWindow.ts` obtiene la hora local `HH:MM` de `now` con
`Intl.DateTimeFormat` (mismo mecanismo que `localTime.ts` de las features 1/2, sin agregar
`date-fns`/`luxon`/`dayjs`) y compara lexicográficamente contra `SEND_WINDOW_START_LOCAL` /
`SEND_WINDOW_END_LOCAL` (strings `HH:MM` de 24 horas con cero a la izquierda, para que la
comparación de string sea válida). Ventana same-day: se asume `start <= end` (una ventana que
no cruza la medianoche) — ver Assumptions de spec.md, no hay ningún requisito de negocio que
pida lo contrario.

**Rationale**: coherente con la restricción explícita "sin biblioteca de fechas" y con el
patrón ya establecido por `localTime.ts`.

**Alternatives considered**: comparar objetos `Date` completos (rechazada: mezclaría de nuevo
zona horaria con aritmética de fecha, exactamente lo que `localTime.ts` evita al trabajar con
las partes ya formateadas en hora local); ventana que cruza medianoche (rechazada: no está en
el alcance descrito, y agregar el caso sin que se haya pedido viola "no diseñar para
hipotéticos").

## 6. Coherencia retención/entrega: validación de arranque, no solo documentación

**Decision**: `src/core/retentionCoherence.ts` expone
`assertRetentionCoherent({ newsRetentionMs, maxSendIntervalMs, maxPendingAgeMs })`, que lanza si
`newsRetentionMs <= maxSendIntervalMs + maxPendingAgeMs`. `src/notifier.ts` la invoca
inmediatamente después de cargar la configuración, antes de conectar a Mongo o tocar cualquier
dato — un arranque con esta relación incoherente termina con código de salida distinto de cero
y **ningún** efecto secundario.

**Rationale**: es la resolución que el propio usuario ya eligió y describió en el input
("Si la resolución elegida es conservar el borrado por índice TTL con un margen holgado,
entonces el proceso DEBE validar..."): se conserva el índice TTL ciego ya existente sobre
`news.expiresAt` (`src/adapters/repository.ts`, sin tocarlo) en vez de reemplazarlo por una
purga consciente del estado de entrega, y se compensa el riesgo con un invariante de
configuración **verificado en tiempo de ejecución** en vez de confiado a `env.md`. Con esta
relación garantizada, para cuando el TTL de Mongo purgaría una noticia (`newsRetentionMs`
después de publicada), ya pasaron al menos `maxSendIntervalMs + maxPendingAgeMs` — es decir, ya
hubo oportunidad de al menos un envío dentro de la ventana permitida **después** de que esa
noticia dejó de ser elegible por antigüedad (`maxPendingAgeMs`), momento en el que, por FR-020
de spec.md, la noticia ya dejó de contar como "pendiente" para cualquier suscriptor (se
descartó en vez de enviarse tarde) — así que el TTL nunca purga algo que la spec todavía
considere pendiente. Esto **cierra** la excepción de Artículo I que quedó documentada como TODO
en `repository.ts` desde la feature 1 ("Cuando exista la feature de notificaciones, esta purga
DEBE revisarse").

**Riesgo residual, reconocido explícitamente** (ver plan.md, Complexity Tracking): esta
garantía depende de que `MAX_SEND_INTERVAL_MS` refleje honestamente la cadencia real de cron —
si cron deja de correr por más tiempo del declarado en esa variable (una falla de cron mismo,
externa a este proceso), el invariante deja de sostenerse silenciosamente para las corridas
saltadas. Reemplazar el TTL por una purga que consulte `deliveries`/`subscribers` antes de
borrar eliminaría ese riesgo residual, pero agrega un componente con estado nuevo solo para un
caso borde ya acotado; el usuario ya evaluó ese trade-off en el input y eligió la opción más
simple.

**Alternatives considered**: quitar el índice TTL de `news` y purgar explícitamente desde el
notifier o desde el ingestor consultando `deliveries` antes de borrar (más seguro, pero un
proceso/responsabilidad nueva no pedida — descartada por el propio input del usuario, que ya
resolvió cuál de las dos opciones tomar).

## 7. Adaptador de correo: reutilización de `EmailSender`, resultado tri-estado

**Decision**: se reutiliza la interfaz `EmailSender` de la feature 3 tal cual, con **un único
cambio genérico** (no específico del resumen): `send()` deja de poder lanzar como única forma
de señalar un problema y pasa a devolver siempre un resultado explícito:

```ts
export type EmailSendResult = "confirmed" | "failed" | "ambiguous";
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
```

La implementación Resend clasifica así: respuesta HTTP recibida con `response.ok` →
`"confirmed"`; respuesta HTTP recibida sin `ok` (Resend respondió explícitamente que rechaza el
mensaje) → `"failed"`; `fetch()` lanza (timeout, sin respuesta, error de red/DNS) →
`"ambiguous"` — es exactamente el caso "ni confirmación ni error claro" de spec.md, y es el
adaptador quien mejor puede distinguirlo, no cada consumidor.

**Rationale**: instrucción explícita del usuario — "el adaptador debe distinguir tres
resultados... Reutilizar la interfaz de envío definida en la feature 3, sin modificarla ni
extenderla con nada específico del resumen." Distinguir confirmado/fallo/ambiguo es una
propiedad general de "enviar un correo por HTTP", aplicable a cualquier consumidor presente o
futuro de `EmailSender` — no es un campo ni una regla propia del resumen periódico, así que
ampliar el tipo de retorno no viola la instrucción; lo que viola la instrucción sería agregar
algo como un campo `digestId` o una opción específica de este feature a la interfaz, y eso no
se hizo.

**Impacto en el único consumidor existente** (`src/http/routes/subscribers.ts`, feature 3): hoy
ese código llama `await deps.emailSender.send(...)` sin mirar el valor de retorno y confía en
que un `throw` interrumpa la petición con un 500 genérico (vía `setErrorHandler` de
`src/http/app.ts`). Se actualiza a `if (result !== "confirmed") throw new Error(...)` — mismo
comportamiento observable de cara al cliente HTTP que hoy (falló el envío ⇒ 500), ahora
expresado sobre un valor en vez de una excepción. El doble en memoria de pruebas
(`FakeEmailSender`, `tests/http/testHelpers.ts`) pasa a devolver `"confirmed"` por defecto y
acepta un resultado configurable por invocación para los tests nuevos de esta feature.

**Alternatives considered**: mantener `send(): Promise<void>` y agregar una segunda función
`sendAndClassify()` solo para el notifier (rechazada: dos formas de hacer lo mismo en la misma
interfaz es peor que una sola forma más expresiva, y el Artículo V pide una única superficie de
entrega); modelar el resultado como una excepción tipada (`AmbiguousSendError`) en vez de un
valor de retorno (rechazada: un resultado esperado y manejado en el flujo normal —no una
condición excepcional— se modela mejor como valor que como excepción, y evita que el notifier
tenga que envolver cada envío en `try/catch` solo para leer un `.code`).

## 8. Vía de baja en el resumen: el token de baja de la feature 3 es irrecuperable

**Problema encontrado, no mencionado en el input**: cada mensaje del resumen periódico debe
incluir la vía de baja (FR-010 de spec.md), construida como
`{PUBLIC_BASE_URL}/subscribers/unsubscribe/{token}`, validada por
`GET`/`POST /subscribers/unsubscribe/:token` comparando `hashToken(token)` contra
`subscribers.unsubscribeTokenHash` (feature 3). Pero ese token se generó con
`generateToken()` — bytes aleatorios — y **nunca se persiste en claro** (`tokens.ts`,
`data-model.md` de la feature 3: "protege contra activación/baja por acceso directo a la
base"). El notifier corre en un proceso y un momento completamente distintos de cuando ese
token se generó y se envió una única vez por correo — no tiene forma de reconstruirlo. Sin
resolver esto, la feature no puede cumplir su propio FR-010.

**Decision**: cambiar cómo se deriva específicamente `unsubscribeTokenHash` (el token de
*confirmación* no cambia) de aleatorio a **determinístico**:
`unsubscribeToken = HMAC-SHA256(email, UNSUBSCRIBE_TOKEN_SECRET)` (codificado base64url, mismo
formato que `generateToken()`), agregado como `deriveUnsubscribeToken(email, secret)` en
`src/core/tokens.ts`. Cualquier proceso que conozca el correo del suscriptor y el secreto
compartido puede recalcular exactamente el mismo token en cualquier momento, sin persistir
nada nuevo — el notifier lo hace al armar cada mensaje; `src/http/routes/subscribers.ts`
(feature 3) pasa a usarlo en vez de `generateToken()` al dar de alta o reemitir.

**Rationale**: mismo criterio no reversible pero recomputable ya usado en `suppressions._id`
(feature 3, HMAC del correo con secreto propio) — no es una técnica nueva en este proyecto, es
la misma aplicada a un problema análogo. Evita agregar un campo nuevo o persistir el token en
claro (que sí violaría el criterio de seguridad original de la feature 3).

**Efecto secundario, positivo**: al ser determinístico, `unsubscribeTokenHash` deja de
necesitar rotarse en cada reenvío de confirmación (`reissueConfirmationToken` deja de recibir
ni actualizar ese campo) — el mismo enlace de baja sigue siendo válido para siempre para una
misma dirección, incluso el de un correo de confirmación superado por un reenvío. La propia
`research.md` de la feature 3 (§8) ya señalaba esa rotación como un efecto secundario un poco
incómodo ("el enlace de baja del mensaje superado queda invalidado"); esta feature lo elimina
como consecuencia de resolver el problema real que motivó el cambio.

**Variable de entorno nueva**: `UNSUBSCRIBE_TOKEN_SECRET` (secreto, nunca versionado), agregada
a **ambos** procesos que lo necesitan — `.env.server` (feature 3, para derivarlo al dar de alta)
y `.env.notifier` (esta feature, para reconstruirlo al armar cada mensaje). Mismo valor en
ambos: es un secreto compartido entre dos procesos, no un secreto propio de uno.

**Compatibilidad con datos existentes**: como el sistema todavía no tiene lanzamiento ni
suscriptores reales (MVP no comercial, confirmado por el usuario en esta misma conversación),
no hace falta ninguna migración — cualquier suscriptor `pending`/`active` creado antes de este
cambio quedaría con un `unsubscribeTokenHash` que ya no es reconstruible por el notifier, pero
no existen suscriptores así todavía. Si en el futuro esto se despliega sobre datos reales,
haría falta una migración explícita (fuera de alcance de esta feature).

**Alternatives considered**: agregar un segundo campo `digestUnsubscribeTokenHash` separado del
existente, calculado igual (determinístico) pero sin tocar el campo original (rechazada: dos
campos con el mismo propósito y el mismo mecanismo es una duplicación sin beneficio — el campo
original solo tenía la propiedad "aleatorio" porque nadie necesitaba antes que fuera
recomputable, no porque el azar fuera un requisito de negocio); que el notifier escriba un
token nuevo en `subscribers` antes de cada envío y lo use una sola vez (rechazada: obligaría al
notifier a tener permiso de escritura sobre `subscribers`, ampliando innecesariamente su
credencial, e invalidaría enlaces de baja de resúmenes anteriores todavía no leídos — contrario
a que la baja "está siempre disponible", Artículo IV).

## 9. Borrado del historial de entregas al eliminarse el suscriptor: choque de credenciales

**Problema encontrado, no mencionado en el input**: FR-019 de spec.md exige que, al eliminarse
un suscriptor (baja o supresión), su historial en `deliveries` se elimine con él — y por el
requisito de datos personales ("las direcciones de correo NUNCA deben... persistir más de lo
necesario tras la baja", Artículo IV), esa eliminación debe ser inmediata, no una limpieza
diferida hasta la próxima corrida del notifier. Pero quien ejecuta la baja
(`deleteAndSuppress`, en `src/adapters/subscriberRepository.ts`) corre dentro del proceso HTTP
de la feature 3, con la credencial `MONGODB_SUBSCRIBERS_URI` — acotada por rol únicamente a
`subscribers`/`suppressions` (research.md §4 de la feature 3). Esa credencial no tiene permiso
sobre `deliveries`, que es la colección que esta feature agrega bajo el ámbito de
`MONGODB_NOTIFIER_URI`.

**Decision**: ampliar el rol de Atlas asociado a `MONGODB_SUBSCRIBERS_URI` para que incluya
también permiso de escritura (`deleteMany`) sobre `deliveries` — nada más: sigue sin poder leer
ni escribir `news`. `deleteAndSuppress()` se extiende para borrar, en la misma llamada,
`deliveries.deleteMany({ subscriberId: params.email })`. El nombre de la colección
(`DELIVERIES_COLLECTION`) se exporta desde `src/adapters/deliveryRepository.ts` (dueño natural
de esa colección) e se importa desde `subscriberRepository.ts` — dos procesos distintos, dos
credenciales de Atlas distintas, mismo nombre de colección físico en el mismo cluster/base, ya
es el patrón existente entre `MONGODB_URI` y `MONGODB_READONLY_URI` sobre `news`.

**Rationale**: la alternativa de barrido diferido (que el notifier limpie entregas huérfanas en
cada corrida) deja direcciones de correo en `deliveries` durante horas tras una baja, lo cual
contradice que la baja "elimina los datos personales efectivamente" (Artículo IV) tal como ya
lo exige y cumple la feature 3 para `subscribers`/`suppressions`. Ampliar un rol ya existente es
un paso operativo (como la verificación de dominio de la feature 3), no una dependencia ni una
credencial nueva.

**Alternatives considered**: barrido diferido en el notifier, ejecutado al inicio de cada
corrida contra la lista vigente de suscriptores (rechazada por la demora en el borrado de datos
personales, arriba); una cuarta credencial dedicada solo para borrar `deliveries` desde el
proceso HTTP (rechazada: agrega un secreto y una conexión más para una sola operación
`deleteMany`, cuando ampliar el rol ya acotado que ese proceso ya usa alcanza).

## 10. Credencial de MongoDB dedicada del notifier

**Decision**: `MONGODB_NOTIFIER_URI`, un cuarto usuario de Atlas (junto a `MONGODB_URI`,
`MONGODB_READONLY_URI`, `MONGODB_SUBSCRIBERS_URI`), con rol acotado a: lectura de `news`,
lectura de `subscribers`, lectura/escritura de `deliveries`, lectura/escritura de `locks` (para
reutilizar el mecanismo de exclusión mutua de la feature 1 con un `_id` de lock distinto —
research.md §1). Sin acceso a `categories`, `state`, `runs`, `raw_snapshots`, `suppressions`.

**Rationale**: mismo criterio de mínimo privilegio ya aplicado en las tres features anteriores
(research.md §4 de la feature 3: "mismo criterio que las credenciales de solo lectura de la
feature 2"); el notifier no necesita ni debería poder escribir `news` ni `subscribers`.

**Alternatives considered**: reutilizar `MONGODB_READONLY_URI` para leer `news` y
`MONGODB_SUBSCRIBERS_URI` para leer `subscribers`, más una credencial nueva solo para
`deliveries`/`locks` (rechazada: obliga al notifier a manejar tres conexiones de Mongo
simultáneas para una sola corrida secuencial de bajo volumen, complejidad operativa sin
beneficio de seguridad adicional frente a una única credencial de cuatro colecciones ya acotada
por sí misma).

## 11. Zona horaria del sistema operativo fijada, requisito de despliegue

**Decision**: se documenta como requisito de despliegue (README, `env.notifier.md`) que la VM
donde corre cron debe tener su zona horaria del sistema operativo fijada a
`America/Argentina/Buenos_Aires` — no se valida en código (no hay forma portable de leer/fijar
la zona del SO desde Node sin invocar herramientas del sistema, y validarlo en runtime no
previene que cron ya haya interpretado mal sus propias entradas antes de que el proceso
arranque). La ventana horaria permitida y el `TIMEZONE` de la app siguen siendo la fuente de
verdad para las decisiones de negocio (Artículo VI) — la zona del SO solo afecta a qué hora
"cree" cron que está invocando, no a ningún cálculo de este proceso.

**Rationale**: instrucción explícita del usuario, con la razón ya dada en el input ("si la
máquina queda en UTC, los envíos se desplazan sin aviso") — es un requisito operativo externo
al código, mismo tratamiento que la verificación de dominio DNS de la feature 3 (research.md §9
de esa feature).

**Alternatives considered**: N/A — requisito operativo explícito, sin alternativas de diseño
equivalentes.

## 12. Procesamiento secuencial de suscriptores, sin cola

**Decision**: un `for...of` simple sobre la lista de suscriptores activos, sin
`Promise.all`/paralelismo y sin ninguna infraestructura de colas/mensajería.

**Rationale**: instrucción explícita del usuario ("no hay volumen que lo justifique"), y
además necesario para que la escritura de cada entrega ocurra inmediatamente después de la
confirmación de **ese** suscriptor (FR-011/FR-014) sin coordinación adicional entre tareas
concurrentes.

**Alternatives considered**: procesar en paralelo con un límite de concurrencia (rechazada
explícitamente por el usuario, y sin beneficio medible al volumen descrito).

## 13. Pruebas locales: `mongodb-memory-server` + `EmailSender` configurable + `now` explícito

**Decision**: la orquestación completa de una corrida se expone como una función exportada,
testeable directamente — `runDigestOnce(deps)` en `src/notifier.ts` — que recibe `db`,
`emailSender`, `now` y la configuración ya cargada como parámetros explícitos (nunca lee
`process.env` ni llama `new Date()` internamente). Carpeta de tests nueva, `tests/notifier/`,
con un `testHelpers.ts` propio: `mongodb-memory-server` (mismo mecanismo que
`tests/http/testHelpers.ts` de las features 2/3) para `news`/`subscribers`/`deliveries`/`locks`
en memoria, y una versión configurable de `FakeEmailSender` cuyo resultado por envío se decide
por test (`"confirmed"`/`"failed"`/`"ambiguous"`, incluso variando por destinatario dentro de
la misma corrida — necesario para el escenario "falla para un suscriptor y funciona para
otro").

**Rationale**: instrucción explícita del usuario, reutilizando el mismo patrón que las
features 2/3. Se documenta una diferencia deliberada con la feature 1: `CLAUDE.md` dice que los
adaptadores del ingestor "son exercitados solo por corridas reales, no por la suite de tests"
— esta feature se aparta de eso a propósito, porque varios escenarios pedidos explícitamente
por el usuario (dos envíos sucesivos sin repetición, ejecución duplicada, recuperación tras una
caída) requieren estado persistente entre múltiples invocaciones de la corrida completa, algo
que los tests unitarios puros de `src/core` contra fixtures no pueden ejercitar por diseño. Es
el mismo razonamiento que ya llevó a las features 2/3 a testear contra `mongodb-memory-server`
en vez de limitarse a `src/core`.

**Alternatives considered**: limitarse a tests unitarios puros de `src/core` (rechazada: no
puede cubrir "dos envíos sucesivos" ni "ejecución duplicada", que son exactamente los
escenarios de mayor riesgo de esta feature — dependen del registro de entregas persistiendo
entre corridas); levantar un MongoDB real de Docker para los tests (rechazada: agrega una
dependencia de infraestructura local que `mongodb-memory-server` ya evita, y por lo tanto
contradice el requisito de verificabilidad sin servicios adicionales).
