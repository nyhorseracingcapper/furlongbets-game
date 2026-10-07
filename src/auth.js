'use strict';
/* Authentication: signup / login / logout / me — bcrypt + secure sessions + CSRF. */
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const BCRYPT_COST = 12;

function validUsername(u){ return typeof u === 'string' && USERNAME_RE.test(u); }
function validPassword(p){ return typeof p === 'string' && p.length >= 8 && p.length <= 200; }

// CSRF: a per-session token, required in the X-CSRF-Token header on every state change.
function ensureCsrf(req, _res, next){
  if (!req.session.csrf) req.session.csrf = require('crypto').randomBytes(24).toString('hex');
  next();
}
function requireCsrf(req, res, next){
  const tok = req.get('X-CSRF-Token');
  if (!tok || tok !== req.session.csrf) return res.status(403).json({ error: 'Bad or missing CSRF token. Reload the page.' });
  next();
}
function requireAuth(req, res, next){
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not signed in.' });
  next();
}

function publicUser(u){
  return u && { username: u.username, totalScore: u.total_score, daysPlayed: u.days_played, bestDay: u.best_day };
}

function router(){
  const r = express.Router();

  const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });
  const signupLimiter = rateLimit({ windowMs: 60*60*1000, max: 8, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many sign-ups from this address. Try again later.' } });

  r.get('/me', (req, res) => {
    const u = req.session.userId ? db.getUserById(req.session.userId) : null;
    res.json({ user: publicUser(u), csrf: req.session.csrf });
  });

  r.post('/signup', signupLimiter, requireCsrf, (req, res) => {
    const { username, password } = req.body || {};
    if (!validUsername(username)) return res.status(400).json({ error: '3–20 characters, letters, numbers, and underscores only.' });
    if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (db.getUserByUsername(username)) return res.status(409).json({ error: 'That username is taken.' });
    let id;
    try {
      const hash = bcrypt.hashSync(password, bcrypt.genSaltSync(BCRYPT_COST));
      id = db.createUser(username, hash);
    } catch (e) {
      if (String(e.message||'').includes('UNIQUE')) return res.status(409).json({ error: 'That username is taken.' });
      throw e;
    }
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      req.session.userId = id;
      req.session.csrf = require('crypto').randomBytes(24).toString('hex');
      res.json({ user: publicUser(db.getUserById(id)), csrf: req.session.csrf });
    });
  });

  r.post('/login', loginLimiter, requireCsrf, (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Enter your username and password.' });
    const u = db.getUserByUsername(username);
    const ok = u && bcrypt.compareSync(password, u.pass_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });   // generic
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      req.session.userId = u.id;
      req.session.csrf = require('crypto').randomBytes(24).toString('hex');
      res.json({ user: publicUser(u), csrf: req.session.csrf });
    });
  });

  r.post('/logout', requireCsrf, (req, res) => {
    req.session.destroy(() => { res.clearCookie('pp.sid'); res.json({ ok: true }); });
  });

  return r;
}

module.exports = { router, ensureCsrf, requireCsrf, requireAuth, publicUser };
