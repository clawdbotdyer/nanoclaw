#!/usr/bin/env node

/**
 * Setup script to create the SigmaBoy 5-minute orchestrator scheduler task
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'store', 'messages.db');

const db = new Database(dbPath);

// Create the scheduled task
const taskId = `SigmaBoy-5min-Cycle-${Date.now()}`;
const now = new Date().toISOString();
const groupFolder = 'sigmaboy-orchestrator';
const chatJid = 'sigmaboy-orchestrator@internal';

const sql = `
  INSERT INTO scheduled_tasks
  (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

try {
  db.prepare(sql).run(
    taskId,
    groupFolder,
    chatJid,
    'Execute trading cycle: Spawn Signal Agent → Risk Agent → Execution Agent (if approved)',
    'interval',
    '5m',
    'isolated',
    now,
    'active',
    now
  );

  console.log('✅ Scheduler created successfully');
  console.log(`   Task ID: ${taskId}`);
  console.log(`   Group: ${groupFolder}`);
  console.log(`   Schedule: Every 5 minutes`);
  console.log(`   Status: active`);
  console.log(`   Next run: ${now}`);
} catch (err) {
  console.error('❌ Error creating scheduler:', err.message);
  process.exit(1);
} finally {
  db.close();
}
