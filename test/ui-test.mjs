// UI-Test mit simuliertem Server (Zeiten 60× schneller). Prüft Darstellung und Abläufe.
import { chromium, devices } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(join(ROOT, "test/cfg.json"), "utf8"));
const SPEED = 60;

// ---------- statischer Server ----------
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const srv = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try { res.writeHead(200, { "Content-Type": types[extname(p)] || "text/plain" }); res.end(readFileSync(join(ROOT, p))); }
  catch { res.writeHead(404); res.end(); }
}).listen(8765);

// ---------- Mini-Simulation des Servers ----------
const iso = (t) => new Date(t).toISOString();
let events = [];
const st = {
  player: { revier_name: "Mein Revier", level: 1, xp: 0, xp_to_next: 7, taler: 80, grandeln: 10, lager_level: 0, huette_level: 0 },
  inventory: { hafer: 6, mais: 4 },
  plots: Array.from({ length: 6 }, (_, i) => ({ idx: i, crop: null, planted_at: null, ready_at: null })),
  buildings: [{ id: "futtermuehle", slots: 2 }],
  jobs: [], stands: [{ idx: 0, stand: "hochsitz_wildacker", ready_at: null }],
  orders: [
    { slot: 0, items: [{ item: "hafer", qty: 2 }], taler: 5, xp: 2, available_at: iso(Date.now() - 1000) },
    { slot: 1, items: [{ item: "aesungsmix", qty: 1 }], taler: 10, xp: 3, available_at: iso(Date.now() - 1000) },
    { slot: 2, items: [{ item: "reh", qty: 1 }], taler: 35, xp: 6, available_at: iso(Date.now() - 1000) },
  ],
  storage: { lager: { cap: 50, used: 10, level: 0, need: 1 }, huette: { cap: 50, used: 0, level: 0, need: 1 } },
  plot_shop: { owned: 6, max: 6, cost: 30 },
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
const actions = {
  game_start() { if (!started) { started = true; events.push({ type: "welcome" }); } },
  game_state() {},
  plant({ p_plots, p_crop }) {
    for (const i of p_plots) { const p = st.plots[i]; if (p.crop || !st.inventory[p_crop]) continue; take(p_crop, 1); p.crop = p_crop; p.planted_at = iso(Date.now()); p.ready_at = iso(Date.now() + cfg.crops[p_crop].grow_seconds * 1000 / SPEED); }
  },
  harvest({ p_plots }) {
    for (const i of p_plots) { const p = st.plots[i]; if (!p.crop || Date.parse(p.ready_at) > Date.now()) continue; add(p.crop, 2); xp(cfg.crops[p.crop].xp); p.crop = p.ready_at = p.planted_at = null; }
    events.push({ type: "drop", item: "schrauben" }); add("schrauben", 1);
  },
  start_job({ p_recipe }) {
    const r = cfg.recipes.find((r) => r.id === p_recipe);
    for (const [k, v] of Object.entries(r.inputs)) take(k, v);
    const last = Math.max(Date.now(), ...st.jobs.filter((j) => j.building === r.building_id).map((j) => Date.parse(j.ready_at)));
    st.jobs.push({ id: Math.random(), building: r.building_id, recipe: r.id, start_at: iso(last), ready_at: iso(last + r.seconds * 1000 / SPEED) });
  },
  collect_jobs({ p_building }) {
    st.jobs = st.jobs.filter((j) => {
      if (j.building !== p_building || Date.parse(j.ready_at) > Date.now()) return true;
      const r = cfg.recipes.find((r) => r.id === j.recipe); add(r.output_item, r.output_qty); xp(r.xp);
      events.push({ type: "collect", item: r.output_item, qty: r.output_qty }); return false;
    });
  },
  feed_stand({ p_idx }) { const s = st.stands[p_idx]; take("aesungsmix", 1); s.ready_at = iso(Date.now() + 900 * 1000 / SPEED); },
  hunt({ p_idx }) { const s = st.stands[p_idx]; s.ready_at = null; add("reh", 1); xp(6); events.push({ type: "hunt", flavor: "Jährling", xp: 6, item: "reh" }); },
  deliver_order({ p_slot }) { const o = st.orders[p_slot]; for (const i of o.items) take(i.item, i.qty); st.player.taler += o.taler; xp(o.xp); events.push({ type: "order", taler: o.taler, xp: o.xp }); o.items = [{ item: "mais", qty: 3 }]; },
  sell({ p_item, p_qty }) { take(p_item, p_qty); st.player.taler += p_qty; events.push({ type: "sold", item: p_item, qty: p_qty, taler: p_qty }); },
};

const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "de-DE" });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("fonts")) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
await page.route("**/auth/v1/**", (r) => r.fulfill({ json: { access_token: "t", refresh_token: "abcdefgh12", expires_in: 3600, user: { id: "u1" } } }));
await page.route("**/rest/v1/rpc/*", async (r) => {
  const name = r.request().url().split("/").pop();
  if (name === "game_config") return r.fulfill({ json: cfg });
  events = [];
  try {
    actions[name](JSON.parse(r.request().postData() || "{}"));
    await new Promise((res) => setTimeout(res, 80));
    return r.fulfill({ json: { ...structuredClone(st), now: iso(Date.now()), events } });
  } catch (e) {
    return r.fulfill({ status: 400, json: { message: e.message, details: e.details } });
  }
});

async function dismiss() { for (let i = 0; i < 3; i++) { const b = page.locator(".modal [data-act=modal-ok]"); if (await b.count()) { await b.first().click(); await page.waitForTimeout(150); } } }
const shot = (n) => page.screenshot({ path: join(ROOT, `test/shots/${n}.png`) });
const sleep = (t) => page.waitForTimeout(t);
async function swipe(idxs) {
  const boxes = [];
  for (const i of idxs) boxes.push(await page.locator(`.plot[data-idx="${i}"]`).boundingBox());
  const c = (b) => [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(...c(boxes[0])); await page.mouse.down();
  for (const b of boxes.slice(1)) await page.mouse.move(...c(b), { steps: 6 });
  await page.mouse.up();
}

await page.goto("http://localhost:8765/");
await page.waitForSelector(".modal");
await shot("01-willkommen");
await page.click("[data-act=modal-ok]");
await shot("02-revier-start");
await swipe([0, 1, 2, 3, 4, 5]);
await sleep(400);
await shot("03-gesaet");
await sleep(2300);
await shot("04-reif");
await swipe([0, 1, 2, 3, 4, 5]);
await sleep(600);
await page.click("[data-act=modal-ok]").catch(() => {});
await page.click(".card[data-act=open-b]");
await sleep(200);
await page.click("[data-act=start][data-id=r_aesungsmix]");
await sleep(300);
await page.click("[data-act=start][data-id=r_aesungsmix]");
await sleep(300);
await shot("05-muehle");
await sleep(4300);
await page.click("#sheet [data-act=collect]");
await sleep(400);
await shot("05b-levelup");
await dismiss();
await page.click("#sheet-backdrop", { position: { x: 20, y: 20 } });
await dismiss();
await page.click("[data-act=feed]");
await sleep(400);
await shot("06-hochsitz-wartet");
await sleep(15500);
await dismiss();
await page.click("[data-act=hunt]", { force: true });
await sleep(3000);
await shot("07-ansitz");
await page.click("[data-act=hunt-shoot]", { force: true });
await sleep(1200);
await shot("08-waidmannsheil");
await page.click("[data-act=hunt-close]");
await sleep(300);
await page.click(".modal [data-act=modal-ok]").catch(() => {});
await dismiss();
await page.click("#tabs [data-tab=gasthaus]");
await sleep(200);
await shot("09-gasthaus");
await page.click("[data-act=deliver][data-slot='0']");
await sleep(400);
await page.click(".modal [data-act=modal-ok]").catch(() => {});
await dismiss();
await page.click("#tabs [data-tab=lager]");
await sleep(200);
await shot("10-lager");
await page.click("#tabs [data-tab=bauen]");
await sleep(200);
await shot("11-bauen");
await page.click("#tabs [data-tab=revier]");
await page.evaluate(() => (document.querySelector("#view").scrollTop = 0));
await sleep(200);
await shot("12-revier-spaeter");

console.log("Inventar:", JSON.stringify(st.inventory), "Level:", st.player.level, "Taler:", st.player.taler);
console.log(errors.length ? "FEHLER:\n" + errors.join("\n") : "Keine JS-Fehler");
await browser.close();
srv.close();
