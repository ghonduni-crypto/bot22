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
  reconnectDelay: 15,
  maxReconnectDelay: 120
};

let bot = null;
let botStatus = 'offline';
let logs = [];
let lookInterval = null;
let reconnectTimer = null;
let reconnectCount = 0;
let autoReconnect = false;
let currentDelay = config.reconnectDelay;
const MAX_LOGS = 300;

// ── Logger ───────────────────────────────────────────────────
function addLog(message, type = 'info') {
  const entry = { time: new Date().toLocaleTimeString('id-ID'), message, type };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  console.log(`[${entry.time}] [${type.toUpperCase()}] ${message}`);
}

// ── Parse kick ───────────────────────────────────────────────
function parseKickReason(reason) {
  if (!reason) return 'Tidak ada alasan';
  if (typeof reason === 'object') {
    if (reason.value?.translate?.value) return reason.value.translate.value;
    if (reason.value?.text?.value)      return reason.value.text.value;
    if (reason.translate)               return reason.translate;
    if (reason.text)                    return reason.text;
    return JSON.stringify(reason);
  }
  try {
    const p = JSON.parse(reason);
    if (p.value?.translate?.value) return p.value.translate.value;
    if (p.translate)               return p.translate;
    if (p.text)                    return p.text;
    return JSON.stringify(p);
  } catch (_) { return String(reason); }
}

// ── Anti-idle ────────────────────────────────────────────────
function startAntiIdle() {
  stopAntiIdle();
  let count = 0;
  const schedule = () => {
    const delay = (25 + Math.random() * 25) * 1000;
    lookInterval = setTimeout(() => {
      if (!bot || botStatus !== 'online') return;
      try {
        const yaw   = (Math.random() * 2 - 1) * Math.PI;
        const pitch = (Math.random() * 0.3) - 0.15;
        bot.look(yaw, pitch, true);
        count++;
        if (count % 5 === 0) addLog(`Anti-idle: rotasi ke-${count}`, 'info');
      } catch (_) {}
      schedule();
    }, delay);
  };
  schedule();
  addLog('Anti-idle aktif (rotasi kepala setiap 25-50 detik)', 'success');
}

function stopAntiIdle() {
  if (lookInterval) { clearTimeout(lookInterval); lookInterval = null; }
}

// ── Reconnect ────────────────────────────────────────────────
function scheduleReconnect(reason) {
  if (!autoReconnect) return;
  if (reconnectTimer) return;

  const isServerDown = reason && (
    reason.includes('idling') ||
    reason.includes('socketClosed') ||
    reason.includes('timeout') ||
    reason.includes('ECONNREFUSED') ||
    reason.includes('ENOTFOUND') ||
    reason.includes('ETIMEDOUT')
  );

  currentDelay = isServerDown
    ? Math.min(currentDelay * 1.5, config.maxReconnectDelay)
    : config.reconnectDelay;

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

// ── Buat Bot ─────────────────────────────────────────────────
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
      physicsEnabled: false,
      hideErrors: false,
      // Tambah timeout lebih panjang agar tidak disconnect.timeout
      connectTimeout: 30000,
      closeTimeout: 240
    });
  } catch (e) {
    addLog('Gagal membuat bot: ' + e.message, 'error');
    botStatus = 'error';
    bot = null;
    scheduleReconnect(e.message);
    return;
  }

  // ── Login ──────────────────────────────────────────────────
  bot.on('login', () => {
    botStatus = 'online';
    reconnectCount = 0;
    currentDelay = config.reconnectDelay;
    addLog(`Login berhasil sebagai "${config.name}"`, 'success');
  });

  // ── Spawn ──────────────────────────────────────────────────
  bot.on('spawn', () => {
    const pos = bot.entity?.position;
    const posStr = pos
      ? `X:${Math.round(pos.x)} Y:${Math.round(pos.y)} Z:${Math.round(pos.z)}`
      : 'unknown';
    addLog(`Bot spawn di dunia — posisi ${posStr}`, 'success');
    bot.clearControlStates();
    bot.setControlState('sneak', true);
    startAntiIdle();
  });

  // ── Resource Pack ──────────────────────────────────────────
  // Intersep packet mentah sebelum Mineflayer sempat proses
  bot._client.on('resource_pack_send', (packet) => {
    addLog(`Resource pack diminta (hash: ${packet.hash || 'none'}), mengirim accept...`, 'info');

    // Step 1: accepted
    try {
      bot._client.write('resource_pack_receive', {
        hash: packet.hash || '',
        result: 3
      });
      addLog('Resource pack: accepted ✓', 'success');
    } catch (e) {
      addLog('Gagal kirim accepted: ' + e.message, 'warn');
    }

    // Step 2: successfully loaded (2 detik kemudian)
    setTimeout(() => {
      if (!bot) return;
      try {
        bot._client.write('resource_pack_receive', {
          hash: packet.hash || '',
          result: 0
        });
        addLog('Resource pack: loaded ✓', 'success');
      } catch (e) {
        addLog('Gagal kirim loaded: ' + e.message, 'warn');
      }
    }, 2000);
  });

  // ── Chat ───────────────────────────────────────────────────
  bot.on('chat', (username, message) => {
    if (username === config.name) return;
    addLog(`[Chat] <${username}> ${message}`, 'info');
  });

  // ── Kick ───────────────────────────────────────────────────
  bot.on('kicked', (reason, loggedIn) => {
    const msg = parseKickReason(reason);
    addLog(`Bot di-kick: ${msg}`, 'error');
    stopAntiIdle();
    bot = null;
    botStatus = 'offline';
    scheduleReconnect(msg);
  });

  // ── Error ──────────────────────────────────────────────────
  bot.on('error', (err) => {
    addLog('Error: ' + err.message, 'warn');
    stopAntiIdle();
    bot = null;
    botStatus = 'error';
    scheduleReconnect(err.message);
  });

  // ── End ────────────────────────────────────────────────────
  bot.on('end', (reason) => {
    const wasActive = botStatus === 'online' || botStatus === 'connecting';
    if (wasActive) addLog('Koneksi terputus' + (reason ? ': ' + reason : ''), 'warn');
    stopAntiIdle();
    bot = null;
    if (wasActive) {
      botStatus = 'offline';
      scheduleReconnect(reason || '');
    }
  });
}

// ── Start / Stop ──────────────────────────────────────────────
function startBot() {
  if (autoReconnect) {
    addLog('Bot sudah berjalan.', 'warn');
    return { ok: false, message: 'Bot sudah berjalan' };
  }
  autoReconnect = true;
  reconnectCount = 0;
  currentDelay = config.reconnectDelay;
  addLog('Memulai bot...', 'info');
  createBot();
  return { ok: true };
}

function stopBot() {
  autoReconnect = false;
  cancelReconnect();
  stopAntiIdle();
  if (bot) {
    try { bot.quit('Stopped by panel'); } catch (_) {}
    bot = null;
  }
  botStatus = 'offline';
  addLog('Bot dihentikan — auto-reconnect dimatikan', 'warn');
  return { ok: true };
}

// ── API ───────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ message: 'AFK Bot API aktif', status: botStatus }));

app.get('/status', (req, res) => res.json({
  status: botStatus, autoReconnect, reconnectCount,
  config: { ip: config.ip, port: config.port, name: config.name, version: config.version }
}));

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

// ── Start Server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  addLog(`Server API berjalan di port ${PORT}`, 'success');
});
