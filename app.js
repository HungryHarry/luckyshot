import { CONFIG } from './config.js';
import { t, getLang, setLang, LANGS } from './i18n.js';

/* ═════════════════════════ Konstanten ═════════════════════════ */
const AVATARS = ['😀','😎','🤓','🥳','😜','🤠','🤖','😺','🤡','🥸','😇','🤩','😏','🙃','🤪','😴',
  '🤯','🥶','🥵','😈','👽','🎃','🐵','🐶','🦊','🐼','🐸','🐷','🐯','🦁','🐨','🐙','🦄','🐲',
  '🐔','🐧','🦉','🐳','🐰','🐻'];


const BOT_NAMES = ['Bert','Rosi','Kalle','Uschi','Paule','Gerda','Horst','Mia','Jupp','Lotte','Ede','Frieda',
  'Otto','Hilde','Fritz','Erna','Bodo','Trude','Willi','Elfi','Gustl','Resi','Heinz','Moni','Kurt','Inge',
  'Rudi','Gabi','Toni','Lilo'];

const qs = new URLSearchParams(location.search);
const ROOM = (qs.get('room') || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'main';
const MAX = CONFIG.maxPlayers ?? 30;
const READY_MS = (CONFIG.readySeconds ?? 3) * 1000;
const PICK_MS = (CONFIG.pickSeconds ?? 10) * 1000;
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
        err => showBanner('dbErr', 'error', { m: esc(err.message) }));
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
  confettiFor: null, cache: {}, err: '', claimErr: '', banner: null, joining: false,
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
  const cur = getLang();
  let h = `<div class="lang" role="group" aria-label="${esc(t('langLabel'))}">${Object.entries(LANGS).map(([k, label]) =>
    `<button type="button" class="${k === cur ? 'on' : ''}" data-lang="${k}" aria-pressed="${k === cur}">${label}</button>`).join('')}</div>`;
  h += `<span class="chip room">${esc(t('room', { r: ROOM }))}</span>`;
  if (p) {
    h += isHost()
      ? `<span class="chip host">${t('hostChip')}</span>`
      : `<button class="chip link" data-action="toggleHost">${t('hostQ')}</button>`;
    h += `<span class="chip me"><span class="e">${p.avatar}</span>${esc(p.name)}</span>`;
  }
  setHTML($('#topRight'), h);
}

/** Banner merkt sich nur den Text-Schlüssel → wird bei Sprachwechsel neu übersetzt. */
function showBanner(key, kind = 'info', params = {}) {
  ui.banner = key ? { key, kind, params } : null;
  renderBanner();
}
function renderBanner() {
  const b = ui.banner;
  $('#banner').innerHTML = b ? `<div class="banner ${b.kind}"><div class="banner-in">${t(b.key, b.params)}</div></div>` : '';
}

/* ───────────── Beitreten ───────────── */
function joinSkeleton() {
  return `
  <section class="join">
    <div class="hero">
      <div class="hero-badge">${t('heroBadge', { max: MAX })}</div>
      <h1>Lucky<span>Shot</span></h1>
      <p>${t('heroText')}</p>
    </div>
    <div class="jcard">
      <div id="joinStatus"></div>
      <label class="field">
        <span class="lbl">${t('yourName')}</span>
        <input id="nameIn" maxlength="16" autocomplete="off" placeholder="${esc(t('namePh'))}" enterkeyhint="go">
      </label>
      <div class="field">
        <span class="lbl">${t('yourAvatar')}</span>
        <div id="avatarGrid" class="avgrid" role="radiogroup" aria-label="${esc(t('chooseAvatar'))}"></div>
      </div>
      <details class="hostfold" id="hostFold">
        <summary>${t('iAmHost')}</summary>
        <label class="field">
          <span class="lbl">${t('hostCode')}</span>
          <input id="codeIn" type="password" autocomplete="off" placeholder="${esc(t('enterCode'))}">
        </label>
      </details>
      <p class="err" id="joinErr" role="alert"></p>
      <button class="btn primary big block" data-action="join" id="joinBtn">${t('join')}</button>
    </div>
    ${rulesHTML()}
  </section>`;
}

function rulesHTML() {
  return `
  <details class="rules">
    <summary>${t('rulesTitle')}</summary>
    <ol>${t('rules', { s: CONFIG.pickSeconds ?? 10 }).map(r => `<li>${r}</li>`).join('')}</ol>
  </details>`;
}

function prefillJoin() {
  const prof = (() => { try { return JSON.parse(safeStorage('localStorage')?.getItem('luckyshot:profile') || '{}'); } catch { return {}; } })();
  if (prof.name && store.mode !== 'local') $('#nameIn').value = prof.name;
  if (prof.avatar && store.mode !== 'local' && !ui.avatar) ui.avatar = prof.avatar;
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
    status = `<div class="note warn">${t('runningNote', { r: m.round || 1 })}</div>`;
  } else if (full) {
    status = `<div class="note warn">${t('lobbyFull', { max: MAX })}</div>`;
  } else {
    status = `<div class="lobbyline"><span>${t('inLobby', { n: list.length, max: MAX })}</span>
      <span class="minis">${list.slice(0, 14).map(p => `<span title="${esc(p.name)}">${p.avatar}</span>`).join('')}${list.length > 14 ? `<span class="more">+${list.length - 14}</span>` : ''}</span></div>`;
  }
  setHTML($('#joinStatus'), status);
  setHTML($('#avatarGrid'), AVATARS.map(a => {
    const tk = taken.has(a);
    return `<button type="button" class="avopt ${ui.avatar === a ? 'sel' : ''}" data-avatar="${a}" ${tk ? `disabled title="${esc(t('taken'))}"` : ''} role="radio" aria-checked="${ui.avatar === a}">${a}</button>`;
  }).join(''));
  const btn = $('#joinBtn');
  if (btn && !ui.joining) btn.disabled = running || full;
  $('#joinErr').textContent = ui.err ? t(ui.err) : '';
}

async function join() {
  const name = ($('#nameIn')?.value || '').trim().replace(/\s+/g, ' ');
  const code = ($('#codeIn')?.value || '').trim();
  const m = meta();
  const list = playerList();
  const fail = key => { ui.err = key; renderJoin(); };
  if (m.status !== 'lobby') return fail('errRunning');
  if (list.length >= MAX) return fail('errFull');
  if (!name) return fail('errName');
  if (list.some(p => p.name.toLowerCase() === name.toLowerCase())) return fail('errNameTaken');
  if (!ui.avatar) return fail('errAvatar');
  if (list.some(p => p.avatar === ui.avatar)) return fail('errAvatarTaken');
  const hostClaim = code !== '';
  const btn = $('#joinBtn');
  ui.joining = true;
  if (btn) btn.disabled = true;
  try {
    // 1) Spielleiter-Code zuerst vom Server prüfen lassen
    if (hostClaim) {
      try { await store.claimHost(code); } catch { return fail('errCode'); }
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
    fail('errJoin');
  } finally {
    ui.joining = false;
    if (btn && document.body.contains(btn)) btn.disabled = false;
  }
}

/* ───────────── Spielansicht ───────────── */
/** Nach dem Aufdecken wartet das Spiel auf den Spielleiter. Damit bei späteren
    Neu-Renderings (z. B. jemand geht offline) die Animationen nicht erneut starten,
    wird der Endzustand ab ~5 s direkt gezeigt. */
const SETTLE_MS = 5000;
const isSettled = () => meta().status === 'reveal' && store.now() - (meta().revealAt || 0) > SETTLE_MS;

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
      <span class="hb-title">${t('hostLogin')}</span>
      <input id="claimCode" type="password" placeholder="${esc(t('hostCode'))}" autocomplete="off">
      <button class="btn primary sm" data-action="claimHost">${t('confirm')}</button>
      <button class="btn ghost sm" data-action="toggleHost">${t('cancel')}</button>
      <span class="err" id="claimErr">${ui.claimErr ? t(ui.claimErr) : ''}</span>
    </div></div>`;
  }
  const n = playerList().length;
  const abortBtns = ui.confirmAbort
    ? `<button class="btn danger sm" data-action="abort">${t('reallyAbort')}</button><button class="btn ghost sm" data-action="cancelAbort">${t('no')}</button>`
    : `<button class="btn ghost sm" data-action="askAbort">${t('abort')}</button>`;
  let h = `<div class="hostbar is-host"><div class="hb-in"><span class="hb-title">${t('hostTitle')}</span>`;
  if (m.status === 'lobby') {
    h += `<button class="btn primary" data-action="start" ${n < 2 ? 'disabled' : ''}>${t('startGame', { n })}</button>`;
    if (botsAllowed()) h += `<button class="btn tertiary sm" data-action="addBot" ${n >= MAX ? 'disabled' : ''}>${t('addBot')}</button>
      <button class="btn tertiary sm" data-action="addBot5" ${n >= MAX ? 'disabled' : ''}>${t('addBots5')}</button>`;
    if (n < 2) h += `<span class="hint">${t('min2')}</span>`;
  } else if (m.status === 'finished') {
    h += `<button class="btn primary" data-action="newGame">${t('newGame')}</button>`;
  } else if (m.status === 'reveal') {
    const settled = isSettled() ? 'settled' : '';
    if (m.outcome === 'continue') {
      h += `<button class="btn primary reveal-cta ${settled}" data-action="nextRound">${t('nextRound', { r: (m.round || 0) + 1 })}</button>
        <span class="hint">${t('revealHint', { r: m.round })}</span>`;
    } else {
      h += `<button class="btn primary reveal-cta ${settled}" data-action="showPodium">${t('showPodium')}</button>
        <span class="hint">${t('revealEndHint')}</span>`;
    }
    h += abortBtns;
  } else {
    h += `<span class="hint">${t('roundRunning', { r: m.round })}</span>${abortBtns}`;
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
    const crown = m.hostId === id ? `<span class="crown" title="${esc(t('crownTitle'))}">👑</span>` : '';
    seats += `<div class="seat" style="--a:${a}deg;--r:var(--ra)"><div class="av ${cls}" title="${esc(p.name)}">
      <span class="emo">${p.avatar}</span>${crown}<span class="nm">${esc(p.name)}</span></div></div>`;
    if (st === 'picking' || reveal) {
      const v = picks[id];
      let c = 'card';
      const front = v ?? '–';
      let back = '';
      if (reveal) {
        c += ' flipped';
        if (!v) c += ' none'; else if (m.outcome === 'allSame') c += ' same'; else if (counts[v] > 1) c += ' dup'; else c += ' ok';
        if (elim.has(id)) c += ' doomed';
      } else {
        if (v) c += ' ready';
        back = id === myPid && v ? v : v ? '✓' : '?';
      }
      seats += `<div class="seat" style="--a:${a}deg;--r:var(--rc)"><div class="${c}" style="--i:${i}">
        <div class="inner"><div class="face back">${back}</div><div class="face front">${front}</div></div></div></div>`;
    }
  });

  let center = '';
  if (st === 'lobby') {
    center = `<div class="c-big">${n}<small>/${MAX}</small></div><div class="c-sub">${t('lobbyCount', { n })}</div>
      <div class="c-wait">${t('waitStart')} <span class="dots"><i></i><i></i><i></i></span></div>`;
  } else if (st === 'picking') {
    const sub = ui.sub || 'go';
    center = `<div class="ring ${sub}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="44"/>
      <circle class="prog" data-ring cx="50" cy="50" r="44"/></svg>
      <div class="ring-txt"><div class="c-round">${t('round', { r: m.round })}</div><div class="c-secs" data-secs>${Math.ceil(PICK_MS / 1000)}</div>
      <div class="c-sub">${sub === 'ready' ? t('ready') : sub === 'over' ? t('timeUp') : t('numRange', { n: range })}</div></div></div>`;
  } else if (reveal) {
    const k = (m.eliminated || []).length;
    let out;
    if (m.outcome === 'allSame') out = `<b class="good">${t('cAllSame')}</b><span>${t('cAllHad', { n: m.winPick })}</span>`;
    else if (m.outcome === 'groupLost') out = `<b class="bad">${t('cAllOut')}</b><span>${t('cGroupLoses')}</span>`;
    else if (m.outcome === 'winner') out = `<b class="good">${t('cLms')}</b><span>${esc(ps[(m.winners || [])[0]]?.name || '')}</span>`;
    else if (k === 0) out = `<b class="good">${t('cAllSafe')}</b><span>${t('cNoDup')}</span>`;
    else out = `<b class="bad">${t('cOut', { k })}</b><span>${t('cStillIn', { n: n - k })}</span>`;
    center = `<div class="c-round">${t('round', { r: m.round })}</div><div class="c-flip">${t('revealed')}</div><div class="c-out">${out}</div>`;
  }

  return `<div class="arena-wrap ${isSettled() ? 'settled' : ''}"><div class="arena ${n > 16 ? 'many' : ''}" style="--n:${Math.max(n, 1)}">
    <div class="center">${center}</div>${seats}</div></div>`;
}

function panelHTML() {
  const m = meta();
  const p = me();
  const st = m.status;
  const inRoster = roster().includes(myPid);
  const n = playerList().length;
  const range = m.aliveCount || roster().length;
  const num = v => `<b class="big-num">${v}</b>`;

  if (st === 'lobby') {
    return `<div class="pcard-box">
      <h2>${t('youreIn')} <span class="e">${p.avatar}</span></h2>
      <p>${isHost() ? t('hostStartHint') : t('waitHost')}</p>
      <div class="stat">${t('playersCount', { n, max: MAX })}</div>
      ${!meta().hostId ? `<div class="note warn">${t('noHost')}</div>` : ''}
      ${hostListHTML()}
      <button class="btn ghost sm" data-action="leave">${t('leave')}</button>
      ${rulesHTML()}
    </div>`;
  }

  if (st === 'picking') {
    if (!inRoster) return deadPanel();
    const sub = ui.sub || 'go';
    const mine = curPicks()[myPid];
    const enabled = sub === 'go';
    let head;
    if (sub === 'ready') head = `<h2>${t('readyHead', { r: m.round })}</h2><p>${t('readyText', { n: range })}</p>`;
    else if (sub === 'over') head = `<h2>${t('overHead')}</h2><p>${mine ? t('pickRevealSoon', { pick: num(mine) }) : t('noPick')}</p>`;
    else head = `<h2>${t('pickHead', { n: range })}</h2><p>${mine ? t('pickChange', { pick: num(mine) }) : t('tapCard')}</p>`;
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
    const wait = `<p class="muted">${m.outcome === 'continue' ? t('waitNext') : t('waitPodium')}</p>`;
    let msg;
    if (m.outcome === 'allSame') msg = `<h2 class="good">${t('allSameWin')}</h2>`;
    else if (out) msg = `<h2 class="bad">${t('outHead')}</h2><p>${mine ? t('outDup', { n: mine }) : t('outNone')} ${t('toGrave')}</p>`;
    else if (m.outcome === 'winner') msg = `<h2 class="good">${t('youLms')}</h2>`;
    else msg = `<h2 class="good">${t('survived')}</h2><p>${t('survivedText', { n: mine })}</p>`;
    return `<div class="pcard-box reveal-msg ${isSettled() ? 'settled' : ''}">${msg}${isHost() ? '' : wait}</div>`;
  }

  if (st === 'finished') {
    const won = (m.winners || []).includes(myPid);
    let h;
    if (m.outcome === 'groupLost') h = `<h2 class="bad">${t('nobodyWon')}</h2><p>${t('allOutRound', { r: m.round })}</p>`;
    else if (won) h = `<h2 class="good">${t('youWon')}</h2><p>${t('afterRounds', { n: m.round })}</p>`;
    else h = `<h2>${t('gameOver')}</h2><p>${t('outInRound', { r: p.elimRound || '?' })}</p>`;
    return `<div class="pcard-box">${h}${isHost() ? '' : `<p class="muted">${t('waitNewGame')}</p>`}</div>`;
  }
  return '';
}

function deadPanel() {
  const p = me();
  const m = meta();
  return `<div class="pcard-box dead">
    <h2>${t('deadHead')}</h2>
    <p>${p.elimRound ? t('deadOutRound', { r: p.elimRound }) : ''} ${t('deadWatch', { n: roster().length - (m.status === 'reveal' ? (m.eliminated || []).length : 0) })}</p>
    ${m.status === 'picking' ? `<div class="bar ${ui.sub || 'go'}"><i data-bar></i><span data-secs></span></div>` : ''}
  </div>`;
}

function hostListHTML() {
  if (!isHost()) return '';
  const pres = presence();
  const rows = playerList().map(p => `<li>
    <span class="e">${p.avatar}</span><span class="n">${esc(p.name)}${p.bot ? ` <small>${t('bot')}</small>` : ''}${p.id === myPid ? ` <small>${t('you')}</small>` : ''}</span>
    ${store.mode === 'firebase' && !p.bot ? `<span class="dot ${pres[p.id] ? 'on' : ''}" title="${pres[p.id] ? t('online') : t('offline')}"></span>` : ''}
    ${p.id !== myPid ? `<button class="x" data-kick="${p.id}" title="${esc(t('remove', { name: p.name }))}" aria-label="${esc(t('remove', { name: p.name }))}">✕</button>` : ''}
  </li>`).join('');
  return `<details class="plist" open><summary>${t('managePlayers')}</summary><ul>${rows}</ul>
    <p class="muted small">${t('inviteLink')} <code>${esc(location.href.split('#')[0])}</code></p></details>`;
}

function graveyardHTML() {
  const m = meta();
  if (m.status === 'lobby') return '';
  const dead = playerList().filter(p => !p.alive && p.elimRound)
    .sort((a, b) => b.elimRound - a.elimRound || (a.joinedAt || 0) - (b.joinedAt || 0));
  const freshSet = new Set(m.status === 'reveal' ? (m.eliminated || []) : []);
  const tombs = dead.map((p, i) => {
    const list = t(p.elimReason === 'none' ? 'epitaphsNone' : 'epitaphsDup', { n: p.elimPick ?? '?' });
    const ep = list[hash(p.id + ':' + p.elimRound) % list.length];
    const tilt = (hash(p.id) % 7) - 3;
    return `<div class="tomb ${freshSet.has(p.id) ? 'fresh' : ''}" style="--tilt:${tilt}deg;--j:${i}">
      <div class="stone"><span class="rip">R.I.P.</span><span class="emo">${p.avatar}</span>
      <b>${esc(p.name)}</b><small>${t('round', { r: p.elimRound })}${p.elimPick ? ` · ${p.elimPick}` : ''}</small><em>${esc(ep)}</em></div>
      <div class="mound"></div></div>`;
  }).join('');
  return `<div class="yard ${isSettled() ? 'settled' : ''}">
    <div class="yard-head"><h2>${t('graveTitle')}</h2><span class="moon" aria-hidden="true">🌕</span>
    <span class="bats" aria-hidden="true">🦇</span></div>
    ${dead.length ? `<div class="tombs">${tombs}</div>` : `<p class="empty">${t('graveEmpty')} <span>${t('graveEmpty2')}</span></p>`}
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
  if (m.outcome === 'allSame') { title = t('podAllSame', { n: winners.length }); sub = t('podAllSameSub', { r: m.round, n: m.winPick }); }
  else if (m.outcome === 'winner') { title = t('podWinner', { name: esc(winners[0]?.name || '') }); sub = t('podWinnerSub', { n: m.round }); }
  else { title = t('podNobody'); sub = t('podNobodySub', { r: m.round }); }

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
   Das Gerät des Spielleiters ist "Schiedsrichter": es wertet jede Runde nach Ablauf
   des Countdowns aus. Die nächste Runde startet der Spielleiter per Klick. Alle Zeiten basieren auf der Server-Zeit (Firebase-Offset). */
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
    }
    // Nach dem Aufdecken wartet das Spiel, bis der Spielleiter „Nächste Runde“ bzw. „Siegertreppchen“ klickt.
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
  const lg = e.target.closest('[data-lang]');
  if (lg) { changeLang(lg.dataset.lang); return; }

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
    case 'nextRound': {
      const m = meta();
      if (isHost() && m.status === 'reveal' && m.outcome === 'continue' && advancedReveal !== m.round) {
        advancedReveal = m.round;
        await startRound();
      }
      break;
    }
    case 'showPodium': {
      const m = meta();
      if (isHost() && m.status === 'reveal' && m.outcome !== 'continue' && advancedReveal !== m.round) {
        advancedReveal = m.round;
        await store.update({ 'meta/status': 'finished', 'meta/finishedAt': store.now() });
      }
      break;
    }
    case 'askAbort': ui.confirmAbort = true; render(); break;
    case 'cancelAbort': ui.confirmAbort = false; render(); break;
    case 'abort': if (isHost()) await newGame(); break;
    case 'leave': await store.update({ [`players/${myPid}`]: null, [`presence/${myPid}`]: null }); break;
    case 'toggleHost': ui.hostOpen = !ui.hostOpen; ui.claimErr = ''; render(); setTimeout(() => $('#claimCode')?.focus(), 0); break;
    case 'claimHost': {
      const code = ($('#claimCode')?.value || '').trim();
      try { await store.claimHost(code); } catch { ui.claimErr = 'codeWrong'; ui.cache.hostbar = null; render(); break; }
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
  if (/permission/i.test(msg)) showBanner('deniedBanner', 'error');
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
/** Sprache wechseln: alles neu aufbauen, Eingaben im Beitreten-Formular behalten. */
function changeLang(l) {
  if (l === getLang()) return;
  const keep = { name: $('#nameIn')?.value, code: $('#codeIn')?.value, hostOpen: $('#hostFold')?.open, claim: $('#claimCode')?.value };
  setLang(l);
  ui.lastView = null;
  ui.cache = {};
  renderBanner();
  if (!loaded) { $('#app').innerHTML = `<div class="loading"><span class="spinner"></span> ${t('loading')}</div>`; return; }
  render();
  if (keep.name != null && $('#nameIn')) $('#nameIn').value = keep.name;
  if (keep.code != null && $('#codeIn')) $('#codeIn').value = keep.code;
  if (keep.hostOpen && $('#hostFold')) $('#hostFold').open = true;
  if (keep.claim != null && $('#claimCode')) $('#claimCode').value = keep.claim;
}

async function boot() {
  document.documentElement.lang = getLang();
  renderTop();
  $('#app').innerHTML = `<div class="loading"><span class="spinner"></span> ${t('loading')}</div>`;
  try {
    store = await createStore();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="note error">${t('fbLoadErr')}<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  const idStore = store.mode === 'local' ? safeStorage('sessionStorage') : safeStorage('localStorage');
  const ID_KEY = `luckyshot:${ROOM}:pid`;
  myPid = store.uid || idStore?.getItem(ID_KEY);
  if (!myPid) { myPid = rid('p_'); idStore?.setItem(ID_KEY, myPid); }

  const brand = $('#brandLink');
  if (brand && ROOM !== 'main') brand.href = `?room=${encodeURIComponent(ROOM)}`;

  if (store.mode === 'local') {
    showBanner('demoBanner', 'info');
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
