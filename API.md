# Guía de Acceso a la API de Mastra (ROMA IA)

Esta guía explica cómo interactuar con el agente `hr-sql-agent` a través de la API HTTP que expone automáticamente el servidor de Mastra en desarrollo o producción.

---

## 1. Servidor de Mastra

Por defecto, al iniciar el servidor con `npm run dev` o `mastra dev`, este se ejecuta en:
`http://localhost:4111`

---

## 2. Endpoints Disponibles

Mastra expone rutas automáticas para cada agente registrado.

### Generación de Texto Completo
* **Método:** `POST`
* **Ruta:** `/api/agents/hr-sql-agent/generate`
* **Descripción:** Retorna la respuesta completa del agente una vez que finaliza su procesamiento y llamadas a herramientas.

### Streaming de Respuesta
* **Método:** `POST`
* **Ruta:** `/api/agents/hr-sql-agent/stream`
* **Descripción:** Retorna un flujo de datos (Server-Sent Events) para renderizar la respuesta del agente palabra por palabra en tiempo real.

---

## 3. Estructura del Payload (JSON Body)

Las peticiones `POST` a los endpoints de generación o streaming aceptan un body en formato JSON con la siguiente estructura (verificada contra el servidor de Mastra 1.x):

```json
{
  "messages": "string | CoreMessage[]",
  "memory": { "thread": "string", "resource": "string" }
}
```

### Detalle de Campos:
* **`messages`** *(Obligatorio)*: El prompt del usuario. Puede ser una cadena de texto simple o un arreglo de objetos de conversación `CoreMessage` de la forma:
  ```json
  "messages": [
    { "role": "user", "content": "Hola, ¿cuál es mi horario?" }
  ]
  ```
* **`memory`** *(Obligatorio si el agente usa Memory — este lo usa)*: objeto con **ambos** campos:
  * **`thread`**: identificador del hilo de conversación (persiste el historial de esa conversación).
  * **`resource`**: identificador del usuario dueño de la memoria. **Debe ser el `colaboradorID`.**

> [!NOTE]
> El campo `memory.resource` que envíe el cliente es **sobrescrito por seguridad** por el servidor con el valor de la cabecera `x-colaborador-id` (vía `MASTRA_RESOURCE_ID_KEY`), de modo que un usuario no pueda acceder a la memoria de otro. Aun así, el body **exige** el campo por validación: envía `resource = colaboradorID`.
>
> El formato antiguo `threadId`/`memory: boolean` (top-level) **ya no es válido** en esta versión.

---

## 4. Control de Acceso y Seguridad (Cabeceras de Contexto)

> [!IMPORTANT]
> El agente `hr-sql-agent` aplica aislamiento multi-empresa y privacidad por rol **de forma determinista en código**. El contexto del usuario ya **NO** se envía dentro del mensaje, sino mediante **cabeceras HTTP de confianza** que un middleware del servidor traslada al `RequestContext` de Mastra:
>
> | Cabecera | Descripción |
> |---|---|
> | `x-empresa-id` | ID de la empresa (tenant). **Obligatorio.** |
> | `x-colaborador-id` | ID del colaborador autenticado. **Obligatorio.** Aísla además la memoria. |
> | `x-rol` | Rol: `colaborador`, `gerencia` o `admin`. |
> | `x-area` | Área del colaborador (usada por el rol `gerencia`). |
>
> Si no se reciben `x-empresa-id` y `x-colaborador-id`, el agente **no ejecuta ninguna consulta** y responde que la sesión no está autenticada.
>
> ⚠️ **Producción**: estas cabeceras deben ser establecidas por un backend que verifique un **JWT**, nunca enviadas directamente por el cliente final (de lo contrario serían falsificables).

---

## 5. Ejemplos de Implementación

### Petición por consola (`curl`)

```bash
curl -X POST http://localhost:4111/api/agents/hr-sql-agent/generate \
  -H "Content-Type: application/json" \
  -H "x-empresa-id: 1" \
  -H "x-colaborador-id: 2" \
  -H "x-rol: colaborador" \
  -H "x-area: Sistemas" \
  -d '{
    "messages": "Hola, ¿cuántos días de vacaciones tengo disponibles?",
    "memory": { "thread": "sesion_usuario_123", "resource": "2" }
  }'
```

### Petición con JavaScript (`fetch`)

```javascript
async function consultarAgenteRRHH() {
  const url = 'http://localhost:4111/api/agents/hr-sql-agent/generate';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-empresa-id': '1',
      'x-colaborador-id': '2',
      'x-rol': 'colaborador',
      'x-area': 'Sistemas',
    },
    body: JSON.stringify({
      messages: '¿Cuáles son las políticas de vacaciones?',
      memory: { thread: 'sesion_usuario_123', resource: '2' },
    }),
  });

  const data = await response.json();
  console.log('Respuesta del agente:', data.text);
}
```

### Ejemplo: dominio "global" (Mundial)

Las tablas de scope `global` (ej: posiciones del Mundial) no requieren `empresaId`, así que cualquier colaborador puede consultarlas:

```bash
curl -X POST http://localhost:4111/api/agents/hr-sql-agent/generate \
  -H "Content-Type: application/json" \
  -H "x-empresa-id: 1" \
  -H "x-colaborador-id: 2" \
  -H "x-rol: colaborador" \
  -H "x-area: Sistemas" \
  -d '{
    "messages": "¿Cómo va Argentina en el mundial?",
    "memory": { "thread": "sesion_usuario_123", "resource": "2" }
  }'
```

---

## 6. Uso Alternativo: SDK de Cliente (`@mastra/client-js`)

Mastra provee un SDK de cliente oficial. Las cabeceras de contexto se pasan al construir el cliente:

```typescript
import { MastraClient } from '@mastra/client-js';

const client = new MastraClient({
  baseUrl: 'http://localhost:4111',
  headers: {
    'x-empresa-id': '1',
    'x-colaborador-id': '2',
    'x-rol': 'colaborador',
    'x-area': 'Sistemas',
  },
});

const agent = client.getAgent('hr-sql-agent');

const response = await agent.generate({
  messages: 'Hola agente, ¿cuántos días de vacaciones tengo?',
  memory: { thread: 'sesion_usuario_123', resource: '2' },
});

console.log(response.text);
```
