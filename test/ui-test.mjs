// UI-Test der Karten-Oberfläche mit simuliertem Server (Zeiten 60× schneller), quer und hochkant.
import { chromium, devices } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(join(ROOT, "test/cfg.json"), "utf8"));
const SPEED = 60;
mkdirSync(join(ROOT, "test/shots"), { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const srv = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try { res.writeHead(200, { "Content-Type": types[extname(p)] || "text/plain" }); res.end(readFileSync(join(ROOT, p))); }
  catch { res.writeHead(404); res.end(); }
}).listen(8765);

/* ---------- Mini-Server ---------- */
const iso = (t) => new Date(t).toISOString();
const later = (sec) => iso(Date.now() + (sec * 1000) / SPEED);
let events = [];
const st = {
  player: { revier_name: "Revier Lindenhof", level: 1, xp: 0, xp_to_next: 7, taler: 80, grandeln: 10, ansehen: 0, fallenschein: false, lager_level: 0, huette_level: 0 },
  inventory: { hafer: 6, mais: 4, sww_genuss: 2 },
  plots: Array.from({ length: 6 }, (_, i) => ({ idx: i, crop: null, planted_at: null, ready_at: null })),
  buildings: [{ id: "futtermuehle", slots: 2 }], jobs: [],
  reviere: [{ id: "feldrevier", hege: 0, hege_factor: 1 }],
  stands: [{ idx: 0, stand: "hochsitz_wildacker", revier: "feldrevier", ready_at: null, boost: null }],
  traps: [],
  orders: [
    { slot: 0, items: [{ item: "hafer", qty: 2 }], taler: 5, xp: 2, available_at: iso(Date.now() - 1000), bonus: null },
    { slot: 1, items: [{ item: "aesungsmix", qty: 1 }], taler: 10, xp: 3, available_at: iso(Date.now() - 1000), bonus: "sww_salzspray_anis" },
    { slot: 2, items: [{ item: "reh", qty: 1 }], taler: 35, xp: 6, available_at: iso(Date.now() - 1000), bonus: null },
  ],
  storage: { lager: { cap: 50, used: 10, level: 0, need: 1 }, huette: { cap: 50, used: 2, level: 0, need: 1 } },
  plot_shop: { owned: 6, max: 6, cost: 30 }, layout: {},
};
const add = (k, n) => (st.inventory[k] = (st.inventory[k] || 0) + n);
const take = (k, n) => { if ((st.inventory[k] || 0) < n) throw { message: "FEHLT", details: k }; st.inventory[k] -= n; };
const xp = (n) => {
  st.player.xp += n;
  while (st.player.xp >= st.player.xp_to_next) {
    st.player.xp -= st.player.xp_to_next; st.player.level++;
    st.player.xp_to_next = cfg.levels[st.player.level]?.xp_to_next || 999;
    events.push({ type: "levelup", level: st.player.level, taler: 20, grandeln: 1 });
  }
};
let started = false;
const A = {
  game_start() { if (!started) { started = true; events.push({ type: "welcome" }); } },
  game_state() {},
  save_layout({ p_layout }) { st.layout = p_layout; },
  plant({ p_plots, p_crop }) { for (const i of p_plots) { const p = st.plots[i]; if (p.crop || !st.inventory[p_crop]) continue; take(p_crop, 1); p.crop = p_crop; p.planted_at = iso(Date.now()); p.ready_at = later(cfg.crops[p_crop].grow_seconds); } },
  harvest({ p_plots }) { for (const i of p_plots) { const p = st.plots[i]; if (!p.crop || Date.parse(p.ready_at) > Date.now()) continue; add(p.crop, 2); xp(1); p.crop = p.ready_at = p.planted_at = null; } },
  start_job({ p_recipe }) {
    const r = cfg.recipes.find((r) => r.id === p_recipe); for (const [k, v] of Object.entries(r.inputs)) take(k, v);
    const last = Math.max(Date.now(), ...st.jobs.filter((j) => j.building === r.building_id).map((j) => Date.parse(j.ready_at)));
    st.jobs.push({ id: Math.random(), building: r.building_id, recipe: r.id, start_at: iso(last), ready_at: iso(last + r.seconds * 1000 / SPEED) });
  },
  collect_jobs({ p_building }) {
    st.jobs = st.jobs.filter((j) => { if (j.building !== p_building || Date.parse(j.ready_at) > Date.now()) return true;
      const r = cfg.recipes.find((r) => r.id === j.recipe); add(r.output_item, r.output_qty); xp(r.xp); events.push({ type: "collect", item: r.output_item, qty: r.output_qty }); return false; });
  },
  feed_stand({ p_idx, p_boost }) { const s = st.stands.find((x) => x.idx === p_idx); const c = cfg.stands.find((x) => x.id === s.stand); if (p_boost) take(p_boost, 1); take(c.feed_item, c.feed_qty); s.boost = p_boost; s.ready_at = later(c.wait_seconds * (p_boost ? 0.5 : 1)); },
  hunt({ p_idx }) { const s = st.stands.find((x) => x.idx === p_idx); s.ready_at = null; s.boost = null; add("reh", 2); xp(12); events.push({ type: "hunt", flavor: "Jährling", xp: 12, qty: 2, bonus: true, item: "reh" }); },
  deliver_order({ p_slot }) { const o = st.orders[p_slot]; for (const i of o.items) take(i.item, i.qty); st.player.taler += o.taler; xp(o.xp); events.push({ type: "order", taler: o.taler, xp: o.xp, bonus: o.bonus }); o.items = [{ item: "mais", qty: 3 }]; o.bonus = null; },
  build({ p_building }) { const b = cfg.buildings.find((x) => x.id === p_building); st.player.taler -= b.cost; st.buildings.push({ id: b.id, slots: b.slots }); events.push({ type: "built", building: b.id }); },
  lease_revier({ p_revier }) { st.reviere.push({ id: p_revier, hege: 0, hege_factor: 1 }); events.push({ type: "revier", revier: p_revier }); },
  take_course() { st.player.fallenschein = true; add("fallenkoeder", 3); events.push({ type: "course" }); },
  buy_trap({ p_revier }) { st.traps.push({ idx: st.traps.length, trap: "kastenfalle", revier: p_revier, ready_at: null, boost: null }); events.push({ type: "built", trap: "kastenfalle" }); },
  set_trap({ p_idx, p_boost }) { const t = st.traps[p_idx]; if (p_boost) take(p_boost, 1); take("fallenkoeder", 1); t.boost = p_boost; t.ready_at = later(1800 * 0.6); },
  check_trap({ p_idx }) { const t = st.traps[p_idx]; t.ready_at = null; add("fuchsbalg", 1); st.player.ansehen += 1; st.reviere[0].hege += 2; st.reviere[0].hege_factor = 0.98; events.push({ type: "trap", result: "catch", flavor: "Fuchs", item: "fuchsbalg", xp: 5 }); },
  buy_boost({ p_item, p_qty }) { add(p_item, p_qty); st.player.grandeln -= 2 * p_qty; events.push({ type: "bought", item: p_item, qty: p_qty }); },
  buy_stand({ p_stand }) { const c = cfg.stands.find((x) => x.id === p_stand); st.stands.push({ idx: st.stands.length, stand: c.id, revier: c.revier_id, ready_at: null, boost: null }); events.push({ type: "built", stand: c.id }); },
};

const errors = [];
const browser = await chromium.launch();
async function run(device, tag, flow) {
  const ctx = await browser.newContext({ ...devices[device], locale: "de-DE" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/fonts|ERR_|Failed to load/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("**/auth/v1/**", (r) => r.fulfill({ json: { access_token: "t", refresh_token: "abcdefgh12", expires_in: 3600, user: { id: "u1" } } }));
  await page.route("**/rest/v1/rpc/*", async (r) => {
    const name = r.request().url().split("/").pop();
    if (name === "game_config") return r.fulfill({ json: cfg });
    events = [];
    try {
      if (!A[name]) throw { message: "UNBEKANNT", details: name };
      A[name](JSON.parse(r.request().postData() || "{}"));
      await new Promise((res) => setTimeout(res, 60));
      return r.fulfill({ json: { ...structuredClone(st), now: iso(Date.now()), events } });
    } catch (e) { return r.fulfill({ status: 400, json: { message: e.message, details: e.details } }); }
  });
  const H = {
    page,
    shot: (n) => page.screenshot({ path: join(ROOT, `test/shots/${tag}-${n}.png`) }),
    sleep: (t) => page.waitForTimeout(t),
    async dismiss() { for (let i = 0; i < 4; i++) { const b = page.locator(".modal [data-act=modal-ok]"); if (await b.count()) { await b.first().click(); await page.waitForTimeout(150); } } },
    async center(key) { const b = await page.locator(`[data-obj="${key}"]`).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height * 0.6]; },
    async tap(key) { const [x, y] = await H.center(key); await page.mouse.click(x, y); await page.waitForTimeout(250); },
    async swipe(keys) {
      const pts = []; for (const k of keys) pts.push(await H.center(k));
      await page.mouse.move(...pts[0]); await page.mouse.down();
      for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 6 });
      await page.mouse.up(); await page.waitForTimeout(300);
    },
  };
  await page.goto("http://localhost:8765/");
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 8000 });
  try { await flow(H); }
  catch (e) { await H.shot("FEHLER"); throw e; }
  await ctx.close();
}

if (!process.env.NUR_HOCH) await run("iPhone 13 landscape", "quer", async (H) => {
  const { page } = H;
  await H.sleep(300); await H.shot("01-willkommen"); await H.dismiss();
  await H.shot("02-hof");
  await H.tap("plot:0"); await H.shot("03-saatleiste");
  await H.swipe(["plot:0", "plot:1", "plot:2", "plot:3", "plot:4", "plot:5"]);
  await H.sleep(600); await H.shot("04-gesaet");
  await H.sleep(2200);
  await page.click("[data-act=seed-close]").catch(() => {});
  await H.swipe(["plot:0", "plot:1", "plot:2", "plot:3", "plot:4", "plot:5"]);
  await H.sleep(500); await H.dismiss();
  await H.tap("bld:futtermuehle");
  await page.click("[data-act=start][data-id=r_aesungsmix]"); await H.sleep(250);
  await page.click("[data-act=start][data-id=r_aesungsmix]"); await H.sleep(250);
  await H.shot("05-muehle");
  await H.sleep(4300);
  await page.click("#panel [data-act=collect]"); await H.sleep(300); await H.dismiss();
  await page.click("[data-act=close]");
  await H.shot("06-hof-label");
  await page.click("#btn-karte"); await H.sleep(300); await H.shot("07-revierkarte");
  await page.click("[data-act=enter][data-id=feldrevier]"); await H.sleep(400); await H.shot("08-feldrevier");
  await H.tap("stand:0"); await H.shot("09-hochsitz-lockmittel");
  await page.click("[data-act=feed][data-boost=sww_genuss]"); await H.sleep(400);
  await H.shot("10-hochsitz-wartet");
  await H.sleep(7800);
  await H.shot("11-anblick");
  await H.tap("stand:0"); await H.sleep(2800);
  await page.click("[data-act=hunt-shoot]", { force: true }); await H.sleep(1100); await H.shot("12-waidmannsheil");
  await page.click("[data-act=hunt-close]"); await H.sleep(300); await H.dismiss();
  st.player.level = 4; st.player.taler = 900;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await H.sleep(400);
  await H.tap("slot:trap:feldrevier:0"); await H.shot("13-fallenlehrgang");
  await page.click("#panel [data-act=course]"); await H.sleep(300); await H.dismiss();
  await page.click("#panel [data-act=buy-trap]"); await H.sleep(300);
  await H.tap("trap:0"); await H.shot("14-falle-lockmittel");
  await page.click("[data-act=boost][data-id=sww_duft_lockei]"); await H.sleep(200);
  await page.click("[data-act=boost-go]"); await H.sleep(300);
  await page.click("[data-act=set-trap][data-boost=sww_duft_lockei]"); await H.sleep(300);
  await H.sleep(18500);
  await H.shot("15-fangmelder");
  await H.tap("trap:0"); await H.sleep(400); await H.shot("16-fang"); await H.dismiss();
  await page.click("#btn-hof"); await H.sleep(300);
  await page.click("[data-act=bauen]"); await H.sleep(200); await H.shot("17-bauen");
  await page.click("[data-act=build][data-id=wildkammer]"); await H.sleep(500);
  await page.click("[data-act=bauen]"); await page.click("[data-act=edit-start]"); await H.sleep(300);
  const [x, y] = await H.center("bld:wildkammer");
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 90, y + 60, { steps: 8 }); await H.sleep(100);
  await H.shot("18-umstellen"); await page.mouse.up();
  await page.click("[data-act=edit-save]"); await H.sleep(300);
  await page.click("[data-act=gasthaus]"); await H.sleep(200); await H.shot("19-gasthaus");
  await page.click("[data-act=close]"); await page.click("[data-act=lager]"); await H.sleep(200); await H.shot("20-lager");
});

await run("iPhone 13", "hoch", async (H) => {
  await H.sleep(400); await H.dismiss();
  if (process.env.NUR_HOCH) console.log(await H.page.evaluate(() => { const W = innerWidth; const o = [`iw ${W} sw ${document.documentElement.scrollWidth} sx ${scrollX} bodySL ${document.body.scrollLeft} appSL ${document.getElementById("app").scrollLeft}`]; for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1) && !el.closest("svg")) o.push(`${el.tagName}#${el.id}.${el.className} L${r.left | 0} R${r.right | 0}`); } return o.slice(0, 12).join("\n"); }));
  await H.shot("01-hof");
  await H.page.click("[data-act=gasthaus]"); await H.sleep(200); await H.shot("02-gasthaus");
});

console.log("Layout gespeichert:", JSON.stringify(st.layout).slice(0, 160));
console.log("Inventar:", JSON.stringify(st.inventory));
console.log(errors.length ? "FEHLER:\n" + errors.join("\n") : "Keine JS-Fehler");
await browser.close(); srv.close();
