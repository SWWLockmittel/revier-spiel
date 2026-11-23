// Verbindung zum Spiel-Server (Supabase). Kein SDK nötig: Auth + RPC über fetch.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const LS_KEY = "revier.session.v1";

export class GameError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail || null;
  }
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch { return null; }
}
function saveSession(s) {
  try {
    if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
    else localStorage.removeItem(LS_KEY);
  } catch { /* privater Modus: Sitzung bleibt im Speicher */ }
}

let session = loadSession();
let refreshing = null;

function toSession(data) {
  const expires_at = data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at, user_id: data.user?.id };
}

async function authFetch(path, body) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new GameError("OFFLINE");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.msg || data.message || data.error_description || data.error || "").toLowerCase();
    if (msg.includes("anonymous")) throw new GameError("GAST_AUS");
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new GameError("SITZUNG_UNGUELTIG");
    throw new GameError("AUTH_FEHLER", msg);
  }
  return data;
}

async function signUpGuest() {
  const data = await authFetch("signup", { data: {} });
  session = toSession(data);
  saveSession(session);
  return session;
}

async function refresh(token) {
  const data = await authFetch("token?grant_type=refresh_token", { refresh_token: token });
  session = toSession(data);
  saveSession(session);
  return session;
}

export async function ensureSession() {
  const now = Math.floor(Date.now() / 1000);
  if (session && session.expires_at - 60 > now) return session;
  if (session?.refresh_token) {
    if (!refreshing) refreshing = refresh(session.refresh_token).finally(() => { refreshing = null; });
    try { return await refreshing; }
    catch (e) {
      if (e.code === "OFFLINE") throw e;
      // Sitzung ist abgelaufen oder wurde auf ein anderes Gerät übertragen
      session = null; saveSession(null);
      throw new GameError("SITZUNG_UNGUELTIG");
    }
  }
  return signUpGuest();
}

export function hasSession() { return !!session; }

/** Übertragungs-Code für ein anderes Gerät (z. B. Safari → Homescreen-App). */
export async function transferCode() {
  await ensureSession();
  return session.refresh_token;
}

/** Übernimmt ein Revier per Code von einem anderen Gerät. */
export async function importCode(code) {
  const clean = String(code || "").trim();
  if (clean.length < 6) throw new GameError("CODE_UNGUELTIG");
  try { await refresh(clean); }
  catch (e) { throw e.code === "OFFLINE" ? e : new GameError("CODE_UNGUELTIG"); }
}

export function resetSession() { session = null; saveSession(null); }

export async function rpc(name, args = {}, retry = true) {
  const s = await ensureSession();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${s.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  } catch {
    throw new GameError("OFFLINE");
  }
  if (res.status === 401 && retry) {
    session.expires_at = 0;
    return rpc(name, args, false);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new GameError(data?.message || "SERVER_FEHLER", data?.details);
  return data;
}

export async function loadConfig() {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/game_config`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    throw new GameError("OFFLINE");
  }
  if (!res.ok) throw new GameError("SERVER_FEHLER");
  return res.json();
}
