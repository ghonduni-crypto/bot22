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
  name: 'afk_bot',
  version: '1.21.1'
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

// ── Parse pesan kick ─────────────────────────────────────────
function parseKickReason(reason) {
  if (!reason) return 'Tidak ada alasan';

  // Kalau sudah object langsung
  if (typeof reason === 'object') {
    // Format mineflayer compound: { type:'compound', value:{ translate:{ value:'...' } } }
    if (reason.value?.translate?.value) return reason.value.translate.value;
    if (reason.value?.text?.value)      return reason.value.text.value;
    return JSON.stringify(reason);
  }

  // Kalau string, coba parse JSON
  if (typeof reason === 'string') {
    try {
      const p = JSON.parse(reason);
      if (p.value?.translate?.value) return p.value.translate.value;
      if (p.value?.text?.value)      return p.value.text.value;
      if (p.translate)               return p.translate;
      if (p.text)                    return p.text;
      return JSON.stringify(p);
    } catch (_) {
      return reason;
    }
  }

  return String(reason);
}

// ── Start Bot ────────────────────────────────────────────────
function startBot() {
  if (bot) {
    addLog('Bot sudah berjalan.', 'warn');
    return { ok: false, message: 'Bot sudah berjalan' };
  }

  botStatus = 'connecting';
  addLog(`Menghubungkan ke ${config.ip}:${config.port} (v${config.version}) sebagai "${config.name}"...`, 'info');

  try {
    bot = mineflayer.createBot({
      host: config.ip,
      port: parseInt(config.port),
      username: config.name,
      version: config.version,
      auth: 'offline',
      hideErrors: false,
      // Nonaktifkan physics agar tidak ada gerakan otomatis
      physicsEnabled: false
    });
  } catch (e) {
    addLog('Gagal membuat bot: ' + e.message, 'error');
    botStatus = 'error';
    bot = null;
    return { ok: false };
  }

  bot.on('login', () => {
    botStatus = 'online';
    addLog(`Login berhasil sebagai "${config.name}"`, 'success');
  });

  bot.on('spawn', () => {
    addLog('Bot spawn di dunia — mode diam (no movement)', 'success');

    // Pastikan semua kontrol gerakan mati
    bot.clearControlStates();

    // Sneak agar tidak jatuh dari tepi
    bot.setControlState('sneak', true);

    addLog('Bot aktif AFK — diam di tempat', 'info');
  });

  bot.on('chat', (username, message) => {
    if (username === config.name) return; // abaikan chat bot sendiri
    addLog(`[Chat] <${username}> ${message}`, 'info');
  });

  bot.on('kicked', (reason, loggedIn) => {
    const msg = parseKickReason(reason);
    addLog(`Bot di-kick${loggedIn ? ' setelah login' : ''}: ${msg}`, 'error');
    botStatus = 'offline';
    bot = null;
  });

  bot.on('error', (err) => {
    // Abaikan error ECONNRESET biasa
    if (err.message.includes('ECONNRESET') || err.message.includes('ENOTFOUND')) {
      addLog('Koneksi terputus (network): ' + err.message, 'warn');
    } else {
      addLog('Error: ' + err.message, 'error');
    }
    botStatus = 'error';
    bot = null;
  });

  bot.on('end', (reason) => {
    if (botStatus === 'online' || botStatus === 'connecting') {
      addLog('Koneksi terputus' + (reason ? ': ' + reason : ''), 'warn');
    }
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
  try {
    bot.clearControlStates();
    bot.quit('Stopped by panel');
  } catch (_) {}
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
  res.json({ status: botStatus, config: { ip: config.ip, port: config.port, name: config.name, version: config.version } });
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
