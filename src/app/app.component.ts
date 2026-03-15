import { Component, signal } from '@angular/core';
import { runFlow, streamFlow } from 'genkit/beta/client';
import { DynamicRendererComponent } from './components/dynamic-renderer/dynamic-renderer.component';
import './components/button/button.component';
import './components/tag/tag.component';
import './components/container/container.component';
import { UISchema } from './models/ui-schema.model';

type AgentIntent = 'confirm-action' | 'show-status' | 'default';

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ui?: UISchema;
};

type ChatApiResponse = {
  text: string;
  model?: string;
};

const flowBaseUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:${window.location.port === '4200' ? '3401' : window.location.port}/api/flows`
    : 'http://localhost:3401/api/flows';

const chooseTree = (intent: AgentIntent): UISchema => {
  if (intent === 'confirm-action') {
    return {
      root: {
        type: 'container',
        layout: { direction: 'row', gap: '0.75rem' },
        children: [
          {
            type: 'tag',
            inputs: {
              text: 'Action Needed',
              tone: 'warning',
            },
          },
          {
            type: 'button',
            inputs: {
              label: 'Generate Plan',
            },
          },
        ],
      },
    };
  }

  if (intent === 'show-status') {
    return {
      root: {
        type: 'container',
        layout: { direction: 'column', gap: '0.6rem' },
        children: [
          {
            type: 'container',
            layout: { direction: 'row', gap: '0.5rem' },
            children: [
              {
                type: 'tag',
                inputs: {
                  text: 'Ready',
                  tone: 'success',
                },
              },
            ],
          },
          {
            type: 'container',
            layout: { direction: 'row', gap: '0.5rem', columns: 1 },
            children: [
              {
                type: 'button',
                inputs: {
                  label: 'Publish Result',
                },
              },
            ],
          },
        ],
      },
    };
  }

  return {
    root: {
      type: 'container',
      layout: { direction: 'column', gap: '0.5rem' },
      // children: [
      //   {
      //     type: 'tag',
      //     inputs: {
      //       text: 'Info',
      //       tone: 'neutral',
      //     },
      //   },
      // ],
    },
  };
};

const inferIntent = (prompt: string): AgentIntent => {
  const value = prompt.toLowerCase();

  if (value.includes('publish') || value.includes('ready') || value.includes('done')) {
    return 'show-status';
  }

  if (value.includes('create') || value.includes('generate') || value.includes('plan') || value.includes('checklist')) {
    return 'confirm-action';
  }

  return 'default';
};

const buildAssistantReply = (prompt: string): Omit<ChatMessage, 'id'> => {
  const intent = inferIntent(prompt);

  if (intent === 'show-status') {
    return {
      role: 'assistant',
      content: 'Status noted. Everything looks ready from the current context.',
      ui: chooseTree('show-status'),
    };
  }

  if (intent === 'confirm-action') {
    return {
      role: 'assistant',
      content: 'I can prepare that now. Confirm to generate the next step.',
      ui: chooseTree('confirm-action'),
    };
  }

  return {
    role: 'assistant',
    content: 'Got it. I can provide a short response or a full action flow.',
    ui: chooseTree('default'),
  };
};

const fetchGeminiReply = async (prompt: string, history: ChatMessage[]): Promise<string> => {
  const data = await runFlow<ChatApiResponse>({
    url: `${flowBaseUrl}/chat`,
    input: {
      prompt,
      history: history.map((item) => ({
        role: item.role,
        content: item.content,
      })),
    },
  });

  return data.text;
};

const streamGeminiReply = async (
  prompt: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void | Promise<void>,
): Promise<string> => {
  const response = streamFlow<ChatApiResponse, string>({
    url: `${flowBaseUrl}/chatStream`,
    input: {
      prompt,
      history: history.map((item) => ({
        role: item.role,
        content: item.content,
      })),
    },
  });

  for await (const chunk of response.stream) {
    await onChunk(chunk);
  }

  const output = await response.output;
  return output.text;
};

@Component({
  selector: 'app-root',
  imports: [DynamicRendererComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  protected summary = 'Type a message to stream a Gemini response character-by-character via Genkit flow client helpers.';

  protected draft = signal('Can you generate a launch checklist?');
  protected isTyping = signal(false);
  protected messages = signal<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: 'Ask for an action and I will choose components to help respond.',
      ui: chooseTree('default'),
    },
  ]);
  private nextId = 2;

  protected updateDraft(value: string): void {
    this.draft.set(value);
  }

  protected async sendMessage(): Promise<void> {
    const userPrompt = this.draft().trim();
    if (!userPrompt || this.isTyping()) return;

    const snapshot = this.messages();

    this.messages.update((current) => [
      ...current,
      {
        id: this.nextId++,
        role: 'user',
        content: userPrompt,
      },
    ]);

    this.draft.set('');
    this.isTyping.set(true);

    const intent = inferIntent(userPrompt);
    const assistantId = this.nextId++;

    this.messages.update((current) => [
      ...current,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        ui: chooseTree(intent),
      },
    ]);

    try {
      const aiText = await streamGeminiReply(userPrompt, snapshot, (chunk) => {
        return new Promise<void>((resolve) => {
          const chars = Array.from(chunk);

          const typeNext = () => {
            const char = chars.shift();
            if (char === undefined) {
              resolve();
              return;
            }

            this.messages.update((current) =>
              current.map((msg) =>
                msg.id === assistantId
                  ? {
                      ...msg,
                      content: `${msg.content}${char}`,
                    }
                  : msg,
              ),
            );

            setTimeout(typeNext, 12);
          };

          typeNext();
        });
      });

      if (!aiText.trim()) {
        throw new Error('Empty stream response');
      }

      this.messages.update((current) => [
        ...current.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: aiText,
              }
            : msg,
        ),
      ]);
    } catch {
      try {
        const aiText = await fetchGeminiReply(userPrompt, snapshot);

        if (!aiText.trim()) {
          throw new Error('Empty flow response');
        }

        this.messages.update((current) => [
          ...current.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: aiText,
                }
              : msg,
          ),
        ]);
      } catch {
        const reply = buildAssistantReply(userPrompt);

        this.messages.update((current) => [
          ...current.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  ...reply,
                }
              : msg,
          ),
        ]);
      }
    } finally {
      this.isTyping.set(false);
    }
  }

  protected resetChat(): void {
    this.messages.set([
      {
        id: 1,
        role: 'assistant',
        content: 'Ask for an action and I will choose components to help respond.',
        ui: chooseTree('default'),
      },
    ]);
    this.nextId = 2;
    this.draft.set('');
    this.isTyping.set(false);
  }
}
