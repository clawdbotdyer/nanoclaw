#!/usr/bin/env node

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'store', 'messages.db');

const db = new Database(dbPath);

console.log('=== Registered Groups ===\n');

const groups = db.prepare('SELECT jid, name, folder, trigger_pattern, requires_trigger FROM registered_groups ORDER BY added_at DESC').all();

if (groups.length === 0) {
  console.log('No registered groups found');
} else {
  groups.forEach(group => {
    console.log(`JID: ${group.jid}`);
    console.log(`  Name: ${group.name}`);
    console.log(`  Folder: ${group.folder}`);
    console.log(`  Trigger: ${group.trigger_pattern}`);
    console.log(`  Requires trigger: ${group.requires_trigger ? 'yes' : 'no'}`);
    console.log();
  });
}

db.close();
