import { CONFIG } from './config.js';

/* ═════════════════════════ Konstanten ═════════════════════════ */
const AVATARS = ['😀','😎','🤓','🥳','😜','🤠','🤖','😺','🤡','🥸','😇','🤩','😏','🙃','🤪','😴',
  '🤯','🥶','🥵','😈','👽','🎃','🐵','🐶','🦊','🐼','🐸','🐷','🐯','🦁','🐨','🐙','🦄','🐲',
  '🐔','🐧','🦉','🐳','🐰','🐻'];

const EPITAPHS = {
  dup: ['Wählte die {n}. Leider nicht allein.', 'Die {n} war schon vergeben.', 'Zu viel Teamgeist bei der {n}.',
    'Große Geister denken gleich – an die {n}.', 'Starb an einer Überdosis {n}.', 'Hier ruht ein Fan der {n}.',
    'Die {n} war eine Falle.', 'Dachte, die {n} sei ein Geheimtipp.'],
  none: ['Hat zu lange überlegt.', 'Denkt immer noch nach.', 'Kam, sah – und wählte nichts.',
    'Der Countdown war schneller.', 'Wollte nur kurz Kaffee holen.'],
};

const BOT_NAMES = ['Bert','Rosi','Kalle','Uschi','Paule','Gerda','Horst','Mia','Jupp','Lotte','Ede','Frieda',
  'Otto','Hilde','Fritz','Erna','Bodo','Trude','Willi','Elfi','Gustl','Resi','Heinz','Moni','Kurt','Inge',
  'Rudi','Gabi','Toni','Lilo'];

const qs = new URLSearchParams(location.search);
const ROOM = (qs.get('room') || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'main';
const MAX = CONFIG.maxPlayers ?? 30;
const READY_MS = (CONFIG.readySeconds ?? 3) * 1000;
const PICK_MS = (CONFIG.pickSeconds ?? 10) * 1000;
const REVEAL_MS = (CONFIG.revealSeconds ?? 7) * 1000;
const GRACE_MS = 700; // Puffer für Netzwerk-Latenz nach Ablauf des Countdowns

/* ═════════════════════════ Helfer ═════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function safeStorage(kind) {
  try { const s = window[kind]; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch { return null; }
}

function setPath(obj, path, val) {
  const parts = path.split('/');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (val === null || val === undefined) delete o[last]; else o[last] = val;
}

/* ═════════════════════════ Datenschicht ═════════════════════════
   Ein Store hat: mode, now(), subscribe(cb), update({ 'pfad/zu/wert': wert|null }), presence(pid)
   – Firebase Realtime Database (echtes Multiplayer)
   – Lokaler Demo-Store (localStorage + storage-Event → mehrere Tabs im selben Browser)  */

async function createStore() {
  const fb = CONFIG.firebase || {};
  if (fb.apiKey && fb.databaseURL) return firebaseStore();
  return localStore();
}

async function firebaseStore() {
  const v = CONFIG.firebaseSdkVersion || '10.12.2';
  const [{ initializeApp }, fdb, fauth] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${v}/firebase-database.js`),
    import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`),
  ]);
  const app = initializeApp(CONFIG.firebase);
  const db = fdb.getDatabase(app);

  // Anonyme Anmeldung (wie Farbspur): die Firebase-UID ist die Spieler-ID.
  // Die Regeln erlauben jedem nur, den eigenen Spieler / die eigene Wahl zu schreiben.
  const auth = fauth.getAuth(app);
  const uid = await new Promise((resolve, reject) => {
    const off = fauth.onAuthStateChanged(auth, user => { if (user) { off(); resolve(user.uid); } });
    fauth.signInAnonymously(auth).catch(err => { off(); reject(err); });
  });
  const base = `luckyshot/${ROOM}`;
  let offset = 0;
  let presencePid = null;
  fdb.onValue(fdb.ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  const setPresence = () => {
    if (!presencePid) return;
    const r = fdb.ref(db, `${base}/presence/${presencePid}`);
    fdb.onDisconnect(r).remove();
    fdb.set(r, true);
  };
  fdb.onValue(fdb.ref(db, '.info/connected'), s => { if (s.val() === true) setPresence(); });
  return {
    mode: 'firebase',
    uid,
    now: () => Date.now() + offset,
    /** Spielleiter-Code serverseitig prüfen: die Regel lässt den Eintrag nur zu,
        wenn er exakt config/luckyshotHostKey entspricht. Sonst PERMISSION_DENIED. */
    claimHost(code) { return fdb.set(fdb.ref(db, `luckyshotHostClaims/${uid}`), code); },
    subscribe(cb) {
      fdb.onValue(fdb.ref(db, base), s => cb(s.val() || {}),
        err => showBanner(`Verbindung zur Datenbank fehlgeschlagen: ${esc(err.message)}`, 'error'));
    },
    update(u) {
      const o = {};
      for (const k in u) o[`${base}/${k}`] = u[k] === undefined ? null : u[k];
      return fdb.update(fdb.ref(db), o);
    },
    presence(pid) { presencePid = pid; setPresence(); },
  };
}

function localStore() {
  const ls = safeStorage('localStorage');
  const key = `luckyshot-demo:${ROOM}`;
  let mem = '{}';
  const read = () => { try { return JSON.parse((ls ? ls.getItem(key) : mem) || '{}'); } catch { return {}; } };
  const write = s => { const j = JSON.stringify(s); if (ls) ls.setItem(key, j); else mem = j; };
  const subs = [];
  const emit = () => { const s = read(); subs.forEach(cb => cb(s)); };
  window.addEventListener('storage', e => { if (e.key === key) emit(); });
  return {
    mode: 'local',
    uid: null,
    now: () => Date.now(),
    claimHost(code) {
      if (code.toLowerCase() !== String(CONFIG.hostCode).toLowerCase()) return Promise.reject(new Error('PERMISSION_DENIED'));
      return Promise.resolve();
    },
    subscribe(cb) { subs.push(cb); cb(read()); },
    update(u) {
      const s = read();
      for (const k in u) setPath(s, k, u[k]);
      write(s);
      queueMicrotask(emit);
      return Promise.resolve();
    },
    presence() {},
  };
}

/* ═════════════════════════ Zustand ═════════════════════════ */
let store;
let game = {};
let loaded = false;
let myPid;
const ui = {
  avatar: null, hostOpen: false, confirmAbort: false, sub: null, lastView: null,
  confettiFor: null, cache: {}, err: '',
};
let resolvedRound = -1;
let advancedReveal = -1;

const meta = () => game.meta || { status: 'lobby', round: 0 };
const players = () => game.players || {};
const playerList = () => Object.entries(players()).map(([id, p]) => ({ id, ...p }))
  .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
const me = () => players()[myPid];
const isHost = () => !!myPid && meta().hostId === myPid && !!me();
const curPicks = () => (game.picks && game.picks[meta().round]) || {};
const roster = () => (meta().roster || []).filter(id => players()[id]);
const presence = () => game.presence || {};
const botsAllowed = () => store.mode === 'local' || qs.has('bots');

/* ═════════════════════════ Rendering ═════════════════════════ */
function setHTML(el, html) {
  if (!el) return;
  if (ui.cache[el.id] === html) return;
  ui.cache[el.id] = html;
  el.innerHTML = html;
}

function computeView() {
  if (!loaded) return 'loading';
  return me() ? 'game' : 'join';
}

function render() {
  const view = computeView();
  const app = $('#app');
  if (view !== ui.lastView) {
    ui.lastView = view;
    ui.cache = {};
    if (view === 'join') app.innerHTML = joinSkeleton();
    else if (view === 'game') app.innerHTML = `
      <div id="hostbar"></div>
      <section class="stage-wrap" id="stageWrap">
        <div class="stage" id="stage"></div>
        <aside class="panel" id="panel"></aside>
      </section>
      <section id="graveyard"></section>`;
    if (view === 'join') prefillJoin();
  }
  renderTop();
  if (view === 'join') renderJoin();
  if (view === 'game') renderGame();
}

function renderTop() {
  const p = me();
  let h = `<span class="chip room" title="Raum">Raum: ${esc(ROOM)}</span>`;
  if (p) {
    h += isHost()
      ? `<span class="chip host">👑 Spielleiter</span>`
      : `<button class="chip link" data-action="toggleHost">Spielleiter?</button>`;
    h += `<span class="chip me"><span class="e">${p.avatar}</span>${esc(p.name)}</span>`;
  }
  setHTML($('#topRight'), h);
}

function showBanner(html, kind = 'info') {
  $('#banner').innerHTML = html ? `<div class="banner ${kind}"><div class="banner-in">${html}</div></div>` : '';
}

/* ───────────── Beitreten ───────────── */
function joinSkeleton() {
  return `
  <section class="join">
    <div class="hero">
      <div class="hero-badge">Partyspiel · bis ${MAX} Spieler</div>
      <h1>Lucky<span>Shot</span></h1>
      <p>Wähle eine Zahl, die sonst <b>niemand</b> wählt. Klingt einfach? 😏</p>
    </div>
    <div class="jcard">
      <div id="joinStatus"></div>
      <label class="field">
        <span class="lbl">Dein Name</span>
        <input id="nameIn" maxlength="16" autocomplete="off" placeholder="z. B. Kai" enterkeyhint="go">
      </label>
      <div class="field">
        <span class="lbl">Dein Avatar</span>
        <div id="avatarGrid" class="avgrid" role="radiogroup" aria-label="Avatar wählen"></div>
      </div>
      <details class="hostfold" id="hostFold">
        <summary>Ich bin Spielleiter</summary>
        <label class="field">
          <span class="lbl">Spielleiter-Code</span>
          <input id="codeIn" type="password" autocomplete="off" placeholder="Code eingeben">
        </label>
      </details>
      <p class="err" id="joinErr" role="alert"></p>
      <button class="btn primary big block" data-action="join" id="joinBtn">Beitreten</button>
    </div>
    ${rulesHTML()}
  </section>`;
}

function rulesHTML() {
  return `
  <details class="rules">
    <summary>So geht's</summary>
    <ol>
      <li>Jede Runde wählst du in <b>${CONFIG.pickSeconds ?? 10} Sekunden</b> eine Zahl von 1 bis zur Anzahl der Mitspieler.</li>
      <li>Wählen zwei oder mehr Spieler <b>dieselbe Zahl</b>, fliegen sie alle raus – ab auf den Friedhof. 🪦</li>
      <li>Wer keine Karte wählt, fliegt ebenfalls raus.</li>
      <li>Haben in einer Runde <b>alle dieselbe Zahl</b>, gewinnen alle gemeinsam. 🎉</li>
      <li>Bleibt nur noch einer übrig, gewinnt der <b>Last Man Standing</b>. 🏆</li>
      <li>Fliegen alle gleichzeitig raus, verliert die ganze Gruppe. 💀</li>
    </ol>
  </details>`;
}

function prefillJoin() {
  const prof = (() => { try { return JSON.parse(safeStorage('localStorage')?.getItem('luckyshot:profile') || '{}'); } catch { return {}; } })();
  if (prof.name && store.mode !== 'local') $('#nameIn').value = prof.name;
  if (prof.avatar && store.mode !== 'local') ui.avatar = prof.avatar;
  $('#nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
}

function renderJoin() {
  const m = meta();
  const list = playerList();
  const taken = new Set(list.map(p => p.avatar));
  if (ui.avatar && taken.has(ui.avatar)) ui.avatar = null;
  const running = m.status !== 'lobby';
  const full = list.length >= MAX;

  let status;
  if (running) {
    status = `<div class="note warn">🎲 Gerade läuft ein Spiel (Runde ${m.round || 1}). Sobald der Spielleiter ein neues Spiel startet, kannst du beitreten.</div>`;
  } else if (full) {
    status = `<div class="note warn">Die Lobby ist voll (${MAX}/${MAX}).</div>`;
  } else {
    status = `<div class="lobbyline"><span><b>${list.length}</b> / ${MAX} Spieler in der Lobby</span>
      <span class="minis">${list.slice(0, 14).map(p => `<span title="${esc(p.name)}">${p.avatar}</span>`).join('')}${list.length > 14 ? `<span class="more">+${list.length - 14}</span>` : ''}</span></div>`;
  }
  setHTML($('#joinStatus'), status);
  setHTML($('#avatarGrid'), AVATARS.map(a => {
    const t = taken.has(a);
    return `<button type="button" class="avopt ${ui.avatar === a ? 'sel' : ''}" data-avatar="${a}" ${t ? 'disabled title="schon vergeben"' : ''} role="radio" aria-checked="${ui.avatar === a}">${a}</button>`;
  }).join(''));
  const btn = $('#joinBtn');
  if (btn) btn.disabled = running || full;
  $('#joinErr').textContent = ui.err;
}

async function join() {
  const name = ($('#nameIn')?.value || '').trim().replace(/\s+/g, ' ');
  const code = ($('#codeIn')?.value || '').trim();
  const m = meta();
  const list = playerList();
  const fail = msg => { ui.err = msg; renderJoin(); };
  if (m.status !== 'lobby') return fail('Das Spiel läuft bereits.');
  if (list.length >= MAX) return fail('Die Lobby ist voll.');
  if (!name) return fail('Bitte gib einen Namen ein.');
  if (list.some(p => p.name.toLowerCase() === name.toLowerCase())) return fail('Dieser Name ist schon vergeben.');
  if (!ui.avatar) return fail('Bitte wähle einen Avatar.');
  if (list.some(p => p.avatar === ui.avatar)) return fail('Dieser Avatar ist schon vergeben.');
  const hostClaim = code !== '';
  const btn = $('#joinBtn');
  if (btn) btn.disabled = true;
  try {
    // 1) Spielleiter-Code zuerst vom Server prüfen lassen
    if (hostClaim) {
      try { await store.claimHost(code); } catch { return fail('Der Spielleiter-Code ist falsch.'); }
    }
    ui.err = '';
    try { safeStorage('localStorage')?.setItem('luckyshot:profile', JSON.stringify({ name, avatar: ui.avatar })); } catch {}
    // 2) eigenen Spieler anlegen
    await store.update({ [`players/${myPid}`]: { name, avatar: ui.avatar, joinedAt: store.now(), alive: true } });
    // 3) als Spielleiter eintragen (nur mit gültigem Claim erlaubt)
    if (hostClaim) {
      const u = { 'meta/hostId': myPid };
      if (!game.meta || !game.meta.status) { u['meta/status'] = 'lobby'; u['meta/round'] = 0; }
      await store.update(u);
    }
    store.presence(myPid);
  } catch (e) {
    console.error(e);
    fail('Beitreten hat nicht geklappt. Läuft gerade ein Spiel? Bitte Seite neu laden und erneut versuchen.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ───────────── Spielansicht ───────────── */
function renderGame() {
  const m = meta();
  const wrap = $('#stageWrap');
  const inRoster = roster().includes(myPid);
  wrap.className = `stage-wrap s-${m.status} ${m.status === 'picking' && inRoster ? 'me-picking' : ''}`;
  setHTML($('#hostbar'), hostbarHTML());
  setHTML($('#stage'), m.status === 'finished' ? podiumHTML() : arenaHTML());
  setHTML($('#panel'), panelHTML());
  setHTML($('#graveyard'), graveyardHTML());
  if (m.status === 'finished' && (m.winners || []).length && ui.confettiFor !== m.finishedAt) {
    ui.confettiFor = m.finishedAt;
    confetti(7000);
  }
}

function hostbarHTML() {
  const m = meta();
  if (!isHost()) {
    if (!ui.hostOpen) return '';
    return `<div class="hostbar"><div class="hb-in">
      <span class="hb-title">Spielleiter-Login</span>
      <input id="claimCode" type="password" placeholder="Spielleiter-Code" autocomplete="off">
      <button class="btn primary sm" data-action="claimHost">Bestätigen</button>
      <button class="btn ghost sm" data-action="toggleHost">Abbrechen</button>
      <span class="err" id="claimErr">${esc(ui.claimErr || '')}</span>
    </div></div>`;
  }
  const n = playerList().length;
  let h = `<div class="hostbar is-host"><div class="hb-in"><span class="hb-title">👑 Spielleiter</span>`;
  if (m.status === 'lobby') {
    h += `<button class="btn primary" data-action="start" ${n < 2 ? 'disabled' : ''}>▶ Spiel starten (${plural(n, 'Spieler', 'Spieler')})</button>`;
    if (botsAllowed()) h += `<button class="btn tertiary sm" data-action="addBot" ${n >= MAX ? 'disabled' : ''}>+ Testbot</button>
      <button class="btn tertiary sm" data-action="addBot5" ${n >= MAX ? 'disabled' : ''}>+ 5 Bots</button>`;
    if (n < 2) h += `<span class="hint">Mindestens 2 Spieler nötig.</span>`;
  } else if (m.status === 'finished') {
    h += `<button class="btn primary" data-action="newGame">↻ Neues Spiel</button>`;
  } else {
    h += `<span class="hint">Runde ${m.round} läuft automatisch.</span>`;
    h += ui.confirmAbort
      ? `<button class="btn danger sm" data-action="abort">Wirklich abbrechen?</button><button class="btn ghost sm" data-action="cancelAbort">Nein</button>`
      : `<button class="btn ghost sm" data-action="askAbort">Spiel abbrechen</button>`;
  }
  h += `</div></div>`;
  return h;
}

function arenaHTML() {
  const m = meta();
  const ps = players();
  const st = m.status;
  const ids = st === 'lobby' ? playerList().map(p => p.id) : roster();
  const n = ids.length;
  const picks = curPicks();
  const range = m.aliveCount || n;
  const reveal = st === 'reveal';
  const elim = new Set(reveal ? (m.eliminated || []) : []);
  const counts = {};
  if (reveal) ids.forEach(id => { const v = picks[id]; if (v) counts[v] = (counts[v] || 0) + 1; });
  const now = store.now();
  const pres = presence();
  const showPresence = store.mode === 'firebase';

  let seats = '';
  ids.forEach((id, i) => {
    const p = ps[id];
    const a = -90 + (i * 360) / Math.max(n, 1);
    const fresh = st === 'lobby' && now - (p.joinedAt || 0) < 2000;
    const cls = [
      id === myPid ? 'me' : '',
      elim.has(id) ? 'doomed' : '',
      reveal && m.outcome === 'allSame' ? 'champ' : '',
      fresh ? 'pop' : '',
      showPresence && !p.bot && !pres[id] ? 'offline' : '',
    ].join(' ');
    const crown = m.hostId === id ? '<span class="crown" title="Spielleiter">👑</span>' : '';
    seats += `<div class="seat" style="--a:${a}deg;--r:var(--ra)"><div class="av ${cls}" title="${esc(p.name)}">
      <span class="emo">${p.avatar}</span>${crown}<span class="nm">${esc(p.name)}</span></div></div>`;
    if (st === 'picking' || reveal) {
      const v = picks[id];
      let c = 'card';
      let front = v ?? '–';
      let back = '';
      if (reveal) {
        c += ' flipped';
        if (!v) c += ' none'; else if (m.outcome === 'allSame') c += ' same'; else if (counts[v] > 1) c += ' dup'; else c += ' ok';
        if (elim.has(id)) c += ' doomed';
      } else {
        if (v) c += ' ready';
        if (id === myPid && v) back = v; else back = v ? '✓' : '?';
      }
      seats += `<div class="seat" style="--a:${a}deg;--r:var(--rc)"><div class="${c}" style="--i:${i}">
        <div class="inner"><div class="face back">${back}</div><div class="face front">${front}</div></div></div></div>`;
    }
  });

  let center = '';
  if (st === 'lobby') {
    center = `<div class="c-big">${n}<small>/${MAX}</small></div><div class="c-sub">${n === 1 ? 'Spieler' : 'Spieler'} in der Lobby</div>
      <div class="c-wait">Warte auf Start <span class="dots"><i></i><i></i><i></i></span></div>`;
  } else if (st === 'picking') {
    const sub = ui.sub || 'go';
    center = `<div class="ring ${sub}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="44"/>
      <circle class="prog" data-ring cx="50" cy="50" r="44"/></svg>
      <div class="ring-txt"><div class="c-round">Runde ${m.round}</div><div class="c-secs" data-secs>${Math.ceil(PICK_MS / 1000)}</div>
      <div class="c-sub">${sub === 'ready' ? 'Bereit?' : sub === 'over' ? 'Zeit um!' : `Zahl 1–${range}`}</div></div></div>`;
  } else if (reveal) {
    const k = (m.eliminated || []).length;
    let out;
    if (m.outcome === 'allSame') out = `<b class="good">Alle gleich!</b><span>Alle hatten die ${m.winPick}</span>`;
    else if (m.outcome === 'groupLost') out = `<b class="bad">Alle raus!</b><span>Die Gruppe verliert</span>`;
    else if (m.outcome === 'winner') out = `<b class="good">Last Man Standing!</b><span>${esc(ps[(m.winners || [])[0]]?.name || '')}</span>`;
    else if (k === 0) out = `<b class="good">Alle sicher!</b><span>Keine doppelten Zahlen</span>`;
    else out = `<b class="bad">${k} raus!</b><span>Noch ${n - k} im Spiel</span>`;
    center = `<div class="c-round">Runde ${m.round}</div><div class="c-flip">Aufgedeckt!</div><div class="c-out">${out}</div>`;
  }

  return `<div class="arena-wrap"><div class="arena ${n > 16 ? 'many' : ''}" style="--n:${Math.max(n, 1)}">
    <div class="center">${center}</div>${seats}</div></div>`;
}

function panelHTML() {
  const m = meta();
  const p = me();
  const st = m.status;
  const inRoster = roster().includes(myPid);
  const n = playerList().length;
  const range = m.aliveCount || roster().length;

  if (st === 'lobby') {
    return `<div class="pcard-box">
      <h2>Du bist dabei! <span class="e">${p.avatar}</span></h2>
      <p>${isHost() ? 'Starte das Spiel, sobald alle Spieler beigetreten sind.' : 'Warte, bis der Spielleiter das Spiel startet.'}</p>
      <div class="stat"><b>${n}</b> / ${MAX} Spieler</div>
      ${!meta().hostId ? `<div class="note warn">Noch kein Spielleiter angemeldet. Oben auf „Spielleiter?“ klicken und Code eingeben.</div>` : ''}
      ${hostListHTML()}
      <button class="btn ghost sm" data-action="leave">Lobby verlassen</button>
      ${rulesHTML()}
    </div>`;
  }

  if (st === 'picking') {
    if (!inRoster) return deadPanel();
    const sub = ui.sub || 'go';
    const mine = curPicks()[myPid];
    const enabled = sub === 'go';
    let head;
    if (sub === 'ready') head = `<h2>Runde ${m.round} – gleich geht's los!</h2><p>Gleich wählst du eine Zahl von <b>1 bis ${range}</b>.</p>`;
    else if (sub === 'over') head = `<h2>Zeit um! ⏰</h2><p>${mine ? `Deine Wahl: <b class="big-num">${mine}</b> – gleich wird aufgedeckt …` : 'Du hast keine Karte gewählt …'}</p>`;
    else head = `<h2>Wähle eine Zahl von 1 bis ${range}</h2><p>${mine ? `Deine Wahl: <b class="big-num">${mine}</b> · du kannst noch wechseln` : 'Tippe auf eine Karte. Nur einzigartige Zahlen überleben!'}</p>`;
    let cards = '';
    for (let i = 1; i <= range; i++) {
      cards += `<button class="pick ${mine === i ? 'sel' : ''}" data-pick="${i}" ${enabled ? '' : 'disabled'} aria-pressed="${mine === i}"><span>${i}</span></button>`;
    }
    return `<div class="pcard-box">${head}
      <div class="bar ${sub}"><i data-bar></i><span data-secs></span></div>
      <div class="pickgrid ${range > 16 ? 'dense' : ''}">${cards}</div></div>`;
  }

  if (st === 'reveal') {
    if (!inRoster) return deadPanel();
    const mine = curPicks()[myPid];
    const out = (m.eliminated || []).includes(myPid);
    let msg;
    if (m.outcome === 'allSame') msg = `<h2 class="good">Alle gleich – ihr habt gewonnen! 🎉</h2>`;
    else if (out) msg = `<h2 class="bad">Raus! 🪦</h2><p>${mine ? `Die <b>${mine}</b> hatte noch jemand.` : 'Du hast keine Karte gewählt.'} Du wanderst auf den Friedhof.</p>`;
    else if (m.outcome === 'winner') msg = `<h2 class="good">Du bist der Last Man Standing! 🏆</h2>`;
    else msg = `<h2 class="good">Überlebt! 🎉</h2><p>Deine <b>${mine}</b> war einzigartig. Weiter geht's!</p>`;
    return `<div class="pcard-box reveal-msg">${msg}</div>`;
  }

  if (st === 'finished') {
    const won = (m.winners || []).includes(myPid);
    let h;
    if (m.outcome === 'groupLost') h = `<h2 class="bad">Niemand hat gewonnen 💀</h2><p>In Runde ${m.round} sind alle gleichzeitig rausgeflogen.</p>`;
    else if (won) h = `<h2 class="good">Du hast gewonnen! 🏆</h2><p>Nach ${plural(m.round, 'Runde', 'Runden')}.</p>`;
    else h = `<h2>Spiel vorbei</h2><p>Du bist in Runde ${p.elimRound || '?'} ausgeschieden. Nächstes Mal! 🍀</p>`;
    return `<div class="pcard-box">${h}${isHost() ? '' : '<p class="muted">Warte auf ein neues Spiel vom Spielleiter …</p>'}</div>`;
  }
  return '';
}

function deadPanel() {
  const p = me();
  const m = meta();
  return `<div class="pcard-box dead">
    <h2>🪦 Du liegst auf dem Friedhof</h2>
    <p>${p.elimRound ? `Ausgeschieden in Runde ${p.elimRound}.` : ''} Schau zu, wie die anderen sich schlagen – noch ${plural(roster().length, 'Spieler', 'Spieler')} im Rennen.</p>
    ${m.status === 'picking' ? `<div class="bar ${ui.sub || 'go'}"><i data-bar></i><span data-secs></span></div>` : ''}
  </div>`;
}

function hostListHTML() {
  if (!isHost()) return '';
  const pres = presence();
  const rows = playerList().map(p => `<li>
    <span class="e">${p.avatar}</span><span class="n">${esc(p.name)}${p.bot ? ' <small>(Bot)</small>' : ''}${p.id === myPid ? ' <small>(du)</small>' : ''}</span>
    ${store.mode === 'firebase' && !p.bot ? `<span class="dot ${pres[p.id] ? 'on' : ''}" title="${pres[p.id] ? 'online' : 'offline'}"></span>` : ''}
    ${p.id !== myPid ? `<button class="x" data-kick="${p.id}" title="${esc(p.name)} entfernen" aria-label="${esc(p.name)} entfernen">✕</button>` : ''}
  </li>`).join('');
  return `<details class="plist" open><summary>Spieler verwalten</summary><ul>${rows}</ul>
    <p class="muted small">Einladungslink: <code>${esc(location.href.split('#')[0])}</code></p></details>`;
}

function graveyardHTML() {
  const m = meta();
  if (m.status === 'lobby') return '';
  const dead = playerList().filter(p => !p.alive && p.elimRound)
    .sort((a, b) => b.elimRound - a.elimRound || (a.joinedAt || 0) - (b.joinedAt || 0));
  const freshSet = new Set(m.status === 'reveal' ? (m.eliminated || []) : []);
  const tombs = dead.map((p, i) => {
    const list = EPITAPHS[p.elimReason] || EPITAPHS.dup;
    const ep = list[hash(p.id + ':' + p.elimRound) % list.length].replace('{n}', p.elimPick ?? '?');
    const tilt = (hash(p.id) % 7) - 3;
    return `<div class="tomb ${freshSet.has(p.id) ? 'fresh' : ''}" style="--tilt:${tilt}deg;--j:${i}">
      <div class="stone"><span class="rip">R.I.P.</span><span class="emo">${p.avatar}</span>
      <b>${esc(p.name)}</b><small>Runde ${p.elimRound}${p.elimPick ? ` · ${p.elimPick}` : ''}</small><em>${esc(ep)}</em></div>
      <div class="mound"></div></div>`;
  }).join('');
  return `<div class="yard">
    <div class="yard-head"><h2>🪦 Friedhof der Doppelten</h2><span class="moon" aria-hidden="true">🌕</span>
    <span class="bats" aria-hidden="true">🦇</span></div>
    ${dead.length ? `<div class="tombs">${tombs}</div>` : `<p class="empty">Noch ist der Friedhof leer … 🌱 <span>Das wird sich ändern.</span></p>`}
    <div class="grass"></div></div>`;
}

function podiumHTML() {
  const m = meta();
  const ps = players();
  const winners = (m.winners || []).filter(id => ps[id]).map(id => ({ id, ...ps[id] }));
  const dead = playerList().filter(p => !p.alive && p.elimRound);
  const rounds = [...new Set(dead.map(p => p.elimRound))].sort((a, b) => b - a);
  const second = rounds.length ? dead.filter(p => p.elimRound === rounds[0]) : [];
  const third = rounds.length > 1 ? dead.filter(p => p.elimRound === rounds[1]) : [];

  let title, sub;
  if (m.outcome === 'allSame') { title = `🎉 Alle gleich – ${plural(winners.length, 'Gewinner', 'Gewinner')}!`; sub = `Alle hatten in Runde ${m.round} die ${m.winPick}.`; }
  else if (m.outcome === 'winner') { title = `🏆 ${esc(winners[0]?.name || '')} gewinnt!`; sub = `Last Man Standing nach ${plural(m.round, 'Runde', 'Runden')}.`; }
  else { title = '💀 Niemand gewinnt'; sub = `In Runde ${m.round} sind alle gleichzeitig rausgeflogen – die Gruppe verliert.`; }

  const who = (list, max, cls = '') => {
    if (!list.length) return `<div class="who empty">${cls === 'w' ? '🤷' : ''}</div>`;
    const shown = list.slice(0, max);
    const sz = list.length > 4 ? 'xs' : list.length > 2 ? 'sm' : '';
    return `<div class="who ${sz}">${shown.map((p, i) => `<div class="pav ${cls}" style="--i:${i}"><span class="emo">${p.avatar}</span><span class="nm">${esc(p.name)}</span></div>`).join('')}
      ${list.length > max ? `<div class="pmore">+${list.length - max}</div>` : ''}</div>`;
  };

  return `<div class="finish ${m.outcome}">
    <h1>${title}</h1><p class="sub">${sub}</p>
    <div class="podium">
      <div class="step s2">${who(second, 6, m.outcome === 'groupLost' ? 'lost' : '')}<div class="block">2</div></div>
      <div class="step s1">${who(winners, 12, 'w')}<div class="block">1</div></div>
      <div class="step s3">${who(third, 6)}<div class="block">3</div></div>
    </div>
  </div>`;
}

/* ═════════════════════════ Countdown-Ticker ═════════════════════════ */
const RING_C = 2 * Math.PI * 44;
function tick() {
  const m = meta();
  if (loaded && m.status === 'picking' && m.startAt) {
    const now = store.now();
    const sub = now < m.startAt ? 'ready' : now < m.deadline ? 'go' : 'over';
    if (sub !== ui.sub) { ui.sub = sub; render(); }
    const total = m.deadline - m.startAt;
    const left = sub === 'ready' ? m.startAt - now : Math.max(0, m.deadline - now);
    const frac = sub === 'ready' ? 1 : left / total;
    const secs = String(Math.ceil(left / 1000));
    const urgent = sub === 'go' && left < 3000;
    $$('[data-secs]').forEach(e => { if (e.textContent !== secs) e.textContent = secs; });
    $$('[data-ring]').forEach(e => { e.style.strokeDasharray = RING_C; e.style.strokeDashoffset = RING_C * (1 - frac); });
    $$('[data-bar]').forEach(e => { e.style.width = (frac * 100).toFixed(2) + '%'; });
    $$('.ring, .bar').forEach(e => e.classList.toggle('urgent', urgent));
  } else if (ui.sub !== null && m.status !== 'picking') {
    ui.sub = null;
  }
  requestAnimationFrame(tick);
}

/* ═════════════════════════ Spielleiter-Logik ═════════════════════════
   Das Gerät des Spielleiters ist "Schiedsrichter": es startet Runden, wertet aus
   und schaltet weiter. Alle Zeiten basieren auf der Server-Zeit (Firebase-Offset). */
let hostBusy = false;
async function hostLoop() {
  if (!loaded || !isHost() || hostBusy) return;
  hostBusy = true;
  try {
    const m = meta();
    const now = store.now();
    if (m.status === 'picking') {
      await botPicks(m, now);
      if (now > m.deadline + GRACE_MS && resolvedRound !== m.round) await resolveRound();
    } else if (m.status === 'reveal' && now > (m.revealAt || 0) + REVEAL_MS && advancedReveal !== m.round) {
      advancedReveal = m.round;
      if (m.outcome === 'continue') await startRound();
      else await store.update({ 'meta/status': 'finished', 'meta/finishedAt': now });
    }
  } catch (e) { console.error(e); }
  finally { hostBusy = false; }
}

async function botPicks(m, now) {
  if (now < m.startAt || now > m.deadline) return;
  const ps = players();
  const picks = curPicks();
  const range = m.aliveCount || roster().length;
  const u = {};
  roster().forEach(id => {
    if (!ps[id].bot || picks[id]) return;
    const delay = 600 + (hash(id + ':' + m.round) % Math.max(1000, PICK_MS - 2500));
    if (now > m.startAt + delay) u[`picks/${m.round}/${id}`] = 1 + Math.floor(Math.random() * range);
  });
  if (Object.keys(u).length) await store.update(u);
}

async function startRound() {
  const alive = playerList().filter(p => p.alive).map(p => p.id);
  if (alive.length < 2) return;
  const round = (meta().round || 0) + 1;
  const t = store.now();
  ui.confirmAbort = false;
  await store.update({
    'meta/status': 'picking', 'meta/round': round, 'meta/roster': alive, 'meta/aliveCount': alive.length,
    'meta/startAt': t + READY_MS, 'meta/deadline': t + READY_MS + PICK_MS,
    'meta/eliminated': null, 'meta/outcome': null, 'meta/winners': null, 'meta/winPick': null, 'meta/revealAt': null,
    [`picks/${round}`]: null,
  });
}

/** Kernregeln einer Runde – exportiert für Tests. */
export function evaluateRound(rosterIds, picks, range) {
  const valid = v => Number.isInteger(v) && v >= 1 && v <= range;
  const counts = {};
  rosterIds.forEach(id => { const v = picks[id]; if (valid(v)) counts[v] = (counts[v] || 0) + 1; });
  const allPicked = rosterIds.every(id => valid(picks[id]));
  const distinct = Object.keys(counts);
  if (rosterIds.length >= 2 && allPicked && distinct.length === 1) {
    return { outcome: 'allSame', winners: [...rosterIds], eliminated: [], reasons: {}, winPick: Number(distinct[0]) };
  }
  const eliminated = [];
  const reasons = {};
  rosterIds.forEach(id => {
    const v = picks[id];
    if (!valid(v)) { eliminated.push(id); reasons[id] = 'none'; }
    else if (counts[v] > 1) { eliminated.push(id); reasons[id] = 'dup'; }
  });
  const surv = rosterIds.filter(id => !reasons[id]);
  const outcome = surv.length === 1 ? 'winner' : surv.length === 0 ? 'groupLost' : 'continue';
  return { outcome, winners: outcome === 'winner' ? surv : [], eliminated, reasons, winPick: null };
}

async function resolveRound() {
  const m = meta();
  resolvedRound = m.round;
  const ids = roster();
  const picks = curPicks();
  const res = evaluateRound(ids, picks, m.aliveCount || ids.length);
  const u = {
    'meta/status': 'reveal', 'meta/revealAt': store.now(), 'meta/outcome': res.outcome,
    'meta/winners': res.winners.length ? res.winners : null,
    'meta/eliminated': res.eliminated.length ? res.eliminated : null,
    'meta/winPick': res.winPick,
  };
  res.eliminated.forEach(id => {
    const v = picks[id];
    u[`players/${id}/alive`] = false;
    u[`players/${id}/elimRound`] = m.round;
    u[`players/${id}/elimPick`] = Number.isInteger(v) ? v : null;
    u[`players/${id}/elimReason`] = res.reasons[id];
  });
  await store.update(u);
}

async function newGame() {
  const u = {
    'meta/status': 'lobby', 'meta/round': 0, 'meta/roster': null, 'meta/aliveCount': null, 'meta/startAt': null,
    'meta/deadline': null, 'meta/eliminated': null, 'meta/outcome': null, 'meta/winners': null, 'meta/winPick': null,
    'meta/revealAt': null, 'meta/finishedAt': null, picks: null,
  };
  playerList().forEach(p => {
    u[`players/${p.id}/alive`] = true;
    u[`players/${p.id}/elimRound`] = null;
    u[`players/${p.id}/elimPick`] = null;
    u[`players/${p.id}/elimReason`] = null;
  });
  ui.confirmAbort = false;
  resolvedRound = -1; advancedReveal = -1;
  await store.update(u);
}

async function addBots(k) {
  const list = playerList();
  const usedA = new Set(list.map(p => p.avatar));
  const usedN = new Set(list.map(p => p.name.toLowerCase()));
  const u = {};
  let t = store.now();
  for (let i = 0; i < k && list.length + i < MAX; i++) {
    const avatar = AVATARS.find(a => !usedA.has(a));
    let name = BOT_NAMES.find(nm => !usedN.has(('Bot ' + nm).toLowerCase()));
    name = name ? 'Bot ' + name : 'Bot ' + (list.length + i + 1);
    if (!avatar) break;
    usedA.add(avatar); usedN.add(name.toLowerCase());
    u[`players/${rid('bot_')}`] = { name, avatar, joinedAt: t++, alive: true, bot: true };
  }
  if (Object.keys(u).length) await store.update(u);
}

/* ═════════════════════════ Events ═════════════════════════ */
document.addEventListener('click', async e => {
  const av = e.target.closest('[data-avatar]');
  if (av && !av.disabled) { ui.avatar = av.dataset.avatar; ui.err = ''; renderJoin(); return; }

  const pk = e.target.closest('[data-pick]');
  if (pk && !pk.disabled) {
    const m = meta();
    const v = Number(pk.dataset.pick);
    if (m.status === 'picking' && roster().includes(myPid) && store.now() < m.deadline && store.now() >= m.startAt) {
      await store.update({ [`picks/${m.round}/${myPid}`]: v });
      if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
    }
    return;
  }

  const kick = e.target.closest('[data-kick]');
  if (kick && isHost()) {
    const id = kick.dataset.kick;
    await store.update({ [`players/${id}`]: null, [`presence/${id}`]: null });
    return;
  }

  const act = e.target.closest('[data-action]')?.dataset.action;
  if (!act) return;
  switch (act) {
    case 'join': await join(); break;
    case 'start': if (isHost() && meta().status === 'lobby') { resolvedRound = -1; advancedReveal = -1; await startRound(); } break;
    case 'addBot': if (isHost()) await addBots(1); break;
    case 'addBot5': if (isHost()) await addBots(5); break;
    case 'newGame': if (isHost()) await newGame(); break;
    case 'askAbort': ui.confirmAbort = true; render(); break;
    case 'cancelAbort': ui.confirmAbort = false; render(); break;
    case 'abort': if (isHost()) await newGame(); break;
    case 'leave': await store.update({ [`players/${myPid}`]: null, [`presence/${myPid}`]: null }); break;
    case 'toggleHost': ui.hostOpen = !ui.hostOpen; ui.claimErr = ''; render(); setTimeout(() => $('#claimCode')?.focus(), 0); break;
    case 'claimHost': {
      const code = ($('#claimCode')?.value || '').trim();
      try { await store.claimHost(code); } catch { ui.claimErr = 'Code falsch.'; ui.cache.hostbar = null; render(); break; }
      ui.hostOpen = false; ui.claimErr = '';
      const u = { 'meta/hostId': myPid };
      if (!game.meta || !game.meta.status) { u['meta/status'] = 'lobby'; u['meta/round'] = 0; }
      await store.update(u);
      break;
    }
  }
});

// Abgelehnte Schreibzugriffe (Firebase-Regeln) sichtbar machen statt still zu scheitern
window.addEventListener('unhandledrejection', e => {
  const msg = String(e.reason?.message || e.reason || '');
  console.error(e.reason);
  if (/permission/i.test(msg)) showBanner('Diese Aktion wurde vom Server abgelehnt (keine Berechtigung). Bitte Seite neu laden.', 'error');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'claimCode') $('[data-action="claimHost"]')?.click();
});

/* ═════════════════════════ Konfetti ═════════════════════════ */
function confetti(duration = 6000) {
  const cv = $('#confetti');
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const resize = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  resize();
  window.addEventListener('resize', resize);
  const colors = ['#ff5600', '#ffbb99', '#3d8ace', '#47b26c', '#f5dd14', '#8e0dff', '#ffffff'];
  const parts = [];
  const t0 = performance.now();
  const end = t0 + (reduce ? 1500 : duration);
  const spawn = (k, burst) => {
    for (let i = 0; i < k; i++) parts.push({
      x: burst ? cv.width / 2 + (Math.random() - .5) * cv.width * .3 : Math.random() * cv.width,
      y: burst ? cv.height * .45 : -20 * dpr,
      vx: (Math.random() - .5) * (burst ? 14 : 3) * dpr,
      vy: (burst ? -(6 + Math.random() * 9) : 2 + Math.random() * 3) * dpr,
      r: (4 + Math.random() * 5) * dpr, rot: Math.random() * 6, vr: (Math.random() - .5) * .3,
      c: colors[Math.random() * colors.length | 0], sq: Math.random() < .55,
    });
  };
  spawn(reduce ? 40 : 160, true);
  cv.style.display = 'block';
  function frame(t) {
    if (t < end && !reduce) spawn(5, false);
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += 0.12 * dpr; p.vy = Math.min(p.vy, 5 * dpr); p.vx *= 0.99;
      p.x += p.vx + Math.sin(t / 400 + p.rot) * 0.6 * dpr; p.y += p.vy; p.rot += p.vr;
      if (p.y > cv.height + 30 * dpr) { parts.splice(i, 1); continue; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.sq) ctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r * .66);
      else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2.2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (parts.length || t < end) requestAnimationFrame(frame);
    else { cv.style.display = 'none'; window.removeEventListener('resize', resize); }
  }
  requestAnimationFrame(frame);
}

/* ═════════════════════════ Start ═════════════════════════ */
async function boot() {
  try {
    store = await createStore();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="note error">Firebase konnte nicht geladen werden. Prüfe die Werte in <code>config.js</code> und deine Internetverbindung.<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  const idStore = store.mode === 'local' ? safeStorage('sessionStorage') : safeStorage('localStorage');
  const ID_KEY = `luckyshot:${ROOM}:pid`;
  myPid = store.uid || idStore?.getItem(ID_KEY);
  if (!myPid) { myPid = rid('p_'); idStore?.setItem(ID_KEY, myPid); }

  const brand = $('#brandLink');
  if (brand && ROOM !== 'main') brand.href = `?room=${encodeURIComponent(ROOM)}`;

  if (store.mode === 'local') {
    showBanner(`<b>Demo-Modus</b> – das Spiel läuft nur in diesem Browser (öffne weitere Tabs für mehr Spieler oder füge Testbots hinzu). Für echtes Multiplayer Firebase in <code>config.js</code> eintragen.`, 'info');
  }

  let presenceSet = false;
  store.subscribe(state => {
    game = state || {};
    loaded = true;
    if (me() && !presenceSet) { presenceSet = true; store.presence(myPid); }
    if (!me()) presenceSet = false;
    render();
  });
  setInterval(hostLoop, 200);
  requestAnimationFrame(tick);
}

if (!window.__LUCKYSHOT_TEST__) boot();
