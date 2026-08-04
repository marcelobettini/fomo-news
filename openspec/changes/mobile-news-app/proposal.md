## Why

Hoy la única forma de leer las noticias del día o suscribirse a novedades es pegándole
directamente a la API (`GET /news`, `POST /subscribers`). No hay ningún cliente para un
usuario final. Se necesita una app mobile mínima que consuma esa API pública ya existente,
como prueba de un flujo brownfield de OpenSpec sobre un backend construido con SpecKit — sin
tocar el backend ni ir a producción.

## What Changes

- Nueva app Expo/React Native con TypeScript en `mobile/`, subcarpeta autocontenida del repo (paquete propio,
  no comparte `package.json`/`tsconfig.json` con el backend).
- Una sola pantalla que lista las noticias del día (`GET /news`) con pull to refresh
  condicional (`If-None-Match` / `ETag`), y en la misma vista un formulario de suscripción por
  email (`POST /subscribers`).
- Mensajes de usuario mapeados desde las respuestas del backend, sin exponer códigos HTTP ni
  detalle técnico.
- Alcance de prueba: Expo Go en Simulador de iOS únicamente. Sin build de producción, sin EAS,
  sin Android.
- No incluye: pantallas de confirmación o unsubscribe dentro de la app (viven 100% en el
  correo/navegador), autenticación, navegación multi-pantalla, ni persistencia local del
  estado de suscripción.

## Capabilities

### New Capabilities

- `mobile-news-feed`: pantalla que obtiene y muestra las noticias del día desde `GET /news`,
  con pull to refresh condicional y manejo explícito de vacío/error.
- `mobile-subscriber-signup`: formulario de suscripción por email contra `POST /subscribers`,
  con validación de formato en cliente y mensajes de resultado sin exponer detalle técnico.

### Modified Capabilities

(ninguna — el backend no se modifica; `openspec/specs/` no tiene capacidades previas que este
change altere)

## Impact

- **Código nuevo**: `mobile/` (proyecto Expo/React Native completo — app, componentes,
  cliente HTTP, tests unitarios de lógica pura).
- **Código existente**: ninguno. `GET /news` y `POST /subscribers` (`src/http/routes/`) se
  consumen tal cual están, sin cambios de contrato.
- **Dependencias**: nuevas, acotadas a `mobile/` (Expo, React Native) — no afectan las
  dependencias del backend en la raíz del repo.
- **Infraestructura**: ninguna. Se prueba contra el backend corriendo local
  (`npm run serve`, `http://localhost:3000`) desde el Simulador de iOS.
