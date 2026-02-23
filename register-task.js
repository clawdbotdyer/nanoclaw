import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const homeDir = os.homedir();
const dbPath = path.join(homeDir, '.local/share/nanoclaw/messages.db');

try {
  const db = new Database(dbPath);
  
  // Create the scheduled_tasks table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);
  `);

  // Add context_mode column if it doesn't exist
  try {
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`);
  } catch {
    // Column already exists
  }

  // Check if task already exists
  const existing = db.prepare('SELECT id FROM scheduled_tasks WHERE id = ?').get('sigmaboy-orchestrator-5min');
  
  if (existing) {
    console.log('\n⚠ Task already exists. Updating...\n');
    const update = db.prepare(`
      UPDATE scheduled_tasks 
      SET status = ?, next_run = datetime('now')
      WHERE id = ?
    `);
    update.run('active', 'sigmaboy-orchestrator-5min');
  } else {
    // Insert new task
    const stmt = db.prepare(`
      INSERT INTO scheduled_tasks (
        id, group_folder, chat_jid, prompt, schedule_type,
        schedule_value, context_mode, next_run, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    
    stmt.run(
      'sigmaboy-orchestrator-5min',
      'groups/sigmaboy-orchestrator',
      'nanoclaw-scheduler',
      'Execute the SigmaBoy 5-minute trading cycle orchestration pipeline. Check decision-log.json for in-progress cycles. Generate cycle_id (SB-YYYYMMDD-HHMMSS-UTC) and sequence: Signal fetch → Risk evaluation → (if approved) Execution. Log all outcomes.',
      'interval',
      '5m',
      'group',
      now,
      'active',
      now
    );
    
    console.log('\n✓ Scheduled task registered successfully!\n');
  }

  // Verify
  const verify = db.prepare(`
    SELECT 
      id,
      group_folder,
      schedule_type,
      schedule_value,
      context_mode,
      status,
      next_run,
      created_at
    FROM scheduled_tasks
    WHERE group_folder LIKE '%sigmaboy%'
  `).all();

  console.log('Task details:');
  verify.forEach(row => {
    console.log(`  ID:            ${row.id}`);
    console.log(`  Group:         ${row.group_folder}`);
    console.log(`  Schedule:      ${row.schedule_type} (${row.schedule_value})`);
    console.log(`  Context:       ${row.context_mode}`);
    console.log(`  Status:        ${row.status}`);
    console.log(`  Next run:      ${row.next_run}`);
    console.log(`  Created:       ${row.created_at}`);
  });
  
  console.log('\n✓ Task is active and ready to execute\n');
  
  db.close();
  process.exit(0);
} catch (err) {
  console.error('\n❌ Error registering task:', err.message);
  console.error('\nStack:', err.stack);
  process.exit(1);
}
