const express = require('express');
const cors = require('cors');
const mineflayer = require('mineflayer');

const app = express();
app.use(cors());
app.use(express.json());

// ── Konfigurasi Bot ──────────────────────────────────────────
const config = {
  ip: 'azuardnet.aternos.me',
  port: 13592,
  name: 'afk_bot'
};

let bot = null;
let botStatus = 'offline';
let logs = [];
const MAX_LOGS = 300;

// ── Logger ───────────────────────────────────────────────────
function addLog(message, type = 'info') {
  const entry = {
    time: new Date().toLocaleTimeString('id-ID'),
    message,
    type
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  console.log(`[${entry.time}] [${type.toUpperCase()}] ${message}`);
}

// ── Start Bot ────────────────────────────────────────────────
function startBot() {
  if (bot) {
    addLog('Bot sudah berjalan.', 'warn');
    return { ok: false, message: 'Bot sudah berjalan' };
  }

  botStatus = 'connecting';
  addLog(`Menghubungkan ke ${config.ip}:${config.port} sebagai "${config.name}"...`, 'info');

  bot = mineflayer.createBot({
    host: config.ip,
    port: config.port,
    username: config.name,
    version: false,
    auth: 'offline'
  });

  let lasttime = -1;
  let moving = 0;
  let lastaction;
  const actions = ['forward', 'back', 'left', 'right'];
  const moveinterval = 2;
  const maxrandom = 5;

  bot.on('login', () => {
    botStatus = 'online';
    addLog(`Login berhasil sebagai "${config.name}"`, 'success');
  });

  bot.on('spawn', () => {
    addLog('Bot telah spawn di dunia', 'success');
  });

  bot.on('time', () => {
    if (botStatus !== 'online') return;
    if (lasttime < 0) {
      lasttime = bot.time.age;
    } else {
      const randomadd = Math.random() * maxrandom * 20;
      const interval = moveinterval * 20 + randomadd;
      if (bot.time.age - lasttime > interval) {
        if (moving === 1) {
          bot.setControlState(lastaction, false);
          moving = 0;
          lasttime = bot.time.age;
        } else {
          const yaw = Math.random() * Math.PI - 0.5 * Math.PI;
          const pitch = Math.random() * Math.PI - 0.5 * Math.PI;
          bot.look(yaw, pitch, false);
          lastaction = actions[Math.floor(Math.random() * actions.length)];
          bot.setControlState(lastaction, true);
          moving = 1;
          lasttime = bot.time.age;
          bot.activateItem();
          addLog('AFK move: ' + lastaction, 'info');
        }
      }
    }
  });

  bot.on('chat', (username, message) => {
    addLog(`[Chat] <${username}> ${message}`, 'info');
  });

  bot.on('kicked', (reason) => {
    try { reason = JSON.parse(reason)?.text || reason; } catch (_) {}
    addLog('Bot di-kick: ' + reason, 'error');
    botStatus = 'offline';
    bot = null;
  });

  bot.on('error', (err) => {
    addLog('Error: ' + err.message, 'error');
    botStatus = 'error';
    bot = null;
  });

  bot.on('end', () => {
    addLog('Koneksi bot terputus', 'warn');
    botStatus = 'offline';
    bot = null;
  });

  return { ok: true };
}

// ── Stop Bot ─────────────────────────────────────────────────
function stopBot() {
  if (!bot) {
    addLog('Bot tidak sedang berjalan.', 'warn');
    return { ok: false, message: 'Bot tidak berjalan' };
  }
  bot.quit('Stopped by panel');
  bot = null;
  botStatus = 'offline';
  addLog('Bot dihentikan oleh panel', 'warn');
  return { ok: true };
}

// ── API Routes ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'AFK Bot API aktif', status: botStatus });
});

app.get('/status', (req, res) => {
  res.json({ status: botStatus, config });
});

app.get('/logs', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  res.json({ logs: logs.slice(since), total: logs.length });
});

app.post('/start', (req, res) => {
  const result = startBot();
  res.json({ ...result, status: botStatus });
});

app.post('/stop', (req, res) => {
  const result = stopBot();
  res.json({ ...result, status: botStatus });
});

// ── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  addLog(`Server API berjalan di port ${PORT}`, 'success');
});
