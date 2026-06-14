import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import { describeError } from './logger';
import { requireUserHeaders } from './user-context-http';

/** Ruta oficial documentada en API.md */
export const AGENT_GENERATE_PATH = '/api/agents/hr-sql-agent/generate';

type MastraHttpContext = {
  req: {
    path: string;
    method: string;
    query: (k: string) => string | undefined;
    json: () => Promise<unknown>;
  };
  get: (key: 'mastra' | 'requestContext') => unknown;
  json: (body: unknown, status?: number) => Response;
};

type GenerateBody = {
  messages?: string | Array<{ role: string; content: string }>;
  memory?: { thread: string; resource: string };
};

/**
 * Proxy de POST /api/agents/hr-sql-agent/generate en middleware.
 * El router built-in de Mastra devuelve 500 opaco en serverless; este handler
 * llama al agente directamente con el mismo contrato que API.md.
 */
export async function handleAgentGenerateRequest(c: MastraHttpContext) {
  try {
    const requestContext = c.get('requestContext') as
      | { get: (k: string) => unknown; set: (k: string, v: unknown) => void }
      | undefined;

    const user = requireUserHeaders(requestContext);
    if (!user.ok) {
      return c.json({ error: user.error }, 401);
    }

    const body = (await c.req.json()) as GenerateBody;
    if (body.messages == null || body.messages === '') {
      return c.json({ error: 'messages is required' }, 400);
    }
    if (!body.memory?.thread || !body.memory?.resource) {
      return c.json({ error: 'memory.thread and memory.resource are required' }, 400);
    }

    const m = c.get('mastra') as {
      getAgent?: (key: string) => {
        generate: (messages: GenerateBody['messages'], opts: Record<string, unknown>) => Promise<unknown>;
      };
    };
    const agent = m?.getAgent?.('sqlAgent');
    if (!agent) {
      return c.json({ error: 'Agent sqlAgent not found' }, 500);
    }

    const memory = {
      ...body.memory,
      resource: user.colaboradorID,
    };
    if (requestContext) {
      requestContext.set(MASTRA_RESOURCE_ID_KEY, user.colaboradorID);
    }

    const result = await agent.generate(body.messages, {
      memory,
      ...(requestContext ? { requestContext } : {}),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: describeError(err), stack: (err as Error)?.stack }, 500);
  }
}
