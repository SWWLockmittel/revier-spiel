import { rpc, loadConfig, transferCode, importCode, resetSession } from "./api.js";
import { APP_VERSION } from "./config.js";
import { createMap, REVIER_SLOTS } from "./map.js";
import * as I from "./iso.js";

/* ============================================================
   Zustand & Helfer
   ============================================================ */
const S = {
  cfg: null, st: null, offset: 0,
  panel: null, modals: [], overlay: false,
  seed: null, plantMode: false, plantLeft: 0,
  confirmDiscard: null, installEvt: null, lastHunt: null, lastTrap: null,
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = () => Date.now() + S.offset;
const ms = (iso) => (iso ? Date.parse(iso) : 0);
const lvl = () => S.st.player.level;
const inv = (id) => S.st.inventory[id] || 0;
const item = (id) => S.cfg.items[id] || { name: id, emoji: "❔" };
const icon = (id) => item(id).emoji;
const storeName = (s) => (s === "lager" ? "Futterlager" : "Lagerhütte");
const building = (id) => S.cfg.buildings.find((b) => b.id === id);
const standCfg = (id) => S.cfg.stands.find((s) => s.id === id);
const revierCfg = (id) => S.cfg.reviere.find((r) => r.id === id);
const owned = (bid) => S.st.buildings.some((b) => b.id === bid);
const hasRevier = (rid) => S.st.reviere.some((r) => r.id === rid);
const sellPrice = (id) => Math.max(1, Math.floor(item(id).price * (S.cfg.settings.sell?.factor ?? 0.5)));
const taler = (n) => `<i class="ico-taler"></i>${n}`;

function fmt(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h} h ${m} min` : `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDur(sec) {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* ============================================================
   Server-Aktionen (immer nacheinander)
   ============================================================ */
let chain = Promise.resolve();
function act(name, args = {}, { quiet = false } = {}) {
  const run = async () => {
    try { const st = await rpc(name, args); apply(st); return st; }
    catch (e) { if (!quiet) toast(errText(e), true); refresh(); throw e; }
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
    case "ZU_WENIG_GRANDELN": return "Dafür reichen deine Grandeln nicht.";
    case "ZU_WENIG_ANSEHEN": return `Dafür brauchst du ${d} Ansehen.`;
    case "MAXIMUM": return "Hier ist kein Platz mehr frei.";
    case "NICHT_BEREIT": return "Das ist noch nicht so weit.";
    case "BESCHAEFTIGT": return "Hier läuft schon etwas.";
    case "KEIN_FALLENSCHEIN": return "Erst brauchst du den Fallenlehrgang.";
    case "KEIN_REVIER": return "Dieses Revier hast du noch nicht gepachtet.";
    case "PASST_NICHT": return "Dieses Lockmittel passt hier nicht.";
    case "SCHON_DA": return "Das hast du schon.";
    case "NAME_UNGUELTIG": return "Der Name braucht 2 bis 30 Zeichen.";
    case "OFFLINE": return "Keine Verbindung. Prüfe dein Netz.";
    case "GAST_AUS": return "Der Gastzugang ist noch nicht freigeschaltet.";
    case "CODE_UNGUELTIG": return "Der Code ist ungültig oder wurde schon benutzt.";
    default: return "Da ist etwas schiefgegangen. Versuch es nochmal.";
  }
}
function refresh() { if (S.st) { map.render(); renderHud(); if (S.panel) renderPanel(); } }

function apply(st) {
  const prev = S.st;
  S.st = st;
  S.offset = Date.parse(st.now) - Date.now();
  if (prev) {
    if (st.player.taler !== prev.player.taler) bump("#taler-pill");
    if (st.player.grandeln !== prev.player.grandeln) bump("#grandel-pill");
    if (st.player.ansehen !== prev.player.ansehen) bump("#ansehen-pill");
  }
  handleEvents(st.events || []);
  map.render(); renderHud();
  if (S.panel) renderPanel();
  if (!$("#karte").hidden) renderKarte();
  if (S.plantMode) renderSeedbar();
}

function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case "welcome": S.modals.push({ type: "welcome" }); break;
      case "levelup": S.modals.push({ type: "levelup", ...ev }); break;
      case "drop": toast(`Fund im Revier: ${icon(ev.item)} ${item(ev.item).name}!`); break;
      case "full": toast(`${storeName(ev.storage)} ist voll!`, true); break;
      case "order": toast(`Geliefert: +${ev.taler} Taler · +${ev.xp} XP${ev.bonus ? ` · Bonus ${icon(ev.bonus)} ${item(ev.bonus).name}` : ""}`); break;
      case "collect": toast(`+${ev.qty} ${icon(ev.item)} ${item(ev.item).name}`); break;
      case "sold": toast(`Verkauft: ${ev.qty}× ${icon(ev.item)} für ${ev.taler} Taler`); break;
      case "bought": toast(`Gekauft: ${ev.qty}× ${icon(ev.item)} ${item(ev.item).name}`); break;
      case "built": toast(ev.building ? `${building(ev.building).name} gebaut – steht jetzt auf deinem Hof.` : ev.stand ? `${standCfg(ev.stand).name} gebaut.` : "Kastenfalle aufgestellt."); break;
      case "upgrade": toast(`${storeName(ev.storage)} ausgebaut!`); break;
      case "revier": toast(`Waidmannsheil! ${revierCfg(ev.revier).name} gepachtet.`); break;
      case "course": S.modals.push({ type: "course" }); break;
      case "hunt": S.lastHunt = ev; break;
      case "trap": S.lastTrap = ev; break;
    }
  }
  setTimeout(nextModal, 60);
}

/* ============================================================
   Karte
   ============================================================ */
let saveTimer = null;
const map = createMap($("#map"), {
  getState: () => S.st, getCfg: () => S.cfg, now,
  layoutChanged(layout, explicit) {
    S.st.layout = layout;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => act("save_layout", { p_layout: layout }, { quiet: !explicit }).catch(() => {}), explicit ? 0 : 400);
  },
  strokeKind(key) {
    if (!key?.startsWith("plot:")) return null;
    const p = S.st.plots.find((x) => x.idx === +key.slice(5));
    if (!p) return null;
    if (p.crop && ms(p.ready_at) <= now()) return "harvest";
    if (!p.crop && S.plantMode && S.seed && inv(S.seed) > 0) return "plant";
    return null;
  },
  strokeTouch(kind, key, x, y) {
    const p = S.st.plots.find((q) => q.idx === +key.slice(5));
    if (kind === "harvest") fly(`+2 ${icon(p.crop)}`, x - 18, y - 30);
    else { if (S.plantLeft <= 0) return; S.plantLeft--; fly(icon(S.seed), x - 10, y - 26); }
    navigator.vibrate?.(6);
  },
  onStroke(kind, keys) {
    const idx = keys.map((k) => +k.slice(5));
    if (kind === "harvest") act("harvest", { p_plots: idx }).catch(() => {});
    else act("plant", { p_plots: idx, p_crop: S.seed }).catch(() => {});
  },
  onTap,
});

function onTap(key) {
  if (!key) { if (S.plantMode) closeSeedbar(); return; }
  const [kind, a, b] = key.split(":");
  if (kind === "plot") {
    const p = S.st.plots.find((x) => x.idx === +a);
    if (p.crop && ms(p.ready_at) > now()) { toast(`${icon(p.crop)} ${item(p.crop).name} ist reif in ${fmt((ms(p.ready_at) - now()) / 1000)}`); return; }
    if (!p.crop) {
      if (!S.plantMode) { openSeedbar(); return; }
      if (S.seed && inv(S.seed) > 0) { act("plant", { p_plots: [p.idx], p_crop: S.seed }).catch(() => {}); return; }
      toast("Wähle unten eine Saat, die du im Lager hast.", true);
    }
    return;
  }
  closeSeedbar();
  if (kind === "deco" && a === "hut") openPanel({ type: "hut" });
  else if (kind === "deco" && a === "sign") openKarte();
  else if (kind === "deco" && a === "home") goHof();
  else if (kind === "bld") openPanel({ type: "building", id: a });
  else if (kind === "stand") {
    const ps = S.st.stands.find((s) => s.idx === +a);
    if (ps.ready_at && ms(ps.ready_at) <= now()) startHunt(ps.idx);
    else openPanel({ type: "stand", idx: ps.idx });
  } else if (kind === "trap") {
    const pt = S.st.traps.find((t) => t.idx === +a);
    if (pt.ready_at && ms(pt.ready_at) <= now()) checkTrap(pt.idx);
    else openPanel({ type: "trap", idx: pt.idx });
  } else if (kind === "slot") openPanel({ type: a === "stand" ? "buy-stand" : "buy-trap", revier: b });
}

function goHof() { $("#karte").hidden = true; if (map.scene !== "hof") map.setScene("hof"); renderHud(); }
function goRevier(rid) {
  $("#karte").hidden = true; closePanel(); closeSeedbar(); map.setScene(`revier:${rid}`); renderHud();
  const r = revierCfg(rid), title = $("#scene-title");
  title.textContent = `${r.emoji} ${r.name}`; title.hidden = false;
  clearTimeout(goRevier.t); goRevier.t = setTimeout(() => { title.hidden = true; }, 1800);
}

/* ---------- Saatgut-Leiste ---------- */
function openSeedbar() { S.plantMode = true; renderSeedbar(); }
function closeSeedbar() { S.plantMode = false; $("#seedbar").hidden = true; }
function renderSeedbar() {
  const crops = Object.keys(S.cfg.crops).sort((a, b) => item(a).sort - item(b).sort);
  const unlocked = crops.filter((c) => item(c).unlock_level <= lvl());
  if (!S.seed || !unlocked.includes(S.seed) || (!inv(S.seed) && unlocked.some((c) => inv(c) > 0))) S.seed = unlocked.find((c) => inv(c) > 0) || unlocked[0];
  S.plantLeft = inv(S.seed);
  const next = crops.find((c) => item(c).unlock_level > lvl());
  $("#seedbar").innerHTML = `<span class="seedbar-hint">Saat wählen, dann über leere Äcker wischen</span>` +
    unlocked.map((c) => `<button class="seed ${c === S.seed ? "sel" : ""} ${inv(c) ? "" : "zero"}" data-act="seed" data-id="${c}">
      <span class="c">${inv(c)}</span><span class="e">${icon(c)}</span><span class="n">${esc(item(c).name)}</span><span class="n muted">${fmtDur(S.cfg.crops[c].grow_seconds)}</span></button>`).join("") +
    (next ? `<div class="seed locked"><span class="e">${icon(next)}</span><span class="n">${esc(item(next).name)}</span><span class="n">ab Lv ${item(next).unlock_level}</span></div>` : "") +
    `<button class="seedbar-x" data-act="seed-close" aria-label="Schließen">✕</button>`;
  $("#seedbar").hidden = false;
}

/* ============================================================
   HUD
   ============================================================ */
function renderHud() {
  const p = S.st.player;
  $("#lvl-num").textContent = p.level;
  $("#revier-name").textContent = p.revier_name;
  $("#xp-fill").style.width = `${Math.min(100, (p.xp / (p.xp_to_next || p.xp || 1)) * 100)}%`;
  $("#lvl").title = p.xp_to_next ? `${p.xp} / ${p.xp_to_next} XP` : `${p.xp} XP`;
  $("#taler").textContent = p.taler;
  $("#grandeln").textContent = p.grandeln;
  $("#ansehen").textContent = p.ansehen ?? 0;
  const t = now();
  setBadge("#badge-gasthaus", S.st.orders.filter((o) => ms(o.available_at) <= t && o.items.every((i) => inv(i.item) >= i.qty)).length);
  setBadge("#badge-bauen", S.cfg.buildings.filter((b) => !owned(b.id) && b.unlock_level <= p.level && b.cost <= p.taler).length);
  const inRevier = map.scene.startsWith("revier:");
  $("#btn-hof").hidden = !inRevier;

  const editing = map.editing;
  $("#editbar").hidden = !editing;
  $("#hud-left").hidden = editing; $("#hud-right").hidden = editing;
}
function setBadge(sel, n) { const el = $(sel); el.hidden = !n; el.textContent = n; }

/* ============================================================
   Panels
   ============================================================ */
function openPanel(p) { closeSeedbar(); S.panel = p; S.confirmDiscard = null; $("#panel").scrollTop = 0; renderPanel(); }
function closePanel() { S.panel = null; $("#panel").hidden = true; $("#panel-backdrop").hidden = true; document.body.classList.remove("panel-open"); }
$("#panel-backdrop").addEventListener("click", closePanel);

function head(title, sub = "") {
  return `<div class="p-head"><h3>${title}</h3><button class="p-close" data-act="close" aria-label="Schließen">✕</button></div>${sub ? `<p class="desc">${sub}</p>` : ""}`;
}

function renderPanel() {
  const p = S.panel; if (!p || !S.st) return;
  const el = $("#panel");
  const y = el.scrollTop;
  let h = "";
  switch (p.type) {
    case "building": h = pBuilding(p.id); break;
    case "gasthaus": h = pGasthaus(); break;
    case "lager": h = pLager(); break;
    case "bauen": h = pBauen(); break;
    case "hut": h = pHut(); break;
    case "stand": h = pStand(p.idx); break;
    case "trap": h = pTrap(p.idx); break;
    case "buy-stand": h = pBuyStand(p.revier); break;
    case "buy-trap": h = pBuyTrap(p.revier); break;
    case "sell": h = pSell(p); break;
    case "seed": h = pSeed(p); break;
    case "boost": h = pBoost(p); break;
    case "rename": h = head("Revier benennen", "So heißt dein Revier – später auch für deinen Hegering.") +
      `<input id="rename-input" class="field" maxlength="30" value="${esc(S.st.player.revier_name)}" autocomplete="off"><button class="btn green wide" data-act="rename-go">Speichern</button>`; break;
    case "transfer": h = pTransfer(p); break;
  }
  if (h === null) { closePanel(); return; }
  el.innerHTML = h;
  el.hidden = false; $("#panel-backdrop").hidden = false; document.body.classList.add("panel-open");
  el.scrollTop = y;
  tickPanel();
}

/* ---------- Betrieb ---------- */
const jobsOf = (bid) => S.st.jobs.filter((j) => j.building === bid);
function pBuilding(bid) {
  const b = building(bid), pb = S.st.buildings.find((x) => x.id === bid);
  if (!pb) return null;
  const jobs = jobsOf(bid), t = now();
  const done = jobs.filter((j) => ms(j.ready_at) <= t).length;
  const queue = Array.from({ length: pb.slots }, (_, i) => {
    const j = jobs[i];
    if (!j) return `<div class="q">frei</div>`;
    const r = S.cfg.recipes.find((r) => r.id === j.recipe);
    if (ms(j.ready_at) <= t) return `<div class="q done"><span><span class="e">${icon(r.output_item)}</span>fertig</span></div>`;
    return `<div class="q busy"><span><span class="e">${icon(r.output_item)}</span>${ms(j.start_at) > t ? "wartet" : `<b data-until="${j.ready_at}"></b>`}</span></div>`;
  }).join("");
  const full = jobs.length >= pb.slots;
  const recipes = S.cfg.recipes.filter((r) => r.building_id === bid).map((r) => {
    const locked = r.unlock_level > lvl();
    const ins = Object.entries(r.inputs).map(([k, v]) => `<span class="${inv(k) >= v ? "" : "no"}">${icon(k)} ${inv(k)}/${v}</span>`).join("");
    const can = !locked && !full && Object.entries(r.inputs).every(([k, v]) => inv(k) >= v);
    return `<div class="recipe ${locked ? "locked" : ""}"><div class="out">${icon(r.output_item)}${r.output_qty > 1 ? `<sub>×${r.output_qty}</sub>` : ""}</div>
      <div class="grow"><div class="title">${esc(r.label || item(r.output_item).name)}</div>
      <div class="sub">${locked ? `ab Level ${r.unlock_level}` : `${fmtDur(r.seconds)} · ${r.xp} XP`}</div><div class="ins">${ins}</div></div>
      ${locked ? "" : `<button class="btn green small" data-act="start" data-id="${r.id}" ${can ? "" : "disabled"}>Start</button>`}</div>`;
  }).join("");
  return head(`${b.emoji} ${esc(b.name)}`, esc(b.description)) + `<div class="queue">${queue}</div>` +
    (done ? `<button class="btn green wide" data-act="collect" data-id="${bid}" style="margin-bottom:10px">${done} einsammeln</button>` : "") + recipes;
}

/* ---------- Gasthaus ---------- */
function pGasthaus() {
  const t = now();
  const cards = S.st.orders.map((o) => {
    if (ms(o.available_at) > t) return `<div class="card order wait"><div>Neuer Gast in<br><b data-until="${o.available_at}"></b></div></div>`;
    const ok = o.items.every((i) => inv(i.item) >= i.qty);
    const needs = o.items.map((i) => `<span class="${inv(i.item) >= i.qty ? "ok" : "no"}" title="${esc(item(i.item).name)}">${icon(i.item)} ${Math.min(inv(i.item), i.qty)}/${i.qty}</span>`).join("");
    const conf = S.confirmDiscard === o.slot;
    return `<div class="card order ${ok ? "ready-to-go" : ""}"><div class="need">${needs}</div>
      <div class="sub">${o.items.map((i) => esc(item(i.item).name)).join(", ")}</div>
      <div class="reward"><span>${taler(o.taler)}</span><span>${o.xp} XP</span>${o.bonus ? `<span title="${esc(item(o.bonus).name)}">+ ${icon(o.bonus)}</span>` : ""}</div>
      <div class="acts"><button class="btn green small" data-act="deliver" data-slot="${o.slot}" ${ok ? "" : "disabled"}>Liefern</button>
      <button class="btn ${conf ? "" : "ghost"} small" data-act="discard" data-slot="${o.slot}" aria-label="Ablehnen">${conf ? "Weg?" : "✕"}</button></div></div>`;
  }).join("");
  return head("Gasthaus „Zum Hirschen“", "Der Wirt nimmt alles, was dein Revier hergibt. Manche Gäste legen ein Schwarzwaldwässerle-Lockmittel obendrauf.") + `<div class="orders">${cards}</div>`;
}

/* ---------- Lager ---------- */
function pLager() {
  const st = S.st;
  const mk = (key) => {
    const s = st.storage[key];
    const ids = Object.keys(st.inventory).filter((id) => item(id).storage === key && inv(id) > 0 && item(id).kind !== "boost").sort((a, b) => item(a).sort - item(b).sort);
    const mats = S.cfg.settings.storage[`${key}_materials`];
    const canUp = mats.every((m) => inv(m) >= s.need);
    return `<div class="card"><div class="row"><div class="grow"><div class="title">${storeName(key)}</div><div class="sub">Stufe ${s.level + 1} · ${s.used}/${s.cap} Plätze</div></div></div>
      <div class="bar"><i style="width:${Math.min(100, (s.used / s.cap) * 100)}%;${s.used >= s.cap ? "background:var(--red)" : ""}"></i></div>
      <div class="items">${ids.length ? ids.map((id) => `<button class="item" data-act="sell" data-id="${id}"><span class="e">${icon(id)}</span><span class="q">${inv(id)}</span><span class="nm">${esc(item(id).name)}</span></button>`).join("") : `<p class="muted" style="margin:4px">Noch leer.</p>`}</div>
      <div class="sub" style="margin-top:10px">Ausbau auf ${s.cap + S.cfg.settings.storage.per_level} Plätze braucht je ${s.need}×:</div>
      <div class="mats">${mats.map((m) => `<span class="${inv(m) >= s.need ? "ok" : ""}">${icon(m)} ${esc(item(m).name)} ${inv(m)}/${s.need}</span>`).join("")}</div>
      <button class="btn ${canUp ? "green" : "ghost"} wide" data-act="upgrade" data-id="${key}" ${canUp ? "" : "disabled"}>Ausbauen</button></div>`;
  };
  const boosts = Object.entries(S.cfg.boosts).sort((a, b) => item(a[0]).sort - item(b[0]).sort).map(([id, b]) => {
    const locked = item(id).unlock_level > lvl();
    return `<div class="card"><div class="row"><div class="big-e">${icon(id)}</div><div class="grow">
      <div class="title">${esc(item(id).name)} <span class="muted" style="font-weight:700">· ${inv(id)} im Lager</span></div>
      <div class="sub">${esc(b.description || "")}</div>
      ${b.shop_url ? `<a class="shop" href="${esc(b.shop_url)}" target="_blank" rel="noopener">Im Schwarzwaldwässerle-Shop ansehen ↗</a>` : ""}</div>
      ${locked ? `<span class="btn ghost small" disabled>ab Lv ${item(id).unlock_level}</span>` : `<button class="btn small" data-act="boost" data-id="${id}"><i class="ico-grandel"></i>${b.grandeln_price}</button>`}</div></div>`;
  }).join("");
  return head("Lager", "Antippen zum Verkaufen. Baumaterial findest du zufällig beim Ernten, in der Produktion, beim Ansitz und an der Falle.") +
    mk("lager") + `<div style="height:8px"></div>` + mk("huette") +
    `<div class="sec-t">Schwarzwaldwässerle-Lockmittel</div>${boosts}`;
}

/* ---------- Bauen ---------- */
function pBauen() {
  const p = S.st.player;
  const bCards = S.cfg.buildings.map((b) => {
    const has = owned(b.id), locked = b.unlock_level > p.level;
    const right = has ? `<span class="btn ghost small">✓ gebaut</span>` : locked ? `<span class="btn ghost small">ab Lv ${b.unlock_level}</span>`
      : `<button class="btn small" data-act="build" data-id="${b.id}" ${p.taler >= b.cost ? "" : "disabled"}>${taler(b.cost)}</button>`;
    return `<div class="card"><div class="row"><div class="big-e" ${locked ? 'style="filter:grayscale(1)"' : ""}>${b.emoji}</div>
      <div class="grow"><div class="title">${esc(b.name)}</div><div class="sub">${esc(b.description)}</div></div>${right}</div></div>`;
  }).join("");
  const ps = S.st.plot_shop;
  const plotRight = ps.owned >= ps.max ? `<span class="btn ghost small">${ps.owned}/${ps.max}</span>`
    : `<button class="btn small" data-act="buy-plot" ${p.taler >= ps.cost ? "" : "disabled"}>${taler(ps.cost)}</button>`;
  return head("Bauen", "Neue Gebäude und Äcker erscheinen auf einem freien Platz. Mit „Hof umstellen“ ordnest du alles neu.") +
    `<button class="btn green wide" data-act="edit-start">Hof umstellen</button>
    <div class="sec-t">Fläche</div><div class="card"><div class="row"><div class="big-e">🟫</div>
      <div class="grow"><div class="title">Neuen Wildacker roden</div><div class="sub">${ps.owned} von ${ps.max} möglich · mit jedem Level einer mehr</div></div>${plotRight}</div></div>
    <div class="sec-t">Betriebe</div>${bCards}
    <p class="sub" style="margin-top:12px">Hochsitze, Kanzeln und Fallen baust du direkt im Revier auf den freien Plätzen.</p>`;
}

/* ---------- Jagdhütte / Profil ---------- */
function pHut() {
  const p = S.st.player;
  const fs = S.cfg.settings.fallen;
  return head(`🏠 Jagdhütte`, "Dein Zuhause im Revier.") +
    `<div class="card"><div class="row"><div class="grow"><div class="title">${esc(p.revier_name)}</div><div class="sub">Level ${p.level} · ${p.xp}/${p.xp_to_next ?? "–"} XP · Ansehen ${p.ansehen}</div></div>
      <button class="btn ghost small" data-act="rename">Umbenennen</button></div></div>
    <div class="card"><div class="row"><div class="big-e">📜</div><div class="grow"><div class="title">Fallenlehrgang</div>
      <div class="sub">${p.fallenschein ? "Bestanden – du darfst Fallen stellen." : `Pflicht für die Fallenjagd. Ab Level ${fs.course_level}, ${fs.course_cost} Taler.`}</div></div>
      ${p.fallenschein ? `<span class="btn ghost small">✓</span>` : `<button class="btn small" data-act="course" ${p.level >= fs.course_level && p.taler >= fs.course_cost ? "" : "disabled"}>${taler(fs.course_cost)}</button>`}</div></div>
    <div class="card"><div class="row"><div class="big-e">📲</div><div class="grow"><div class="title">Revier übertragen</div><div class="sub">Auf ein anderes Gerät oder in die Homescreen-App mitnehmen.</div></div>
      <button class="btn ghost small" data-act="transfer">Öffnen</button></div></div>
    ${installHint()}
    <p class="sub" style="text-align:center;margin-top:14px">Version ${APP_VERSION}</p>`;
}
function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function installHint() {
  if (isStandalone()) return "";
  if (S.installEvt) return `<div class="install" style="margin-top:8px">📲 Als App installieren – startet schneller und im Vollbild. <button class="btn small" data-act="install">Installieren</button></div>`;
  if (isIOS()) return `<div class="install" style="margin-top:8px">📲 In Safari: Teilen → „Zum Home-Bildschirm“. Vorher hier den Übertragungs-Code holen, damit dein Revier mitkommt.</div>`;
  return "";
}

/* ---------- Hochsitz ---------- */
function boostsFor(yieldItem, target) {
  return Object.entries(S.cfg.boosts).filter(([, b]) => b.target === target && (!b.applies_to.length || b.applies_to.includes(yieldItem)));
}
function pStand(idx) {
  const ps = S.st.stands.find((s) => s.idx === idx); if (!ps) return null;
  const c = standCfg(ps.stand), t = now();
  const rv = S.st.reviere.find((r) => r.id === ps.revier);
  let body = "";
  if (!ps.ready_at) {
    const have = inv(c.feed_item);
    const base = c.wait_seconds * (rv?.hege_factor ?? 1);
    const recipe = S.cfg.recipes.find((r) => r.output_item === c.feed_item);
    body += `<div class="sec-t">Beschicken</div>`;
    if (have < c.feed_qty) {
      body += `<div class="card"><div class="sub">Du brauchst ${c.feed_qty}× ${icon(c.feed_item)} ${esc(item(c.feed_item).name)} (du hast ${have}).</div>
        ${recipe ? `<button class="btn ghost small" style="margin-top:8px" data-act="goto-b" data-id="${recipe.building_id}">Zur ${esc(building(recipe.building_id).name)}</button>`
          : item(c.feed_item).buy_price ? `<button class="btn small" style="margin-top:8px" data-act="seed" data-id="${c.feed_item}">Beim Landhandel kaufen</button>` : ""}</div>`;
    } else {
      body += `<button class="choice" data-act="feed" data-idx="${idx}"><span class="e">${icon(c.feed_item)}</span><span class="grow"><span class="title">Ohne Lockmittel</span><br><span class="sub">${c.feed_qty}× ${esc(item(c.feed_item).name)} · Wild kommt in ${fmtDur(Math.ceil(base))}</span></span></button>`;
      for (const [id, b] of boostsFor(c.yield_item, "stand")) {
        const n = inv(id);
        body += `<button class="choice ${n ? "best" : ""}" data-act="${n ? "feed" : "boost"}" data-idx="${idx}" data-boost="${id}" data-id="${id}">
          <span class="e">${icon(id)}</span><span class="grow"><span class="title">Mit ${esc(item(id).name)} <span class="muted">(${n} im Lager)</span></span><br>
          <span class="sub">${fmtDur(Math.ceil(base * b.wait_factor))} statt ${fmtDur(Math.ceil(base))} · ${Math.round(b.bonus_chance * 100)} % Chance auf ein zweites Stück${n ? "" : ` · kaufen für ${b.grandeln_price} Grandeln`}</span></span></button>`;
      }
    }
  } else if (ms(ps.ready_at) > t) {
    body += `<div class="card"><div class="title">Wild zieht an …</div><div class="sub">Noch <b data-until="${ps.ready_at}"></b>${ps.boost ? ` · mit ${icon(ps.boost)} ${esc(item(ps.boost).name)}` : ""}</div></div>`;
  } else {
    body += `<button class="btn wide pulse" data-act="hunt" data-idx="${idx}">Ansitzen</button>`;
  }
  return head(`${c.emoji} ${esc(c.name)}`, `${esc(revierCfg(ps.revier).name)} · Beute: ${icon(c.yield_item)} ${esc(item(c.yield_item).name)}`) + body +
    `<p class="sub" style="margin-top:12px">Hege im Revier: ${rv?.hege ?? 0} Punkte – senkt die Wartezeit um ${Math.round((1 - (rv?.hege_factor ?? 1)) * 100)} %. Fallenjagd auf Raubwild verbessert die Hege.</p>`;
}

/* ---------- Falle ---------- */
function pTrap(idx) {
  const pt = S.st.traps.find((t) => t.idx === idx); if (!pt) return null;
  const c = S.cfg.traps.find((t) => t.id === pt.trap), t = now();
  const catches = S.cfg.trap_catches.filter((x) => x.revier === pt.revier && x.kind === "catch").map((x) => `${icon(x.item)} ${esc(x.flavor)}`).join(", ");
  let body = "";
  if (!pt.ready_at) {
    const have = inv(c.bait_item);
    body += `<div class="sec-t">Fängisch stellen</div>`;
    if (have < c.bait_qty) {
      body += `<div class="card"><div class="sub">Du brauchst ${c.bait_qty}× ${icon(c.bait_item)} ${esc(item(c.bait_item).name)} (du hast ${have}). Fallenköder machst du in der Wildkammer aus Rehwildbret.</div>
        ${owned("wildkammer") ? `<button class="btn ghost small" style="margin-top:8px" data-act="goto-b" data-id="wildkammer">Zur Wildkammer</button>` : ""}</div>`;
    } else {
      body += `<button class="choice" data-act="set-trap" data-idx="${idx}"><span class="e">${icon(c.bait_item)}</span><span class="grow"><span class="title">Nur mit Köder</span><br><span class="sub">Fangmelder meldet sich nach etwa ${fmtDur(c.wait_seconds)} · die Falle kann auch leer bleiben</span></span></button>`;
      for (const [id, b] of boostsFor(null, "trap")) {
        const n = inv(id);
        const pref = b.prefer_item ? ` · lockt bevorzugt ${icon(b.prefer_item)}` : "";
        body += `<button class="choice ${n ? "best" : ""}" data-act="${n ? "set-trap" : "boost"}" data-idx="${idx}" data-boost="${id}" data-id="${id}">
          <span class="e">${icon(id)}</span><span class="grow"><span class="title">Mit ${esc(item(id).name)} <span class="muted">(${n})</span></span><br>
          <span class="sub">${fmtDur(Math.ceil(c.wait_seconds * b.wait_factor))} · bleibt nie leer${pref}${n ? "" : ` · ${b.grandeln_price} Grandeln`}</span></span></button>`;
      }
    }
  } else if (ms(pt.ready_at) > t) {
    body += `<div class="card"><div class="title">Falle ist fängisch</div><div class="sub">Fangmelder in etwa <b data-until="${pt.ready_at}"></b></div></div>`;
  } else body += `<button class="btn wide pulse" data-act="check-trap" data-idx="${idx}">Falle kontrollieren</button>`;
  return head(`${c.emoji} ${esc(c.name)}`, `${esc(revierCfg(pt.revier).name)} · möglicher Fang: ${catches}`) + body +
    `<p class="sub" style="margin-top:12px">Lebendfalle mit Fangmelder: Sobald etwas drin ist, wirst du benachrichtigt – kein Tier wartet. Igel, Katzen und Dachse werden unversehrt freigelassen. Jeder Raubwild-Fang verbessert die Hege im Revier.</p>`;
}

/* ---------- Bauplätze im Revier ---------- */
function pBuyStand(rid) {
  const r = revierCfg(rid), p = S.st.player;
  const total = S.st.stands.filter((s) => s.revier === rid).length;
  const list = S.cfg.stands.filter((s) => s.revier_id === rid).map((s) => {
    const n = S.st.stands.filter((x) => x.stand === s.id).length;
    const locked = s.unlock_level > p.level;
    const right = locked ? `<span class="btn ghost small">ab Lv ${s.unlock_level}</span>` : n >= s.max_count ? `<span class="btn ghost small">${n}/${s.max_count}</span>`
      : `<button class="btn small" data-act="buy-stand" data-id="${s.id}" ${p.taler >= s.cost ? "" : "disabled"}>${taler(s.cost)}</button>`;
    return `<div class="card"><div class="row"><div class="big-e">${s.emoji}</div><div class="grow"><div class="title">${esc(s.name)}</div>
      <div class="sub">${icon(s.feed_item)} ${esc(item(s.feed_item).name)} → ${icon(s.yield_item)} ${esc(item(s.yield_item).name)} · ${fmtDur(s.wait_seconds)}</div></div>${right}</div></div>`;
  }).join("");
  return head(`Bauplatz im ${esc(r.name)}`, `${total} von ${r.max_stands} Ansitzplätzen belegt. Mehr Hochsitze bedeuten mehr Anblick – und mehr Wildbret.`) + list;
}
function pBuyTrap(rid) {
  const r = revierCfg(rid), p = S.st.player, c = S.cfg.traps[0], fs = S.cfg.settings.fallen;
  if (!p.fallenschein) {
    return head("Platz für eine Falle", "Fallenjagd ist Hege: Sie schützt Bodenbrüter, Feldhase und Fasan.") +
      `<div class="card"><div class="row"><div class="big-e">📜</div><div class="grow"><div class="title">Fallenlehrgang</div>
      <div class="sub">Ohne Lehrgang keine Fallenjagd. ${p.level < fs.course_level ? `Ab Level ${fs.course_level}.` : "Du bekommst 3 Fallenköder dazu."}</div></div>
      <button class="btn small" data-act="course" ${p.level >= fs.course_level && p.taler >= fs.course_cost ? "" : "disabled"}>${taler(fs.course_cost)}</button></div></div>`;
  }
  const n = S.st.traps.filter((t) => t.revier === rid).length;
  return head(`Platz für eine Falle`, `${esc(r.name)} · ${n} von ${r.max_traps} Fallenplätzen belegt.`) +
    `<div class="card"><div class="row"><div class="big-e">${c.emoji}</div><div class="grow"><div class="title">${esc(c.name)}</div><div class="sub">Lebendfalle mit Fangmelder · Köder: ${icon(c.bait_item)} ${esc(item(c.bait_item).name)}</div></div>
    <button class="btn small" data-act="buy-trap" data-id="${rid}" ${p.taler >= c.cost ? "" : "disabled"}>${taler(c.cost)}</button></div></div>`;
}

/* ---------- Kleine Dialoge ---------- */
function pSell(p) {
  if (!inv(p.id)) return null;
  p.qty = Math.min(p.qty, inv(p.id));
  const pr = sellPrice(p.id);
  return head(`${icon(p.id)} ${esc(item(p.id).name)}`, `Du hast ${inv(p.id)} Stück. Der Händler zahlt ${pr} Taler pro Stück – im Gasthaus bekommst du meist mehr.`) +
    `<div class="stepper"><button class="btn ghost" data-act="qty" data-d="-1">−</button><b>${p.qty}</b><button class="btn ghost" data-act="qty" data-d="1">+</button><button class="btn ghost small" data-act="qty-max">Alle</button></div>
    <button class="btn wide" data-act="sell-go">Verkaufen für ${taler(pr * p.qty)}</button>`;
}
function pSeed(p) {
  const per = item(p.id).buy_price ?? item(p.id).price * 2;
  return head(`${icon(p.id)} ${esc(item(p.id).name)} kaufen`, `Beim Landhandel kostet ein Stück ${per} Taler.${S.cfg.crops[p.id] ? " Billiger ist es, einen Teil der eigenen Ernte wieder auszusäen – jede Saat bringt doppelt zurück." : ""}`) +
    `<div class="stepper"><button class="btn ghost" data-act="qty" data-d="-1">−</button><b>${p.qty}</b><button class="btn ghost" data-act="qty" data-d="1">+</button></div>
    <button class="btn wide" data-act="seed-go" ${S.st.player.taler >= per * p.qty ? "" : "disabled"}>Kaufen für ${taler(per * p.qty)}</button>`;
}
function pBoost(p) {
  const b = S.cfg.boosts[p.id];
  return head(`${icon(p.id)} ${esc(item(p.id).name)}`, esc(b.description || "")) +
    `<div class="stepper"><button class="btn ghost" data-act="qty" data-d="-1">−</button><b>${p.qty}</b><button class="btn ghost" data-act="qty" data-d="1">+</button></div>
    <button class="btn wide" data-act="boost-go" ${S.st.player.grandeln >= b.grandeln_price * p.qty ? "" : "disabled"}>Kaufen für <i class="ico-grandel"></i> ${b.grandeln_price * p.qty} Grandeln</button>
    ${b.shop_url ? `<p class="sub" style="margin-top:12px">Das gibt es auch in echt: <a class="shop" href="${esc(b.shop_url)}" target="_blank" rel="noopener">${esc(item(p.id).name)} im Schwarzwaldwässerle-Shop ↗</a></p>` : ""}`;
}
function pTransfer(p) {
  return head("Revier übertragen", "Dein Revier hängt an diesem Gerät. Mit dem Code nimmst du es mit – zum Beispiel aus Safari in die Homescreen-App. Der Code gilt einmal.") +
    (p.code ? `<div class="codebox">${esc(p.code)}</div><button class="btn wide" style="margin-top:10px" data-act="copy-code">Code kopieren</button>` : `<button class="btn wide" data-act="show-code">Code anzeigen</button>`) +
    `<p class="desc" style="margin-top:16px"><b>Revier von einem anderen Gerät holen:</b> Dein aktuelles Revier auf diesem Gerät geht dabei verloren.</p>
    <input id="import-input" class="field" placeholder="Code eingeben" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button class="btn ghost wide" data-act="import-go">Revier übernehmen</button>`;
}

/* ============================================================
   Revierkarte
   ============================================================ */
function vignette(look) {
  const items = [];
  const rr = I.rng(look.length * 13);
  if (look === "feld") { items.push({ d: -9, svg: I.diamond(1, 2, 3, 2, I.shade(I.C.crop1, 0.95)) }); for (let k = 0; k < 5; k++) items.push(I.bush(1 + k * 0.6, 4.4, 0.7)); items.push(I.tree(5, 1, 0.9, "leaf")); items.push({ d: 4, svg: I.hochsitz(4, 3) }); }
  if (look === "wald") { for (let k = 0; k < 14; k++) items.push(I.tree(rr() * 6, rr() * 6, 0.9, "fir")); items.push({ d: 7, svg: I.hochsitz(3, 3, true) }); }
  if (look === "berg") { for (let k = 0; k < 7; k++) items.push(I.rock(rr() * 6, rr() * 6, 0.9 + rr() * 0.6, true)); items.push({ d: 6, svg: I.salzlecke(3, 3) }); }
  if (look === "hochwild") { for (let k = 0; k < 6; k++) items.push(I.tree(rr() * 6, rr() * 2, 1.1, "leaf")); items.push(I.wildAt(3.5, 3.5, "rotwild", 0.4)); items.push({ d: 6, svg: I.hochsitz(1.5, 4, true) }); }
  items.sort((a, b) => a.d - b.d);
  const base = look === "berg" ? "#8c9a6e" : look === "wald" ? "#6f8f52" : look === "hochwild" ? "#8aa660" : I.C.grass;
  return `<svg viewBox="-230 -60 460 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${I.poly([I.P(0, 0), I.P(7, 0), I.P(7, 7), I.P(0, 7)], base)}${items.map((x) => x.svg).join("")}</svg>`;
}
function openKarte() { closePanel(); closeSeedbar(); renderKarte(); $("#karte").hidden = false; }
function renderKarte() {
  const p = S.st.player;
  const cards = S.cfg.reviere.map((r) => {
    const own = hasRevier(r.id), def = REVIER_SLOTS[r.id];
    const pr = S.st.reviere.find((x) => x.id === r.id);
    let btn, sub;
    if (own) {
      const ready = S.st.stands.filter((s) => s.revier === r.id && s.ready_at && ms(s.ready_at) <= now()).length + S.st.traps.filter((t) => t.revier === r.id && t.ready_at && ms(t.ready_at) <= now()).length;
      sub = `Gepachtet · Hege ${pr.hege}${ready ? ` · <b style="color:var(--accent)">${ready}× Anblick/Fang</b>` : ""}`;
      btn = `<button class="btn green" data-act="enter" data-id="${r.id}">Betreten</button>`;
    } else if (r.unlock_level > p.level) { sub = `Ab Level ${r.unlock_level}${r.ansehen_req ? ` und ${r.ansehen_req} Ansehen` : ""}`; btn = `<span class="btn ghost" disabled>Gesperrt</span>`; }
    else if (r.ansehen_req > p.ansehen) { sub = `Braucht ${r.ansehen_req} Ansehen (du hast ${p.ansehen})`; btn = `<span class="btn ghost" disabled>Zu wenig Ansehen</span>`; }
    else { sub = `Pacht: ${r.cost} Taler`; btn = `<button class="btn" data-act="lease" data-id="${r.id}" ${p.taler >= r.cost ? "" : "disabled"}>Pachten · ${taler(r.cost)}</button>`; }
    return `<div class="k-card ${own ? "" : "locked"}">${vignette(def.look)}<div class="k-b"><div class="title">${r.emoji} ${esc(r.name)}</div>
      <div class="sub">${esc(r.wild)}</div><div class="sub">${sub}</div>${btn}</div></div>`;
  }).join("");
  $("#karte").innerHTML = `<div class="k-head"><h2>Revierkarte</h2><button class="btn ghost small" data-act="hof">Zurück zum Hof</button></div><div class="k-grid">${cards}</div>`;
}

/* ============================================================
   Klicks
   ============================================================ */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || !S.st) return;
  const a = t.dataset.act, id = t.dataset.id, P = S.panel;
  switch (a) {
    case "close": closePanel(); break;
    case "hof": goHof(); break;
    case "karte": openKarte(); break;
    case "enter": goRevier(id); break;
    case "lease": act("lease_revier", { p_revier: id }).catch(() => {}); break;
    case "gasthaus": case "lager": case "bauen": case "hut": openPanel({ type: a }); break;
    case "seed":
      if (t.closest("#seedbar")) { S.seed = id; renderSeedbar(); if (!inv(id)) openPanel({ type: "seed", id, qty: 4 }); }
      else openPanel({ type: "seed", id, qty: 4 });
      break;
    case "seed-close": closeSeedbar(); break;
    case "seed-go": act("buy_item", { p_item: P.id, p_qty: P.qty }).then(() => closePanel()).catch(() => {}); break;
    case "qty": {
      const max = P.type === "sell" ? inv(P.id) : P.type === "boost" ? 10 : 20;
      P.qty = Math.max(1, Math.min(max, P.qty + +t.dataset.d)); renderPanel(); break;
    }
    case "qty-max": P.qty = Math.max(1, inv(P.id)); renderPanel(); break;
    case "start": act("start_job", { p_recipe: id }).catch(() => {}); break;
    case "collect": act("collect_jobs", { p_building: id }).catch(() => {}); break;
    case "goto-b": goHof(); openPanel({ type: "building", id }); break;
    case "deliver": S.confirmDiscard = null; act("deliver_order", { p_slot: +t.dataset.slot }).catch(() => {}); break;
    case "discard": {
      const slot = +t.dataset.slot;
      if (S.confirmDiscard === slot) { S.confirmDiscard = null; act("discard_order", { p_slot: slot }).catch(() => {}); }
      else { S.confirmDiscard = slot; renderPanel(); }
      break;
    }
    case "build": act("build", { p_building: id }).then(() => { closePanel(); goHof(); }).catch(() => {}); break;
    case "buy-plot": act("buy_plot").catch(() => {}); break;
    case "edit-start": closePanel(); goHof(); map.startEdit(); renderHud(); break;
    case "edit-save": map.endEdit(true); renderHud(); toast("Hof gespeichert."); break;
    case "edit-cancel": map.endEdit(false); renderHud(); break;
    case "upgrade": act("upgrade_storage", { p_storage: id }).catch(() => {}); break;
    case "sell": openPanel({ type: "sell", id, qty: 1 }); break;
    case "sell-go": act("sell", { p_item: P.id, p_qty: P.qty }).catch(() => {}); break;
    case "boost": openPanel({ type: "boost", id, qty: 1, back: P }); break;
    case "boost-go": {
      const back = P.back;
      act("buy_boost", { p_item: P.id, p_qty: P.qty }).then(() => { if (back) openPanel(back); else renderPanel(); }).catch(() => {});
      break;
    }
    case "feed": act("feed_stand", { p_idx: +t.dataset.idx, p_boost: t.dataset.boost || null }).then(closePanel).catch(() => {}); break;
    case "hunt": closePanel(); startHunt(+t.dataset.idx); break;
    case "buy-stand": act("buy_stand", { p_stand: id }).then(closePanel).catch(() => {}); break;
    case "buy-trap": act("buy_trap", { p_revier: id }).then(closePanel).catch(() => {}); break;
    case "set-trap": act("set_trap", { p_idx: +t.dataset.idx, p_boost: t.dataset.boost || null }).then(closePanel).catch(() => {}); break;
    case "check-trap": closePanel(); checkTrap(+t.dataset.idx); break;
    case "course": act("take_course").catch(() => {}); break;
    case "rename": openPanel({ type: "rename" }); break;
    case "rename-go": act("rename_revier", { p_name: $("#rename-input").value }).then(closePanel).catch(() => {}); break;
    case "transfer": openPanel({ type: "transfer" }); break;
    case "show-code": transferCode().then((c) => { P.code = c; renderPanel(); }).catch((er) => toast(errText(er), true)); break;
    case "copy-code": navigator.clipboard.writeText(P.code).then(() => toast("Code kopiert."), () => toast("Kopieren ging nicht – bitte von Hand markieren.", true)); break;
    case "import-go": doImport(); break;
    case "install": S.installEvt?.prompt(); S.installEvt = null; renderPanel(); break;
    case "modal-ok": closeModal(); break;
    case "hunt-shoot": shoot(); break;
    case "hunt-close": closeHunt(); break;
    case "retry": location.reload(); break;
  }
});

async function doImport() {
  try {
    await importCode($("#import-input").value);
    closePanel();
    apply(await rpc("game_start"));
    toast("Revier übernommen. Waidmannsheil!");
  } catch (e) { toast(errText(e), true); }
}

/* ============================================================
   Ansitz & Falle
   ============================================================ */
function silhouette(yieldItem, flavor = "") {
  if (yieldItem === "sau") return `<svg viewBox="0 0 130 80" width="${/Frischling/.test(flavor) ? 92 : 124}" fill="#17120d">${I.sauSvg()}</svg>`;
  const spiesse = /Jährling|Spießer/.test(flavor) && !/Gams/.test(flavor);
  const w = yieldItem === "rotwild" ? 140 : 108;
  return `<svg viewBox="0 0 120 100" width="${w}" fill="#17120d" style="overflow:visible">${I.rehSvg("#17120d", spiesse)}</svg>`;
}
async function startHunt(idx) {
  const ps = S.st.stands.find((s) => s.idx === idx);
  const c = standCfg(ps.stand);
  S.overlay = true; S.lastHunt = null;
  const ov = $("#overlay");
  ov.hidden = false;
  ov.innerHTML = `<div class="ansitz"><div class="sun"></div>
    <svg class="trees" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true"><path id="tl" fill="#1d2d1c" d="M0 100V62l14-30 12 28 10-40 14 44 12-22 10 30 16-52 14 50 10-20 12 26 16-44 12 40 14-18 10 22 18-56 12 52 12-26 12 30 14-40 12 36 16-24 12 28 18-48 10 42 12-18 14 24 16-36 12 34 14-12 V100z"/><use href="#tl" x="192"/><use href="#tl" x="384"/></svg>
    <div class="meadow"></div><div class="game" id="game"></div><div class="scope" id="scope"></div><div class="flash" id="flash"></div>
    <div class="text" id="htext"><h3>${esc(c.name)}</h3><p>Du baumst leise auf. Der Wind steht gut …</p></div><div class="acts" id="hacts"></div></div>`;
  try { await act("hunt", { p_idx: idx }); } catch { closeHunt(); return; }
  const ev = S.lastHunt || { flavor: "Stück", xp: c.xp, qty: 1 };
  const g = $("#game"); if (g) g.innerHTML = silhouette(c.yield_item, ev.flavor);
  await wait(1200); $("#game")?.classList.add("in");
  await wait(1200); if (!$("#htext")) return;
  $("#htext").innerHTML = `<h3>${esc(ev.flavor)}</h3><p>Steht breit, Kugelfang passt, das Stück ist frei. Ansprechen – passt!</p>`;
  $("#scope").classList.add("on");
  $("#hacts").innerHTML = `<button class="btn wide pulse" data-act="hunt-shoot" style="min-height:56px;font-size:18px">Schuss</button>`;
  S.huntEv = { ...ev, yield: c.yield_item };
}
async function shoot() {
  const ev = S.huntEv || {};
  $("#hacts").innerHTML = ""; $("#flash").classList.add("go"); navigator.vibrate?.([30, 40, 20]);
  await wait(250); $("#scope").classList.remove("on"); $("#game").classList.add("down");
  await wait(700);
  const kammer = owned("wildkammer");
  $("#htext").innerHTML = `<h3>Waidmannsheil!</h3><p>${esc(ev.flavor)} erlegt · +${ev.xp} XP${ev.bonus ? " · das Lockmittel hat ein zweites Stück gebracht!" : ""}</p><div class="bruch">🌿</div>
    <p style="font-size:14px;margin-top:6px">${kammer ? "Das Stück hängt in der Lagerhütte. Versorge es in der Wildkammer." : "Das Stück liegt in der Lagerhütte. Das Gasthaus nimmt es gern – ab Level 3 baust du die Wildkammer."}</p>`;
  $("#hacts").innerHTML = `<button class="btn green wide" data-act="hunt-close" style="min-height:52px">Waidmannsdank</button>`;
}
function closeHunt() { S.overlay = false; S.huntEv = null; const ov = $("#overlay"); ov.hidden = true; ov.innerHTML = ""; nextModal(); }
const wait = (t) => new Promise((r) => setTimeout(r, t));

async function checkTrap(idx) {
  S.lastTrap = null;
  try { await act("check_trap", { p_idx: idx }); } catch { return; }
  const ev = S.lastTrap; if (!ev) return;
  if (ev.result === "catch" || ev.result === "release") S.modals.unshift({ type: "trap", ev });
  else toast("Die Falle war leer. Der Köder bleibt drin – die Falle ist wieder fängisch.");
  nextModal();
}

/* ============================================================
   Modals
   ============================================================ */
let modalOpen = false;
function nextModal() {
  if (modalOpen || S.overlay || !S.modals.length) return;
  const m = S.modals.shift();
  modalOpen = true;
  const w = document.createElement("div");
  w.className = "modal-wrap"; w.id = "modal";
  if (m.type === "welcome") {
    w.innerHTML = `<div class="modal"><div class="burst">🌲🦌🌲</div><h3>Willkommen in deinem Revier</h3>
      <p>Dein Großonkel hat dir seinen Hof im Schwarzwald hinterlassen – samt Feldrevier.</p>
      <ol><li>Auf einen Acker tippen, Hafer wählen und über die Äcker wischen</li><li>In der Futtermühle Äsungsmix mischen</li>
      <li>Über „Reviere“ zum Hochsitz – beschicken und ansitzen</li><li>Das Gasthaus beliefern und den Hof ausbauen</li></ol>
      <button class="btn green wide" data-act="modal-ok">Waidmannsheil!</button></div>`;
  } else if (m.type === "levelup") {
    const L = m.level;
    const un = [
      ...Object.keys(S.cfg.crops).filter((c) => item(c).unlock_level === L).map((c) => `${icon(c)} ${item(c).name}`),
      ...S.cfg.buildings.filter((b) => b.unlock_level === L).map((b) => `${b.emoji} ${b.name}`),
      ...S.cfg.reviere.filter((r) => r.unlock_level === L).map((r) => `${r.emoji} ${r.name}`),
      ...S.cfg.stands.filter((s) => s.unlock_level === L).map((s) => `${s.emoji} ${s.name}`),
      ...(S.cfg.settings.fallen?.course_level === L ? ["📜 Fallenlehrgang"] : []),
    ];
    const gift = Object.keys(S.cfg.settings.boost_gifts?.levelup || {})[0];
    w.innerHTML = `<div class="modal"><div class="burst">⭐</div><h3>Level ${L}!</h3><p>+${m.taler} Taler · +${m.grandeln} Grandel${m.grandeln > 1 ? "n" : ""}${gift ? ` · Geschenk: ${icon(gift)} ${esc(item(gift).name)}` : ""}</p>
      ${un.length ? `<div class="sub">Neu freigeschaltet</div><div class="unlocks">${un.map((u) => `<span>${esc(u)}</span>`).join("")}</div>` : ""}
      <button class="btn wide" data-act="modal-ok">Weiter</button></div>`;
  } else if (m.type === "course") {
    w.innerHTML = `<div class="modal"><div class="burst">📜</div><h3>Fallenlehrgang bestanden</h3>
      <p>Du darfst jetzt Kastenfallen mit Fangmelder stellen. 3 Fallenköder liegen in deiner Lagerhütte. Fallenplätze findest du in jedem Revier.</p>
      <button class="btn green wide" data-act="modal-ok">Waidmannsdank</button></div>`;
  } else if (m.type === "trap") {
    const ev = m.ev;
    w.innerHTML = ev.result === "catch"
      ? `<div class="modal"><div class="burst">${icon(ev.item)}</div><h3>Fangmelder: ${esc(ev.flavor)}</h3><p>Sauber gefangen und waidgerecht erlegt. ${icon(ev.item)} ${esc(item(ev.item).name)} liegt in der Lagerhütte. +${ev.xp} XP · +1 Ansehen · Hege im Revier verbessert.</p><button class="btn green wide" data-act="modal-ok">Weiter</button></div>`
      : `<div class="modal"><div class="burst">🦔</div><h3>Fehlfang: ${esc(ev.flavor)}</h3><p>Unversehrt freigelassen – dafür ist die Lebendfalle da. +2 Ansehen.</p><button class="btn green wide" data-act="modal-ok">Weiter</button></div>`;
  }
  document.body.appendChild(w);
}
function closeModal() { $("#modal")?.remove(); modalOpen = false; nextModal(); }

/* ============================================================
   Effekte & Timer
   ============================================================ */
function toast(msg, err = false) {
  const el = document.createElement("div");
  el.className = `toast ${err ? "err" : ""}`; el.textContent = msg;
  $("#toasts").appendChild(el); setTimeout(() => el.remove(), 2900);
}
function fly(text, x, y) {
  const el = document.createElement("div");
  el.className = "fly"; el.textContent = text; el.style.left = `${x}px`; el.style.top = `${y}px`;
  $("#fx").appendChild(el); setTimeout(() => el.remove(), 1200);
}
function bump(sel) { const el = $(sel); el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }

function tickPanel() {
  const t = now();
  for (const el of document.querySelectorAll("#panel [data-until]")) el.textContent = fmt((ms(el.dataset.until) - t) / 1000);
}
let lastKarte = 0;
setInterval(() => {
  if (!S.st) return;
  const t = now();
  if (t >= map.nextChange) { map.render(); renderHud(); if (S.panel && ["building", "stand", "trap", "gasthaus"].includes(S.panel.type)) renderPanel(); }
  else map.renderLabels();
  tickPanel();
  if (!$("#karte").hidden && t - lastKarte > 5000) { lastKarte = t; renderKarte(); }
}, 1000);

/* ============================================================
   Start
   ============================================================ */
function fatal(e) {
  const gast = e?.code === "GAST_AUS";
  $("#loading").innerHTML = `<div class="card" style="max-width:380px;text-align:center;color:var(--ink)"><div style="font-size:42px">${gast ? "🔒" : "📡"}</div>
    <div class="title">${gast ? "Das Revier ist noch nicht geöffnet" : "Keine Verbindung zum Revier"}</div>
    <p class="sub">${gast ? "Der Gastzugang ist auf dem Server noch nicht eingeschaltet." : esc(errText(e))}</p>
    <button class="btn green" data-act="retry">Erneut versuchen</button></div>`;
  $("#loading").addEventListener("click", (ev) => { if (ev.target.closest("[data-act=retry]")) location.reload(); });
}
async function boot() {
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; });
  try {
    S.cfg = await loadConfig();
    let st;
    try { st = await rpc("game_start"); }
    catch (e) {
      if (e.code !== "SITZUNG_UNGUELTIG") throw e;
      resetSession(); st = await rpc("game_start"); toast("Neue Sitzung gestartet.");
    }
    S.st = st;
    S.offset = Date.parse(st.now) - Date.now();
    map.setScene("hof");
    apply(st);
    $("#loading").hidden = true;
  } catch (e) { console.error(e); fatal(e); }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.st) act("game_state", {}, { quiet: true }).catch(() => {}); });
boot();
