#!/usr/bin/env node

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'store', 'messages.db');

const db = new Database(dbPath);

console.log('=== Checking for DUE tasks ===\n');

const now = new Date().toISOString();
console.log(`Current time: ${now}`);
console.log(`ISO format check: ${new Date(now).toISOString()}\n`);

// Query tasks that should be due (next_run <= now AND status = 'active')
const dueTasks = db.prepare(`
  SELECT id, group_folder, schedule_type, schedule_value, next_run, status
  FROM scheduled_tasks
  WHERE status = 'active'
  ORDER BY next_run ASC
`).all();

console.log(`Total active tasks: ${dueTasks.length}\n`);

dueTasks.forEach(task => {
  const nextRun = new Date(task.next_run);
  const nowDate = new Date(now);
  const isDue = nextRun <= nowDate;
  const diffMs = nowDate.getTime() - nextRun.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  console.log(`Task: ${task.id}`);
  console.log(`  Group: ${task.group_folder}`);
  console.log(`  Next run: ${task.next_run}`);
  console.log(`  Due: ${isDue ? `✓ YES (${diffMins}m ago)` : `✗ no (in ${-diffMins}m)`}`);
  console.log();
});

// Also check if there are any task run logs
console.log('\n=== Last 5 task run logs ===\n');
const logs = db.prepare(`
  SELECT task_id, run_at, status, duration_ms
  FROM task_run_logs
  ORDER BY run_at DESC
  LIMIT 5
`).all();

logs.forEach(log => {
  console.log(`Task: ${log.task_id}`);
  console.log(`  Run at: ${log.run_at}`);
  console.log(`  Status: ${log.status}`);
  console.log(`  Duration: ${log.duration_ms}ms`);
});

db.close();
