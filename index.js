const express = require('express');
const cors = require('cors');
const mc = require('minecraft-protocol');

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

let client = null;
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

// ── Anti-idle: putar kepala ──────────────────────────────────
let yaw = 0;
let pitch = 0;

function startAntiIdle() {
  stopAntiIdle();
  const schedule = () => {
    const delay = (25 + Math.random() * 25) * 1000; // 25–50 detik
    lookInterval = setTimeout(() => {
      if (!client || botStatus !== 'online') return;
      try {
        // Kirim packet look langsung — paling reliable
        yaw   = (Math.random() * 360);
        pitch = (Math.random() * 20) - 10;
        client.write('look', {
          yaw: yaw,
          pitch: pitch,
          onGround: true
        });
      } catch (_) {}
      schedule();
    }, delay);
  };
  schedule();
  addLog('Anti-idle aktif (look packet setiap 25-50 detik)', 'success');
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
    reason.includes('ECONNREFUSED') ||
    reason.includes('ENOTFOUND') ||
    reason.includes('ETIMEDOUT') ||
    reason.includes('connect')
  );

  if (isServerDown) {
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

// ── Buat koneksi bot pakai minecraft-protocol langsung ───────
function createBot() {
  if (client) return;

  botStatus = 'connecting';
  addLog(`Menghubungkan ke ${config.ip}:${config.port} sebagai "${config.name}"...`, 'info');

  try {
    client = mc.createClient({
      host: config.ip,
      port: parseInt(config.port),
      username: config.name,
      version: config.version,
      auth: 'offline',
      hideErrors: false,
      // Nonaktifkan fitur yang tidak perlu
      keepAlive: true,
      checkTimeoutInterval: 30000
    });
  } catch (e) {
    addLog('Gagal membuat koneksi: ' + e.message, 'error');
    botStatus = 'error';
    client = null;
    scheduleReconnect(e.message);
    return;
  }

  // ── Login berhasil ─────────────────────────────────────────
  client.on('login', (packet) => {
    botStatus = 'online';
    reconnectCount = 0;
    currentDelay = config.reconnectDelay;
    addLog(`Login berhasil! EntityID: ${packet.entityId}`, 'success');

    // Kirim client settings supaya server tahu bot siap
    try {
      client.write('settings', {
        locale: 'en_US',
        viewDistance: 2,
        chatFlags: 0,
        chatColors: false,
        skinParts: 127,
        mainHand: 1,
        enableTextFiltering: false,
        enableServerListing: true
      });
    } catch (_) {}
  });

  // ── Spawn / position ───────────────────────────────────────
  client.on('position', (packet) => {
    addLog(`Bot spawn — posisi X:${Math.round(packet.x)} Y:${Math.round(packet.y)} Z:${Math.round(packet.z)}`, 'success');

    // Konfirmasi posisi ke server (wajib di 1.17+)
    try {
      client.write('teleport_confirm', { teleportId: packet.teleportId });
    } catch (_) {}

    // Kirim posisi awal (diam di tempat)
    try {
      client.write('position_look', {
        x: packet.x,
        y: packet.y,
        z: packet.z,
        yaw: packet.yaw,
        pitch: packet.pitch,
        flags: 0,
        onGround: true
      });
    } catch (_) {
      try {
        client.write('position', {
          x: packet.x, y: packet.y, z: packet.z, onGround: true
        });
      } catch (_2) {}
    }

    startAntiIdle();
  });

  // ── Resource pack — intercept packet langsung ──────────────
  client.on('resource_pack_send', (packet) => {
    addLog(`Resource pack diminta, auto-accept (hash: ${packet.hash || 'none'})`, 'info');
    try {
      // Kirim "accepted" ke server
      client.write('resource_pack_receive', {
        hash: packet.hash || '',
        result: 3 // 3 = accepted
      });
      addLog('Resource pack: accepted ✓', 'success');

      // Setelah beberapa detik kirim "loaded"
      setTimeout(() => {
        if (!client) return;
        try {
          client.write('resource_pack_receive', {
            hash: packet.hash || '',
            result: 0 // 0 = successfully loaded
          });
          addLog('Resource pack: loaded ✓', 'success');
        } catch (_) {}
      }, 2000);
    } catch (e) {
      addLog('Gagal accept resource pack: ' + e.message, 'warn');
    }
  });

  // ── Chat ───────────────────────────────────────────────────
  client.on('chat', (packet) => {
    try {
      const msg = typeof packet.message === 'string'
        ? JSON.parse(packet.message)
        : packet.message;
      const text = msg?.text || msg?.translate || JSON.stringify(msg);
      if (text && !text.includes(config.name)) {
        addLog(`[Chat] ${text}`, 'info');
      }
    } catch (_) {}
  });

  // ── Keep alive ─────────────────────────────────────────────
  client.on('keep_alive', (packet) => {
    try {
      client.write('keep_alive', { keepAliveId: packet.keepAliveId });
    } catch (_) {}
  });

  // ── Kick ──────────────────────────────────────────────────
  client.on('kick_disconnect', (packet) => {
    const msg = parseKickReason(packet.reason);
    addLog(`Bot di-kick: ${msg}`, 'error');
    stopAntiIdle();
    client = null;
    botStatus = 'offline';
    scheduleReconnect(msg);
  });

  client.on('disconnect', (packet) => {
    const msg = parseKickReason(packet.reason);
    addLog(`Disconnect: ${msg}`, 'error');
    stopAntiIdle();
    client = null;
    botStatus = 'offline';
    scheduleReconnect(msg);
  });

  // ── Error & End ───────────────────────────────────────────
  client.on('error', (err) => {
    addLog('Error: ' + err.message, 'warn');
    stopAntiIdle();
    client = null;
    botStatus = 'error';
    scheduleReconnect(err.message);
  });

  client.on('end', (reason) => {
    const wasActive = botStatus === 'online' || botStatus === 'connecting';
    if (wasActive) addLog('Koneksi terputus' + (reason ? ': ' + reason : ''), 'warn');
    stopAntiIdle();
    client = null;
    if (wasActive) {
      botStatus = 'offline';
      scheduleReconnect(reason || '');
    }
  });
}

// ── Start / Stop ─────────────────────────────────────────────
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
  if (client) {
    try { client.end('Stopped by panel'); } catch (_) {}
    client = null;
  }
  botStatus = 'offline';
  addLog('Bot dihentikan — auto-reconnect dimatikan', 'warn');
  return { ok: true };
}

// ── API Routes ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'AFK Bot API aktif', status: botStatus });
});

app.get('/status', (req, res) => {
  res.json({ status: botStatus, autoReconnect, reconnectCount,
    config: { ip: config.ip, port: config.port, name: config.name, version: config.version } });
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

// ── Start Server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  addLog(`Server API berjalan di port ${PORT}`, 'success');
});
