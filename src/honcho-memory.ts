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

    const user = (honcho as any).peer(userId, { workspaceId: WORKSPACE });
    const session = (honcho as any).session(sessionId, { workspaceId: WORKSPACE });

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

    const user = (honcho as any).peer(userId, { workspaceId: WORKSPACE });
    const agent = (honcho as any).peer(AGENT_PEER, { workspaceId: WORKSPACE });
    const session = (honcho as any).session(sessionId, { workspaceId: WORKSPACE });

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
    const user = (honcho as any).peer(userId, { workspaceId: WORKSPACE });
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
    (honcho as any).peer(peerId, {
      workspaceId: WORKSPACE,
      config: { role: 'agent', registeredBy: AGENT_PEER },
    });
  } catch (err) {
    console.warn(`[honcho] registerAgentPeer(${peerId}) failed (non-fatal):`, err);
  }
}
