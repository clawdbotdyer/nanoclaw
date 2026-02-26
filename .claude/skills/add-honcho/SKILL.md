# Add Honcho Memory to NanoClaw

## What This Skill Does

Integrates [Honcho](https://honcho.dev) into NanoClaw as a cross-session, cross-agent identity fabric. After this skill runs:

- The agent remembers users across sessions, channels, and restarts
- Honcho builds a reasoning-based model of each user over time — not just facts, but preferences, patterns, and communication style — powered by Neuromancer, a model fine-tuned specifically for this task
- **Only groups you explicitly allowlist are observed** — sensitive groups (work, client, confidential) never touch Honcho
- Each workspace is a hard isolation boundary — you can run separate workspaces for separate contexts (personal, trading, etc.) with no data crossing between them
- The agent gains three active tools: `honcho_recall`, `honcho_search`, and `honcho_context`
- Existing `CLAUDE.md` files are preserved as static behavioural instructions; Honcho carries dynamic identity on top
- Agent swarms get proper peer-peer architecture — each agent builds its own model, with configurable observation of other peers

**Why this is more than session memory:** CLAUDE.md is a static file. Honcho's reasoning model processes every observed message asynchronously, extracts conclusions, and over time builds a representation of the user that no static file could maintain. Honcho also *dreams* — ambient background reasoning runs between sessions, filling gaps and refining its model without any runtime cost. The result is an agent that genuinely knows you, not one that re-reads notes.

---

## Prerequisites

1. A Honcho API key from [app.honcho.dev](https://app.honcho.dev) — sign up for free, you get $100 credits. Or [self-host locally](https://github.com/plastic-labs/honcho?tab=readme-ov-file#local-development) (runs in Docker, no data leaves your machine).
2. NanoClaw running and set up (i.e., `/setup` has already been completed).

---

## Step 1 — Gather Information

Ask the user the following before making any changes:

1. **API key or self-hosted?**
   - Cloud: ask for the key (format: `hc_...`)
   - Self-hosted: confirm Docker is running; `HONCHO_BASE_URL` will be `http://localhost:8000`

2. **Workspace name** — this is the top-level isolation namespace. Use one workspace per context you want kept separate. Examples:
   - `personal` — general assistant use
   - `sigmagrid` — trading and agent work only
   - `nanoclaw` — default if user has no preference

   > **Important:** Groups you do NOT want Honcho to observe (work, client, confidential) should simply not be added to the allowlist. They will never be observed regardless of which workspace is configured.

3. **Which groups should Honcho observe?** — Ask the user to list the NanoClaw group folder names (found in `groups/`) that should feed into Honcho. All other groups are silently skipped.

4. **Peer IDs for swarm agents** — If the user runs agent swarms, ask what names they want for each agent peer. These should be consistent across all integrations so Honcho can correlate their activity. Examples: `sigmaBoy`, `meta-reviewer`, `research-agent`.

---

## Step 2 — Install the SDK

Run in the NanoClaw project root:

```bash
npm install honcho-ai
```

> Use `honcho-ai` (the high-level ergonomic SDK), not `@honcho-ai/core` (the low-level generated client). The ergonomic SDK provides the `.chat()`, `.context()`, and `session.add_messages()` interfaces used in this integration.

---

## Step 3 — Add Environment Variables

Append to the project's `.env` file:

```bash
# Honcho API key (cloud) or 'localdev' (self-hosted)
HONCHO_API_KEY=hc_your_key_here

# Self-hosted only — remove or leave blank for cloud
# HONCHO_BASE_URL=http://localhost:8000

# Workspace name — hard isolation boundary, one per context
HONCHO_WORKSPACE=nanoclaw

# Comma-separated list of group folder names to observe.
# Groups NOT in this list are never sent to Honcho.
# Example: HONCHO_GROUPS=sigmagrid,personal-chat
HONCHO_GROUPS=

# Peer ID for the NanoClaw agent itself (default is fine for most users)
HONCHO_AGENT_PEER=nanoclaw-agent

# Comma-separated peer IDs for swarm agents (optional)
# Example: HONCHO_SWARM_PEERS=sigmaBoy,meta-reviewer
HONCHO_SWARM_PEERS=
```

**Compartmentalisation is enforced at `HONCHO_GROUPS`.** If a group folder is not listed, it is never sent to Honcho under any circumstances.

---

## Step 4 — Create `src/honcho-memory.ts`

Create a new file `src/honcho-memory.ts`. This module contains all Honcho logic so nothing else in the codebase needs structural changes.

```typescript
import Honcho from 'honcho-ai';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WORKSPACE = process.env.HONCHO_WORKSPACE ?? 'nanoclaw';
const AGENT_PEER = process.env.HONCHO_AGENT_PEER ?? 'nanoclaw-agent';

// Groups allowed to interact with Honcho — opt-in, empty means nothing observed
const ALLOWED_GROUPS = new Set(
  (process.env.HONCHO_GROUPS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// Client (lazy singleton)
// ---------------------------------------------------------------------------

let _honcho: Honcho | null = null;

function getHoncho(): Honcho {
  if (!_honcho) {
    _honcho = new Honcho({
      apiKey: process.env.HONCHO_API_KEY,
      ...(process.env.HONCHO_BASE_URL ? { baseURL: process.env.HONCHO_BASE_URL } : {}),
    });
  }
  return _honcho;
}

// ---------------------------------------------------------------------------
// Allowlist check — call before every Honcho operation
// ---------------------------------------------------------------------------

/**
 * Returns true if this group is allowed to interact with Honcho.
 * Groups not in HONCHO_GROUPS are never observed or queried.
 */
export function isHonchoEnabled(groupFolder: string): boolean {
  return ALLOWED_GROUPS.has(groupFolder);
}

// ---------------------------------------------------------------------------
// Context injection
// ---------------------------------------------------------------------------

/**
 * Fetch context for a user in a given group, to be injected into the agent's
 * prompt before the Claude session starts.
 *
 * Uses two Honcho endpoints:
 *   peer.get_context()  → peer card: key conclusions about the user
 *   session.context()   → recent history + summaries within token budget
 *
 * Returns a formatted string or '' on any failure.
 * Honcho is enhancement-only — it never blocks the agent.
 */
export async function getHonchoContext(
  userId: string,
  groupFolder: string,
  tokenBudget = 2000,
): Promise<string> {
  if (!isHonchoEnabled(groupFolder)) return '';

  try {
    const honcho = getHoncho();
    const sessionId = `nanoclaw-${groupFolder}`;

    const user = honcho.peer(userId, { workspaceId: WORKSPACE });
    const session = honcho.session(sessionId, { workspaceId: WORKSPACE });

    const userCtx = await user.get_context();
    const sessionCtx = await session.context({ maxTokens: tokenBudget });

    const lines: string[] = [];

    if (userCtx.peer_card?.length > 0) {
      lines.push('## Honcho: Who this user is');
      lines.push(userCtx.peer_card.join('\n'));
    }

    if (sessionCtx?.messages?.length > 0) {
      lines.push('\n## Honcho: Recent conversation context');
      for (const msg of sessionCtx.messages) {
        const role = msg.is_human ? 'User' : 'Assistant';
        lines.push(`${role}: ${msg.content}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '';
  } catch (err) {
    console.warn('[honcho] getHonchoContext failed (non-fatal):', err);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/**
 * Persist a user message and agent response to Honcho after the Claude
 * session completes. Fire-and-forget — never await in the hot path.
 *
 * Honcho's Neuromancer model processes these asynchronously and updates
 * its representation of each peer in the background. Dreaming then runs
 * between sessions to fill gaps and refine conclusions.
 */
export async function observeExchange(
  userId: string,
  groupFolder: string,
  userMessage: string,
  agentResponse: string,
): Promise<void> {
  if (!isHonchoEnabled(groupFolder)) return;

  try {
    const honcho = getHoncho();
    const sessionId = `nanoclaw-${groupFolder}`;

    const user = honcho.peer(userId, { workspaceId: WORKSPACE });
    const agent = honcho.peer(AGENT_PEER, { workspaceId: WORKSPACE });
    const session = honcho.session(sessionId, { workspaceId: WORKSPACE });

    await session.add_messages([
      user.message(userMessage),
      agent.message(agentResponse),
    ]);
  } catch (err) {
    console.warn('[honcho] observeExchange failed (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// Active recall — used by honcho_recall / honcho_search tools
// ---------------------------------------------------------------------------

/**
 * Ask Honcho a natural-language question about a user.
 *
 * Uses peer.chat() which triggers Honcho's dialectic reasoning — it searches
 * across all stored conclusions, message history, and derived representations.
 * More powerful than a simple RAG lookup.
 */
export async function queryHoncho(
  userId: string,
  groupFolder: string,
  question: string,
): Promise<string> {
  if (!isHonchoEnabled(groupFolder)) {
    return 'Honcho is not enabled for this group.';
  }

  try {
    const honcho = getHoncho();
    const user = honcho.peer(userId, { workspaceId: WORKSPACE });
    const response = await user.chat(question);
    return typeof response === 'string' ? response : JSON.stringify(response);
  } catch (err) {
    console.warn('[honcho] queryHoncho failed:', err);
    return 'Honcho query failed.';
  }
}

// ---------------------------------------------------------------------------
// Swarm agent peer registration
// ---------------------------------------------------------------------------

/**
 * Register a swarm agent as a named peer in Honcho.
 *
 * Call at startup for each agent in HONCHO_SWARM_PEERS. Each swarm agent
 * builds its own model in Honcho — separate from the main assistant peer —
 * and peer-peer observation can be configured via the Honcho dashboard.
 */
export async function registerAgentPeer(peerId: string): Promise<void> {
  try {
    const honcho = getHoncho();
    honcho.peer(peerId, {
      workspaceId: WORKSPACE,
      config: { role: 'agent', registeredBy: AGENT_PEER },
    });
  } catch (err) {
    console.warn(`[honcho] registerAgentPeer(${peerId}) failed (non-fatal):`, err);
  }
}
```

---

## Step 5 — Modify `src/index.ts`

Read `src/index.ts` carefully before making changes. Three targeted additions only.

### 5a — Import

```typescript
import { getHonchoContext, observeExchange, isHonchoEnabled, registerAgentPeer } from './honcho-memory.js';
```

### 5b — Register swarm peers at startup

In the main initialisation block, after state is loaded:

```typescript
// Register any configured swarm agent peers with Honcho
const swarmPeers = (process.env.HONCHO_SWARM_PEERS ?? '').split(',').filter(Boolean);
for (const peerId of swarmPeers) {
  await registerAgentPeer(peerId);
}
```

### 5c — Inject context before agent invocation

Find where `runAgent` / `runContainerAgent` is called with the prompt. Before the call:

```typescript
const userId = senderJid.split('@')[0];

// Returns '' immediately if group not allowlisted or Honcho unreachable
const honchoContext = await getHonchoContext(userId, group.folder);

const augmentedPrompt = honchoContext
  ? `${prompt}\n\n---\n${honchoContext}`
  : prompt;

// Pass augmentedPrompt instead of prompt
```

> Do not write Honcho context into `CLAUDE.md` on disk. CLAUDE.md is static behavioural instruction. Honcho context is ephemeral per-session — inject into the runtime prompt only.

### 5d — Observe after agent responds

After the container finishes and you have the agent's output:

```typescript
// Fire and forget
if (isHonchoEnabled(group.folder)) {
  observeExchange(userId, group.folder, userMessage, agentOutput).catch(() => {});
}
```

---

## Step 6 — Add Honcho Guidance to Allowlisted Groups' CLAUDE.md

For each group in `HONCHO_GROUPS`, add this section to the group's `CLAUDE.md`. Groups not in the allowlist don't need it.

```markdown
## Memory (Honcho)

You have access to Honcho, a persistent memory and reasoning system that has
built up a model of this user across all past sessions.

Use these tools when past context would improve your response:

- `honcho_recall` — ask a natural language question about this user
  ("What do I know about their preferences?", "Have they mentioned X before?")
- `honcho_search` — semantic search over stored observations
- `honcho_context` — get the user's full peer card and recent session history

Use proactively when making recommendations, continuing a topic from a previous
session, or when the user references something you should remember. Do NOT call
on every message — only when relevant.

Honcho reasons across all past sessions, not just this one. Its conclusions
reflect patterns built up over months of interaction.
```

---

## Step 7 — Wire up Honcho Tools via IPC MCP (Optional but Recommended)

Add to `container/agent-runner/ipc-mcp.ts` to give the agent real tool access mid-conversation:

```typescript
{
  name: 'honcho_recall',
  description: 'Ask Honcho a question about this user using dialectic reasoning across all past sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Natural language question about the user' }
    },
    required: ['question']
  }
},
{
  name: 'honcho_search',
  description: 'Semantic search over stored Honcho observations about this user.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      top_k: { type: 'number', default: 5 }
    },
    required: ['query']
  }
},
{
  name: 'honcho_context',
  description: "Get this user's full Honcho peer card and recent session context.",
  inputSchema: { type: 'object', properties: {} }
}
```

Route these calls back to the host via IPC (same pattern as other tools in `ipc-mcp.ts`), calling `queryHoncho()` from `honcho-memory.ts`.

If the IPC wiring is complex, skip this step — the passive observe/inject model from Step 5 already provides persistent memory. These tools add active mid-conversation recall.

---

## Step 8 — Test

```bash
npm run dev

# From an allowlisted group:
# "My name is [name] and I'm working on [project]"
# Later session: "What do you know about me?"
# → Agent should recall without being told.

# From a non-allowlisted group:
# "My name is [name]"
# Later session: "What do you know about me?"
# → Agent should NOT recall. Honcho never saw it.
```

Quick smoke test:

```bash
node -e "
import('honcho-ai').then(({ default: Honcho }) => {
  const h = new Honcho({ apiKey: process.env.HONCHO_API_KEY });
  h.peer('test-user', { workspaceId: process.env.HONCHO_WORKSPACE })
    .chat('What do you know about this user?')
    .then(r => console.log('Honcho OK:', r))
    .catch(e => console.error('Honcho error:', e));
});
"
```

---

## Step 9 — Migrate Existing CLAUDE.md Memory (Optional)

If an allowlisted group's `CLAUDE.md` contains user-specific knowledge, upload it to Honcho:

```typescript
import { readFileSync } from 'fs';
import Honcho from 'honcho-ai';

const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY });
const content = readFileSync('groups/my-group/CLAUDE.md', 'utf8');

const user = honcho.peer('your-user-id', { workspaceId: process.env.HONCHO_WORKSPACE });
const session = honcho.session('migration', { workspaceId: process.env.HONCHO_WORKSPACE });

await session.add_messages([
  user.message(`Historical context about this user:\n${content}`)
]);
```

After migration, trim `CLAUDE.md` to static behavioural content only. Let Honcho carry user-specific knowledge.

---

## Architecture After This Skill

```
WhatsApp msg
      │
      ├─ group in HONCHO_GROUPS?
      │       │
      │      NO → skip Honcho entirely
      │             (client work, confidential groups — never observed)
      │       │
      │      YES
      │       │
      │  getHonchoContext() ←──── Honcho workspace
      │       │                    peer card + session context
      │       │                    (conclusions from months of interaction)
      │       │
      │  Augmented prompt
      │       │
      │  Container (Claude Agent SDK)
      │       reads CLAUDE.md      (static — how to behave)
      │       + Honcho context     (dynamic — who this user is)
      │       + Obsidian vault     (if mounted — what you know)
      │       │
      │  Agent response
      │       │
      │  observeExchange() ───────→ Honcho (fire-and-forget)
      │                              Neuromancer reasons over exchange
      │                              Dreaming runs between sessions
      │
      └─ Router → WhatsApp
```

**Workspace compartmentalisation:**

```
Workspace: sigmagrid
├── you        (human peer — SigmaGrid context only)
├── nanoclaw-agent
├── sigmaBoy
└── meta-reviewer

Workspace: personal (optional separate context)
├── you        (separate peer ID from sigmagrid workspace)
└── nanoclaw-agent

(no workspace for client/work — those groups never observed)
```

**Peer-peer observation:** Configure which peers can make conclusions about which others via [app.honcho.dev](https://app.honcho.dev) or the Honcho API. For example: `sigmaBoy` observes your messages to build trading context; `meta-reviewer` only sees agent performance data, not raw conversation.

---

## Self-Hosted Honcho

To keep all data local:

```bash
git clone https://github.com/plastic-labs/honcho
cd honcho
docker compose up -d
```

```bash
# .env
HONCHO_API_KEY=localdev
HONCHO_BASE_URL=http://localhost:8000
# If NanoClaw runs in Docker: HONCHO_BASE_URL=http://host.docker.internal:8000
```

See the [Honcho self-hosting guide](https://github.com/plastic-labs/honcho?tab=readme-ov-file#local-development) for full setup.

---

## Troubleshooting

**Agent isn't remembering things across sessions:**
- Add `console.log('[honcho] observing:', groupFolder)` inside `observeExchange` and confirm it fires.
- Check that the group folder name in `HONCHO_GROUPS` exactly matches the name in `groups/` (case-sensitive).
- Honcho processes asynchronously — wait 10–15 seconds after a session before querying.

**Worried a non-allowlisted group is leaking to Honcho:**
- `isHonchoEnabled()` is called at the top of both `getHonchoContext` and `observeExchange`. Neither function proceeds if the group is not listed.
- Verify `HONCHO_GROUPS` in `.env` is an exact comma-separated list with no wildcards or spaces.

**`Cannot find module 'honcho-ai'`:**
- Run `npm install honcho-ai` in the project root. The SDK is used by the host process only, not inside containers.

**Honcho slowing down responses:**
- `getHonchoContext` should return in ~200ms. Reduce `tokenBudget` to 500 if needed.
- If Honcho is unreachable it returns `''` immediately and the agent continues normally.

**Self-hosted Honcho not reachable:**
- `curl http://localhost:8000/health` should return 200.
- If NanoClaw runs in Docker use `host.docker.internal:8000`.
