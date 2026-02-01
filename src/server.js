import express from 'express';
import httpProxy from 'http-proxy';
import { createServer } from 'http';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { create as createTar } from 'tar';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '18789', 10);
const INTERNAL_GATEWAY_PORT = parseInt(process.env.INTERNAL_GATEWAY_PORT || '18790', 10);
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw';
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || path.join(STATE_DIR, 'workspace');
const SETUP_PASSWORD = process.env.SETUP_PASSWORD;

if (!SETUP_PASSWORD) {
  console.error('ERROR: SETUP_PASSWORD environment variable is required');
  process.exit(1);
}

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

function resolveGatewayToken() {
  const envToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (envToken) return envToken;

  const tokenPath = path.join(STATE_DIR, 'gateway.token');
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing) return existing;
  } catch {}

  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenPath, generated, { mode: 0o600 });
  return generated;
}

const GATEWAY_TOKEN = resolveGatewayToken();

let gatewayProcess = null;
let gatewayReady = false;
let gatewayStarting = false;

function isConfigured() {
  const configPath = path.join(STATE_DIR, 'openclaw.json');
  if (!fs.existsSync(configPath)) return false;

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const providers = config.providers || {};
    return Object.keys(providers).some(key => {
      const provider = providers[key];
      return provider && (provider.apiKey || provider.apikey || provider.key);
    });
  } catch {
    return false;
  }
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    try {
      const result = execFileSync(cmd, args, {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, HOME: '/home/node' }
      });
      resolve(result.trim());
    } catch (err) {
      reject(err);
    }
  });
}

async function startGateway() {
  if (gatewayProcess || gatewayStarting) return;

  gatewayStarting = true;
  console.log('Starting OpenClaw gateway...');

  try {
    await runCmd('openclaw', ['config', 'set', 'gateway.auth.token', GATEWAY_TOKEN]);
    await runCmd('openclaw', ['config', 'set', 'gateway.auth.mode', 'token']);
  } catch (err) {
    console.warn('Could not sync gateway config:', err.message);
  }

  gatewayProcess = spawn('openclaw', [
    'gateway', 'run',
    '--bind', 'loopback',
    '--port', String(INTERNAL_GATEWAY_PORT),
    '--auth', 'token',
    '--token', GATEWAY_TOKEN
  ], {
    env: {
      ...process.env,
      HOME: '/home/node',
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  gatewayProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log('[gateway]', output.trim());
    if (output.includes('Gateway listening') || output.includes('listening on')) {
      gatewayReady = true;
    }
  });

  gatewayProcess.stderr.on('data', (data) => {
    console.error('[gateway:err]', data.toString().trim());
  });

  gatewayProcess.on('exit', (code, signal) => {
    console.log(`Gateway exited with code ${code}, signal ${signal}`);
    gatewayProcess = null;
    gatewayReady = false;
    gatewayStarting = false;

    if (isConfigured() && signal !== 'SIGTERM') {
      console.log('Restarting gateway in 5 seconds...');
      setTimeout(startGateway, 5000);
    }
  });

  await new Promise((resolve) => {
    const checkReady = setInterval(() => {
      if (gatewayReady) {
        clearInterval(checkReady);
        resolve();
      }
    }, 100);

    setTimeout(() => {
      clearInterval(checkReady);
      resolve();
    }, 30000);
  });

  gatewayStarting = false;
  console.log('Gateway started successfully');
}

function stopGateway() {
  if (gatewayProcess) {
    gatewayProcess.kill('SIGTERM');
    gatewayProcess = null;
    gatewayReady = false;
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/setup/static', express.static(path.join(__dirname, 'public')));

function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="OpenClaw Setup"');
    return res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1) {
    res.setHeader('WWW-Authenticate', 'Basic realm="OpenClaw Setup"');
    return res.status(401).send('Invalid credentials format');
  }
  const password = credentials.slice(colonIndex + 1);

  if (password !== SETUP_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="OpenClaw Setup"');
    return res.status(401).send('Invalid credentials');
  }

  next();
}

app.get('/setup', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

app.get('/setup/api/status', basicAuth, async (req, res) => {
  const configPath = path.join(STATE_DIR, 'openclaw.json');
  let config = {};

  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {}

  res.json({
    configured: isConfigured(),
    gatewayRunning: gatewayReady,
    gatewayToken: GATEWAY_TOKEN,
    stateDir: STATE_DIR,
    providers: Object.keys(config.providers || {}),
    channels: Object.keys(config.channels || {})
  });
});

app.post('/setup/api/run', basicAuth, async (req, res) => {
  const { providers } = req.body;

  if (!providers || Object.keys(providers).length === 0) {
    return res.status(400).json({ error: 'At least one provider is required' });
  }

  try {
    stopGateway();

    for (const [name, config] of Object.entries(providers)) {
      if (config.apiKey) {
        await runCmd('openclaw', ['config', 'set', `providers.${name}.apiKey`, config.apiKey]);
      }
      if (config.baseUrl) {
        await runCmd('openclaw', ['config', 'set', `providers.${name}.baseUrl`, config.baseUrl]);
      }
      if (config.model) {
        await runCmd('openclaw', ['config', 'set', `providers.${name}.model`, config.model]);
      }
    }

    await runCmd('openclaw', ['config', 'set', 'gateway.auth.mode', 'token']);
    await runCmd('openclaw', ['config', 'set', 'gateway.auth.token', GATEWAY_TOKEN]);
    await runCmd('openclaw', ['config', 'set', 'gateway.controlUi.allowInsecureAuth', 'true']);
    await runCmd('openclaw', ['config', 'set', 'gateway.trustedProxies', '["127.0.0.0/8","10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"]']);

    await startGateway();

    res.json({
      success: true,
      message: 'Configuration saved and gateway started',
      gatewayToken: GATEWAY_TOKEN
    });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/setup/api/channel', basicAuth, async (req, res) => {
  const { channel, config } = req.body;

  if (!channel || !config) {
    return res.status(400).json({ error: 'Channel and config are required' });
  }

  try {
    for (const [key, value] of Object.entries(config)) {
      await runCmd('openclaw', ['config', 'set', `channels.${channel}.${key}`, String(value)]);
    }

    stopGateway();
    await startGateway();

    res.json({ success: true, message: `Channel ${channel} configured` });
  } catch (err) {
    console.error('Channel config error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/setup/api/pairing/approve', basicAuth, async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Pairing code is required' });
  }

  try {
    await runCmd('openclaw', ['gateway', 'pairing', 'approve', code]);
    res.json({ success: true, message: 'Pairing approved' });
  } catch (err) {
    console.error('Pairing approval error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/setup/api/pairing/pending', basicAuth, async (req, res) => {
  try {
    const result = await runCmd('openclaw', ['gateway', 'pairing', 'list', '--json']);
    const pending = JSON.parse(result || '[]');
    res.json({ pending });
  } catch {
    res.json({ pending: [] });
  }
});

app.post('/setup/api/reset', basicAuth, async (req, res) => {
  try {
    stopGateway();

    const configPath = path.join(STATE_DIR, 'openclaw.json');
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }

    res.json({ success: true, message: 'Configuration reset' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/setup/api/restart', basicAuth, async (req, res) => {
  try {
    stopGateway();
    await startGateway();
    res.json({ success: true, message: 'Gateway restarted' });
  } catch (err) {
    console.error('Restart error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/setup/export', basicAuth, (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `openclaw-backup-${timestamp}.tar.gz`;

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const tarStream = createTar({ gzip: true, cwd: STATE_DIR }, ['.']);

    tarStream.on('error', (err) => {
      console.error('Tar stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });

    tarStream.pipe(res);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    configured: isConfigured(),
    gatewayReady
  });
});

const server = createServer(app);

const proxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${INTERNAL_GATEWAY_PORT}`,
  ws: true,
  xfwd: true,
  changeOrigin: true
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  if (res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Gateway unavailable',
      message: gatewayReady ? 'Gateway error' : 'Gateway not ready. Complete setup at /setup'
    }));
  }
});

proxy.on('proxyReq', (proxyReq, req) => {
  proxyReq.setHeader('Authorization', `Bearer ${GATEWAY_TOKEN}`);
  proxyReq.setHeader('X-Forwarded-Host', req.headers.host || '');
});

app.use((req, res, next) => {
  if (req.path.startsWith('/setup') || req.path === '/health') {
    return next();
  }

  if (!gatewayReady) {
    if (!isConfigured()) {
      return res.redirect('/setup');
    }
    return res.status(503).json({
      error: 'Gateway starting...',
      message: 'Please wait a moment and refresh'
    });
  }

  proxy.web(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/setup')) {
    socket.destroy();
    return;
  }

  if (!gatewayReady) {
    socket.destroy();
    return;
  }

  proxy.ws(req, socket, head, {
    headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` }
  });
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  stopGateway();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  stopGateway();
  server.close(() => process.exit(0));
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Wrapper listening on port ${PORT}`);
  console.log(`Setup: http://localhost:${PORT}/setup`);

  if (isConfigured()) {
    console.log('Configuration found, starting gateway...');
    await startGateway();
  } else {
    console.log('No configuration. Complete setup at /setup');
  }
});
