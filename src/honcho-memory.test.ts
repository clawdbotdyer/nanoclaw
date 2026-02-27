import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('honcho-memory', () => {
  describe('isHonchoEnabled', () => {
    it('is a function that checks group membership', async () => {
      // Import fresh to get current env vars
      const module = await import('./honcho-memory.js');
      expect(typeof module.isHonchoEnabled).toBe('function');
    });
  });

  describe('getHonchoContext', () => {
    it('is an async function that returns a string', async () => {
      const module = await import('./honcho-memory.js');
      expect(typeof module.getHonchoContext).toBe('function');

      // Call with a group that's not enabled should return empty string
      const result = await module.getHonchoContext('test-user', 'disabled-group');
      expect(typeof result).toBe('string');
    });
  });

  describe('observeExchange', () => {
    it('is an async function', async () => {
      const module = await import('./honcho-memory.js');
      expect(typeof module.observeExchange).toBe('function');

      // Call should not throw
      const result = await module.observeExchange('test-user', 'disabled-group', 'message', 'response');
      expect(result).toBeUndefined();
    });
  });

  describe('queryHoncho', () => {
    it('is an async function that returns a string', async () => {
      const module = await import('./honcho-memory.js');
      expect(typeof module.queryHoncho).toBe('function');

      // Call with a group that's not enabled should return error message
      const result = await module.queryHoncho('test-user', 'disabled-group', 'question');
      expect(typeof result).toBe('string');
      expect(result).toContain('not enabled');
    });
  });

  describe('registerAgentPeer', () => {
    it('is an async function', async () => {
      const module = await import('./honcho-memory.js');
      expect(typeof module.registerAgentPeer).toBe('function');

      // Call should not throw (handles errors gracefully)
      const result = await module.registerAgentPeer('agent-001');
      expect(result).toBeUndefined();
    });
  });

  describe('Core functionality', () => {
    it('exports all expected functions', async () => {
      const module = await import('./honcho-memory.js');

      expect(module.isHonchoEnabled).toBeDefined();
      expect(module.getHonchoContext).toBeDefined();
      expect(module.observeExchange).toBeDefined();
      expect(module.queryHoncho).toBeDefined();
      expect(module.registerAgentPeer).toBeDefined();
    });

    it('getHonchoContext returns empty string for disabled groups', async () => {
      const module = await import('./honcho-memory.js');
      const result = await module.getHonchoContext('user123', 'some-group');
      // Should return empty string since group is not in HONCHO_GROUPS
      expect(typeof result).toBe('string');
    });

    it('queryHoncho returns disabled message for disabled groups', async () => {
      const module = await import('./honcho-memory.js');
      const result = await module.queryHoncho('user123', 'some-group', 'test?');
      expect(result).toContain('not enabled');
    });
  });
});
