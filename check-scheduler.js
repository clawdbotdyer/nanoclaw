#!/usr/bin/env node

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'store', 'messages.db');

const db = new Database(dbPath);

console.log('=== Scheduled Tasks ===\n');

const tasks = db.prepare('SELECT id, group_folder, schedule_type, schedule_value, status, next_run FROM scheduled_tasks ORDER BY created_at DESC LIMIT 5').all();

if (tasks.length === 0) {
  console.log('No scheduled tasks found');
} else {
  tasks.forEach(task => {
    const nextRun = new Date(task.next_run);
    const now = new Date();
    const isDue = nextRun <= now;

    console.log(`ID: ${task.id}`);
    console.log(`  Group: ${task.group_folder}`);
    console.log(`  Schedule: ${task.schedule_value} (${task.schedule_type})`);
    console.log(`  Status: ${task.status}`);
    console.log(`  Next run: ${task.next_run}`);
    console.log(`  Due now: ${isDue ? '✓ YES' : '✗ no'}`);
    console.log();
  });
}

db.close();
