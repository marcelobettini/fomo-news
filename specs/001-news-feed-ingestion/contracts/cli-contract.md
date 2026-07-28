# Contract: invocación del ejecutable de ingesta

Este proceso no expone red; su contrato es su forma de invocación, sus variables de entorno
y su código de salida. Este es el contrato que cron (externo, Artículo II) debe respetar.

## Invocación

- Un único comando, sin argumentos obligatorios, sin flags interactivos.
- El proceso arranca, ejecuta una corrida completa, y termina. No debe quedar residente ni
  reprogramarse a sí mismo.
- Debe ser seguro invocarlo de forma solapada (dos invocaciones simultáneas): la segunda
  DEBE detectar el lock vigente, no ejecutar una segunda corrida concurrente, y terminar de
  forma distinguible de un fallo de fuente (no es un error de datos, es una corrida omitida
  por exclusión mutua).

## Variables de entorno requeridas

| Variable | Propósito |
|---|---|
| Cadena de conexión a MongoDB | Acceso a la base (Atlas). |
| URL del feed de la fuente | Endpoint Atom a consultar. |
| Categoría objetivo | Nombre de categoría a conservar. |
| Nombre de zona horaria IANA | Ej. `America/Argentina/Buenos_Aires`; nunca un offset numérico (Artículo VI). |
| Período de retención de noticias | Duración usada para calcular `expiresAt` en `news`. |
| Período de retención de la copia cruda de diagnóstico | Duración corta, independiente de la anterior. |
| Umbral de ausencia prolongada de categoría objetivo | Duración usada para evaluar la alarma de `category-silence`. |

Todas se cargan con el mecanismo nativo de Node (sin paquete gestor de entorno); ninguna
tiene un valor por defecto embebido en el código para datos sensibles (cadena de conexión).

## Código de salida

| Código | Significado |
|---|---|
| `0` | Corrida exitosa (incluye el caso normal de cero noticias nuevas). También corresponde a una corrida omitida por exclusión mutua (lock vigente) — no es un fallo. |
| distinto de `0` | Corrida fallida: fuente no respondió o respondió de forma inválida, cero entradas vistas, o alguna condición de alarma de pérdida de datos confirmada (rotación completa de ventana, ausencia prolongada de categoría). |

El código de salida es la señal que cron (o el sistema de monitoreo que lea sus logs) usa
para notar un fallo; el detalle vive en el registro de la corrida (`runs`), no en el código
de salida en sí.

## Salida estándar / error

- No se define un formato de salida estructurado como contrato (no hay consumidor
  automatizado de stdout en este feature); el registro persistente en `runs` es la fuente de
  verdad. stderr puede usarse para diagnóstico legible por humanos.
