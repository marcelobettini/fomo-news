## ADDED Requirements

### Requirement: Formulario de suscripción por email
La app SHALL mostrar, en la misma pantalla que la lista de noticias, un formulario con un
campo de email y un botón de envío para suscribirse mediante `POST /subscribers`.

#### Scenario: Formato de email inválido detectado en cliente
- **WHEN** el usuario intenta enviar el formulario con un valor que no tiene forma de email
  válido
- **THEN** la app no envía la petición y muestra un mensaje de formato inválido

#### Scenario: Envío aceptado por el backend
- **WHEN** el usuario envía un email con formato válido y `POST /subscribers` responde `202`
- **THEN** la app muestra un mensaje de éxito indicando que debe revisar su correo para
  confirmar la suscripción, sin distinguir si la dirección era nueva, ya activa, o pendiente
  de confirmación previa

#### Scenario: Backend rechaza el formato
- **WHEN** `POST /subscribers` responde `400 { error: "invalid_email" }`
- **THEN** la app muestra el mismo mensaje de formato inválido que en la validación de
  cliente, sin exponer el código de error crudo

#### Scenario: Falla la petición por un motivo no relacionado al formato
- **WHEN** `POST /subscribers` falla por falta de red, timeout, `5xx`, o rate limit (`429`)
- **THEN** la app muestra un mensaje de error genérico y accionable ("no se pudo completar,
  probá de nuevo"), sin exponer el código HTTP ni detalle técnico

### Requirement: Confirmación fuera de la app
La app SHALL NOT implementar pantallas de confirmación de suscripción ni de unsubscribe; SHALL
comunicar en el mensaje de éxito que la confirmación se completa desde el correo recibido.

#### Scenario: Usuario confirma desde el correo
- **WHEN** el usuario toca el link de confirmación en el correo recibido
- **THEN** el link se abre en el navegador del sistema, fuera de la app; la app no participa
  de ese flujo ni necesita reflejar el cambio de estado
