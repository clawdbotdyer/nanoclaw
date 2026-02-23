#!/usr/bin/env node

/**
 * Manual orchestrator invocation test
 * Simulates what the scheduler would do when executing the SigmaBoy orchestrator task
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;
const groupFolder = path.join(projectRoot, 'groups', 'sigmaboy-orchestrator');

console.log('🧪 Testing orchestrator invocation...\n');
console.log(`Project root: ${projectRoot}`);
console.log(`Group folder: ${groupFolder}`);
console.log(`Exists: ${fs.existsSync(groupFolder)}`);

// Check for CLAUDE.md
const claudeMdPath = path.join(groupFolder, 'CLAUDE.md');
console.log(`CLAUDE.md exists: ${fs.existsSync(claudeMdPath)}`);

// Check for .env
const envPath = path.join(projectRoot, '.env');
console.log(`Environ available: ${fs.existsSync(envPath)}`);

if (!fs.existsSync(envPath)) {
  console.log('\n⚠️  .env file not found');
  process.exit(1);
}

// Read env vars
const envContent = fs.readFileSync(envPath, 'utf-8');
const hasSignalGrid = envContent.includes('SIGMAGRID_API_KEY');
console.log(`SIGMAGRID vars in .env: ${hasSignalGrid}`);

console.log('\n✅ Setup looks good for orchestrator container spawning');
console.log('\nTo test full orchestrator execution:');
console.log('1. Scheduler should spawn a Docker container for sigmaboy-orchestrator');
console.log('2. Mount the group folder and project root');
console.log('3. Pass environment variables');
console.log('4. Claude Code should load CLAUDE.md and execute the orchestration logic');
console.log('\nCurrent status: Scheduler task is DUE but not executing');
console.log('Next action: Check if scheduler loop is actually processing tasks');
