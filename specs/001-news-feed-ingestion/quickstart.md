# Quickstart: validar la captura de noticias

## Prerrequisitos

- Node.js LTS (>=22) instalado.
- Un cluster de MongoDB Atlas (el tier gratuito alcanza) y su cadena de conexión.
- Variables de entorno configuradas según [contracts/cli-contract.md](./contracts/cli-contract.md)
  (cadena de conexión, URL del feed, categoría objetivo, zona horaria IANA, retención de
  noticias, retención de copia cruda, umbral de ausencia prolongada de categoría). Sin
  secretos versionados: usar un archivo de entorno local no commiteado.

## Configurar la periodicidad (cron)

Este proceso no se programa a sí mismo (Artículo II); cron del sistema operativo lo invoca.
Ejemplo de entrada de crontab (ajustar el intervalo según los datos de `runs.oldestEntryAt`
observados — ver más abajo):

```cron
*/5 * * * * cd /ruta/al/proyecto && node --env-file=.env dist/main.js >> /var/log/ingestor.log 2>&1
```

Para calibrar el intervalo: consultar `runs` ordenado por `startedAt` y observar
`oldestEntryAt` de cada corrida; si se acerca demasiado al límite de la ventana de ~20 ítems
entre corridas sucesivas, reducir el intervalo.

## Validación sin red (fixtures)

La mayor parte de los criterios de aceptación de spec.md se validan contra
`tests/fixtures/` sin tocar la red ni MongoDB, ejercitando `src/core` directamente:

```bash
npm test
```

Casos que los fixtures deben cubrir (ver data-model.md y research.md para el detalle de
cada decisión):

- Corrida normal con noticias nuevas de la categoría objetivo → quedan con los campos
  correctos (User Story 1, escenario 1).
- La misma corrida ejecutada dos veces sobre el mismo fixture → mismo resultado, sin
  duplicados (User Story 1, escenario 2; SC-003).
- Una entrada ya conocida con contenido actualizado → se refleja actualizada, no cuenta como
  nueva (User Story 1, escenario 3).
- Entradas de categorías distintas a la objetivo → ninguna se conserva (User Story 1,
  escenario 4; SC-006).
- Entrada con fecha UTC de madrugada → se le atribuye el día local correcto (User Story 1,
  escenario 5).
- Fixture "primera corrida" (sin historial previo) con 100% de entradas nuevas → NO dispara
  la alarma de rotación completa (research.md §7).
- Fixture con historial previo y 100% de entradas nuevas en la corrida actual → SÍ dispara
  la alarma de rotación completa (User Story 3, escenario 1; SC-005).
- Fixture con cero entradas objetivo por un período prolongado → dispara la alarma de
  ausencia de categoría (User Story 3, escenario 2).
- Fixture con una categoría nunca antes vista → se registra y dispara señal de novedad (User
  Story 3, escenario 3).
- Fixture vacío (`entriesSeen === 0`) → la corrida nunca se marca exitosa (User Story 3,
  escenario 4; FR-017).
- Fixture con categoría declarada distinta de la categoría en la ruta del enlace → se
  almacena/descarta según la categoría declarada y se registra la anomalía, sin alarma de
  pérdida (FR-011).
- Fixture con más entradas nuevas que el tamaño de ventana simulado entre dos corridas → se
  reporta como pérdida de datos (User Story 3, escenario 6; FR-022).
- Fixture con resumen sin imagen inicial y con imagen inicial → en ambos casos el resultado
  conserva el texto tal como lo publica la fuente, solo se quita la imagen si existe
  (Artículo VIII).

## Validación con la fuente real (manual, end-to-end)

1. Configurar las variables de entorno apuntando al feed real y a un cluster de Atlas de
   prueba.
2. Ejecutar el proceso una vez:

   ```bash
   node --env-file=.env dist/main.js
   ```

3. Verificar en `runs` que la corrida quedó registrada con `status: "success"`,
   `entriesSeen > 0` y los contadores esperados.
4. Verificar en `news` que solo hay documentos de la categoría configurada, con los seis
   campos de data-model.md y sin el cuerpo del artículo.
5. Ejecutar el proceso una segunda vez de inmediato: `entriesNew` de la segunda corrida debe
   ser `0` (o reflejar solo publicaciones genuinamente nuevas ocurridas entre medio) y
   `news` no debe haber crecido en duplicados (SC-003).
6. Ejecutar dos invocaciones simultáneas (`node ... & node ...`) y confirmar que solo una
   corrida real ocurre; la otra termina sin error de datos, indicando que el lock la evitó.
7. Simular varias corridas seguidas con la fuente caída (cambiar temporalmente la URL
   configurada a una inválida) y confirmar que `news` no pierde datos y que, al restaurar la
   URL correcta, la corrida siguiente se recupera sola sin intervención manual (SC-007).

## Resultado esperado

Todos los criterios de aceptación de spec.md quedan verificados: idempotencia, retención que
cubre el cruce de día local, conversión correcta de UTC a hora local, recuperación
automática tras una falla de fuente, detección de pérdida por rotación completa de ventana, y
ninguna noticia ajena a la categoría configurada almacenada.
