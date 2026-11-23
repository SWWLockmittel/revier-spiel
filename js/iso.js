// Isometrische Vektorgrafik im Stil B ("flach und modern", gedeckte Erdtöne).
// Alle Zeichenfunktionen liefern {d, svg}: d = Tiefe für die Zeichenreihenfolge (Painter's Algorithmus).

export const TW = 64, TH = 32;

export const C = {
  forest: "#2b4334", grass: "#86a35e", grass2: "#7d9a56", meadow: "#93ae68", shadow: "#2b3a22",
  path: "#d3c39f", soil: "#6b513a", crop1: "#d8b35a", crop2: "#9bb862",
  wood: "#6d5038", wood2: "#4f3a29", woodLight: "#8a6a4c", roof: "#a9553a", roofBlue: "#3f5f6e", roofGreen: "#4f6b4a",
  wall: "#ebe4d1", wall2: "#dfe3de", stone: "#a7a59b", rock: "#8c8b84", snow: "#f2f1ec",
  tree: "#33523f", tree2: "#2a4535", leaf: "#5f7e4a", trunk: "#4f3a29", water: "#6f97a3", water2: "#8fb3bc",
  win: "#3b4a44", winLit: "#f4d58d", door: "#4f3a29", silo: "#d6dad4", metal: "#9aa3a0",
  reh: "#8a5a33", sau: "#3e352d", gams: "#5a4a3a", rot: "#7a4a2a", muffel: "#5e4632", fuchs: "#b8662f",
  hud: "#f5f1e6", ink: "#2b2a22", accent: "#a9553a", gold: "#c9a227",
};

export function hexrgb(h) { h = h.replace("#", ""); return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)); }
export function shade(h, f) {
  let r = hexrgb(h);
  r = f >= 1 ? r.map((c) => Math.min(255, Math.round(c + (255 - c) * (f - 1)))) : r.map((c) => Math.round(c * f));
  return "#" + r.map((c) => c.toString(16).padStart(2, "0")).join("");
}

export function P(i, j, z = 0) { return [(i - j) * TW / 2, (i + j) * TH / 2 - z]; }
const up = (p, z) => [p[0], p[1] - z];
const f1 = (n) => Math.round(n * 10) / 10;
export const poly = (pts, fill, extra = "") => `<polygon points="${pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(" ")}" fill="${fill}" ${extra}/>`;
const mid = (a, b, t = 0.5) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// deterministischer Zufall (für Deko, damit sich die Szene nicht bei jedem Neuzeichnen ändert)
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function diamond(i, j, a, b, fill, extra = "") {
  return poly([P(i, j), P(i + a, j), P(i + a, j + b), P(i, j + b)], fill, extra);
}

export function groundShadow(i, j, a, b, off = 0.35) {
  return poly([P(i + off, j + off * 0.3), P(i + a + off, j + off * 0.3), P(i + a + off, j + b + off), P(i + off, j + b + off)], C.shadow, 'opacity="0.3"');
}

/** Quader mit Satteldach, Flachdach oder ohne Dach. */
export function box(o) {
  const { i, j, a, b, H, base, roof, R = 0, flatRoof, door, windows = [], lit = false, shadow = true, z = 0 } = o;
  const N = up(P(i, j), z), E = up(P(i + a, j), z), S = up(P(i + a, j + b), z), W = up(P(i, j + b), z);
  const out = [];
  if (shadow) out.push(groundShadow(i, j, a, b));
  out.push(poly([W, S, up(S, H), up(W, H)], shade(base, 0.93)));
  out.push(poly([S, E, up(E, H), up(S, H)], shade(base, 0.74)));
  const onFront = (t, z0, z1, w) => {
    const a0 = mid(W, S, t - w / 2), a1 = mid(W, S, t + w / 2);
    return [up(a0, z0), up(a1, z0), up(a1, z1), up(a0, z1)];
  };
  if (door != null) out.push(poly(onFront(door, 0, H * 0.62, 0.16 * 2.4 / Math.max(a, 1.2)), C.door));
  for (const t of windows) out.push(poly(onFront(t, H * 0.4, H * 0.72, 0.13 * 2.4 / Math.max(a, 1.2)), lit ? C.winLit : C.win));
  if (roof) {
    const R1 = up(mid(N, W), H + R), R2 = up(mid(E, S), H + R);
    out.push(poly([up(N, H), up(E, H), R2, R1], shade(roof, 0.8)));
    out.push(poly([up(S, H), up(E, H), R2], shade(base, 0.64)));
    const wH = up(W, H), sH = up(S, H);
    out.push(poly([[wH[0] - 6, wH[1] + 2], [sH[0], sH[1] + 4], [R2[0] + 2, R2[1]], [R1[0] - 6, R1[1]]], roof));
  } else if (flatRoof) {
    out.push(poly([up(N, H + 4), up(E, H + 4), up(S, H + 4), up(W, H + 4)], flatRoof));
    out.push(poly([up(W, H), up(S, H), up(S, H + 4), up(W, H + 4)], shade(flatRoof, 0.8)));
    out.push(poly([up(S, H), up(E, H), up(E, H + 4), up(S, H + 4)], shade(flatRoof, 0.65)));
  } else {
    out.push(poly([up(N, H), up(E, H), up(S, H), up(W, H)], shade(base, 1.1)));
  }
  return out.join("");
}

export function cylinder(i, j, r, H, base, cap) {
  const [cx, cy] = P(i, j), rx = r, ry = r * 0.5;
  return `<ellipse cx="${cx + 10}" cy="${cy + 6}" rx="${rx}" ry="${ry}" fill="${C.shadow}" opacity="0.3"/>
    <path d="M${cx - rx} ${cy} L${cx - rx} ${cy - H} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy - H} L${cx + rx} ${cy} A${rx} ${ry} 0 0 1 ${cx - rx} ${cy} Z" fill="${shade(base, 0.86)}"/>
    <path d="M${cx} ${cy - H + ry} L${cx} ${cy + ry} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy} L${cx + rx} ${cy - H} A${rx} ${ry} 0 0 1 ${cx} ${cy - H + ry} Z" fill="${shade(base, 0.7)}"/>
    <ellipse cx="${cx}" cy="${cy - H}" rx="${rx}" ry="${ry}" fill="${base}"/>
    <path d="M${cx - rx} ${cy - H} Q${cx} ${cy - H - 24} ${cx + rx} ${cy - H} A${rx} ${ry} 0 0 1 ${cx - rx} ${cy - H} Z" fill="${cap}"/>`;
}

export function smoke(x, y) {
  return `<g class="smoke" opacity="0.55"><circle cx="${x}" cy="${y}" r="6" fill="#d9d6cc"/><circle cx="${x + 6}" cy="${y - 12}" r="8" fill="#d9d6cc"/><circle cx="${x + 2}" cy="${y - 28}" r="10" fill="#e4e1d8"/></g>`;
}

/* ---------- Natur ---------- */
export function tree(i, j, k = 1, kind = "fir") {
  const [x, y] = P(i, j);
  let s = `<ellipse cx="${x + 14 * k}" cy="${y + 4}" rx="${24 * k}" ry="${10 * k}" fill="${C.shadow}" opacity="0.3"/>
    <rect x="${x - 3 * k}" y="${y - 14 * k}" width="${6 * k}" height="${16 * k}" fill="${C.trunk}"/>`;
  if (kind === "fir") {
    [[26, 30], [21, 28], [15, 24]].forEach(([w, hh], t) => {
      const yy = y - 10 * k - t * 18 * k;
      const col = t % 2 ? shade(C.tree, 1.08) : C.tree;
      s += `<path d="M${x - w * k} ${yy} L${x} ${yy - hh * k} L${x + w * k} ${yy} Q${x} ${yy + 6 * k} ${x - w * k} ${yy} Z" fill="${col}"/>
        <path d="M${x} ${yy - hh * k} L${x + w * k} ${yy} Q${x + w * k / 2} ${yy + 4 * k} ${x} ${yy + 3 * k} Z" fill="${shade(C.tree, 0.76)}"/>`;
    });
  } else {
    s += `<circle cx="${x}" cy="${y - 34 * k}" r="${24 * k}" fill="${C.leaf}"/>
      <path d="M${x} ${y - 58 * k} A${24 * k} ${24 * k} 0 0 1 ${x} ${y - 10 * k} A${16 * k} ${24 * k} 0 0 0 ${x} ${y - 58 * k} Z" fill="${shade(C.leaf, 0.78)}"/>
      <circle cx="${x - 8 * k}" cy="${y - 44 * k}" r="${7 * k}" fill="${shade(C.leaf, 1.12)}"/>`;
  }
  return { d: i + j + 0.2, svg: s };
}

export function bush(i, j, k = 1, col = C.leaf) {
  const [x, y] = P(i, j);
  return { d: i + j + 0.1, svg: `<ellipse cx="${x + 6}" cy="${y + 2}" rx="${16 * k}" ry="${6 * k}" fill="${C.shadow}" opacity="0.25"/>
    <ellipse cx="${x - 6 * k}" cy="${y - 8 * k}" rx="${11 * k}" ry="${9 * k}" fill="${shade(col, 0.9)}"/>
    <ellipse cx="${x + 6 * k}" cy="${y - 9 * k}" rx="${12 * k}" ry="${10 * k}" fill="${col}"/>
    <ellipse cx="${x}" cy="${y - 15 * k}" rx="${10 * k}" ry="${8 * k}" fill="${shade(col, 1.08)}"/>` };
}

export function rock(i, j, k = 1, snow = false) {
  const [x, y] = P(i, j);
  const h = 46 * k, w = 34 * k;
  let s = `<ellipse cx="${x + 10}" cy="${y + 3}" rx="${w}" ry="${w * 0.35}" fill="${C.shadow}" opacity="0.3"/>
    <path d="M${x - w} ${y} L${x - w * 0.35} ${y - h} L${x + w * 0.15} ${y - h * 0.8} L${x + w} ${y} Z" fill="${C.rock}"/>
    <path d="M${x - w * 0.35} ${y - h} L${x + w * 0.15} ${y - h * 0.8} L${x + w} ${y} L${x + w * 0.05} ${y} Z" fill="${shade(C.rock, 0.78)}"/>`;
  if (snow) s += `<path d="M${x - w * 0.55} ${y - h * 0.68} L${x - w * 0.35} ${y - h} L${x + w * 0.15} ${y - h * 0.8} L${x + w * 0.32} ${y - h * 0.56} L${x - w * 0.05} ${y - h * 0.66} Z" fill="${C.snow}"/>`;
  return { d: i + j + 0.3, svg: s };
}

export function pond(i, j, a, b) {
  const pts = [];
  for (let t = 0; t < 16; t++) {
    const ang = (t / 16) * Math.PI * 2;
    const r = 0.92 + 0.08 * Math.sin(t * 2.3);
    pts.push(P(i + a / 2 + Math.cos(ang) * a / 2 * r, j + b / 2 + Math.sin(ang) * b / 2 * r));
  }
  const inner = pts.map((p) => [p[0] * 0.7 + P(i + a / 2, j + b / 2)[0] * 0.3, p[1] * 0.7 + P(i + a / 2, j + b / 2)[1] * 0.3]);
  return { d: i + j - 6, svg: poly(pts, shade(C.water, 0.85)) + poly(inner, C.water) +
    `<path d="M${P(i + a * 0.35, j + b * 0.4)[0]} ${P(i + a * 0.35, j + b * 0.4)[1]} q10 -3 20 0" stroke="${C.water2}" stroke-width="2" fill="none"/>` };
}

/* ---------- Wildacker ---------- */
export function field(i, j, a, b, crop, state, cropCol) {
  i += 0.09; j += 0.09; a -= 0.18; b -= 0.18;
  const N = P(i, j), E = P(i + a, j), S = P(i + a, j + b), W = P(i, j + b);
  const d = 5;
  let s = poly([W, S, [S[0], S[1] + d], [W[0], W[1] + d]], shade(C.soil, 0.72)) +
    poly([S, E, [E[0], E[1] + d], [S[0], S[1] + d]], shade(C.soil, 0.56)) + poly([N, E, S, W], C.soil);
  for (let t = 1; t < 6; t++) {
    const p0 = mid(N, W, t / 6), p1 = mid(E, S, t / 6);
    s += `<line x1="${f1(p0[0])}" y1="${f1(p0[1])}" x2="${f1(p1[0])}" y2="${f1(p1[1])}" stroke="${shade(C.soil, 0.8)}" stroke-width="3" stroke-linecap="round"/>`;
  }
  if (crop) {
    const col = cropCol || C.crop1;
    for (let ti = 0; ti < 4; ti++) for (let tj = 0; tj < 4; tj++) {
      const [x, y] = P(i + (ti + 0.5) * a / 4, j + (tj + 0.5) * b / 4);
      if (state === "ready") {
        s += `<g class="sway"><path d="M${x} ${y} L${x - 5} ${y - 15} M${x} ${y} L${x} ${y - 19} M${x} ${y} L${x + 5} ${y - 15}" stroke="${shade(col, 0.75)}" stroke-width="3" stroke-linecap="round"/>
          <circle cx="${x}" cy="${y - 19}" r="3" fill="${col}"/><circle cx="${x - 5}" cy="${y - 15}" r="2.5" fill="${col}"/><circle cx="${x + 5}" cy="${y - 15}" r="2.5" fill="${col}"/></g>`;
      } else {
        s += `<path d="M${x} ${y} L${x - 3} ${y - 7} M${x} ${y} L${x + 3} ${y - 7}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`;
      }
    }
  }
  return s;
}

/* ---------- Gebäude des Hofs ---------- */
export const FOOT = {
  hut: [3, 3], futtermuehle: [3, 3], wildkammer: [2, 2], wildkueche: [2, 2], raeucherei: [2, 2], gerberei: [2, 2], plot: [2, 2],
};

export function building(id, i, j, opt = {}) {
  const lit = !!opt.lit;
  switch (id) {
    case "hut": return box({ i: i + 0.2, j: j + 0.5, a: 2.6, b: 2.0, H: 40, base: C.wood, roof: C.roof, R: 34, door: 0.55, windows: [0.22, 0.84], lit })
      + (() => { const [x, y] = P(i + 2.4, j + 0.9, 74); return `<rect x="${x}" y="${y - 10}" width="12" height="22" fill="${C.wood2}"/>` + smoke(x + 6, y - 18); })();
    case "futtermuehle": return box({ i: i + 0.1, j: j + 0.6, a: 2.0, b: 1.8, H: 46, base: C.wall, roof: C.roofBlue, R: 28, door: 0.5, windows: [0.2, 0.8], lit })
      + cylinder(i + 2.55, j + 1.1, 20, 64, C.silo, C.roofBlue);
    case "wildkammer": {
      const s = box({ i: i + 0.15, j: j + 0.2, a: 1.7, b: 1.6, H: 34, base: C.wall2, flatRoof: "#4c5a55", door: 0.42, windows: [0.8], lit });
      const [x, y] = P(i + 1.85, j + 0.6, 30);
      return s + `<rect x="${x - 4}" y="${y - 4}" width="14" height="12" fill="${C.metal}"/><circle cx="${x + 3}" cy="${y + 2}" r="4" fill="none" stroke="${shade(C.metal, 0.6)}" stroke-width="1.5"/>`;
    }
    case "wildkueche": {
      const s = box({ i: i + 0.15, j: j + 0.2, a: 1.7, b: 1.6, H: 36, base: C.wall, roof: C.roofGreen, R: 24, door: 0.4, windows: [0.8], lit });
      const [x, y] = P(i + 1.5, j + 0.5, 62);
      return s + `<rect x="${x}" y="${y - 8}" width="9" height="18" fill="${C.stone}"/>` + smoke(x + 4, y - 14);
    }
    case "raeucherei": {
      let s = box({ i: i + 0.5, j: j + 0.3, a: 1.0, b: 1.0, H: 54, base: C.stone, roof: C.wood2, R: 18, door: 0.5 });
      const [x, y] = P(i + 1.1, j + 0.8, 90);
      s += smoke(x, y - 4);
      for (let t = 0; t < 3; t++) { const [lx, ly] = P(i + 0.35, j + 1.55 + t * 0.12); s += `<rect x="${lx - 18}" y="${ly - 8 - t * 3}" width="30" height="7" rx="3" fill="${shade(C.wood, 1.05 - t * 0.08)}"/>`; }
      return s;
    }
    case "gerberei": {
      let s = box({ i: i + 0.15, j: j + 0.15, a: 1.5, b: 1.2, H: 30, base: C.woodLight, roof: C.wood2, R: 18, door: 0.5 });
      for (let t = 0; t < 2; t++) {
        const [x, y] = P(i + 0.5 + t * 0.7, j + 1.75);
        s += `<line x1="${x - 12}" y1="${y}" x2="${x - 12}" y2="${y - 34}" stroke="${C.wood2}" stroke-width="3"/><line x1="${x + 12}" y1="${y}" x2="${x + 12}" y2="${y - 34}" stroke="${C.wood2}" stroke-width="3"/>
          <rect x="${x - 10}" y="${y - 32}" width="20" height="24" rx="5" fill="${t ? "#b8662f" : "#8a6a4c"}"/>`;
      }
      return s;
    }
  }
  return "";
}

/* ---------- Revier-Einrichtungen ---------- */
export function hochsitz(i, j, closed = false) {
  const L = closed ? 56 : 70;
  const c = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
  const ctr = P(i + 0.5, j + 0.5);
  const tops = c.map(([x, y]) => [x + (ctr[0] - x) * (closed ? 0.15 : 0.3), y - L]);
  let s = groundShadow(i, j, 1.2, 0.9, 0.45);
  for (const k of [0, 1, 3, 2]) s += `<line x1="${f1(c[k][0])}" y1="${f1(c[k][1])}" x2="${f1(tops[k][0])}" y2="${f1(tops[k][1])}" stroke="${C.wood2}" stroke-width="5" stroke-linecap="round"/>`;
  if (!closed) for (const t of [0.35, 0.65]) {
    const a = mid(c[3], tops[3], t), b = mid(c[2], tops[2], t);
    s += `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${C.wood2}" stroke-width="4" stroke-linecap="round"/>`;
  }
  s += box({ i: i + (closed ? 0.05 : 0.15), j: j + (closed ? 0.05 : 0.15), a: closed ? 0.9 : 0.7, b: closed ? 0.9 : 0.7, H: closed ? 34 : 26, base: closed ? C.woodLight : C.wood, roof: closed ? C.roofGreen : C.roof, R: 16, windows: [0.5], shadow: false, z: L });
  return s;
}

export function salzlecke(i, j) {
  const [x, y] = P(i + 0.5, j + 0.5);
  return groundShadow(i + 0.2, j + 0.2, 0.6, 0.6) + `<rect x="${x - 3}" y="${y - 30}" width="6" height="30" fill="${C.wood2}"/><rect x="${x - 9}" y="${y - 42}" width="18" height="14" rx="2" fill="#e9e6dd"/><rect x="${x - 9}" y="${y - 32}" width="18" height="4" fill="#cfcac0"/>`;
}

export function kirrung(i, j) {
  const [x, y] = P(i + 0.5, j + 0.5);
  return `<ellipse cx="${x}" cy="${y}" rx="22" ry="9" fill="${shade(C.soil, 0.9)}"/><ellipse cx="${x - 4}" cy="${y - 3}" rx="10" ry="4" fill="${C.crop1}"/>
    <circle cx="${x + 18}" cy="${y - 20}" r="0" />` + box({ i: i + 0.65, j: j + 0.05, a: 0.3, b: 0.3, H: 26, base: C.wood, shadow: false });
}

export function falle(i, j, armed, ready) {
  let s = box({ i: i + 0.1, j: j + 0.3, a: 0.9, b: 0.4, H: 14, base: C.woodLight, flatRoof: shade(C.woodLight, 0.85) });
  const [x, y] = P(i + 0.55, j + 0.35, 22);
  s += `<rect x="${x - 2}" y="${y - 10}" width="4" height="10" fill="${C.metal}"/><circle cx="${x}" cy="${y - 12}" r="4" fill="${ready ? "#e2533b" : armed ? "#7fb069" : "#9aa3a0"}"/>`;
  return s;
}

export function bauplatz(i, j, a = 1, b = 1) {
  return diamond(i + 0.05, j + 0.05, a - 0.1, b - 0.1, "rgba(245,241,230,0.25)", `stroke="${C.hud}" stroke-width="2" stroke-dasharray="6 5"`) +
    (() => { const [x, y] = P(i + a / 2, j + b / 2); return `<circle cx="${x}" cy="${y}" r="11" fill="${C.hud}"/><path d="M${x - 5} ${y} H${x + 5} M${x} ${y - 5} V${y + 5}" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>`; })();
}

export function signpost(i, j, text) {
  const [x, y] = P(i, j);
  return { d: i + j + 0.3, svg: `<rect x="${x - 2}" y="${y - 40}" width="5" height="40" fill="${C.wood2}"/>
    ${poly([[x - 48, y - 58], [x + 36, y - 58], [x + 48, y - 46], [x + 36, y - 34], [x - 48, y - 34]], C.wall)}
    <text x="${x - 6}" y="${y - 41}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.ink}" font-family="Inter, system-ui, sans-serif">${text}</text>` };
}

/* ---------- Wild (Seitenansicht, passt in die Iso-Szene) ---------- */
export function rehSvg(col = C.reh, spiesse = false) {
  return `<path d="M44 56 C40 44 36 34 35 26 L52 20 C56 30 60 38 66 42 Z"/><path d="M38 30 C34 26 29 25 25 26 C22 27 22 31 25 32 C29 33 35 33 42 33 Z"/><ellipse cx="44" cy="24" rx="9" ry="7"/>
    <ellipse cx="41" cy="13" rx="3.4" ry="7.5" transform="rotate(-22 41 13)"/><ellipse cx="49" cy="14" rx="3.4" ry="7.5" transform="rotate(14 49 14)"/>
    <path d="M46 46 C58 38 86 38 100 44 C106 48 106 58 99 63 C86 68 60 68 50 63 C44 60 42 52 46 46 Z"/>
    <path d="M52 60 L51 94 L55 94 L57 62 Z M60 62 L60 94 L64 94 L65 63 Z M88 60 C92 70 90 80 89 94 L93 94 C95 80 97 70 96 60 Z M95 58 C100 70 98 82 97 94 L101 94 C103 82 105 68 101 56 Z"/>
    ${spiesse ? `<path d="M42 12 L40 -7 M48 12 L50 -7" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/>` : ""}
    <ellipse cx="101" cy="52" rx="4.5" ry="6.5" fill="#efe6d2"/>`;
}
export function sauSvg() {
  return `<path d="M22 44 Q26 14 60 12 Q96 10 111 30 Q119 44 109 56 L32 59 Q17 56 22 44Z"/><path d="M30 28 L4 44 Q3 50 9 52 L33 56Z"/><path d="M33 25 L38 12 L44 26Z"/>
    <rect x="36" y="52" width="7" height="22" rx="2"/><rect x="47" y="53" width="7" height="21" rx="2"/><rect x="90" y="50" width="7" height="24" rx="2"/><rect x="100" y="48" width="7" height="25" rx="2"/>
    <path d="M45 13 L50 6 L55 13 L60 5 L65 12 L71 6 L75 13Z"/>`;
}
export function wildAt(i, j, kind, k = 0.5, flip = false) {
  const [x, y] = P(i, j);
  const col = { reh: C.reh, sau: C.sau, gams: C.gams, rotwild: C.rot, muffel: C.muffel }[kind] || C.reh;
  const inner = kind === "sau" ? sauSvg() : rehSvg(col);
  const w = kind === "sau" ? 120 : 110, h = kind === "sau" ? 76 : 96;
  const sx = flip ? -k : k;
  return { d: i + j + 0.5, svg: `<ellipse cx="${x + 4}" cy="${y + 2}" rx="${30 * k * 2}" ry="${7 * k * 2}" fill="${C.shadow}" opacity="0.3"/>
    <g transform="translate(${x - (flip ? -w * k / 2 : w * k / 2)} ${y - h * k}) scale(${sx} ${k})" fill="${col}">${inner}</g>` };
}
