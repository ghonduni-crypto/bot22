const express = require('express');
const cors = require('cors');
const mineflayer = require('mineflayer');

const app = express();
app.use(cors());
app.use(express.json());

// ── Konfigurasi ──────────────────────────────────────────────
const config = {
  ip: 'azuardnet.aternos.me',
  port: 13592,
  name: 'afk_bot',
  version: '1.21.1',
  reconnectDelay: 15,   // detik tunggu sebelum reconnect
  maxReconnectDelay: 120 // maksimal delay (detik) saat server mati
};

let bot = null;
let botStatus = 'offline';
let logs = [];
let lookInterval = null;
let reconnectTimer = null;
let reconnectCount = 0;
let autoReconnect = false; // hanya aktif kalau user klik Start
let currentDelay = config.reconnectDelay;
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

// ── Parse kick reason ────────────────────────────────────────
function parseKickReason(reason) {
  if (!reason) return 'Tidak ada alasan';
  if (typeof reason === 'object') {
    if (reason.value?.translate?.value) return reason.value.translate.value;
    if (reason.value?.text?.value)      return reason.value.text.value;
    return JSON.stringify(reason);
  }
  if (typeof reason === 'string') {
    try {
      const p = JSON.parse(reason);
      if (p.value?.translate?.value) return p.value.translate.value;
      if (p.value?.text?.value)      return p.value.text.value;
      if (p.translate)               return p.translate;
      if (p.text)                    return p.text;
      return JSON.stringify(p);
    } catch (_) { return reason; }
  }
  return String(reason);
}

// ── Anti-idle: putar kepala ──────────────────────────────────
function startAntiIdle() {
  stopAntiIdle();
  let step = 0;
  const schedule = () => {
    const delay = (30 + Math.random() * 30) * 1000;
    lookInterval = setTimeout(() => {
      if (!bot || botStatus !== 'online') return;
      try {
        const yaw   = (Math.random() * 2 - 1) * Math.PI;
        const pitch = (Math.random() * 0.4) - 0.2;
        bot.look(yaw, pitch, true);
        step++;
        if (step % 5 === 0) addLog(`Anti-idle aktif (rotasi ke-${step})`, 'info');
      } catch (_) {}
      schedule();
    }, delay);
  };
  schedule();
  addLog('Anti-idle aktif', 'success');
}

function stopAntiIdle() {
  if (lookInterval) { clearTimeout(lookInterval); lookInterval = null; }
}

// ── Reconnect ────────────────────────────────────────────────
function scheduleReconnect(reason) {
  if (!autoReconnect) return;
  if (reconnectTimer) return; // sudah ada timer

  // Kalau server Aternos mati, tunggu lebih lama
  const isServerDown = reason && (
    reason.includes('idling') ||
    reason.includes('socketClosed') ||
    reason.includes('ECONNREFUSED') ||
    reason.includes('ENOTFOUND') ||
    reason.includes('ETIMEDOUT')
  );

  if (isServerDown) {
    // Pakai exponential backoff: makin lama makin sabar
    currentDelay = Math.min(currentDelay * 1.5, config.maxReconnectDelay);
  } else {
    currentDelay = config.reconnectDelay;
  }

  const delayInt = Math.round(currentDelay);
  botStatus = 'reconnecting';
  addLog(`Reconnect ke-${reconnectCount + 1} dalam ${delayInt} detik...`, 'warn');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!autoReconnect) return;
    reconnectCount++;
    addLog(`Mencoba reconnect ke-${reconnectCount}...`, 'info');
    createBot();
  }, delayInt * 1000);
}

function cancelReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

// ── Buat instance bot ────────────────────────────────────────
function createBot() {
  if (bot) return;

  botStatus = 'connecting';
  addLog(`Menghubungkan ke ${config.ip}:${config.port} sebagai "${config.name}"...`, 'info');

  try {
    bot = mineflayer.createBot({
      host: config.ip,
      port: parseInt(config.port),
      username: config.name,
      version: config.version,
      auth: 'offline',
      hideErrors: false,
      physicsEnabled: false
    });
  } catch (e) {
    addLog('Gagal membuat bot: ' + e.message, 'error');
    botStatus = 'error';
    bot = null;
    scheduleReconnect(e.message);
    return;
  }

  bot.on('login', () => {
    botStatus = 'online';
    reconnectCount = 0;
    currentDelay = config.reconnectDelay; // reset delay kalau berhasil
    addLog(`Login berhasil sebagai "${config.name}"`, 'success');
  });

  // Auto-accept resource pack
  bot.on('resource_pack_push', (pack) => {
    addLog('Resource pack diterima: ' + (pack.url || 'unknown'), 'info');
    bot.acceptResourcePack();
  });

  bot.on('spawn', () => {
    addLog('Bot spawn di dunia', 'success');
    bot.clearControlStates();
    bot.setControlState('sneak', true);
    startAntiIdle();
  });

  bot.on('chat', (username, message) => {
    if (username === config.name) return;
    addLog(`[Chat] <${username}> ${message}`, 'info');
  });

  bot.on('kicked', (reason, loggedIn) => {
    const msg = parseKickReason(reason);
    addLog(`Bot di-kick: ${msg}`, 'error');
    stopAntiIdle();
    bot = null;
    botStatus = 'offline';
    scheduleReconnect(msg);
  });

  bot.on('error', (err) => {
    addLog('Error: ' + err.message, 'warn');
    stopAntiIdle();
    bot = null;
    botStatus = 'error';
    scheduleReconnect(err.message);
  });

  bot.on('end', (reason) => {
    const wasOnline = botStatus === 'online' || botStatus === 'connecting';
    if (wasOnline) addLog('Koneksi terputus' + (reason ? ': ' + reason : ''), 'warn');
    stopAntiIdle();
    bot = null;
    if (wasOnline) {
      botStatus = 'offline';
      scheduleReconnect(reason || '');
    }
  });
}

// ── Start / Stop (dipanggil dari API) ────────────────────────
function startBot() {
  if (autoReconnect) {
    addLog('Bot sudah berjalan.', 'warn');
    return { ok: false, message: 'Bot sudah berjalan' };
  }
  autoReconnect = true;
  reconnectCount = 0;
  currentDelay = config.reconnectDelay;
  addLog('Auto-reconnect diaktifkan', 'info');
  createBot();
  return { ok: true };
}

function stopBot() {
  autoReconnect = false;
  cancelReconnect();
  stopAntiIdle();
  if (bot) {
    try { bot.clearControlStates(); bot.quit('Stopped by panel'); } catch (_) {}
    bot = null;
  }
  botStatus = 'offline';
  addLog('Bot dihentikan — auto-reconnect dimatikan', 'warn');
  return { ok: true };
}

// ── API Routes ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'AFK Bot API aktif', status: botStatus });
});

app.get('/status', (req, res) => {
  res.json({
    status: botStatus,
    autoReconnect,
    reconnectCount,
    config: { ip: config.ip, port: config.port, name: config.name, version: config.version }
  });
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
