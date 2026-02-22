// SigmaBoy Express API server
// Serves synthesised intelligence via x402-gated endpoints
// Port 8080 internally, Cloudflare Tunnel for external access

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8080;
const WORKSPACE = '/workspace/group';

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  const state = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'state.json'), 'utf8'));
  res.json({
    status: 'ok',
    tier: state.tier,
    killed: state.killed,
    timestamp: new Date().toISOString()
  });
});

// Paper trade performance (public)
app.get('/v1/performance', (req, res) => {
  try {
    const performance = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'performance.json'), 'utf8'));
    res.json(performance);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read performance data' });
  }
});

// TODO: Add x402-gated endpoints for:
// - /v1/spread-alerts
// - /v1/regime-alerts
// - /v1/funding-digest
// - /v1/polymarket-calibration

app.listen(PORT, () => {
  console.log(`SigmaBoy API listening on port ${PORT}`);
  console.log(`Started at ${new Date().toISOString()}`);
});
