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
// Client (lazy singleton) + App cache
// ---------------------------------------------------------------------------

let _honcho: Honcho | null = null;
let _appId: string | null = null;

function getHoncho(): Honcho {
  if (!_honcho) {
    _honcho = new Honcho({
      apiKey: process.env.HONCHO_API_KEY,
      ...(process.env.HONCHO_BASE_URL ? { baseURL: process.env.HONCHO_BASE_URL } : {}),
    });
  }
  return _honcho;
}

/**
 * Get or create the app for this workspace.
 * Apps are cached per workspace — this ensures all users/sessions
 * within a workspace share the same app context.
 */
async function getAppId(): Promise<string> {
  if (_appId) return _appId;

  try {
    const honcho = getHoncho();
    const app = await honcho.apps.getByName(WORKSPACE);
    _appId = app.id;
    return _appId;
  } catch (err) {
    // App doesn't exist, create it
    try {
      const honcho = getHoncho();
      const app = await honcho.apps.create({ name: WORKSPACE });
      _appId = app.id;
      return _appId;
    } catch (createErr) {
      console.error('[honcho] Failed to get or create app:', createErr);
      throw createErr;
    }
  }
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
 * Retrieves recent messages from the user's session within the group.
 *
 * Returns a formatted string or '' on any failure.
 * Honcho is enhancement-only — it never blocks the agent.
 */
export async function getHonchoContext(
  userId: string,
  groupFolder: string,
  messageLimit = 20,
): Promise<string> {
  if (!isHonchoEnabled(groupFolder)) return '';

  try {
    const honcho = getHoncho();
    const appId = await getAppId();
    const sessionId = `${groupFolder}`;

    // Get or create the user
    const user = await honcho.apps.users.getOrCreate(appId, userId);

    // Try to get or create a session for this group
    let session;
    try {
      session = await honcho.apps.users.sessions.get(appId, user.id, {
        session_id: sessionId,
      });
    } catch (err) {
      // Session doesn't exist, create it
      session = await honcho.apps.users.sessions.create(appId, user.id, {
        metadata: { group: groupFolder },
      });
    }

    // Fetch recent messages
    const messages = await honcho.apps.users.sessions.messages.list(
      appId,
      user.id,
      session.id,
      { size: messageLimit, reverse: true },
    );

    const lines: string[] = [];

    if (messages.items && messages.items.length > 0) {
      lines.push('## Recent conversation history (Honcho)');
      // Reverse to get chronological order
      for (const msg of messages.items.reverse()) {
        const role = msg.is_user ? 'User' : 'Assistant';
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
 * Messages are stored in the session for this group, allowing future
 * context injection to include conversation history.
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
    const appId = await getAppId();
    const sessionId = `${groupFolder}`;

    // Get or create the user
    const user = await honcho.apps.users.getOrCreate(appId, userId);

    // Try to get or create a session for this group
    let session;
    try {
      session = await honcho.apps.users.sessions.get(appId, user.id, {
        session_id: sessionId,
      });
    } catch (err) {
      // Session doesn't exist, create it
      session = await honcho.apps.users.sessions.create(appId, user.id, {
        metadata: { group: groupFolder },
      });
    }

    // Add both messages to the session in order
    await honcho.apps.users.sessions.messages.batch(appId, user.id, session.id, {
      messages: [
        {
          content: userMessage,
          is_user: true,
        },
        {
          content: agentResponse,
          is_user: false,
        },
      ],
    });
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
 * Uses session.chat() which triggers Honcho's dialectic reasoning — it searches
 * across session message history and derives context.
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
    const appId = await getAppId();
    const sessionId = `${groupFolder}`;

    // Get or create the user
    const user = await honcho.apps.users.getOrCreate(appId, userId);

    // Try to get or create a session for this group
    let session;
    try {
      session = await honcho.apps.users.sessions.get(appId, user.id, {
        session_id: sessionId,
      });
    } catch (err) {
      // Session doesn't exist, create it
      session = await honcho.apps.users.sessions.create(appId, user.id, {
        metadata: { group: groupFolder },
      });
    }

    // Use dialectic reasoning to answer the question
    const response = await honcho.apps.users.sessions.chat(
      appId,
      user.id,
      session.id,
      { queries: question },
    );

    return response.content || 'No response from Honcho.';
  } catch (err) {
    console.warn('[honcho] queryHoncho failed:', err);
    return 'Honcho query failed.';
  }
}

// ---------------------------------------------------------------------------
// Swarm agent peer registration
// ---------------------------------------------------------------------------

/**
 * Register a swarm agent as a named user in Honcho.
 *
 * Call at startup for each agent in HONCHO_SWARM_PEERS. Creates a dedicated
 * user record for the agent so its activity can be tracked separately.
 */
export async function registerAgentPeer(peerId: string): Promise<void> {
  try {
    const honcho = getHoncho();
    const appId = await getAppId();

    // Create or get the swarm agent user
    await honcho.apps.users.getOrCreate(appId, peerId);

    console.log(`[honcho] Registered swarm agent: ${peerId}`);
  } catch (err) {
    console.warn(`[honcho] registerAgentPeer(${peerId}) failed (non-fatal):`, err);
  }
}
