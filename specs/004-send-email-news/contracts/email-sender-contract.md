# Contract: interfaz `EmailSender` (compartida entre features 3 y 4)

No es un contrato HTTP ni un contrato de invocación — es el contrato de código entre `src/core`
y `src/adapters` que exige el Artículo V ("el núcleo NO DEBE conocer el medio de entrega"). Se
documenta como contrato explícito porque esta feature lo **modifica** (research.md §7) y porque
a partir de esta feature tiene dos consumidores (`src/http/routes/subscribers.ts` de la feature
3, y `src/notifier.ts` de esta feature) que deben seguir viéndolo exactamente igual.

## Forma (desde esta feature en adelante)

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export type EmailSendResult = "confirmed" | "failed" | "ambiguous";

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
```

`send()` **no lanza** como forma de reportar un problema de entrega — el resultado siempre es
un valor. (Puede seguir lanzando ante un error de programación genuino, p. ej. un `message`
malformado, pero eso no es parte de este contrato de negocio.)

## Significado de cada resultado

| Resultado | Cuándo | Qué debe hacer el consumidor |
|---|---|---|
| `"confirmed"` | El canal confirmó explícitamente la entrega. | Puede registrar la entrega como efectiva (feature 4: crear el documento en `deliveries`). |
| `"failed"` | El canal respondió explícitamente rechazando el envío. | Tratar como no entregado; en la feature 4, reintentar en la corrida siguiente sin registrar nada. |
| `"ambiguous"` | No hubo respuesta clara del canal (timeout, error de red, sin respuesta). | Tratar igual que `"failed"` a los efectos de registrar la entrega — nunca asumir éxito ante la duda (spec.md, "Cómo se registra la entrega"). |

## Implementaciones

- **Producción** (`createResendEmailSender`, `src/adapters/emailSender.ts`): clasifica según la
  respuesta HTTP de Resend (research.md §7 de esta feature).
- **Consola, desarrollo local** (`createConsoleEmailSender`, agregado para pruebas manuales sin
  Resend): siempre devuelve `"confirmed"` — imprime el mensaje en vez de enviarlo.
- **Doble de pruebas** (`makeFakeEmailSender`, `tests/http/testHelpers.ts` y su equivalente en
  `tests/notifier/testHelpers.ts`): devuelve `"confirmed"` por defecto, con un resultado
  configurable por invocación para simular los tres casos (necesario para los escenarios de
  fallo parcial/ambigüedad de esta feature).

## Quién puede depender de este contrato

Cualquier canal de entrega futuro (Artículo V) implementa esta misma interfaz; ningún consumidor
(`src/core/confirmationEmail.ts`, `src/core/digestEmail.ts`) importa ni conoce la
implementación concreta — solo el tipo `EmailMessage`/`EmailSendResult`.
