'use strict';
/* SQLite data layer: users, daily plays, leaderboard. */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let db;

function init(dbPath){
  const dir = path.dirname(dbPath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL,
      username_lc   TEXT NOT NULL UNIQUE,
      pass_hash     TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      total_score   INTEGER NOT NULL DEFAULT 0,
      days_played   INTEGER NOT NULL DEFAULT 0,
      best_day      INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS plays (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      day         TEXT NOT NULL,
      seed        TEXT NOT NULL,
      card_json   TEXT NOT NULL,
      state_json  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      score       INTEGER,
      created_at  INTEGER NOT NULL,
      finished_at INTEGER,
      UNIQUE(user_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_plays_day ON plays(day, score);
    CREATE INDEX IF NOT EXISTS idx_users_total ON users(total_score);
  `);
  return db;
}

/* ------------------------------ users ------------------------------------ */
const q = {};
function prep(){
  q.createUser = db.prepare(`INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES (?,?,?,?)`);
  q.userByLc   = db.prepare(`SELECT * FROM users WHERE username_lc = ?`);
  q.userById   = db.prepare(`SELECT * FROM users WHERE id = ?`);
  q.getPlay    = db.prepare(`SELECT * FROM plays WHERE user_id = ? AND day = ?`);
  q.createPlay = db.prepare(`INSERT INTO plays (user_id, day, seed, card_json, state_json, status, created_at) VALUES (?,?,?,?,?, 'active', ?)`);
  q.setState   = db.prepare(`UPDATE plays SET state_json = ? WHERE id = ?`);
  q.finishPlay = db.prepare(`UPDATE plays SET state_json = ?, status='complete', score = ?, finished_at = ? WHERE id = ?`);
  q.bumpUser   = db.prepare(`UPDATE users SET total_score = total_score + ?, days_played = days_played + 1, best_day = MAX(best_day, ?) WHERE id = ?`);
  q.lbAllTime  = db.prepare(`SELECT username, total_score, days_played, best_day FROM users WHERE days_played > 0 ORDER BY total_score DESC, best_day DESC LIMIT ?`);
  q.lbDay      = db.prepare(`SELECT u.username AS username, p.score AS score FROM plays p JOIN users u ON u.id = p.user_id WHERE p.day = ? AND p.status='complete' ORDER BY p.score DESC LIMIT ?`);
  q.myRank     = db.prepare(`SELECT COUNT(*)+1 AS rank FROM users WHERE days_played > 0 AND total_score > (SELECT total_score FROM users WHERE id = ?)`);
  q.countUsers = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE days_played > 0`);
}

function createUser(username, passHash){
  const info = q.createUser.run(username, username.toLowerCase(), passHash, Date.now());
  return info.lastInsertRowid;
}
const getUserByUsername = (name)=> q.userByLc.get(String(name).toLowerCase());
const getUserById = (id)=> q.userById.get(id);

/* ------------------------------ plays ------------------------------------ */
const getPlay = (userId, day)=> q.getPlay.get(userId, day);
function createPlay(userId, day, seed, cardJson, stateJson){
  const info = q.createPlay.run(userId, day, seed, cardJson, stateJson, Date.now());
  return info.lastInsertRowid;
}
const setState = (playId, stateJson)=> q.setState.run(stateJson, playId);

// finalize a play and roll the day's score into the user's lifetime total (atomic)
const finishPlay = db ? null : null;
function finalize(playId, userId, stateJson, score){
  const tx = db.transaction(()=>{
    q.finishPlay.run(stateJson, score, Date.now(), playId);
    q.bumpUser.run(score, score, userId);
  });
  tx();
}

/* --------------------------- leaderboard --------------------------------- */
const leaderboardAllTime = (limit=50)=> q.lbAllTime.all(limit);
const leaderboardDay = (day, limit=50)=> q.lbDay.all(day, limit);
const myRank = (userId)=> (q.myRank.get(userId)||{}).rank;
const userCount = ()=> (q.countUsers.get()||{}).c;

module.exports = {
  init, prep,
  createUser, getUserByUsername, getUserById,
  getPlay, createPlay, setState, finalize,
  leaderboardAllTime, leaderboardDay, myRank, userCount,
  raw: ()=>db
};
