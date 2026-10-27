'use strict';
/* Post Parade Daily — server entrypoint. */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require('./db');
const auth = require('./auth');
const game = require('./game');

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const PROD = NODE_ENV === 'production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'furlongbets.db');
const SESSION_DIR = path.dirname(DB_PATH);

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-session-secret-change-me';
if (PROD && (SESSION_SECRET.includes('change-me') || (process.env.SERVER_SALT||'').includes('change-me') || !process.env.SESSION_SECRET || !process.env.SERVER_SALT)){
  console.error('\n[FATAL] In production you MUST set SESSION_SECRET and SERVER_SALT to long random values.');
  console.error('        e.g.  SESSION_SECRET=$(openssl rand -hex 32)  SERVER_SALT=$(openssl rand -hex 32)\n');
  process.exit(1);
}

db.init(DB_PATH);
db.prep();

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", "https://dfeuxpsydnispfjqjwij.supabase.co"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '64kb' }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: SESSION_DIR, concurrentDB: true }),
  name: 'pp.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,      // so a CSRF token exists before login
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: PROD,               // requires HTTPS in production
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));
app.use(auth.ensureCsrf);

// API
app.use('/api/auth', auth.router());
app.use('/api/game', game.router());

// static client
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: PROD ? '1h' : 0 }));
// SPA fallback for non-API routes
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// JSON error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

app.listen(PORT, () => {
  console.log(`Post Parade Daily running on http://localhost:${PORT}  (env=${NODE_ENV}, day=${game.racingDay()})`);
  if (!PROD) console.log('[dev] Using insecure default secrets. Set SESSION_SECRET + SERVER_SALT for production.');
});
