# Post Parade Daily — furlongbets

A free, play-money horse-racing handicapping contest. Players create an account,
play **one randomly generated card per day** (eight races), place real pari-mutuel
bets with **no takeout**, and their end-of-card chip total is banked into an
**all-time leaderboard**. Everything that touches money, odds, and results is
computed on the **server**, so scores can't be faked from the browser.

- No real wagering, no cash, no payments — chips only.
- Fresh random card per player each day; the finishing order is pre-rolled on the
  server from a secret seed and never sent to the client until a race is run.
- Secure accounts: bcrypt-hashed passwords, httpOnly/SameSite session cookies,
  login rate-limiting, CSRF protection, Helmet security headers, parameterized SQL.

---

## What's in the box

```
src/
  server.js   Express app: security middleware, sessions, routes, static hosting
  db.js       SQLite schema + data access (users, daily plays, leaderboard)
  engine.js   The race engine — deterministic sim, Monte-Carlo odds, NO-takeout pari-mutuel
  auth.js     signup / login / logout / me  (bcrypt + sessions + CSRF + rate limit)
  game.js     today's card, place bet, run race (server settles), leaderboard
public/
  index.html  app shell
  styles.css  the dark racebook theme
  app.js      the client — renders what the server returns, animates the races
Dockerfile, render.yaml, .env.example   deploy helpers
```

Requires **Node 18+**. The database is a single SQLite file (zero config); it can
be moved to Postgres later if you ever need to.

---

## Run it locally

```bash
npm install
npm start
# open http://localhost:3000
```

In development it runs with insecure default secrets (fine for your machine).

---

## Deploy so people can go to furlongbets.com and play

You need three things: a host that runs the Node app, a persistent disk for the
database, and your domain pointed at it with HTTPS. Pick **one** path below.

### Option A — Render (easiest, recommended)

1. Put this folder in a GitHub repo (`git init && git add . && git commit && git push`).
2. On [render.com](https://render.com): **New + → Blueprint**, pick the repo. It reads
   `render.yaml` and creates the web service, a 1 GB persistent disk at `/data`, and
   generates `SESSION_SECRET` + `SERVER_SALT` for you.
3. When it's live you'll get a `*.onrender.com` URL — open it and confirm you can sign
   up and play.
4. **Custom domain:** in the service's **Settings → Custom Domains**, add
   `furlongbets.com` (and `www.furlongbets.com`). Render shows you the DNS records to
   create. At your domain registrar / DNS provider, add them (an `ALIAS`/`CNAME` for the
   apex or the `A` record Render gives you). HTTPS is issued automatically.

> Render's free tier has **no persistent disk** and sleeps when idle, which would wipe
> the SQLite database. Use the **Starter** plan (or attach a disk) so player data sticks.

### Option B — Railway / Fly.io / any Docker host

A `Dockerfile` is included.

- **Railway:** New Project → Deploy from repo. Add a **Volume** mounted at `/data`, set
  `DB_PATH=/data/furlongbets.db`, `NODE_ENV=production`, `TRUST_PROXY=1`,
  `SESSION_SECRET` and `SERVER_SALT` (each `openssl rand -hex 32`). Add your domain under
  the service's Networking/Domains and point DNS as Railway instructs.
- **Fly.io:** `fly launch` (keep the Dockerfile), `fly volumes create data`, mount it at
  `/data`, set the same env vars with `fly secrets set ...`, then `fly certs add
  furlongbets.com` and add the DNS records it prints.

### Option C — Your own VPS (full control)

```bash
# on an Ubuntu/Debian box, as a non-root user
sudo apt update && sudo apt install -y nodejs npm   # or use nvm for a newer Node
git clone <your repo> furlongbets && cd furlongbets
npm install --omit=dev
cp .env.example .env            # then edit .env (see below)

# keep it running with pm2
sudo npm i -g pm2
pm2 start src/server.js --name post-parade
pm2 save && pm2 startup
```

Put **Caddy** in front for automatic HTTPS (simplest):

```
# /etc/caddy/Caddyfile
furlongbets.com, www.furlongbets.com {
    reverse_proxy localhost:3000
}
```

`sudo systemctl reload caddy`, point your domain's DNS **A record** at the server's IP,
and you're live with a valid certificate. (Nginx + certbot works too — just
`proxy_pass http://localhost:3000;` and keep `TRUST_PROXY=1`.)

---

## Configuration (environment variables)

| Variable | Required | What it does |
|---|---|---|
| `SESSION_SECRET` | **yes in prod** | Signs session cookies. Use `openssl rand -hex 32`. |
| `SERVER_SALT` | **yes in prod** | Secret mixed into each player's daily card seed. Keep it stable — changing it reshuffles everyone's in-progress card. `openssl rand -hex 32`. |
| `DB_PATH` | recommended | SQLite file location. Put it on a **persistent disk**. Default `./data/furlongbets.db`. |
| `DAY_TZ` | optional | Timezone for the "one card per day" reset and daily board. Default `America/New_York`. |
| `TRUST_PROXY` | behind a proxy | Set `1` so secure cookies work over HTTPS behind Render/Railway/Nginx/Caddy/Cloudflare. |
| `PORT` | optional | Defaults to 3000; most hosts set it for you. |

The app **refuses to boot in production** if `SESSION_SECRET` or `SERVER_SALT` are
missing or still contain `change-me` — that's on purpose.

---

## How a day works

- A player's card for the day is created the first time they open it and is tied to
  `sha256(userId : date : SERVER_SALT)`. Reloading resumes the same card — they can't
  re-roll for a better draw.
- Each day starts every player at **1,000 chips**. They play the eight races in order,
  placing Win/Place/Show, Exacta/Trifecta (straight, keyed, spread, or boxed), and
  multi-race Daily Double / Pick 3 / Pick 4 bets.
- Pools pay out with **no takeout**. When the last race is settled, the final chip total
  is the day's score and is added to the player's all-time total.
- The day rolls over at midnight in `DAY_TZ`; a new card unlocks then.

## Fairness & anti-cheat notes

- The seed, the finishing order, the pools and probabilities live only on the server.
  The browser only ever receives the horses + current odds, and a race's result only
  after it POSTs "run". There is nothing in the page to inspect that reveals winners.
- Bet legality and cost are re-validated server-side on every bet; the client's preview
  is only cosmetic.
- Because each player gets their own random card, totals reward consistency over a lucky
  single draw — but they are **not** a same-card head-to-head. If you later want a pure
  skill contest, switch to a shared daily seed (drop `userId` from the seed) so everyone
  plays the identical card; the rest of the code is unchanged.

## Backups

The whole game is one SQLite file (`DB_PATH`) plus `sessions.sqlite` next to it. Back up
the data directory on a schedule (e.g. `cp`/`litestream`/your host's disk snapshots).

## Operating it

- **Reset the leaderboard / wipe accounts:** stop the app, delete the DB file, restart.
- **Change daily starting chips, number of races, or pool sizes:** `src/engine.js`
  (`START_BANKROLL`, `NRACES`, `POOLBASE`). Takeout is already `0` in `TK`.
- **Moderation:** usernames are the only user-entered text shown to others and are
  restricted to `[a-zA-Z0-9_]`, 3–20 chars.

---

*Play money only. Post Parade Daily is a game of simulated racing for entertainment and
bragging rights — it does not accept, hold, or pay out money of any kind.*
