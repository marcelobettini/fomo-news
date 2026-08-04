## 1. Bootstrap del proyecto Expo

- [x] 1.1 Crear `mobile/` con `create-expo-app` (TypeScript template), paquete autocontenido
      con su propio `package.json`/`app.json`/`tsconfig.json`
- [x] 1.2 Configurar `EXPO_PUBLIC_API_URL` como env var (default `http://localhost:3000` para
      Simulador de iOS) — nunca hardcodear la URL del backend en el código
- [x] 1.3 Verificar que `npx expo start` levanta y abre en Simulador de iOS vía Expo Go, sin
      tocar `package.json`/`tsconfig.json` de la raíz del repo

## 2. Cliente HTTP

- [x] 2.1 Implementar función de fetch para `GET /news` que lea `EXPO_PUBLIC_API_URL`, envíe
      `If-None-Match` cuando haya un `ETag` guardado, y exponga por separado los casos
      `200`/`304`/`503`/fallo de red
- [x] 2.2 Implementar función de fetch para `POST /subscribers` que envíe `{ email }` y exponga
      por separado los casos `202`/`400 invalid_email`/otro fallo (red, timeout, `5xx`, `429`)

## 3. Pantalla de noticias (mobile-news-feed)

- [x] 3.1 Componente de lista que renderiza título, resumen, link y fecha de publicación por
      cada noticia
- [x] 3.2 Estado vacío ("no hay noticias hoy") distinguible visualmente del estado de error
- [x] 3.3 Estado de error explícito para `503` / fallo de red en la carga inicial
- [x] 3.4 Pull to refresh: reenvía `If-None-Match`, ignora el body en `304` sin pisar la lista,
      reemplaza la lista y guarda el nuevo `ETag` en `200`, conserva la lista previa si el
      refresh falla
- [x] 3.5 Fetch inicial de `GET /news` al montar la pantalla

## 4. Formulario de suscripción (mobile-subscriber-signup)

- [x] 4.1 Función pura de validación de formato de email en cliente
- [x] 4.2 Función pura de mapeo resultado de `POST /subscribers` → mensaje de usuario (éxito
      genérico / formato inválido / error genérico), sin exponer código HTTP
- [x] 4.3 Componente de formulario (campo de email + botón de envío) integrado en la misma
      pantalla que la lista de noticias
- [x] 4.4 Bloquear el envío y mostrar el mensaje de formato inválido cuando la validación de
      cliente falla, sin llamar al backend
- [x] 4.5 Mostrar el mensaje mapeado (2.2 + 4.2) tras cada intento de envío

## 5. Tests unitarios de lógica pura

- [x] 5.1 Tests de la validación de formato de email (4.1): casos válidos e inválidos
- [x] 5.2 Tests del mapeo resultado → mensaje de usuario (4.2): `202`, `400 invalid_email`,
      `429`/`5xx`/timeout/sin red

## 6. Verificación manual end-to-end

- [ ] 6.1 Con el backend corriendo (`npm run serve` en la raíz) y la app en Expo Go sobre
      Simulador de iOS: confirmar que la lista carga noticias reales del día
- [ ] 6.2 Confirmar el estado vacío apagando temporalmente la fuente de noticias del día (o en
      un día sin publicaciones)
- [ ] 6.3 Confirmar pull to refresh sin cambios (`304`) y con cambios (`200` con `ETag` nuevo)
- [ ] 6.4 Suscribirse con un email real, confirmar el mensaje de "revisá tu correo", y
      verificar que el link de confirmación del correo recibido abre correctamente en el
      navegador del sistema (fuera del simulador)
- [ ] 6.5 Probar el caso de formato de email inválido y el caso de backend apagado
      (mensaje de error genérico, sin detalle técnico)
