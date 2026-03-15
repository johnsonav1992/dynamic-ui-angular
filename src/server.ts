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
};

const modelName = 'gemini-2.0-flash';

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
    return {
      text: final.text || '',
      model: modelName,
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
    return {
      text: final.text || '',
      model: modelName,
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
