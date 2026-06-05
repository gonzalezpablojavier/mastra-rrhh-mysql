# Guía de Acceso a la API de Mastra (HR SQL Agent)

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

Las peticiones `POST` a los endpoints de generación o streaming aceptan un body en formato JSON con la siguiente estructura básica:

```json
{
  "messages": "string | CoreMessage[]",
  "threadId": "string",
  "memory": "boolean"
}
```

### Detalle de Campos:
* **`messages`** *(Obligatorio)*: El prompt del usuario. Puede ser una cadena de texto simple o un arreglo de objetos de conversación `CoreMessage` de la forma:
  ```json
  "messages": [
    { "role": "user", "content": "Hola, ¿cuál es mi horario?" }
  ]
  ```
* **`threadId`** *(Opcional)*: Identificador único del hilo de conversación para mantener la persistencia y contexto histórico.
* **`memory`** *(Opcional)*: Booleano que indica si se debe utilizar o no el almacenamiento del historial en la base de datos de Mastra.

---

## 4. Control de Acceso y Seguridad (Inyección de Contexto)

> [!IMPORTANT]
> El agente `hr-sql-agent` posee estrictas políticas de seguridad multitenant y privacidad basadas en roles. Para que las consultas SQL se ejecuten con éxito, debes proveer el bloque de contexto del usuario actual en la conversación o en el mensaje en el formato exacto:
>
> `[CONTEXTO_USUARIO: colaboradorID=X, rol=Y, area=A, empresaId=Z]`
>
> Si este bloque de contexto no se proporciona, o si las credenciales no tienen permisos suficientes para consultar la información solicitada, el agente denegará la petición por seguridad.

---

## 5. Ejemplos de Implementación

### Petición por consola (`curl`)

```bash
curl -X POST http://localhost:4111/api/agents/hr-sql-agent/generate \
  -H "Content-Type: application/json" \
  -d '{
    "messages": "[CONTEXTO_USUARIO: colaboradorID=2, rol=colaborador, area=Sistemas, empresaId=1] Hola, ¿cuántos días de vacaciones tengo disponibles?",
    "threadId": "sesion_usuario_123"
  }'
```

### Petición con JavaScript (`fetch`)

```javascript
async function consultarAgenteRRHH() {
  const url = 'http://localhost:4111/api/agents/hr-sql-agent/generate';
  const payload = {
    messages: '[CONTEXTO_USUARIO: colaboradorID=2, rol=colaborador, area=Sistemas, empresaId=1] ¿Cuáles son las políticas de vacaciones?',
    threadId: 'sesion_usuario_123'
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('Respuesta del agente:', data.text);
  } catch (error) {
    console.error('Error al consultar el agente:', error);
  }
}
```

---

## 6. Uso Alternativo: SDK de Cliente (`@mastra/client-js`)

Mastra provee un SDK de cliente oficial para conectar servicios de forma tipada:

```typescript
import { MastraClient } from '@mastra/client-js';

const client = new MastraClient({
  baseUrl: 'http://localhost:4111',
});

const agent = client.getAgent('hr-sql-agent');

const response = await agent.generate({
  messages: '[CONTEXTO_USUARIO: colaboradorID=2, rol=colaborador, area=Sistemas, empresaId=1] Hola agente',
});

console.log(response.text);
```
