import { Honcho, type Peer } from '@honcho-ai/sdk';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AGENT_PEER_ID = process.env.HONCHO_AGENT_PEER ?? 'nanoclaw-agent';

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
      environment: 'production', // Use Honcho Cloud (https://api.honcho.dev)
      // Override with custom base URL if provided (for self-hosted instances)
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
    console.log(`[honcho] getHonchoContext: Creating/getting peer userId=${userId}...`);

    // Get or create the peer (user)
    const peer = await honcho.peer(userId);
    console.log(`[honcho] getHonchoContext: Got peer=${userId}`);

    // Session ID is based on group folder for consistency
    const sessionId = `${groupFolder}`;
    console.log(`[honcho] getHonchoContext: Getting/creating session=${sessionId}...`);

    // Get or create a session for this group
    const session = await honcho.session(sessionId, {
      metadata: { group: groupFolder },
    });
    console.log(`[honcho] getHonchoContext: Got session=${sessionId}`);

    // Fetch recent messages from this session
    const messagesPage = await session.messages();
    const messages = messagesPage.items || [];
    console.log(`[honcho] getHonchoContext: Found ${messages.length} messages`);

    const lines: string[] = [];

    if (messages && messages.length > 0) {
      lines.push('## Recent conversation history (Honcho)');
      // Show recent messages (last messageLimit items)
      const recentMessages = messages.slice(Math.max(0, messages.length - messageLimit));
      for (const msg of recentMessages) {
        const role = msg.peerId === userId ? 'User' : 'Assistant';
        lines.push(`${role}: ${msg.content}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '';
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : '';
    console.warn(`[honcho] getHonchoContext failed (non-fatal): ${errMsg}`);
    if (errStack) console.warn(errStack);
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
    console.log(`[honcho] observeExchange: Creating/getting peer userId=${userId}...`);

    // Get or create the peer (user)
    const userPeer = await honcho.peer(userId);
    console.log(`[honcho] observeExchange: Got user peer=${userId}`);

    // Get or create the agent peer
    const agentPeer = await honcho.peer(AGENT_PEER_ID);
    console.log(`[honcho] observeExchange: Got agent peer=${AGENT_PEER_ID}`);

    // Session ID is based on group folder for consistency
    const sessionId = `${groupFolder}`;
    console.log(`[honcho] observeExchange: Getting/creating session=${sessionId}...`);

    // Get or create a session for this group
    const session = await honcho.session(sessionId, {
      metadata: { group: groupFolder },
    });
    console.log(`[honcho] observeExchange: Got session=${sessionId}`);

    // Add both peers to the session
    console.log(`[honcho] observeExchange: Adding peers to session...`);
    await session.addPeers([userPeer, agentPeer]);

    // Add messages using the peer.message() helper
    console.log(`[honcho] observeExchange: Adding messages...`);
    await session.addMessages([userPeer.message(userMessage), agentPeer.message(agentResponse)]);

    console.log(`[honcho] observeExchange: Messages added successfully`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : '';
    console.warn(`[honcho] observeExchange failed (non-fatal): ${errMsg}`);
    if (errStack) console.warn(errStack);
  }
}

// ---------------------------------------------------------------------------
// Active recall — used by honcho_recall / honcho_search tools
// ---------------------------------------------------------------------------

/**
 * Ask Honcho a natural-language question about a user.
 *
 * Uses peer.chat() which triggers Honcho's dialectic reasoning — it searches
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
    console.log(`[honcho] queryHoncho: Creating/getting peer userId=${userId}...`);

    // Get or create the peer (user)
    const peer = await honcho.peer(userId);
    console.log(`[honcho] queryHoncho: Got peer=${userId}`);

    // Get or create the session for this group
    const sessionId = `${groupFolder}`;
    const session = await honcho.session(sessionId, {
      metadata: { group: groupFolder },
    });

    // Use dialectic reasoning to answer the question in the context of this session
    console.log(`[honcho] queryHoncho: Querying peer with question...`);
    const response = await peer.chat(question, { session });
    console.log(`[honcho] queryHoncho: Got response`);

    return response || 'No response from Honcho.';
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : '';
    console.warn(`[honcho] queryHoncho failed: ${errMsg}`);
    if (errStack) console.warn(errStack);
    return 'Honcho query failed.';
  }
}

// ---------------------------------------------------------------------------
// Swarm agent peer registration
// ---------------------------------------------------------------------------

/**
 * Register a swarm agent as a named peer in Honcho.
 *
 * Call at startup for each agent in HONCHO_SWARM_PEERS. Creates a dedicated
 * peer record for the agent so its activity can be tracked separately.
 */
export async function registerAgentPeer(peerId: string): Promise<void> {
  try {
    const honcho = getHoncho();
    console.log(`[honcho] Registering swarm agent: ${peerId}...`);

    // Create or get the swarm agent peer
    await honcho.peer(peerId);

    console.log(`[honcho] Registered swarm agent: ${peerId}`);
  } catch (err) {
    console.warn(`[honcho] registerAgentPeer(${peerId}) failed (non-fatal):`, err);
  }
}
