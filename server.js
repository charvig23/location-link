// Consent-based location sharing. Stores ONLY lat, lng, accuracy and a timestamp.
// No IP address, user agent, cookies or any other data about the visitor is saved.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

// { [id]: { key, createdAt, locations: [{lat, lng, accuracy, at}] } }
let db = {};
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 2000) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
});

const serveFile = (res, name) =>
  fs.readFile(path.join(PUBLIC, name), (err, buf) =>
    err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, 'text/html; charset=utf-8'));

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;

  if (req.method === 'GET' && p === '/') return serveFile(res, 'index.html');

  // Visitor page
  if (req.method === 'GET' && (m = p.match(/^\/l\/([a-f0-9]{12})$/))) {
    return db[m[1]] ? serveFile(res, 'share.html') : send(res, 404, 'Link not found', 'text/plain');
  }

  // Create a new link
  if (req.method === 'POST' && p === '/api/links') {
    const id = crypto.randomBytes(6).toString('hex');
    const key = crypto.randomBytes(16).toString('hex');
    db[id] = { key, createdAt: Date.now(), locations: [] };
    save();
    return send(res, 200, { id, key });
  }

  // Visitor submits location (lat/lng/accuracy only)
  if (req.method === 'POST' && (m = p.match(/^\/api\/links\/([a-f0-9]{12})\/location$/))) {
    const link = db[m[1]];
    if (!link) return send(res, 404, { error: 'not found' });
    const { lat, lng, accuracy } = await readBody(req);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return send(res, 400, { error: 'invalid' });
    link.locations.push({ lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null, at: Date.now() });
    save();
    return send(res, 200, { ok: true });
  }

  // Owner reads locations (requires secret key)
  if (req.method === 'GET' && (m = p.match(/^\/api\/links\/([a-f0-9]{12})\/locations$/))) {
    const link = db[m[1]];
    if (!link || link.key !== url.searchParams.get('key')) return send(res, 404, { error: 'not found' });
    return send(res, 200, { locations: link.locations });
  }

  send(res, 404, 'Not found', 'text/plain');
}).listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
