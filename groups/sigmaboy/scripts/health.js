// SigmaBoy health check and process watchdog
// Checks: Express server alive, disk space, CPU load
// Run before every scheduled task

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const WORKSPACE = '/workspace/group';
const PID_FILE = path.join(WORKSPACE, 'scripts', 'serve.pid');

function checkDiskSpace() {
  const df = execSync("df /workspace | tail -1 | awk '{print $5}'").toString().trim();
  const usedPct = parseInt(df.replace('%', ''));
  const freePct = 100 - usedPct;

  if (freePct < 15) {
    console.error(`DISK CRITICAL: ${freePct}% free (threshold: 15%)`);
    return false;
  }

  console.log(`Disk: ${freePct}% free`);
  return true;
}

function checkCPU() {
  // Check load average (1 min)
  const loadavg = execSync("cat /proc/loadavg | awk '{print $1}'").toString().trim();
  const load = parseFloat(loadavg);

  // Pi 5 has 4 cores, so load > 3.2 = sustained >80% CPU
  if (load > 3.2) {
    console.error(`CPU HIGH: load average ${load} (threshold: 3.2 for 80% on 4 cores)`);
    return false;
  }

  console.log(`CPU load: ${load}`);
  return true;
}

function checkServerProcess() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('No PID file found, server not started yet');
    return true; // Not an error on first run
  }

  const pid = fs.readFileSync(PID_FILE, 'utf8').trim();

  try {
    process.kill(pid, 0); // Check if process exists
    console.log(`Server process ${pid} alive`);
    return true;
  } catch (err) {
    console.error(`Server process ${pid} dead, restarting...`);

    // Restart server
    const { spawn } = require('child_process');
    const server = spawn('node', [path.join(WORKSPACE, 'scripts', 'serve.js')], {
      detached: true,
      stdio: 'ignore'
    });

    server.unref();
    fs.writeFileSync(PID_FILE, server.pid.toString());
    console.log(`Server restarted with PID ${server.pid}`);
    return true;
  }
}

function main() {
  console.log(`Health check: ${new Date().toISOString()}`);

  const diskOk = checkDiskSpace();
  const cpuOk = checkCPU();
  const serverOk = checkServerProcess();

  if (!diskOk || !cpuOk) {
    // Force low_compute tier
    const statePath = path.join(WORKSPACE, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    if (state.tier === 'normal') {
      state.tier = 'low_compute';
      state.tier_reason = `System health: disk=${diskOk}, cpu=${cpuOk}`;
      state.last_updated = new Date().toISOString();
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      console.error('TIER DOWNGRADE: normal → low_compute due to system health');
    }
  }

  console.log('Health check complete\n');
}

main();
