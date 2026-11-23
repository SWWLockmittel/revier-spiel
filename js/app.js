import { rpc, loadConfig, GameError, transferCode, importCode, resetSession } from "./api.js";
import { APP_VERSION } from "./config.js";

/* ============================================================
   Zustand
   ============================================================ */
const S = {
  cfg: null,        // Spiel-Konfiguration vom Server
  st: null,         // aktueller Spielstand vom Server
  offset: 0,        // Serverzeit − Gerätezeit (ms)
  tab: "revier",
  seed: null,       // gewähltes Saatgut
  sheet: null,      // offenes Bottom-Sheet {type, ...}
  modals: [],       // Warteschlange für Level-up usw.
  overlay: false,   // Ansitz-Szene offen
  nextChange: Infinity,
  confirmDiscard: null,
  installEvt: null,
};

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = () => Date.now() + S.offset;
const ms = (iso) => (iso ? Date.parse(iso) : 0);
const lvl = () => S.st.player.level;
const inv = (id) => S.st.inventory[id] || 0;
const item = (id) => S.cfg.items[id] || { name: id, emoji: "❔" };
const icon = (id) => item(id).emoji;
const storeName = (s) => (s === "lager" ? "Futterlager" : "Lagerhütte");
const building = (id) => S.cfg.buildings.find((b) => b.id === id);
const stand = (id) => S.cfg.stands.find((s) => s.id === id);
const owned = (bid) => S.st.buildings.some((b) => b.id === bid);
const sellPrice = (id) => Math.max(1, Math.floor(item(id).price * (S.cfg.settings.sell?.factor ?? 0.5)));

function fmt(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h} h ${m} min`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDur(sec) {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* ============================================================
   Server-Aktionen (immer nacheinander, nie parallel)
   ============================================================ */
let chain = Promise.resolve();
function act(name, args = {}) {
  const run = async () => {
    try {
      const st = await rpc(name, args);
      apply(st);
      return st;
    } catch (e) {
      toast(errText(e), true);
      render(); // optimistische Anzeige zurücksetzen
      throw e;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

function errText(e) {
  const d = e?.detail;
  switch (e?.code) {
    case "FEHLT": return `Dir fehlt: ${icon(d)} ${item(d).name}.`;
    case "LAGER_VOLL": return `${storeName(d)} ist voll. Verkaufe etwas oder baue aus.`;
    case "GESPERRT": return "Das ist noch gesperrt.";
    case "WARTESCHLANGE_VOLL": return "Alle Plätze sind belegt.";
    case "ZU_WENIG_TALER": return "Dafür reichen deine Taler noch nicht.";
    case "MAXIMUM": return "Mehr geht auf diesem Level nicht.";
    case "NICHT_BEREIT": return "Das ist noch nicht so weit.";
    case "BESCHAEFTIGT": return "Hier läuft schon etwas.";
    case "NAME_UNGUELTIG": return "Der Name braucht 2 bis 30 Zeichen.";
    case "OFFLINE": return "Keine Verbindung. Prüfe dein Netz.";
    case "GAST_AUS": return "Der Gastzugang ist noch nicht freigeschaltet.";
    case "CODE_UNGUELTIG": return "Der Code ist ungültig oder wurde schon benutzt.";
    case "SITZUNG_UNGUELTIG": return "Deine Sitzung ist abgelaufen.";
    default: return "Da ist etwas schiefgegangen. Versuch es nochmal.";
  }
}

function apply(st) {
  const prev = S.st;
  S.st = st;
  S.offset = Date.parse(st.now) - Date.now();
  if (prev) {
    if (st.player.taler !== prev.player.taler) bump("#taler-pill");
    if (st.player.grandeln !== prev.player.grandeln) bump("#grandel-pill");
  }
  handleEvents(st.events || []);
  render();
}

function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case "welcome": S.modals.push({ type: "welcome" }); break;
      case "levelup": S.modals.push({ type: "levelup", ...ev }); break;
      case "drop": toast(`Fund im Revier: ${icon(ev.item)} ${item(ev.item).name}!`); break;
      case "full": toast(`${storeName(ev.storage)} ist voll!`, true); break;
      case "order": flyAt("#taler-pill", `+${ev.taler} Taler`); flyAt("#lvl", `+${ev.xp} XP`); break;
      case "collect": flyAt("#view", `+${ev.qty} ${icon(ev.item)}`); break;
      case "bought": toast(`Gekauft: ${ev.qty}× ${icon(ev.item)} für ${ev.taler} Taler`); break;
      case "sold": toast(`Verkauft: ${ev.qty}× ${icon(ev.item)} für ${ev.taler} Taler`); break;
      case "built": toast(`Fertig gebaut: ${ev.building ? building(ev.building).name : stand(ev.stand).name}`); break;
      case "upgrade": toast(`${storeName(ev.storage)} ausgebaut!`); break;
      case "hunt": S.lastHunt = ev; break;
    }
  }
  setTimeout(nextModal, 50);
}

/* ============================================================
   Rendering
   ============================================================ */
function render() {
  if (!S.st) return;
  renderTop();
  S.nextChange = Infinity;
  const y = view.scrollTop;
  if (S.tab === "revier") view.innerHTML = vRevier();
  else if (S.tab === "gasthaus") view.innerHTML = vGasthaus();
  else if (S.tab === "lager") view.innerHTML = vLager();
  else if (S.tab === "bauen") view.innerHTML = vBauen();
  view.scrollTop = y;
  if (S.sheet) renderSheet();
  collectTimers();
  tick();
}

function renderTop() {
  const p = S.st.player;
  $("#lvl-num").textContent = p.level;
  const need = p.xp_to_next || p.xp || 1;
  $("#xp-fill").style.width = `${Math.min(100, (p.xp / need) * 100)}%`;
  $("#xp-text").textContent = p.xp_to_next ? `${p.xp}/${p.xp_to_next}` : `${p.xp}`;
  $("#taler").textContent = p.taler;
  $("#grandeln").textContent = p.grandeln;
  const t = now();
  const deliverable = S.st.orders.filter((o) => ms(o.available_at) <= t && o.items.every((i) => inv(i.item) >= i.qty)).length;
  setBadge("#badge-gasthaus", deliverable);
  const buildable = S.cfg.buildings.filter((b) => !owned(b.id) && b.unlock_level <= p.level && b.cost <= p.taler).length;
  setBadge("#badge-bauen", buildable);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === S.tab));
}
function setBadge(sel, n) { const el = $(sel); el.hidden = !n; el.textContent = n; }

/* ---------- Revier ---------- */
function vRevier() {
  const st = S.st;
  const crops = Object.keys(S.cfg.crops).sort((a, b) => item(a).sort - item(b).sort);
  const unlocked = crops.filter((c) => item(c).unlock_level <= lvl());
  if (!S.seed || !unlocked.includes(S.seed) || (inv(S.seed) === 0 && unlocked.some((c) => inv(c) > 0))) {
    S.seed = unlocked.find((c) => inv(c) > 0) || unlocked[0];
  }
  const nextLocked = crops.find((c) => item(c).unlock_level > lvl());
  const t = now();

  const plots = st.plots.map((p) => {
    if (!p.crop) return `<div class="plot empty" data-idx="${p.idx}"></div>`;
    const ready = ms(p.ready_at) <= t;
    if (ready) return `<div class="plot ready" data-idx="${p.idx}"><span class="crop">${icon(p.crop)}</span></div>`;
    return `<div class="plot growing" data-idx="${p.idx}"><span class="crop">${icon(p.crop)}</span>
      <span class="tt" data-until="${p.ready_at}"></span>
      <span class="t"><i data-from="${p.planted_at}" data-until="${p.ready_at}"></i></span></div>`;
  }).join("");

  const seeds = unlocked.map((c) => `
    <button class="seed ${c === S.seed ? "sel" : ""} ${inv(c) ? "" : "zero"}" data-act="seed" data-id="${c}">
      <span class="c">${inv(c)}</span><span class="e">${icon(c)}</span>
      <span class="n">${esc(item(c).name)}</span><span class="n muted">${fmtDur(S.cfg.crops[c].grow_seconds)}</span>
    </button>`).join("") + (nextLocked ? `
    <div class="seed locked"><span class="e">${icon(nextLocked)}</span><span class="n">${esc(item(nextLocked).name)}</span><span class="n">ab Lv ${item(nextLocked).unlock_level}</span></div>` : "");

  const readyCount = st.plots.filter((p) => p.crop && ms(p.ready_at) <= t).length;
  return `
    ${installBanner()}
    <div class="revier-name">🌲 <span>${esc(st.player.revier_name)}</span><button data-act="rename" aria-label="Revier umbenennen">✏️</button></div>
    <section class="sec">
      <div class="sec-h"><h2>Wildäcker</h2><small>${readyCount ? `${readyCount} reif` : `${st.plots.length} Äcker`}</small></div>
      <div class="fields" id="fields">${plots}</div>
      <div class="seedbar">${seeds}</div>
      <p class="hint">Saatgut wählen und über leere Äcker wischen. Reife Äcker abwischen zum Ernten – jede Saat bringt doppelt zurück.</p>
    </section>
    <section class="sec">
      <div class="sec-h"><h2>Hochsitze</h2></div>
      ${st.stands.map(vStand).join("")}
    </section>
    <section class="sec">
      <div class="sec-h"><h2>Betriebe</h2></div>
      ${S.cfg.buildings.filter((b) => owned(b.id)).map(vBuildingCard).join("")}
      ${vNextBuilding()}
    </section>`;
}

function vStand(ps) {
  const c = stand(ps.stand);
  const t = now();
  let sub, btn, bar = "";
  if (!ps.ready_at) {
    const have = inv(c.feed_item);
    sub = `Beschicken mit ${c.feed_qty}× ${icon(c.feed_item)} ${esc(item(c.feed_item).name)} · du hast ${have}`;
    if (have >= c.feed_qty) btn = `<button class="btn green small" data-act="feed" data-idx="${ps.idx}">Beschicken</button>`;
    else {
      const r = S.cfg.recipes.find((r) => r.output_item === c.feed_item);
      btn = r && owned(r.building_id)
        ? `<button class="btn ghost small" data-act="open-b" data-id="${r.building_id}">Mischen</button>`
        : `<button class="btn small" disabled>Fehlt</button>`;
    }
  } else if (ms(ps.ready_at) > t) {
    sub = `Wild zieht an … <b data-until="${ps.ready_at}"></b>`;
    const from = ms(ps.ready_at) - c.wait_seconds * 1000;
    bar = `<div class="bar"><i data-from="${new Date(from).toISOString()}" data-until="${ps.ready_at}"></i></div>`;
    btn = "";
  } else {
    sub = `Anblick! Wild ist ausgetreten.`;
    btn = `<button class="btn pulse" data-act="hunt" data-idx="${ps.idx}">Ansitzen</button>`;
  }
  return `<div class="card"><div class="row">
      <div class="big-e">${c.emoji}</div>
      <div class="grow"><div class="title">${esc(c.name)}</div><div class="sub">${sub}</div>${bar}</div>
      ${btn}</div></div>`;
}

function jobsOf(bid) { return S.st.jobs.filter((j) => j.building === bid); }

function vBuildingCard(b) {
  const pb = S.st.buildings.find((x) => x.id === b.id);
  const jobs = jobsOf(b.id);
  const t = now();
  const done = jobs.filter((j) => ms(j.ready_at) <= t);
  const running = jobs.find((j) => ms(j.ready_at) > t && ms(j.start_at) <= t);
  let sub;
  if (done.length) sub = `<b>${done.length} fertig</b> zum Einsammeln`;
  else if (running) sub = `In Arbeit … <b data-until="${running.ready_at}"></b>`;
  else sub = "Steht still – starte eine Produktion";
  const slots = Array.from({ length: pb.slots }, (_, i) => {
    const j = jobs[i];
    if (!j) return `<span></span>`;
    const r = S.cfg.recipes.find((r) => r.id === j.recipe);
    return `<span class="${ms(j.ready_at) <= t ? "done" : ""}">${icon(r.output_item)}</span>`;
  }).join("");
  return `<div class="card" data-act="open-b" data-id="${b.id}"><div class="row">
      <div class="big-e">${b.emoji}</div>
      <div class="grow"><div class="title">${esc(b.name)}</div><div class="sub">${sub}</div><div class="slots">${slots}</div></div>
      ${done.length ? `<button class="btn green small" data-act="collect" data-id="${b.id}">Einsammeln</button>` : `<span class="btn ghost small">Öffnen</span>`}
    </div></div>`;
}

function vNextBuilding() {
  const next = S.cfg.buildings.find((b) => !owned(b.id));
  if (!next) return "";
  if (next.unlock_level <= lvl()) {
    return `<div class="card locked-card"><div class="row"><div class="big-e">${next.emoji}</div>
      <div class="grow"><div class="title">${esc(next.name)}</div><div class="sub">${esc(next.description)}</div></div>
      <button class="btn small" data-act="tab" data-id="bauen">Bauen</button></div></div>`;
  }
  return `<div class="card locked-card"><div class="row"><div class="big-e" style="filter:grayscale(1)">${next.emoji}</div>
    <div class="grow"><div class="title">${esc(next.name)}</div><div class="sub">Ab Level ${next.unlock_level}</div></div></div></div>`;
}

/* ---------- Gasthaus ---------- */
function vGasthaus() {
  const t = now();
  const cards = S.st.orders.map((o) => {
    if (ms(o.available_at) > t) {
      return `<div class="card order wait"><div><div style="font-size:30px">🚶</div>Neuer Gast in<br><b data-until="${o.available_at}"></b></div></div>`;
    }
    const ok = o.items.every((i) => inv(i.item) >= i.qty);
    const needs = o.items.map((i) => {
      const have = inv(i.item);
      return `<span class="${have >= i.qty ? "ok" : "no"}" title="${esc(item(i.item).name)}">${icon(i.item)} ${Math.min(have, i.qty)}/${i.qty}</span>`;
    }).join("");
    const confirm = S.confirmDiscard === o.slot;
    return `<div class="card order ${ok ? "ready-to-go" : ""}">
      <div class="need">${needs}</div>
      <div class="sub">${o.items.map((i) => esc(item(i.item).name)).join(", ")}</div>
      <div class="reward"><span><i class="ico-taler"></i> ${o.taler}</span><span>⭐ ${o.xp} XP</span></div>
      <div class="acts">
        <button class="btn green small" data-act="deliver" data-slot="${o.slot}" ${ok ? "" : "disabled"}>Liefern</button>
        <button class="btn ${confirm ? "red" : "ghost"} small" data-act="discard" data-slot="${o.slot}" aria-label="Auftrag ablehnen">${confirm ? "Weg?" : "✕"}</button>
      </div></div>`;
  }).join("");
  return `
    <div class="gasthaus-head"><div style="font-size:42px">🦌</div><div>
      <h2>Gasthaus „Zum Hirschen“</h2>
      <p>Der Wirt nimmt alles, was dein Revier hergibt. Wildbret bringt am meisten.</p></div></div>
    <div class="orders">${cards}</div>
    <p class="hint">Abgelehnte Aufträge werden nach einer Minute durch einen neuen Gast ersetzt.</p>`;
}

/* ---------- Lager ---------- */
function vLager() {
  const st = S.st;
  const mk = (key) => {
    const s = st.storage[key];
    const ids = Object.keys(st.inventory).filter((id) => item(id).storage === key && inv(id) > 0)
      .sort((a, b) => item(a).sort - item(b).sort);
    const mats = S.cfg.settings.storage[`${key}_materials`];
    const canUp = mats.every((m) => inv(m) >= s.need);
    const grid = ids.length
      ? ids.map((id) => `<button class="item" data-act="sell" data-id="${id}"><span class="e">${icon(id)}</span><span class="q">${inv(id)}</span><span class="nm">${esc(item(id).name)}</span></button>`).join("")
      : `<p class="muted" style="grid-column:1/-1;margin:4px 0">Noch leer.</p>`;
    return `<div class="card">
      <div class="store-h"><div><div class="title">${key === "lager" ? "🌾" : "🛖"} ${storeName(key)}</div>
        <div class="sub">${key === "lager" ? "Ernte von den Wildäckern" : "Wild, Wildbret, Waren und Baumaterial"} · Stufe ${s.level + 1}</div></div>
        <div class="cap">${s.used}/${s.cap}</div></div>
      <div class="bar"><i style="width:${Math.min(100, (s.used / s.cap) * 100)}%;${s.used >= s.cap ? "background:var(--red)" : ""}"></i></div>
      <div class="items">${grid}</div>
      <div class="sub" style="margin-top:12px">Ausbau auf ${s.cap + S.cfg.settings.storage.per_level} Plätze braucht je ${s.need}×:</div>
      <div class="mats">${mats.map((m) => `<span class="${inv(m) >= s.need ? "ok" : ""}">${icon(m)} ${esc(item(m).name)} ${inv(m)}/${s.need}</span>`).join("")}</div>
      <button class="btn ${canUp ? "green" : "ghost"} wide" data-act="upgrade" data-id="${key}" ${canUp ? "" : "disabled"}>Ausbauen</button>
    </div>`;
  };
  return `
    <div class="sec-h"><h2>Lager</h2><small>Antippen zum Verkaufen</small></div>
    ${mk("lager")}${mk("huette")}
    <p class="hint">Baumaterial findest du zufällig beim Ernten, in der Produktion und beim Ansitz.</p>
    <div class="card" style="margin-top:14px"><div class="row"><div class="big-e">📲</div>
      <div class="grow"><div class="title">Revier übertragen</div><div class="sub">Auf ein anderes Gerät oder in die Homescreen-App mitnehmen.</div></div>
      <button class="btn ghost small" data-act="transfer">Öffnen</button></div></div>
    <p class="hint" style="text-align:center;opacity:.5">Version ${APP_VERSION}</p>`;
}

/* ---------- Bauen ---------- */
function vBauen() {
  const p = S.st.player;
  const bCards = S.cfg.buildings.map((b) => {
    const has = owned(b.id);
    const locked = b.unlock_level > p.level;
    let right;
    if (has) right = `<span class="btn ghost small">✓ gebaut</span>`;
    else if (locked) right = `<span class="btn ghost small" disabled>ab Lv ${b.unlock_level}</span>`;
    else right = `<button class="btn small" data-act="build" data-id="${b.id}" ${p.taler >= b.cost ? "" : "disabled"}><i class="ico-taler"></i>${b.cost}</button>`;
    return `<div class="card shop-item ${locked ? "locked-card" : ""}"><div class="row"><div class="big-e" ${locked ? 'style="filter:grayscale(1)"' : ""}>${b.emoji}</div>
      <div class="grow"><div class="title">${esc(b.name)}</div><div class="sub">${esc(b.description)}</div></div>${right}</div></div>`;
  }).join("");
  const sCards = S.cfg.stands.map((s) => {
    const n = S.st.stands.filter((x) => x.stand === s.id).length;
    const locked = s.unlock_level > p.level;
    let right;
    if (locked) right = `<span class="btn ghost small">ab Lv ${s.unlock_level}</span>`;
    else if (n >= s.max_count) right = `<span class="btn ghost small">${n}/${s.max_count}</span>`;
    else right = `<button class="btn small" data-act="buy-stand" data-id="${s.id}" ${p.taler >= s.cost ? "" : "disabled"}><i class="ico-taler"></i>${s.cost}</button>`;
    return `<div class="card shop-item ${locked ? "locked-card" : ""}"><div class="row"><div class="big-e">${s.emoji}</div>
      <div class="grow"><div class="title">${esc(s.name)}</div><div class="sub">${icon(s.feed_item)} → ${icon(s.yield_item)} · ${fmtDur(s.wait_seconds)} · du hast ${n}/${s.max_count}</div></div>${right}</div></div>`;
  }).join("");
  const ps = S.st.plot_shop;
  const plotRight = ps.owned >= ps.max
    ? `<span class="btn ghost small">${ps.owned}/${ps.max}</span>`
    : `<button class="btn small" data-act="buy-plot" ${p.taler >= ps.cost ? "" : "disabled"}><i class="ico-taler"></i>${ps.cost}</button>`;
  return `
    <div class="sec"><div class="sec-h"><h2>Betriebe</h2></div>${bCards}</div>
    <div class="sec"><div class="sec-h"><h2>Hochsitze & Kanzeln</h2></div>${sCards}</div>
    <div class="sec"><div class="sec-h"><h2>Fläche</h2></div>
      <div class="card shop-item"><div class="row"><div class="big-e">🟫</div>
        <div class="grow"><div class="title">Neuen Wildacker roden</div><div class="sub">${ps.owned} von ${ps.max} möglich · mit jedem Level einer mehr</div></div>${plotRight}</div></div></div>`;
}

/* ---------- Install-Hinweis ---------- */
function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function installBanner() {
  if (isStandalone()) return "";
  try { if (localStorage.getItem("revier.install.hide")) return ""; } catch {}
  if (S.installEvt) {
    return `<div class="install">📲 <span>Installiere dein Revier als App – dann bekommst du später Bescheid, wenn das Wild anwechselt.</span>
      <button class="btn small" data-act="install">Installieren</button><button class="x" data-act="hide-install">✕</button></div>`;
  }
  if (isIOS()) {
    return `<div class="install">📲 <span>Tipp: In Safari auf <b>Teilen</b> und <b>„Zum Home-Bildschirm“</b> – dann läuft dein Revier wie eine App. Vorher unter Lager → <b>Revier übertragen</b> den Code kopieren.</span>
      <button class="x" data-act="hide-install">✕</button></div>`;
  }
  return "";
}

/* ============================================================
   Timer (laufen lokal mit Serverzeit; der Server prüft trotzdem)
   ============================================================ */
let timerEls = [];
function collectTimers() {
  timerEls = [...document.querySelectorAll("[data-until]")];
  const t = now();
  const all = [
    ...S.st.plots.filter((p) => p.ready_at).map((p) => ms(p.ready_at)),
    ...S.st.jobs.map((j) => ms(j.ready_at)),
    ...S.st.stands.filter((s) => s.ready_at).map((s) => ms(s.ready_at)),
    ...S.st.orders.map((o) => ms(o.available_at)),
  ].filter((x) => x > t);
  S.nextChange = all.length ? Math.min(...all) : Infinity;
}
function tick() {
  if (!S.st) return;
  const t = now();
  if (t >= S.nextChange && !stroke) { render(); return; }
  for (const el of timerEls) {
    const until = ms(el.dataset.until);
    if (el.dataset.from) {
      const from = ms(el.dataset.from);
      el.style.width = `${Math.min(100, Math.max(0, ((t - from) / (until - from)) * 100))}%`;
    } else {
      el.textContent = fmt((until - t) / 1000);
    }
  }
}
setInterval(tick, 1000);

/* ============================================================
   Wischen über die Wildäcker
   ============================================================ */
let stroke = null;
view.addEventListener("pointerdown", (e) => {
  const plot = e.target.closest(".plot");
  if (!plot || S.overlay) return;
  e.preventDefault();
  const p = S.st.plots.find((x) => x.idx === +plot.dataset.idx);
  const t = now();
  if (p.crop && ms(p.ready_at) > t) {
    toast(`${icon(p.crop)} ${item(p.crop).name} ist reif in ${fmt((ms(p.ready_at) - t) / 1000)}`);
    return;
  }
  if (p.crop) stroke = { mode: "harvest", set: new Set() };
  else {
    if (!S.seed || inv(S.seed) < 1) { toast("Kein Saatgut. Wähle unten eine Saat, die du im Lager hast.", true); return; }
    stroke = { mode: "plant", set: new Set(), seed: S.seed, left: inv(S.seed) };
  }
  $("#fields").setPointerCapture?.(e.pointerId);
  touchPlot(plot);
});
view.addEventListener("pointermove", (e) => {
  if (!stroke) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".plot");
  if (el) touchPlot(el);
});
const endStroke = () => {
  if (!stroke) return;
  const s = stroke; stroke = null;
  if (!s.set.size) return;
  const idx = [...s.set];
  if (s.mode === "harvest") act("harvest", { p_plots: idx }).catch(() => {});
  else act("plant", { p_plots: idx, p_crop: s.seed }).catch(() => {});
};
view.addEventListener("pointerup", endStroke);
view.addEventListener("pointercancel", endStroke);

function touchPlot(el) {
  const idx = +el.dataset.idx;
  if (stroke.set.has(idx)) return;
  const p = S.st.plots.find((x) => x.idx === idx);
  const t = now();
  if (stroke.mode === "harvest") {
    if (!p.crop || ms(p.ready_at) > t) return;
    stroke.set.add(idx);
    el.className = "plot empty pending";
    el.innerHTML = "";
    const r = el.getBoundingClientRect();
    fly(`+2 ${icon(p.crop)}`, r.left + r.width / 2 - 18, r.top + 8);
    navigator.vibrate?.(8);
  } else {
    if (p.crop || stroke.left <= 0) return;
    stroke.set.add(idx);
    stroke.left--;
    el.className = "plot growing pending";
    el.innerHTML = `<span class="crop">${icon(stroke.seed)}</span>`;
    navigator.vibrate?.(5);
  }
}

/* ============================================================
   Klicks
   ============================================================ */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  const tab = e.target.closest("#tabs button");
  if (tab) { S.tab = tab.dataset.tab; S.confirmDiscard = null; view.scrollTop = 0; render(); return; }
  if (!t || !S.st) return;
  const a = t.dataset.act, id = t.dataset.id;
  e.stopPropagation();
  switch (a) {
    case "seed":
      S.seed = id; render();
      if (!inv(id)) openSheet({ type: "seed", id, qty: 4 });
      break;
    case "seed-step": S.sheet.qty = Math.max(1, Math.min(20, S.sheet.qty + +t.dataset.d)); renderSheet(); break;
    case "seed-go": act("buy_seed", { p_crop: S.sheet.id, p_qty: S.sheet.qty }).then(closeSheet).catch(() => {}); break;
    case "feed": act("feed_stand", { p_idx: +t.dataset.idx }).catch(() => {}); break;
    case "hunt": startHunt(+t.dataset.idx); break;
    case "open-b": openSheet({ type: "building", id }); break;
    case "collect": act("collect_jobs", { p_building: id }).catch(() => {}); break;
    case "start": act("start_job", { p_recipe: id }).catch(() => {}); break;
    case "deliver": S.confirmDiscard = null; act("deliver_order", { p_slot: +t.dataset.slot }).catch(() => {}); break;
    case "discard": {
      const slot = +t.dataset.slot;
      if (S.confirmDiscard === slot) { S.confirmDiscard = null; act("discard_order", { p_slot: slot }).catch(() => {}); }
      else { S.confirmDiscard = slot; render(); }
      break;
    }
    case "build": act("build", { p_building: id }).catch(() => {}); break;
    case "buy-stand": act("buy_stand", { p_stand: id }).catch(() => {}); break;
    case "buy-plot": act("buy_plot").catch(() => {}); break;
    case "upgrade": act("upgrade_storage", { p_storage: id }).catch(() => {}); break;
    case "sell": openSheet({ type: "sell", id, qty: 1 }); break;
    case "sell-step": S.sheet.qty = Math.max(1, Math.min(inv(S.sheet.id), S.sheet.qty + +t.dataset.d)); renderSheet(); break;
    case "sell-max": S.sheet.qty = Math.max(1, inv(S.sheet.id)); renderSheet(); break;
    case "sell-go": {
      const { id: sid, qty } = S.sheet;
      act("sell", { p_item: sid, p_qty: qty }).then(() => { if (!inv(sid)) closeSheet(); }).catch(() => {});
      break;
    }
    case "rename": openSheet({ type: "rename" }); break;
    case "rename-go": {
      const v = $("#rename-input").value;
      act("rename_revier", { p_name: v }).then(closeSheet).catch(() => {});
      break;
    }
    case "transfer": openSheet({ type: "transfer" }); break;
    case "show-code": showCode(); break;
    case "copy-code": copyCode(); break;
    case "import-go": doImport(); break;
    case "close-sheet": closeSheet(); break;
    case "tab": closeSheet(); S.tab = id; view.scrollTop = 0; render(); break;
    case "install": S.installEvt?.prompt(); S.installEvt = null; render(); break;
    case "hide-install": try { localStorage.setItem("revier.install.hide", "1"); } catch {} render(); break;
    case "modal-ok": closeModal(); break;
    case "hunt-shoot": shoot(); break;
    case "hunt-close": closeHunt(); break;
    case "retry": location.reload(); break;
  }
});

/* ============================================================
   Bottom-Sheets
   ============================================================ */
function openSheet(s) { S.sheet = s; renderSheet(); }
function closeSheet() {
  S.sheet = null;
  $("#sheet").hidden = true; $("#sheet-backdrop").hidden = true;
}
$("#sheet-backdrop").addEventListener("click", closeSheet);

function renderSheet() {
  const s = S.sheet;
  const el = $("#sheet");
  let html = `<div class="grab"></div>`;
  if (s.type === "building") html += sheetBuilding(s.id);
  else if (s.type === "sell") {
    if (!inv(s.id)) { closeSheet(); return; }
    s.qty = Math.min(s.qty, inv(s.id));
    const pr = sellPrice(s.id);
    html += `<h3>${icon(s.id)} ${esc(item(s.id).name)}</h3>
      <p class="desc">Du hast ${inv(s.id)} Stück. Der Händler zahlt ${pr} Taler pro Stück – im Gasthaus bekommst du meist mehr.</p>
      <div class="stepper"><button class="btn ghost" data-act="sell-step" data-d="-1">−</button><b>${s.qty}</b>
        <button class="btn ghost" data-act="sell-step" data-d="1">+</button><button class="btn ghost small" data-act="sell-max">Alle</button></div>
      <button class="btn wide" data-act="sell-go">Verkaufen für <i class="ico-taler"></i> ${pr * s.qty}</button>`;
  } else if (s.type === "seed") {
    const per = item(s.id).price * (S.cfg.settings.seeds?.buy_factor ?? 2);
    const cost = per * s.qty;
    html += `<h3>${icon(s.id)} ${esc(item(s.id).name)}-Saatgut</h3>
      <p class="desc">Beim Landhandel kostet eine Saat ${per} Taler. Billiger ist es, einen Teil der eigenen Ernte wieder auszusäen – jede Saat bringt doppelt zurück.</p>
      <div class="stepper"><button class="btn ghost" data-act="seed-step" data-d="-1">−</button><b>${s.qty}</b>
        <button class="btn ghost" data-act="seed-step" data-d="1">+</button></div>
      <button class="btn wide" data-act="seed-go" ${S.st.player.taler >= cost ? "" : "disabled"}>Kaufen für <i class="ico-taler"></i> ${cost}</button>`;
  } else if (s.type === "rename") {
    html += `<h3>Revier benennen</h3><p class="desc">So heißt dein Revier für dich und später für deinen Hegering.</p>
      <input id="rename-input" class="field" maxlength="30" value="${esc(S.st.player.revier_name)}" autocomplete="off">
      <button class="btn green wide" data-act="rename-go">Speichern</button>`;
  } else if (s.type === "transfer") {
    html += `<h3>Revier übertragen</h3>
      <p class="desc">Dein Revier hängt an diesem Gerät. Mit dem Code nimmst du es mit – zum Beispiel aus Safari in die Homescreen-App. Der Code gilt einmal; danach ist das Revier nur noch auf dem neuen Gerät.</p>
      ${s.code ? `<div class="codebox" id="code">${esc(s.code)}</div><button class="btn wide" style="margin-top:10px" data-act="copy-code">Code kopieren</button>`
        : `<button class="btn wide" data-act="show-code">Code anzeigen</button>`}
      <p class="desc" style="margin-top:18px"><b>Revier von einem anderen Gerät holen:</b> Code dort anzeigen lassen und hier eingeben. Dein aktuelles Revier auf diesem Gerät geht dabei verloren.</p>
      <input id="import-input" class="field" placeholder="Code eingeben" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn ghost wide" data-act="import-go">Revier übernehmen</button>
      <p class="desc" style="margin-top:14px">Bald kommt die Sicherung per E-Mail dazu.</p>`;
  }
  el.innerHTML = html;
  el.hidden = false; $("#sheet-backdrop").hidden = false;
  collectTimersInSheet();
}
function collectTimersInSheet() { timerEls = [...document.querySelectorAll("[data-until]")]; tick(); }

function sheetBuilding(bid) {
  const b = building(bid);
  const pb = S.st.buildings.find((x) => x.id === bid);
  if (!pb) return `<h3>${b.emoji} ${esc(b.name)}</h3><p class="desc">Noch nicht gebaut.</p>`;
  const jobs = jobsOf(bid);
  const t = now();
  const done = jobs.filter((j) => ms(j.ready_at) <= t).length;
  const queue = Array.from({ length: pb.slots }, (_, i) => {
    const j = jobs[i];
    if (!j) return `<div class="q">frei</div>`;
    const r = S.cfg.recipes.find((r) => r.id === j.recipe);
    if (ms(j.ready_at) <= t) return `<div class="q done"><span><span class="e">${icon(r.output_item)}</span>fertig</span></div>`;
    const waiting = ms(j.start_at) > t;
    return `<div class="q busy"><span><span class="e">${icon(r.output_item)}</span>${waiting ? "wartet" : `<b data-until="${j.ready_at}"></b>`}</span></div>`;
  }).join("");
  const full = jobs.length >= pb.slots;
  const recipes = S.cfg.recipes.filter((r) => r.building_id === bid).map((r) => {
    const locked = r.unlock_level > lvl();
    const ins = Object.entries(r.inputs).map(([k, v]) => `<span class="${inv(k) >= v ? "" : "no"}">${icon(k)} ${inv(k)}/${v}</span>`).join("");
    const can = !locked && !full && Object.entries(r.inputs).every(([k, v]) => inv(k) >= v);
    return `<div class="recipe ${locked ? "locked" : ""}">
      <div class="out">${icon(r.output_item)}${r.output_qty > 1 ? `<sub>×${r.output_qty}</sub>` : ""}</div>
      <div class="grow"><div class="title">${esc(r.label || item(r.output_item).name)}</div>
        <div class="sub">${locked ? `ab Level ${r.unlock_level}` : `${fmtDur(r.seconds)} · ⭐ ${r.xp} XP`}</div>
        <div class="ins">${ins}</div></div>
      ${locked ? "" : `<button class="btn green small" data-act="start" data-id="${r.id}" ${can ? "" : "disabled"}>Start</button>`}
    </div>`;
  }).join("");
  return `<h3>${b.emoji} ${esc(b.name)}</h3><p class="desc">${esc(b.description)}</p>
    <div class="queue">${queue}</div>
    ${done ? `<button class="btn green wide" data-act="collect" data-id="${bid}" style="margin-bottom:12px">${done} einsammeln</button>` : ""}
    ${recipes}`;
}

async function showCode() {
  try { S.sheet.code = await transferCode(); renderSheet(); }
  catch (e) { toast(errText(e), true); }
}
async function copyCode() {
  try { await navigator.clipboard.writeText(S.sheet.code); toast("Code kopiert."); }
  catch { toast("Kopieren ging nicht – markiere den Code und kopiere ihn von Hand.", true); }
}
async function doImport() {
  const v = $("#import-input").value;
  try {
    await importCode(v);
    closeSheet();
    const st = await rpc("game_start");
    S.st = null; apply(st);
    toast("Revier übernommen. Waidmannsheil!");
  } catch (e) { toast(errText(e), true); }
}

/* ============================================================
   Ansitz
   ============================================================ */
// Silhouetten statt Emoji: ein Schmalreh trägt kein Gehörn, ein Jährling schon.
function silhouette(yieldItem, flavor = "") {
  if (yieldItem === "sau") {
    const small = /Frischling/.test(flavor);
    return `<svg viewBox="0 0 130 80" width="${small ? 92 : 124}" aria-label="${esc(flavor)}">
      <g fill="#17120d">
        <path d="M22 44 Q26 14 60 12 Q96 10 111 30 Q119 44 109 56 L32 59 Q17 56 22 44Z"/>
        <path d="M30 28 L4 44 Q3 50 9 52 L33 56Z"/>
        <path d="M33 25 L38 12 L44 26Z"/>
        <rect x="36" y="52" width="7" height="22" rx="2"/><rect x="47" y="53" width="7" height="21" rx="2"/>
        <rect x="90" y="50" width="7" height="24" rx="2"/><rect x="100" y="48" width="7" height="25" rx="2"/>
        <path d="M110 32 Q122 30 121 40" stroke="#17120d" stroke-width="2.5" fill="none"/>
        <path d="M45 13 L50 6 L55 13 L60 5 L65 12 L71 6 L75 13Z"/>
      </g></svg>`;
  }
  const spiesse = /Jährling/.test(flavor);
  return `<svg viewBox="0 0 120 100" width="108" aria-label="${esc(flavor)}">
    <g fill="#17120d">
      <path d="M44 56 C40 44 36 34 35 26 L52 20 C56 30 60 38 66 42 Z"/>
      <path d="M38 30 C34 26 29 25 25 26 C22 27 22 31 25 32 C29 33 35 33 42 33 Z"/>
      <ellipse cx="44" cy="24" rx="9" ry="7"/>
      <ellipse cx="41" cy="13" rx="3.4" ry="7.5" transform="rotate(-22 41 13)"/>
      <ellipse cx="49" cy="14" rx="3.4" ry="7.5" transform="rotate(14 49 14)"/>
      <path d="M46 46 C58 38 86 38 100 44 C106 48 106 58 99 63 C86 68 60 68 50 63 C44 60 42 52 46 46 Z"/>
      <path d="M52 60 L51 94 L55 94 L57 62 Z"/><path d="M60 62 L60 94 L64 94 L65 63 Z"/>
      <path d="M88 60 C92 70 90 80 89 94 L93 94 C95 80 97 70 96 60 Z"/>
      <path d="M95 58 C100 70 98 82 97 94 L101 94 C103 82 105 68 101 56 Z"/>
      ${spiesse ? `<path d="M42 12 L40 -7 M48 12 L50 -7" stroke="#17120d" stroke-width="2.6" stroke-linecap="round"/>` : ""}
    </g>
    <ellipse cx="101" cy="52" rx="4.5" ry="6.5" fill="#e9e1cf" opacity=".8"/>
  </svg>`;
}

async function startHunt(idx) {
  const ps = S.st.stands.find((s) => s.idx === idx);
  const c = stand(ps.stand);
  S.overlay = true;
  S.lastHunt = null;
  const ov = $("#overlay");
  ov.hidden = false;
  ov.innerHTML = `<div class="ansitz">
    <div class="sun"></div>
    <svg class="trees" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true">
      <path fill="#1d2d1c" d="M0 100V62l14-30 12 28 10-40 14 44 12-22 10 30 16-52 14 50 10-20 12 26 16-44 12 40 14-18 10 22 18-56 12 52 12-26 12 30 14-40 12 36 16-24 12 28 18-48 10 42 12-18 14 24 16-36 12 34 14-12 V100z"/>
    </svg>
    <div class="meadow"></div>
    <div class="game" id="game"></div>
    <div class="scope" id="scope"></div>
    <div class="flash" id="flash"></div>
    <div class="text" id="htext"><h3>${esc(c.name)}</h3><p>Du baumst leise auf. Der Wind steht gut …</p></div>
    <div class="acts" id="hacts"></div>
  </div>`;
  try {
    await act("hunt", { p_idx: idx });
  } catch {
    closeHunt();
    return;
  }
  const ev = S.lastHunt || { flavor: "Stück", xp: c.xp };
  const g = $("#game");
  if (g) g.innerHTML = silhouette(c.yield_item, ev.flavor);
  await wait(1300);
  $("#game")?.classList.add("in");
  await wait(1200);
  if (!$("#htext")) return;
  $("#htext").innerHTML = `<h3>${esc(ev.flavor)}</h3><p>Steht breit, Kugelfang passt, das Stück ist frei. Ansprechen – passt!</p>`;
  $("#scope").classList.add("on");
  $("#hacts").innerHTML = `<button class="btn wide pulse" data-act="hunt-shoot" style="padding:16px;font-size:18px">Schuss</button>`;
  S.huntEv = ev;
}

async function shoot() {
  const ev = S.huntEv || {};
  $("#hacts").innerHTML = "";
  $("#flash").classList.add("go");
  navigator.vibrate?.([30, 40, 20]);
  await wait(250);
  $("#scope").classList.remove("on");
  $("#game").classList.add("down");
  await wait(700);
  const hasKammer = owned("wildkammer");
  $("#htext").innerHTML = `<h3>Waidmannsheil!</h3>
    <p>${esc(ev.flavor)} erlegt · +${ev.xp} XP</p><div class="bruch">🌿</div>
    <p style="font-size:14px;margin-top:6px">${hasKammer
      ? "Das Stück hängt in der Lagerhütte. Versorge es in der Wildkammer."
      : "Das Stück liegt in der Lagerhütte. Das Gasthaus nimmt es gern – ab Level 3 baust du die Wildkammer."}</p>`;
  $("#hacts").innerHTML = `<button class="btn green wide" data-act="hunt-close" style="padding:14px">Waidmannsdank</button>`;
}
function closeHunt() {
  S.overlay = false; S.huntEv = null;
  const ov = $("#overlay"); ov.hidden = true; ov.innerHTML = "";
  nextModal();
}
const wait = (t) => new Promise((r) => setTimeout(r, t));

/* ============================================================
   Modals (Willkommen, Level-up)
   ============================================================ */
let modalOpen = false;
function nextModal() {
  if (modalOpen || S.overlay || !S.modals.length) return;
  const m = S.modals.shift();
  modalOpen = true;
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.id = "modal";
  if (m.type === "welcome") {
    wrap.innerHTML = `<div class="modal"><div class="burst">🌲🦌🌲</div>
      <h3>Willkommen in deinem Revier</h3>
      <p>Dein Großonkel hat dir sein Revier im Schwarzwald hinterlassen. Verwildert – aber mit Potenzial.</p>
      <ol><li>Hafer auf die Wildäcker säen und ernten</li><li>In der Futtermühle Äsungsmix mischen</li>
      <li>Den Hochsitz beschicken und ansitzen</li><li>Das Gasthaus beliefern und dein Revier ausbauen</li></ol>
      <button class="btn green wide" data-act="modal-ok">Waidmannsheil!</button></div>`;
  } else {
    const L = m.level;
    const un = [
      ...Object.keys(S.cfg.crops).filter((c) => item(c).unlock_level === L).map((c) => `${icon(c)} ${item(c).name}`),
      ...S.cfg.buildings.filter((b) => b.unlock_level === L).map((b) => `${b.emoji} ${b.name}`),
      ...S.cfg.stands.filter((s) => s.unlock_level === L).map((s) => `${s.emoji} ${s.name}`),
      ...S.cfg.recipes.filter((r) => r.unlock_level === L && !S.cfg.buildings.some((b) => b.id === r.building_id && b.unlock_level === L))
        .map((r) => `${icon(r.output_item)} ${item(r.output_item).name}`),
    ];
    wrap.innerHTML = `<div class="modal"><div class="burst">⭐</div>
      <h3>Level ${L}!</h3>
      <p>+${m.taler} Taler · +${m.grandeln} Grandel${m.grandeln > 1 ? "n" : ""}</p>
      ${un.length ? `<div class="sub">Neu freigeschaltet</div><div class="unlocks">${un.map((u) => `<span>${esc(u)}</span>`).join("")}</div>` : ""}
      <button class="btn wide" data-act="modal-ok">Weiter</button></div>`;
    navigator.vibrate?.([20, 30, 20]);
  }
  document.body.appendChild(wrap);
}
function closeModal() {
  $("#modal")?.remove();
  modalOpen = false;
  nextModal();
}

/* ============================================================
   Toasts & kleine Effekte
   ============================================================ */
function toast(msg, err = false) {
  const el = document.createElement("div");
  el.className = `toast ${err ? "err" : ""}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 2700);
}
function fly(text, x, y) {
  const el = document.createElement("div");
  el.className = "fly";
  el.textContent = text;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  $("#fx").appendChild(el);
  setTimeout(() => el.remove(), 1200);
}
function flyAt(sel, text) {
  const r = $(sel)?.getBoundingClientRect();
  if (r) fly(text, r.left + r.width / 2 - 30, r.top + r.height);
}
function bump(sel) { const el = $(sel); el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }

/* ============================================================
   Start
   ============================================================ */
function fatal(e) {
  const gast = e?.code === "GAST_AUS";
  view.innerHTML = `<div class="card" style="margin-top:30px;text-align:center">
    <div style="font-size:48px">${gast ? "🔒" : "📡"}</div>
    <h3 class="title" style="font-size:20px">${gast ? "Das Revier ist noch nicht geöffnet" : "Keine Verbindung zum Revier"}</h3>
    <p class="muted">${gast ? "Der Gastzugang ist auf dem Server noch nicht eingeschaltet." : esc(errText(e))}</p>
    <button class="btn green" data-act="retry">Erneut versuchen</button></div>`;
}

async function boot() {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; render(); });
  try {
    S.cfg = await loadConfig();
    let st;
    try { st = await rpc("game_start"); }
    catch (e) {
      if (e.code !== "SITZUNG_UNGUELTIG") throw e;
      resetSession();
      st = await rpc("game_start");
      toast("Neue Sitzung gestartet.");
    }
    apply(st);
  } catch (e) {
    fatal(e);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.st) act("game_state").catch(() => {});
});

boot();
