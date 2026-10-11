const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const twilio = require('twilio');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'messages.json');
const required = ['APP_PASSWORD', 'SESSION_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_MESSAGING_SERVICE_SID'];
const configured = required.every(k => Boolean(process.env[k])) && Boolean(process.env.PUBLIC_BASE_URL);
const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ number: null, messages: [] }, null, 2));
function loadDb() { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return { number: null, messages: [] }; } }
function saveDb(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function requireConfigured(req, res, next) {
  if (!twilioClient || !process.env.TWILIO_MESSAGING_SERVICE_SID || !baseUrl) return res.status(503).json({ error: 'Phone service is not configured yet. The site owner must finish the server setup.' });
  next();
}
function requireLogin(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'Please sign in again.' });
}
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'"], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], upgradeInsecureRequests: [] } } }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '20kb' }));
app.use(session({
  name: 'poopywater.sid',
  secret: process.env.SESSION_SECRET || 'not-configured-change-this-before-deploying',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));
// Also serve the root index while the repo is being run locally.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/me', requireLogin, (req, res) => res.json({ authenticated: true }));
app.post('/api/login', (req, res) => {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return res.status(503).json({ error: 'APP_PASSWORD has not been set on the server.' });
  if (typeof req.body.password !== 'string' || req.body.password.length > 200 || req.body.password !== expected) {
    return res.status(401).json({ error: 'Incorrect app password.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start a secure session.' });
    req.session.authenticated = true;
    req.session.save(err2 => err2 ? res.status(500).json({ error: 'Could not save session.' }) : res.json({ ok: true }));
  });
});
app.post('/api/logout', requireLogin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/status', requireLogin, (req, res) => {
  const db = loadDb();
  res.json({ configured, number: db.number ? db.number.phoneNumber : null });
});
app.get('/api/numbers/available', requireLogin, requireConfigured, async (req, res) => {
  try {
    const areaCode = String(req.query.areaCode || '');
    if (areaCode && !/^\d{3}$/.test(areaCode)) return res.status(400).json({ error: 'Area code must be three digits.' });
    const opts = { smsEnabled: true, limit: 10 };
    if (areaCode) opts.areaCode = areaCode;
    const list = await twilioClient.availablePhoneNumbers('US').local.list(opts);
    res.json({ numbers: list.map(n => ({ phoneNumber: n.phoneNumber, locality: n.locality, region: n.region })) });
  } catch (e) {
    console.error('Number search failed:', e.message);
    res.status(502).json({ error: 'Could not search numbers. Check provider permissions and account setup.' });
  }
});
app.post('/api/numbers/purchase', requireLogin, requireConfigured, async (req, res) => {
  const phoneNumber = String(req.body.phoneNumber || '');
  if (!/^\+1\d{10}$/.test(phoneNumber)) return res.status(400).json({ error: 'Choose a valid US number from the search results.' });
  const db = loadDb();
  if (db.number) return res.status(409).json({ error: 'A number is already attached to this app. Contact the site owner before changing it.' });
  try {
    const bought = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber, smsUrl: baseUrl + '/webhooks/twilio/inbound', smsMethod: 'POST',
      statusCallback: baseUrl + '/webhooks/twilio/status', statusCallbackMethod: 'POST'
    });
    db.number = { phoneNumber: bought.phoneNumber, sid: bought.sid, createdAt: new Date().toISOString() };
    saveDb(db);
    res.json({ phoneNumber: bought.phoneNumber });
  } catch (e) {
    console.error('Number purchase failed:', e.message);
    res.status(502).json({ error: 'Provider could not purchase this number. Check billing, permissions, and any required US messaging registration.' });
  }
});
app.get('/api/messages', requireLogin, (req, res) => {
  const db = loadDb();
  res.json({ messages: db.messages.slice(-100).reverse() });
});
app.post('/api/messages', requireLogin, requireConfigured, rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }), async (req, res) => {
  const to = String(req.body.to || '');
  const body = String(req.body.body || '').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return res.status(400).json({ error: 'Recipient must be in international format, e.g. +14155550123.' });
  if (!body || body.length > 1600) return res.status(400).json({ error: 'Message must be 1–1600 characters.' });
  const db = loadDb();
  if (!db.number) return res.status(409).json({ error: 'Purchase a number before sending messages.' });
  try {
    const msg = await twilioClient.messages.create({ to, body, messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, statusCallback: baseUrl + '/webhooks/twilio/status' });
    db.messages.push({ sid: msg.sid, direction: 'outbound', from: db.number.phoneNumber, to, body, status: msg.status, date: new Date().toISOString() });
    db.messages = db.messages.slice(-500);
    saveDb(db);
    res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    console.error('SMS send failed:', e.message);
    res.status(502).json({ error: 'Message could not be sent. Check account balance, recipient permissions, and US messaging registration.' });
  }
});
function verifyTwilio(req, res, next) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return res.status(503).send('Messaging service not configured');
  const signature = req.get('X-Twilio-Signature') || '';
  const url = baseUrl + req.originalUrl;
  if (!baseUrl || !twilio.validateRequest(token, signature, url, req.body)) return res.status(403).send('Invalid webhook signature');
  next();
}
app.post('/webhooks/twilio/inbound', verifyTwilio, (req, res) => {
  const db = loadDb();
  const msg = {
    sid: String(req.body.MessageSid || ''),
    direction: 'inbound',
    from: String(req.body.From || ''),
    to: String(req.body.To || ''),
    body: String(req.body.Body || '').slice(0, 1600),
    status: 'received',
    date: new Date().toISOString()
  };
  if (msg.sid && !db.messages.some(m => m.sid === msg.sid)) {
    db.messages.push(msg);
    db.messages = db.messages.slice(-500);
    saveDb(db);
  }
  res.type('text/xml').send('<Response></Response>');
});
app.post('/webhooks/twilio/status', verifyTwilio, (req, res) => {
  const db = loadDb();
  const sid = String(req.body.MessageSid || req.body.SmsSid || '');
  const item = db.messages.find(m => m.sid === sid);
  if (item && req.body.MessageStatus) { item.status = String(req.body.MessageStatus); saveDb(db); }
  res.sendStatus(204);
});
app.get('/health', (_req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log('Poopywater Phone listening on port ' + PORT));
