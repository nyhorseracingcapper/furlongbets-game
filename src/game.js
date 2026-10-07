'use strict';
/* Game API — server-authoritative. The daily card, its results and pools live
   only on the server; the client never receives the seed or the finishing order
   until it commits to running a race. One card per player per day. No takeout. */
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const E = require('./engine');
const { requireAuth, requireCsrf } = require('./auth');

const AMOUNTS_MAX = 500;            // max chips per single bet unit
const DAY_TZ = process.env.DAY_TZ || 'America/New_York';
const SERVER_SALT = process.env.SERVER_SALT || 'dev-insecure-salt-change-me';

function racingDay(){
  return new Intl.DateTimeFormat('en-CA', { timeZone: DAY_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}
function seedFor(userId, day){
  return crypto.createHash('sha256').update(`${userId}:${day}:${SERVER_SALT}`).digest('hex').slice(0, 24);
}
function freshState(){
  return { bankroll: E.START_BANKROLL, raceIdx: 0, finished:false, score:null, bets:{}, multi:[], ledger:[] };
}
function raceBets(state, idx){
  if (!state.bets[idx]) state.bets[idx] = { win:[], place:[], show:[], exacta:{}, trifecta:{}, staged:[] };
  return state.bets[idx];
}
function idxByPP(race, pp){ return race.horses.findIndex(h => h.pp === pp); }

// distinct ordered combinations for an exotic spread (same rule as the client)
function exoticCombos(spots, k){
  if (spots.length !== k || spots.some(s => !s.length)) return [];
  const out = [];
  (function rec(depth, used, cur){
    if (depth === k){ out.push(cur.slice()); return; }
    for (const pp of spots[depth]){ if (used.has(pp)) continue; used.add(pp); cur.push(pp); rec(depth+1, used, cur); cur.pop(); used.delete(pp); }
  })(0, new Set(), []);
  return out;
}

/* ---- project the current public game view for the client ---- */
function viewOf(play, card, state){
  const idx = state.raceIdx;
  const base = {
    status: play.status, day: play.day, trackName: card.trackName,
    nraces: card.races.length, raceIdx: idx, bankroll: Math.round(state.bankroll),
    startBankroll: E.START_BANKROLL, finished: state.finished, score: state.score,
    ledger: state.ledger
  };
  if (state.finished || idx >= card.races.length) return base;
  const rb = raceBets(state, idx);
  base.race = E.publicRace(card.races[idx], { win: rb.win });
  base.staged = rb.staged;
  base.multiAlive = state.multi.filter(m => m.alive).map(m => ({ type:m.type, amount:m.amount, legs:m.legs, startRace:m.startRace, cost:m.cost }));
  return base;
}

function router(){
  const r = express.Router();
  r.use(requireAuth);

  // GET today's card (creates it on first visit; resumes otherwise)
  r.get('/today', (req, res) => {
    const day = racingDay();
    let play = db.getPlay(req.session.userId, day);
    if (!play){
      const seed = seedFor(req.session.userId, day);
      const card = E.buildCard(seed, E.NRACES);
      const state = freshState();
      const id = db.createPlay(req.session.userId, day, seed, JSON.stringify(card), JSON.stringify(state));
      play = db.getPlay(req.session.userId, day);
    }
    const card = JSON.parse(play.card_json);
    const state = JSON.parse(play.state_json);
    res.json(viewOf(play, card, state));
  });

  // place a bet (validated + priced server-side)
  r.post('/bet', requireCsrf, (req, res) => {
    const day = racingDay();
    const play = db.getPlay(req.session.userId, day);
    if (!play || play.status !== 'active') return res.status(409).json({ error: 'No active card.' });
    const card = JSON.parse(play.card_json), state = JSON.parse(play.state_json);
    if (state.finished) return res.status(409).json({ error: 'Card already finished.' });

    const { type } = req.body || {};
    const T = E.TYPES[type];
    if (!T) return res.status(400).json({ error: 'Unknown bet type.' });
    const amount = Math.floor(Number(req.body.amount));
    if (!(amount >= 1 && amount <= AMOUNTS_MAX)) return res.status(400).json({ error: 'Bet amount out of range.' });

    const curIdx = state.raceIdx;
    const race = card.races[curIdx];
    const liveSet = new Set(race.horses.filter(h => !h.scratched).map(h => h.pp));
    const rb = raceBets(state, curIdx);

    let cost = 0, label = '', detail = '', combos = null, legs = null;

    if (T.legs){
      // multi-race: legs for this race and the next (legs-1) races
      if (curIdx + T.legs > card.races.length) return res.status(400).json({ error: 'Not enough races left for that bet.' });
      legs = req.body.legs;
      if (!Array.isArray(legs) || legs.length !== T.legs) return res.status(400).json({ error: 'Pick horses in each leg.' });
      let c = 1;
      for (let L = 0; L < T.legs; L++){
        const set = [...new Set((legs[L]||[]).map(Number))];
        const legHorses = new Set(card.races[curIdx+L].horses.filter(h=>!h.scratched).map(h=>h.pp));
        if (!set.length || set.some(pp => !legHorses.has(pp))) return res.status(400).json({ error: `Invalid pick in leg ${L+1}.` });
        legs[L] = set; c *= set.length;
      }
      cost = c * amount;
      if (cost > state.bankroll) return res.status(400).json({ error: 'Not enough chips.' });
      label = T.label;
      detail = legs.map(s => s.join('/')).join('  over  ');
      state.multi.push({ type, amount, legs, startRace: curIdx, cost, alive: true });
    } else if (T.n === 1){
      const pp = Number((req.body.picks||[])[0]);
      if (!liveSet.has(pp)) return res.status(400).json({ error: 'Pick a live runner.' });
      cost = amount;
      if (cost > state.bankroll) return res.status(400).json({ error: 'Not enough chips.' });
      const i = idxByPP(race, pp);
      rb[type][i] = (rb[type][i] || 0) + amount;
      label = `${T.label} #${pp}`; detail = race.horses[i].name;
    } else {
      // exacta / trifecta spread: spots = array of arrays, or box
      const box = !!req.body.box;
      let spots;
      if (box){
        const set = [...new Set((req.body.boxSet||[]).map(Number))];
        if (set.some(pp => !liveSet.has(pp)) || set.length < T.n) return res.status(400).json({ error: `Box needs at least ${T.n} runners.` });
        spots = Array(T.n).fill(set);
      } else {
        spots = (req.body.spots||[]).map(s => [...new Set((s||[]).map(Number))]);
        if (spots.length !== T.n || spots.some(s => !s.length || s.some(pp => !liveSet.has(pp))))
          return res.status(400).json({ error: `Pick runners in each of the ${T.n} spots.` });
      }
      combos = exoticCombos(spots, T.n);
      if (!combos.length) return res.status(400).json({ error: 'No valid combinations.' });
      cost = combos.length * amount;
      if (cost > state.bankroll) return res.status(400).json({ error: 'Not enough chips.' });
      combos.forEach(c => { const key = c.join('-'); rb[type][key] = (rb[type][key]||0) + amount; });
      label = `${T.label}${box ? ' Box' : ''}`;
      detail = box ? ('Box ' + [...new Set(spots[0])].join('-')) : spots.map(s => s.join('/')).join('  over  ');
    }

    state.bankroll -= cost;
    const ticket = { type, amount, cost, label, detail, raceIdx: curIdx };
    if (combos) ticket.combos = combos;
    if (legs) ticket.legs = legs;
    rb.staged.push(ticket);

    db.setState(play.id, JSON.stringify(state));
    res.json({ bankroll: Math.round(state.bankroll), staged: rb.staged,
      race: E.publicRace(race, { win: rb.win }).horses });   // refreshed odds
  });

  // run the current race (server computes the result + settles)
  r.post('/run', requireCsrf, (req, res) => {
    const day = racingDay();
    const play = db.getPlay(req.session.userId, day);
    if (!play || play.status !== 'active') return res.status(409).json({ error: 'No active card.' });
    const card = JSON.parse(play.card_json), state = JSON.parse(play.state_json);
    if (state.finished) return res.status(409).json({ error: 'Card already finished.' });

    const idx = state.raceIdx;
    const race = card.races[idx];
    const rb = raceBets(state, idx);
    const pay = E.settleRace(race, { win: rb.win, place: rb.place, show: rb.show, exactaCombos: rb.exacta, trifectaCombos: rb.trifecta });

    // settle single-race staged tickets
    const settled = [];
    for (const t of rb.staged){
      let payout = 0, hit = false, note = '';
      if (t.type === 'win'){ if (t.label.includes('#'+pay.winPP)){ payout = t.amount * pay.winMult; hit = true; note = `$2 → ${pay.win2.toFixed(2)}`; } }
      else if (t.type === 'place'){ const pp = ppOf(t); if (pay.placePPs.includes(pp)){ payout = t.amount * pay.plMultByPP[pp]; hit = true; note = `$2 → ${(pay.plMultByPP[pp]*2).toFixed(2)}`; } }
      else if (t.type === 'show'){ const pp = ppOf(t); if (pay.showPPs.includes(pp)){ payout = t.amount * pay.shMultByPP[pp]; hit = true; note = `$2 → ${(pay.shMultByPP[pp]*2).toFixed(2)}`; } }
      else if (t.type === 'exacta'){ if (t.combos.some(c => c.join('-') === pay.exKey)){ payout = t.amount * pay.exMult; hit = true; note = `${pay.exKey} · $2 → ${pay.ex2.toFixed(2)}`; } }
      else if (t.type === 'trifecta'){ if (t.combos.some(c => c.join('-') === pay.triKey)){ payout = t.amount * pay.triMult; hit = true; note = `${pay.triKey} · $2 → ${pay.tri2.toFixed(2)}`; } }
      if (t.type === 'win' || t.type === 'place' || t.type === 'show' || t.type === 'exacta' || t.type === 'trifecta'){
        state.bankroll += payout;
        settled.push({ label: t.label, detail: t.detail, cost: t.cost, payout: Math.round(payout), hit, note });
        state.ledger.push({ race: idx+1, label: t.label, cost: t.cost, payout: Math.round(payout) });
      }
    }

    // advance multi-race tickets
    for (const m of state.multi){
      if (!m.alive) continue;
      const legIndex = idx - m.startRace;
      if (legIndex < 0 || legIndex >= m.legs.length) continue;
      if (!m.legs[legIndex].includes(pay.winPP)){
        m.alive = false;
        settled.push({ label: m.type.toUpperCase(), detail: m.detail || m.legs.map(s=>s.join('/')).join(' › '), cost: m.cost, payout: 0, hit: false, note: `Leg ${legIndex+1}: #${pay.winPP} beat you` });
        state.ledger.push({ race: idx+1, label: E.TYPES[m.type].label, cost: m.cost, payout: 0 });
      } else if (legIndex === m.legs.length - 1){
        // all legs hit — pay from the product of each leg winner's win prob
        const legProbs = [];
        for (let L = 0; L < m.legs.length; L++){
          const rr = card.races[m.startRace + L];
          const wi = rr.result.order[0];
          legProbs.push(rr.probs.win[wi]);
        }
        const mult = E.multiMult(m.type, legProbs, m.amount);
        const payout = m.amount * mult; m.alive = false;
        state.bankroll += payout;
        settled.push({ label: E.TYPES[m.type].label, detail: `all ${m.legs.length} legs!`, cost: m.cost, payout: Math.round(payout), hit: true, note: `$${m.amount} → ${(mult*m.amount).toFixed(0)}` });
        state.ledger.push({ race: idx+1, label: E.TYPES[m.type].label, cost: m.cost, payout: Math.round(payout) });
      } else {
        settled.push({ label: E.TYPES[m.type].label, detail: m.detail, cost: 0, payout: 0, hit: true, alive: true, note: `Leg ${legIndex+1} ✓ — advances` });
      }
    }

    // beaten lengths
    const lead = race.result.dist[race.result.order[0]];
    const margins = {};
    race.result.order.forEach((hi, k) => { margins[race.horses[hi].pp] = k===0 ? 0 : +(((lead - race.result.dist[hi]) / (lead*0.015)).toFixed(1)); });

    // advance
    state.raceIdx = idx + 1;
    let finishedNow = false;
    if (state.raceIdx >= card.races.length){
      state.finished = true;
      state.score = Math.round(state.bankroll);
      finishedNow = true;
    }

    // persist (finalize rolls the score into the lifetime total atomically)
    if (finishedNow) db.finalize(play.id, req.session.userId, JSON.stringify(state), state.score);
    else db.setState(play.id, JSON.stringify(state));

    const result = {
      orderPP: pay.orderPP,
      ppOrder: race.horses.map(h => h.pp),              // index → pp for the timeline
      timeline: race.result.timeline,                   // [tick][horseIndex] = distance
      margins,
      surf: race.surf
    };
    res.json({
      result, payoffs: {
        win2: round2(pay.win2), winPP: pay.winPP,
        pl2: pay.pl2, sh2: pay.sh2, placePPs: pay.placePPs, showPPs: pay.showPPs,
        exKey: pay.exKey, ex2: round2(pay.ex2), triKey: pay.triKey, tri2: round2(pay.tri2),
        orderPP: pay.orderPP
      },
      settled, bankroll: Math.round(state.bankroll), raceIdx: state.raceIdx,
      finished: state.finished, score: state.score,
      horses: race.horses.map(h => ({ pp:h.pp, name:h.name, color:h.color, jockey:h.jockey }))
    });
  });

  // leaderboard + personal standing
  r.get('/leaderboard', (req, res) => {
    const day = racingDay();
    res.json({
      allTime: db.leaderboardAllTime(50),
      today: db.leaderboardDay(day, 50),
      myRank: db.myRank(req.session.userId),
      players: db.userCount()
    });
  });

  return r;
}
function ppOf(t){ const m = /#(\d+)/.exec(t.label); return m ? Number(m[1]) : -1; }
function round2(x){ return Math.round(x*100)/100; }

module.exports = { router, racingDay };
