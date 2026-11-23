// Isometrische Karte: Kamera (verschieben/zoomen), Szenen (Hof, Reviere), Eingabe (tippen, wischen, umstellen).
import * as I from "./iso.js";

const { P, C, TW, TH } = I;
export const HOF_N = 20, HOF_MIN = 2, HOF_MAX = 18;
export const REV_N = 14;

/* ---------- Szenen-Definitionen der Reviere (feste Plätze für Hochsitze und Fallen) ---------- */
export const REVIER_SLOTS = {
  feldrevier:     { stands: [[3, 4], [9, 3], [5, 9]], traps: [[11, 8], [2, 11]], sign: [12.6, 3.2], look: "feld" },
  waldrevier:     { stands: [[4, 3], [9, 4], [3, 9], [8, 9]], traps: [[11, 10], [1.6, 6]], sign: [12.6, 2.5], look: "wald" },
  bergrevier:     { stands: [[5, 4], [8, 8]], traps: [[3, 10]], sign: [12.5, 2.5], look: "berg" },
  hochwildrevier: { stands: [[4, 4], [9, 5], [5, 9]], traps: [[11, 10]], sign: [12.5, 2.5], look: "hochwild" },
};

export function cropColor(id) {
  return { hafer: "#d8b35a", mais: "#e0c25a", klee: "#7fae5a", kartoffel: "#8fae5a", zwiebel: "#c9a35a", rotkohl: "#7c5a8c", topinambur: "#e3b840" }[id] || C.crop1;
}

/* ============================================================ */
export function createMap(root, ctx) {
  // ctx: { getState(), getCfg(), now(), onTap(obj, info), onStroke(kind, ids), canStroke(obj), strokeKind(obj), layoutChanged(layout), editInfo() }
  root.innerHTML = `<svg id="world" xmlns="http://www.w3.org/2000/svg" aria-label="Spielkarte">
      <g id="cam"><g id="ground"></g><g id="scene"></g><g id="edit"></g><g id="labels"></g></g></svg>`;
  const svg = root.querySelector("#world");
  const cam = svg.querySelector("#cam");
  const gGround = svg.querySelector("#ground"), gScene = svg.querySelector("#scene"), gEdit = svg.querySelector("#edit"), gLabels = svg.querySelector("#labels");

  const M = {
    scene: "hof", tx: 0, ty: 0, s: 1, bounds: null,
    edit: null,          // { layout, sel, ok }
    groundKey: null,
  };

  /* ---------- Kamera ---------- */
  function applyCam() { cam.setAttribute("transform", `translate(${M.tx.toFixed(1)} ${M.ty.toFixed(1)}) scale(${M.s.toFixed(3)})`); }
  function clampCam() {
    const r = root.getBoundingClientRect(), b = M.bounds;
    if (!b) return;
    const minX = r.width - (b.x1) * M.s - 60, maxX = -b.x0 * M.s + 60;
    const minY = r.height - (b.y1) * M.s - 60, maxY = -b.y0 * M.s + 60;
    M.tx = minX > maxX ? (minX + maxX) / 2 : Math.min(maxX, Math.max(minX, M.tx));
    M.ty = minY > maxY ? (minY + maxY) / 2 : Math.min(maxY, Math.max(minY, M.ty));
  }
  function fit(focus) {
    const r = root.getBoundingClientRect(), b = M.bounds;
    const s = Math.min(r.width / (b.x1 - b.x0), r.height / (b.y1 - b.y0)) * (r.height > r.width ? 2.4 : 1.55);
    M.s = Math.max(0.45, Math.min(1.6, s));
    const [fx, fy] = focus || [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    M.tx = r.width / 2 - fx * M.s; M.ty = r.height / 2 - fy * M.s;
    clampCam(); applyCam();
  }
  function zoomAt(cx, cy, f) {
    const ns = Math.max(0.4, Math.min(2.2, M.s * f));
    M.tx = cx - (cx - M.tx) * (ns / M.s); M.ty = cy - (cy - M.ty) * (ns / M.s); M.s = ns;
    clampCam(); applyCam();
  }
  const toWorld = (cx, cy) => { const r = root.getBoundingClientRect(); return [(cx - r.left - M.tx) / M.s, (cy - r.top - M.ty) / M.s]; };
  const toGrid = (wx, wy) => [(wx / (TW / 2) + wy / (TH / 2)) / 2, (wy / (TH / 2) - wx / (TW / 2)) / 2];

  /* ---------- Szene wechseln ---------- */
  function setScene(name, focus) {
    M.scene = name; M.edit = null; M.groundKey = null;
    const n = name === "hof" ? HOF_N : REV_N;
    const c = [P(0, 0), P(n, 0), P(n, n), P(0, n)];
    M.bounds = { x0: c[3][0] - 40, x1: c[1][0] + 40, y0: c[0][1] - 140, y1: c[2][1] + 30 };
    render();
    fit(focus);
  }

  /* ---------- Hof-Layout ---------- */
  function hofObjects(st, cfg, layout) {
    const objs = [{ key: "deco:hut", kind: "hut", w: 3, h: 3 }];
    for (const b of st.buildings) objs.push({ key: `bld:${b.id}`, kind: "bld", id: b.id, w: I.FOOT[b.id]?.[0] || 2, h: I.FOOT[b.id]?.[1] || 2 });
    for (const p of st.plots) objs.push({ key: `plot:${p.idx}`, kind: "plot", idx: p.idx, w: 2, h: 2 });
    // Positionen: gespeichert, sonst freien Platz suchen
    const occ = new Set();
    const mark = (o, on) => { for (let a = 0; a < o.w; a++) for (let b = 0; b < o.h; b++) occ[on ? "add" : "delete"](`${o.i + a},${o.j + b}`); };
    const free = (i, j, w, h) => {
      if (i < HOF_MIN || j < HOF_MIN || i + w > HOF_MAX || j + h > HOF_MAX) return false;
      for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) if (occ.has(`${i + a},${j + b}`)) return false;
      return true;
    };
    const prefs = {
      "deco:hut": [3, 3], "bld:futtermuehle": [13, 3], "bld:wildkammer": [14, 8], "bld:wildkueche": [14, 11],
      "bld:raeucherei": [14, 14], "bld:gerberei": [3, 14],
    };
    const placed = [], pending = [];
    for (const o of objs) {
      const pos = layout[o.key];
      if (pos && free(pos[0], pos[1], o.w, o.h)) { o.i = pos[0]; o.j = pos[1]; mark(o, true); placed.push(o); }
      else pending.push(o);
    }
    let changed = false;
    for (const o of pending) {
      let spot = null;
      const pref = prefs[o.key] || (o.kind === "plot" ? plotPref(o.idx) : null);
      if (pref && free(pref[0], pref[1], o.w, o.h)) spot = pref;
      for (let r = 0; !spot && r < 20; r++) {
        for (let j = HOF_MIN; !spot && j <= HOF_MAX - o.h; j++) for (let i = HOF_MIN; !spot && i <= HOF_MAX - o.w; i++) {
          if (pref && Math.max(Math.abs(i - pref[0]), Math.abs(j - pref[1])) !== r) continue;
          if (!pref && r > 0) continue;
          if (free(i, j, o.w, o.h)) spot = [i, j];
        }
        if (!pref) break;
      }
      if (!spot) continue;
      o.i = spot[0]; o.j = spot[1]; mark(o, true); placed.push(o);
      layout[o.key] = spot; changed = true;
    }
    return { objs: placed, changed, occFree: free, occ, mark };
  }
  function plotPref(idx) {
    const col = idx % 4, row = Math.floor(idx / 4);
    return [6 + col * 2, 8 + row * 2];
  }

  /* ---------- Zeichnen ---------- */
  function drawGround(n, look, seed) {
    const key = `${M.scene}`;
    if (M.groundKey === key) return;
    M.groundKey = key;
    const r = I.rng(seed);
    const base = look === "berg" ? "#8c9a6e" : look === "wald" ? "#6f8f52" : look === "hochwild" ? "#8aa660" : C.grass;
    let s = "";
    const c = [P(0, 0), P(n, 0), P(n, n), P(0, n)];
    s += `<rect x="${c[3][0] - 2000}" y="${c[0][1] - 2000}" width="${c[1][0] - c[3][0] + 4000}" height="${c[2][1] - c[0][1] + 4000}" fill="${C.forest}"/>`;
    for (let k = 0; k < 140; k++) {
      const x = c[3][0] - 300 + r() * (c[1][0] - c[3][0] + 600), y = c[0][1] - 300 + r() * (c[2][1] - c[0][1] + 600);
      s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(26 + r() * 22).toFixed(0)}" fill="${I.shade(C.forest, r() > 0.5 ? 1.1 : 0.88)}"/>`;
    }
    s += I.poly(c, base);
    for (let t = 0; t <= n; t++) {
      const a = P(t, 0), b = P(t, n), d = P(0, t), e = P(n, t);
      s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${I.shade(base, 0.95)}" stroke-width="1"/><line x1="${d[0]}" y1="${d[1]}" x2="${e[0]}" y2="${e[1]}" stroke="${I.shade(base, 0.95)}" stroke-width="1"/>`;
    }
    for (let k = 0; k < 7; k++) {
      const [x, y] = P(2 + r() * (n - 4), 2 + r() * (n - 4));
      s += `<ellipse cx="${x}" cy="${y}" rx="${50 + r() * 60}" ry="${22 + r() * 26}" fill="${I.shade(base, r() > 0.5 ? 1.07 : 0.94)}"/>`;
    }
    if (M.scene === "hof") {
      // Hofplatz vor der Hütte (Kies)
    }
    gGround.innerHTML = s;
  }

  function sceneItems() {
    const st = ctx.getState(), cfg = ctx.getCfg(), t = ctx.now();
    const items = [];
    if (M.scene === "hof") {
      drawGround(HOF_N, "hof", 7);
      const layout = M.edit ? M.edit.layout : { ...(st.layout || {}) };
      const { objs, changed } = hofObjects(st, cfg, layout);
      if (changed && !M.edit) ctx.layoutChanged(layout);
      M.hof = objs;
      // Waldrand-Deko
      const r = I.rng(11);
      for (let k = 0; k < 46; k++) {
        const side = k % 4, u = r() * HOF_N, v = r() * 1.6 + 0.1;
        const [i, j] = side === 0 ? [u, v] : side === 1 ? [HOF_N - v, u] : side === 2 ? [u, HOF_N - v] : [v, u];
        items.push(I.tree(i, j, 0.8 + r() * 0.4, r() > 0.3 ? "fir" : "leaf"));
      }
      items.push(wrap(I.signpost(HOF_MAX - 0.6, HOF_MAX - 4, "Zum Revier"), "deco:sign"));
      for (const o of objs) {
        const sel = M.edit?.sel === o.key;
        let svg;
        if (o.kind === "hut") svg = I.building("hut", o.i, o.j, { lit: false });
        else if (o.kind === "bld") svg = I.building(o.id, o.i, o.j);
        else {
          const p = st.plots.find((x) => x.idx === o.idx);
          const state = !p.crop ? "empty" : Date.parse(p.ready_at) <= t ? "ready" : "grow";
          svg = I.field(o.i, o.j, 2, 2, p.crop, state, p.crop ? cropColor(p.crop) : null);
        }
        const d = o.kind === "plot" ? o.i + o.j - 3 : o.i + o.j + o.w + o.h;
        items.push({ d, svg: `<g data-obj="${o.key}" class="obj${sel ? " sel" : ""}">${svg}</g>` });
      }
    } else if (M.scene.startsWith("revier:")) {
      const rid = M.scene.split(":")[1];
      const def = REVIER_SLOTS[rid];
      drawGround(REV_N, def.look, rid.length * 31);
      decoRevier(items, def.look, rid);
      const myStands = st.stands.filter((s) => s.revier === rid);
      def.stands.forEach(([i, j], k) => {
        const ps = myStands[k];
        if (!ps) { items.push({ d: i + j, svg: `<g data-obj="slot:stand:${rid}:${k}" class="obj">${I.bauplatz(i, j, 1, 1)}</g>` }); return; }
        const cs = cfg.stands.find((s) => s.id === ps.stand);
        let svg = "";
        if (cs.feed_item === "lecksalz") svg += I.salzlecke(i + 1.2, j + 0.4);
        else if (cs.feed_item === "kirrmais") svg += I.kirrung(i + 1.2, j + 0.3);
        else svg += I.diamond(i + 1.1, j - 0.2, 1.6, 1.4, I.shade(C.crop2, 0.92));
        svg += I.hochsitz(i, j, ps.stand.startsWith("kanzel") || ps.stand === "hochsitz_kirrung");
        items.push({ d: i + j + 2, svg: `<g data-obj="stand:${ps.idx}" class="obj">${svg}</g>` });
        if (ps.ready_at && Date.parse(ps.ready_at) <= t) {
          const kind = { reh: "reh", sau: "sau", gams: "gams", rotwild: "rotwild", muffel: "muffel" }[cs.yield_item] || "reh";
          items.push(I.wildAt(i + 2.4, j + 0.9, kind, 0.42, true));
        }
      });
      const myTraps = st.traps.filter((x) => x.revier === rid);
      def.traps.forEach(([i, j], k) => {
        const pt = myTraps[k];
        if (!pt) { items.push({ d: i + j, svg: `<g data-obj="slot:trap:${rid}:${k}" class="obj">${I.bauplatz(i, j, 1, 1)}</g>` }); return; }
        const ready = pt.ready_at && Date.parse(pt.ready_at) <= t;
        items.push({ d: i + j + 1, svg: `<g data-obj="trap:${pt.idx}" class="obj">${I.falle(i, j, !!pt.ready_at, ready)}</g>` });
      });
      items.push(wrap(I.signpost(def.sign[0], def.sign[1], "Zum Hof"), "deco:home"));
    }
    return items;
  }
  const wrap = (it, key) => ({ d: it.d, svg: `<g data-obj="${key}" class="obj">${it.svg}</g>` });

  function decoRevier(items, look, rid) {
    const r = I.rng(rid.length * 97 + 3);
    const d = REVIER_SLOTS[rid];
    const spots = [...d.stands, ...d.traps, d.sign];
    const busy = (i, j) => spots.some((p) => i > p[0] - 1.2 && i < p[0] + 3.2 && j > p[1] - 1.2 && j < p[1] + 2.4);
    const N = REV_N;
    const edge = (k) => { const side = k % 4, u = r() * N, v = r() * 1.5 + 0.1; return side === 0 ? [u, v] : side === 1 ? [N - v, u] : side === 2 ? [u, N - v] : [v, u]; };
    if (look === "feld") {
      items.push({ d: -50, svg: I.diamond(7, 12.6, 5, 1.2, I.shade(C.crop1, 0.95)) + I.diamond(5.5, 0.4, 3, 1.6, I.shade(C.crop2, 0.9)) });
      for (let k = 0; k < 12; k++) items.push(I.bush(7.2 + k * 0.45, 12.2 + (k % 2) * 0.15, 0.7));
      for (let k = 0; k < 18; k++) { const [i, j] = edge(k); if (!busy(i, j)) items.push(I.tree(i, j, 0.9, r() > 0.5 ? "leaf" : "fir")); }
      items.push(I.pond(9.5, 10.5, 2.6, 2));
    } else if (look === "wald") {
      for (let k = 0; k < 60; k++) { const i = r() * N, j = r() * N; if (!busy(i, j)) items.push(I.tree(i, j, 0.8 + r() * 0.5, r() > 0.2 ? "fir" : "leaf")); }
    } else if (look === "berg") {
      for (let k = 0; k < 22; k++) { const i = r() * N, j = r() * N; if (!busy(i, j)) items.push(I.rock(i, j, 0.7 + r() * 1.1, r() > 0.5)); }
      for (let k = 0; k < 18; k++) { const i = r() * N, j = r() * N; if (!busy(i, j)) items.push(I.bush(i, j, 0.8, "#4f6b4a")); }
      for (let k = 0; k < 12; k++) { const [i, j] = edge(k); if (!busy(i, j)) items.push(I.tree(i, j, 0.8, "fir")); }
    } else {
      for (let k = 0; k < 26; k++) { const [i, j] = edge(k); if (!busy(i, j)) items.push(I.tree(i, j, 1.1, r() > 0.5 ? "leaf" : "fir")); }
      for (let k = 0; k < 8; k++) { const i = 2 + r() * (N - 4), j = 2 + r() * (N - 4); if (!busy(i, j)) items.push(I.tree(i, j, 1.3, "leaf")); }
      items.push(I.pond(1.5, 10.5, 2.4, 2));
    }
  }

  function render() {
    if (!ctx.getState()) return;
    const items = sceneItems();
    items.sort((a, b) => a.d - b.d);
    gScene.innerHTML = items.map((x) => x.svg).join("");
    renderEdit();
    renderLabels();
  }

  /* ---------- Statusanzeigen über den Objekten ---------- */
  function pill(x, y, text, kind = "") {
    const w = Math.max(30, text.length * 7 + 16);
    const bg = kind === "ready" ? C.accent : kind === "ok" ? "#5f7e4a" : C.hud;
    const fg = kind ? "#fff" : C.ink;
    return `<g class="lbl ${kind}"><rect x="${x - w / 2}" y="${y - 12}" width="${w}" height="22" rx="11" fill="${bg}" opacity="0.96"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${fg}" font-family="Inter, system-ui, sans-serif">${text}</text></g>`;
  }
  function bar(x, y, f) {
    return `<g><rect x="${x - 22}" y="${y - 3}" width="44" height="6" rx="3" fill="rgba(0,0,0,0.35)"/><rect x="${x - 22}" y="${y - 3}" width="${(44 * Math.max(0, Math.min(1, f))).toFixed(1)}" height="6" rx="3" fill="#d9e88b"/></g>`;
  }
  const fmt = (sec) => {
    sec = Math.max(0, Math.ceil(sec));
    if (sec < 60) return `${sec} s`;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? `${h} h ${m} m` : `${m}:${String(sec % 60).padStart(2, "0")}`;
  };
  function renderLabels() {
    const st = ctx.getState(), cfg = ctx.getCfg(), t = ctx.now();
    if (!st || M.edit) { gLabels.innerHTML = ""; return; }
    let s = "";
    let next = Infinity;
    const note = (iso) => { const v = Date.parse(iso); if (v > t) next = Math.min(next, v); };
    if (M.scene === "hof" && M.hof) {
      for (const o of M.hof) {
        if (o.kind === "plot") {
          const p = st.plots.find((x) => x.idx === o.idx);
          if (p?.crop && Date.parse(p.ready_at) > t) {
            note(p.ready_at);
            const [x, y] = P(o.i + 1, o.j + 1);
            const f = (t - Date.parse(p.planted_at)) / (Date.parse(p.ready_at) - Date.parse(p.planted_at));
            s += bar(x, y - 10, f);
          }
        } else if (o.kind === "bld") {
          const jobs = st.jobs.filter((j) => j.building === o.id);
          const done = jobs.filter((j) => Date.parse(j.ready_at) <= t).length;
          jobs.forEach((j) => note(j.ready_at));
          const [x, y] = P(o.i + o.w / 2, o.j + o.h / 2, 100);
          if (done) s += pill(x, y, `✓ ${done}`, "ready");
          else if (jobs.length) {
            const run = jobs.find((j) => Date.parse(j.ready_at) > t && Date.parse(j.start_at) <= t);
            if (run) s += pill(x, y, fmt((Date.parse(run.ready_at) - t) / 1000));
          } else s += pill(x, y, "Zzz");
        }
      }
    } else if (M.scene.startsWith("revier:")) {
      const rid = M.scene.split(":")[1], def = REVIER_SLOTS[rid];
      st.stands.filter((s) => s.revier === rid).forEach((ps, k) => {
        const [i, j] = def.stands[k] || [0, 0];
        const [x, y] = P(i + 0.5, j + 0.5, 120);
        if (!ps.ready_at) s += pill(x, y, "Beschicken");
        else if (Date.parse(ps.ready_at) > t) { note(ps.ready_at); s += pill(x, y, fmt((Date.parse(ps.ready_at) - t) / 1000)); }
        else s += pill(x, y, "Anblick!", "ready");
      });
      st.traps.filter((x) => x.revier === rid).forEach((pt, k) => {
        const [i, j] = def.traps[k] || [0, 0];
        const [x, y] = P(i + 0.5, j + 0.5, 46);
        if (!pt.ready_at) s += pill(x, y, "Fängisch stellen");
        else if (Date.parse(pt.ready_at) > t) { note(pt.ready_at); s += pill(x, y, fmt((Date.parse(pt.ready_at) - t) / 1000)); }
        else s += pill(x, y, "Fangmelder!", "ready");
      });
    }
    gLabels.innerHTML = s;
    M.nextChange = next;
  }

  /* ---------- Umstellen ---------- */
  function renderEdit() {
    if (!M.edit || !M.hof) { gEdit.innerHTML = ""; return; }
    const o = M.hof.find((x) => x.key === M.edit.sel);
    if (!o) { gEdit.innerHTML = ""; return; }
    const col = M.edit.ok === false ? "rgba(210,70,50,0.45)" : "rgba(127,176,105,0.45)";
    gEdit.innerHTML = I.diamond(o.i, o.j, o.w, o.h, col, `stroke="#fff" stroke-width="2"`);
  }
  function startEdit() {
    const st = ctx.getState();
    M.edit = { layout: { ...(st.layout || {}) }, sel: null, ok: true };
    render();
  }
  function endEdit(save) {
    const lay = M.edit?.layout;
    M.edit = null;
    if (save && lay) ctx.layoutChanged(lay, true);
    render();
  }

  /* ---------- Eingabe ---------- */
  const pointers = new Map();
  let gesture = null;
  root.addEventListener("pointerdown", (e) => {
    root.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: "pinch", d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: M.s };
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-obj]");
    const key = el?.dataset.obj || null;
    gesture = { type: "maybe", x: e.clientX, y: e.clientY, tx: M.tx, ty: M.ty, key, moved: false };
    if (M.edit && key && M.hof?.some((o) => o.key === key)) {
      M.edit.sel = key;
      const o = M.hof.find((x) => x.key === key);
      const [gi, gj] = toGrid(...toWorld(e.clientX, e.clientY));
      gesture = { type: "drag", key, di: gi - o.i, dj: gj - o.j };
      renderEdit();
      return;
    }
    if (!M.edit && key && ctx.strokeKind(key)) {
      gesture = { type: "stroke", kind: ctx.strokeKind(key), set: new Set([key]), x: e.clientX, y: e.clientY };
      ctx.strokeTouch(gesture.kind, key, e.clientX, e.clientY);
    }
  });
  root.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (!gesture) return;
    if (gesture.type === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const r = root.getBoundingClientRect();
      zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, (gesture.s * d / gesture.d) / M.s);
      return;
    }
    if (gesture.type === "stroke") {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-obj]");
      const key = el?.dataset.obj;
      if (key && !gesture.set.has(key) && ctx.strokeKind(key) === gesture.kind) {
        gesture.set.add(key);
        ctx.strokeTouch(gesture.kind, key, e.clientX, e.clientY);
      }
      return;
    }
    if (gesture.type === "drag") {
      const o = M.hof.find((x) => x.key === gesture.key);
      const [gi, gj] = toGrid(...toWorld(e.clientX, e.clientY));
      const ni = Math.round(gi - gesture.di), nj = Math.round(gj - gesture.dj);
      if (ni !== o.i || nj !== o.j) {
        const others = M.hof.filter((x) => x !== o);
        const inside = ni >= HOF_MIN && nj >= HOF_MIN && ni + o.w <= HOF_MAX && nj + o.h <= HOF_MAX;
        const overlap = others.some((x) => ni < x.i + x.w && x.i < ni + o.w && nj < x.j + x.h && x.j < nj + o.h);
        M.edit.ok = inside && !overlap;
        if (M.edit.ok) { M.edit.layout[o.key] = [ni, nj]; render(); }
        else { o.i = ni; o.j = nj; renderEdit(); o.i = M.edit.layout[o.key][0]; o.j = M.edit.layout[o.key][1]; }
      }
      return;
    }
    if (gesture.type === "maybe" || gesture.type === "pan") {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (gesture.type === "maybe" && Math.hypot(dx, dy) > 8) gesture.type = "pan";
      if (gesture.type === "pan") { M.tx = gesture.tx + dx; M.ty = gesture.ty + dy; clampCam(); applyCam(); }
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (!gesture) return;
    const g = gesture;
    if (pointers.size === 0) gesture = null;
    if (g.type === "stroke") ctx.onStroke(g.kind, [...g.set]);
    else if (g.type === "drag") { M.edit.ok = true; renderEdit(); }
    else if (g.type === "maybe") ctx.onTap(g.key);
  };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); gesture = null; });
  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  window.addEventListener("resize", () => { clampCam(); applyCam(); });

  return {
    setScene, render, renderLabels, startEdit, endEdit,
    get scene() { return M.scene; }, get editing() { return !!M.edit; }, get nextChange() { return M.nextChange ?? Infinity; },
    zoom(f) { const r = root.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); },
    screenOf(key) {
      const el = gScene.querySelector(`[data-obj="${CSS.escape(key)}"]`);
      return el?.getBoundingClientRect();
    },
  };
}
