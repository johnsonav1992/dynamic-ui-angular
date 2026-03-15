import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { FlowServer, startFlowServer, withFlowOptions } from '@genkit-ai/express';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import { genkit } from 'genkit/beta';
import 'dotenv/config';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

if (!process.env['GOOGLE_GENAI_API_KEY'] && process.env['GEMINI_API_KEY']) {
  process.env['GOOGLE_GENAI_API_KEY'] = process.env['GEMINI_API_KEY'];
}

const ai = genkit({ plugins: [googleAI()] });

type ChatFlowInput = {
  prompt: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
};

type ChatFlowOutput = {
  text: string;
  model: string;
  ui?: UISchema;
};

type LayoutConfig = {
  direction?: 'row' | 'column';
  gap?: string;
  columns?: number;
};

type UINode = {
  type: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, string>;
  children?: UINode[];
  layout?: LayoutConfig;
};

type UISchema = {
  root: UINode;
};

const modelName = 'gemini-2.0-flash';

const ALLOWED_TYPES = new Set(['container', 'tag', 'button']);

const extractJsonObject = (text: string): string | null => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return text.slice(firstBrace, lastBrace + 1);
};

const sanitizeNode = (node: unknown, depth = 0): UINode | null => {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  const candidate = node as Record<string, unknown>;
  const type = typeof candidate.type === 'string' ? candidate.type : null;
  if (!type || !ALLOWED_TYPES.has(type)) return null;

  const layout: LayoutConfig = {};
  if (candidate.layout && typeof candidate.layout === 'object') {
    const rawLayout = candidate.layout as Record<string, unknown>;
    if (rawLayout.direction === 'row' || rawLayout.direction === 'column') {
      layout.direction = rawLayout.direction;
    }
    if (typeof rawLayout.gap === 'string') {
      layout.gap = rawLayout.gap;
    }
    if (typeof rawLayout.columns === 'number' && Number.isFinite(rawLayout.columns)) {
      layout.columns = Math.max(1, Math.min(4, Math.floor(rawLayout.columns)));
    }
  }

  const sanitized: UINode = {
    type,
  };

  if (candidate.inputs && typeof candidate.inputs === 'object') {
    sanitized.inputs = candidate.inputs as Record<string, unknown>;
  }

  if (Object.keys(layout).length > 0) {
    sanitized.layout = layout;
  }

  if (Array.isArray(candidate.children)) {
    const children = candidate.children
      .map((child) => sanitizeNode(child, depth + 1))
      .filter((value): value is UINode => value !== null);
    if (children.length > 0) sanitized.children = children;
  }

  return sanitized;
};

const sanitizeSchema = (value: unknown): UISchema | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const root = sanitizeNode((value as Record<string, unknown>).root);
  return root ? { root } : undefined;
};

const generateUiSchema = async (input: ChatFlowInput, assistantText: string): Promise<UISchema | undefined> => {
  const history = input.history ?? [];
  const historyText = history
    .slice(-6)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');

  const uiPrompt = [
    'Return ONLY JSON with this exact shape: {"root": UINode}.',
    'UINode fields: type, inputs, children, layout. No markdown, no prose.',
    'Allowed type values: container, tag, button.',
    'Allowed layout: direction (row|column), gap (css string), columns (number).',
    'For tag: inputs {"text": string, "tone": "neutral"|"success"|"warning"}.',
    'For button: inputs {"label": string}.',
    'Prefer compact, useful UI for the assistant response.',
    historyText ? `Conversation:\n${historyText}` : '',
    `User prompt: ${input.prompt}`,
    `Assistant response: ${assistantText}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { response } = ai.generateStream({
    model: gemini20Flash,
    config: { temperature: 0.2 },
    prompt: uiPrompt,
  });

  const final = await response;
  const text = final.text || '';
  const jsonText = extractJsonObject(text);
  if (!jsonText) return undefined;

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return sanitizeSchema(parsed);
  } catch {
    return undefined;
  }
};

const toPrompt = (input: ChatFlowInput): string => {
  const history = input.history ?? [];
  const historyText = history
    .slice(-8)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content}`)
    .join('\n');

  return [
    'You are a helpful assistant. Keep responses concise and clear.',
    historyText ? `Conversation so far:\n${historyText}` : '',
    `User: ${input.prompt}`,
    'Assistant:',
  ]
    .filter(Boolean)
    .join('\n\n');
};

const chat = ai.defineFlow(
  {
    name: 'chat',
  },
  async (input: ChatFlowInput): Promise<ChatFlowOutput> => {
    const { response } = ai.generateStream({
      model: gemini20Flash,
      config: { temperature: 0.5 },
      prompt: toPrompt(input),
    });

    const final = await response;
    const text = final.text || '';
    const ui = await generateUiSchema(input, text);
    return {
      text,
      model: modelName,
      ui,
    };
  },
);

const chatStream = ai.defineFlow(
  {
    name: 'chatStream',
  },
  async (input: ChatFlowInput, { sendChunk }): Promise<ChatFlowOutput> => {
    const { response, stream } = ai.generateStream({
      model: gemini20Flash,
      config: { temperature: 0.5 },
      prompt: toPrompt(input),
    });

    (async () => {
      for await (const chunk of stream) {
        const text = chunk.content?.[0]?.text || '';
        for (const char of text) {
          sendChunk(char);
        }
      }
    })();

    const final = await response;
    const text = final.text || '';
    const ui = await generateUiSchema(input, text);
    return {
      text,
      model: modelName,
      ui,
    };
  },
);

export const streamCharacters = ai.defineFlow(
  {
    name: 'streamCharacters',
  },
  async (count: number, { sendChunk }): Promise<string> => {
    const { response, stream } = ai.generateStream({
      model: gemini20Flash,
      config: {
        temperature: 1,
      },
      prompt: `Generate ${count} different RPG game characters.`,
    });
    (async () => {
      for await (const chunk of stream) {
        const text = chunk.content?.[0]?.text || '';
        for (const char of text) {
          sendChunk(char);
        }
      }
    })();
    return (await response).text || '';
  },
);

const globalWithFlowServer = globalThis as typeof globalThis & {
  __dynamicUiFlowServer?: FlowServer;
};

const startConfiguredFlowServer = () =>
  startFlowServer({
    flows: [
      withFlowOptions(chat, { path: 'chat' }),
      withFlowOptions(chatStream, { path: 'chatStream' }),
      withFlowOptions(streamCharacters, { path: 'streamCharacters' }),
    ],
    pathPrefix: 'api/flows/',
    port: Number(process.env['GENKIT_FLOW_PORT'] || 3401),
    cors: { origin: true },
  });

const previousFlowServer = globalWithFlowServer.__dynamicUiFlowServer;

if (previousFlowServer) {
  void previousFlowServer.stop().finally(() => {
    globalWithFlowServer.__dynamicUiFlowServer = startConfiguredFlowServer();
  });
} else {
  globalWithFlowServer.__dynamicUiFlowServer = startConfiguredFlowServer();
}

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/**', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
