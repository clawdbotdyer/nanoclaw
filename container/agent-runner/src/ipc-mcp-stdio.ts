/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import Honcho from 'honcho-ai';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID || 'unknown@g.us';
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER || 'unknown';
const isMain = process.env.NANOCLAW_IS_MAIN === '1';
const userId = chatJid.split('@')[0]; // Extract user ID from JID

// Honcho configuration
const HONCHO_API_KEY = process.env.HONCHO_API_KEY ?? '';
const HONCHO_WORKSPACE = process.env.HONCHO_WORKSPACE ?? 'nanoclaw';
const HONCHO_GROUPS = new Set(
  (process.env.HONCHO_GROUPS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
);

// Lazy Honcho client (only created if tools are called)
let _honcho: Honcho | null = null;
let _appId: string | null = null;

function getHoncho(): Honcho {
  if (!_honcho) {
    _honcho = new Honcho({
      apiKey: HONCHO_API_KEY,
      environment: 'production',
    });
  }
  return _honcho;
}

async function getAppId(): Promise<string> {
  if (_appId) return _appId;

  try {
    const honcho = getHoncho();
    const app = await honcho.apps.getByName(HONCHO_WORKSPACE);
    _appId = app.id;
    return _appId;
  } catch (err) {
    try {
      const honcho = getHoncho();
      const app = await honcho.apps.create({ name: HONCHO_WORKSPACE });
      _appId = app.id;
      return _appId;
    } catch (createErr) {
      console.error('[honcho] Failed to get or create app:', createErr);
      throw createErr;
    }
  }
}

function isHonchoEnabled(): boolean {
  return HONCHO_GROUPS.has(groupFolder) && !!HONCHO_API_KEY;
}

async function getOrCreateSession(userId: string) {
  const honcho = getHoncho();
  const appId = await getAppId();

  // Get or create the user
  const user = await honcho.apps.users.getOrCreate(appId, userId);

  // Try to get or create a session for this group
  let session;
  try {
    session = await honcho.apps.users.sessions.get(appId, user.id, {
      session_id: groupFolder,
    });
  } catch {
    // Session doesn't exist, create it
    session = await honcho.apps.users.sessions.create(appId, user.id, {
      metadata: { group: groupFolder },
    });
  }

  return { user, session, appId };
}

// Debug logging
console.error(`[MCP] Initialized with chatJid=${chatJid}, groupFolder=${groupFolder}, isMain=${isMain}`);
console.error(`[MCP] Honcho enabled: ${isHonchoEnabled()}`);
console.error(`[MCP] Starting tool registration...`);

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

console.error(`[MCP] Creating McpServer...`);
const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});
console.error(`[MCP] McpServer created, registering tools...`);

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times. Note: when running as a scheduled task, your final output is NOT sent to the user — use this tool if you need to communicate with the user or group.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (/[Zz]$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text' as const, text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const data = {
      type: 'schedule_task',
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    const filename = writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task scheduled (${filename}): ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'register_group',
  `Register a new WhatsApp group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name should be lowercase with hyphens (e.g., "family-chat").`,
  {
    jid: z.string().describe('The WhatsApp JID (e.g., "120363336345536173@g.us")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Folder name for group files (lowercase, hyphens, e.g., "family-chat")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);

try {
  server.tool(
    'honcho_recall',
    'Ask Honcho a question about this user.',
    { question: z.string() },
    async (args) => {
      if (!isHonchoEnabled()) {
        return { content: [{ type: 'text' as const, text: 'Honcho is not enabled for this group.' }] };
      }

      try {
        const { user, session, appId } = await getOrCreateSession(userId);
        const response = await getHoncho().apps.users.sessions.chat(
          appId,
          user.id,
          session.id,
          { queries: args.question },
        );

        return { content: [{ type: 'text' as const, text: response.content || 'No information found.' }] };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[honcho_recall] Full error:', JSON.stringify({ message: errMsg, name: err instanceof Error ? err.name : 'unknown' }, null, 2));
        return { content: [{ type: 'text' as const, text: `Honcho query failed: ${errMsg}` }], isError: true };
      }
    },
  );
} catch (e) {
  console.error('[MCP] Error registering honcho_recall:', e);
}

try {
  server.tool(
    'honcho_search',
    'Search Honcho observations about this user.',
    { query: z.string() },
    async (args) => {
      if (!isHonchoEnabled()) {
        return { content: [{ type: 'text' as const, text: 'Honcho is not enabled for this group.' }] };
      }

      try {
        const { user, session, appId } = await getOrCreateSession(userId);
        // Use chat with a search-framed query
        const response = await getHoncho().apps.users.sessions.chat(
          appId,
          user.id,
          session.id,
          { queries: `Search for: ${args.query}` },
        );

        return { content: [{ type: 'text' as const, text: response.content || 'No results found.' }] };
      } catch (err) {
        console.error('[honcho_search] Error:', err);
        return { content: [{ type: 'text' as const, text: `Search failed: ${err instanceof Error ? err.message : 'Unknown error'}` }], isError: true };
      }
    },
  );
} catch (e) {
  console.error('[MCP] Error registering honcho_search:', e);
}

try {
  server.tool(
    'honcho_context',
    'Get Honcho context about this user.',
    {},
    async () => {
      if (!isHonchoEnabled()) {
        return { content: [{ type: 'text' as const, text: 'Honcho is not enabled for this group.' }] };
      }

      try {
        const { user, session, appId } = await getOrCreateSession(userId);
        const messages = await getHoncho().apps.users.sessions.messages.list(
          appId,
          user.id,
          session.id,
          { size: 20, reverse: true },
        );

        const lines: string[] = [];
        if (messages.items && messages.items.length > 0) {
          lines.push('## Recent conversation context from Honcho');
          // Reverse to get chronological order
          for (const msg of messages.items.reverse()) {
            const role = msg.is_user ? 'User' : 'Assistant';
            lines.push(`${role}: ${msg.content}`);
          }
        }

        const text = lines.length > 0 ? lines.join('\n') : 'No context available.';
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        console.error('[honcho_context] Error:', err);
        return { content: [{ type: 'text' as const, text: `Failed to get context: ${err instanceof Error ? err.message : 'Unknown error'}` }], isError: true };
      }
    },
  );
} catch (e) {
  console.error('[MCP] Error registering honcho_context:', e);
}

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
