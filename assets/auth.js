// Minimal Supabase Auth (GoTrue) client over fetch, plus calls to the mcvsc API. No third-party script runs on the
// page, so the Content-Security-Policy can stay at script-src 'self'.
// The session is kept in sessionStorage: this tab only, gone when it closes (a stolen laptop with the browser open
// is the remaining risk, as with any site). Tokens never go in URLs we build, and are never logged.
"use strict";
const Auth = (() => {
  const { supabaseUrl: BASE, supabaseKey: KEY } = window.MCVSC;
  const STORE = "mcvsc.session";
  let session = read();
  let refreshing = null;

  function read() {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE));
      return s && typeof s.access_token === "string" && typeof s.refresh_token === "string" ? s : null;
    } catch { return null; }
  }
  function write(s) {
    session = s;
    try { s ? sessionStorage.setItem(STORE, JSON.stringify(s)) : sessionStorage.removeItem(STORE); } catch { /* private mode: memory only */ }
  }
  function fromTokens(j) {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Number(j.expires_at) || now + (Number(j.expires_in) || 3600),
    };
  }

  // Friendlier text for the errors people actually hit.
  function message(j, status) {
    const raw = String(j.msg || j.error_description || j.message || j.error || `Request failed (${status})`);
    if (/invalid login credentials/i.test(raw)) return "Wrong email or password.";
    if (/email not confirmed/i.test(raw)) return "Confirm your email first: open the link we sent you.";
    if (/rate limit|too many/i.test(raw) || status === 429) return "Too many attempts. Wait a few minutes and try again.";
    if (/already registered/i.test(raw)) return "That email already has an account. Sign in, or reset the password.";
    return raw;
  }

  async function gotrue(path, { method = "POST", body, token, query } = {}) {
    const url = new URL(`${BASE}/auth/v1/${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const headers = { apikey: KEY, "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    let r;
    try {
      r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: "omit" });
    } catch {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(message(j, r.status)), { status: r.status });
    return j;
  }

  // Where Supabase sends people back to from emails: this page, without query or hash.
  const back = () => location.origin + location.pathname;

  async function signUp(email, password) {
    const j = await gotrue("signup", { body: { email, password }, query: { redirect_to: back() } });
    if (j.access_token) { write(fromTokens(j)); return { signedIn: true }; }
    return { signedIn: false };   // confirmation email sent (or the address exists: Supabase doesn't say which)
  }

  async function signIn(email, password) {
    write(fromTokens(await gotrue("token", { query: { grant_type: "password" }, body: { email, password } })));
  }

  async function refresh() {
    if (!session) throw new Error("Not signed in");
    try {
      write(fromTokens(await gotrue("token", { query: { grant_type: "refresh_token" }, body: { refresh_token: session.refresh_token } })));
    } catch (e) {
      write(null);
      throw Object.assign(new Error("Your session ended. Sign in again."), { status: 401 });
    }
  }

  // A valid access token, refreshed a minute before it expires. One refresh at a time (refresh tokens rotate).
  async function token() {
    if (!session) return null;
    if (session.expires_at - 60 < Date.now() / 1000) {
      refreshing ??= refresh().finally(() => { refreshing = null; });
      await refreshing;
    }
    return session.access_token;
  }

  async function recover(email) {
    await gotrue("recover", { body: { email }, query: { redirect_to: back() } });
  }

  async function updatePassword(password) {
    await gotrue("user", { method: "PUT", body: { password }, token: await token() });
  }

  async function signOut() {
    const t = session?.access_token;
    write(null);
    if (t) await gotrue("logout", { token: t, query: { scope: "local" } }).catch(() => {});
  }

  // Links from Supabase emails come back as #access_token=...&type=signup|recovery, or #error=...
  // Read once, then wipe the fragment so tokens don't stay in the address bar or history.
  function consumeRedirect() {
    if (!location.hash.includes("=")) return null;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    if (h.get("error") || h.get("error_description")) {
      const d = h.get("error_description") || h.get("error");
      return { error: /expired|invalid/i.test(d) ? "That link has expired or was already used. Ask for a new one." : d };
    }
    if (h.get("access_token") && h.get("refresh_token")) {
      write(fromTokens(Object.fromEntries(h)));
      return { type: h.get("type") || "" };
    }
    return null;
  }

  // The mcvsc API (Supabase Edge Function). Throws Error(message) with .status.
  async function api(action, body = {}) {
    const t = await token();
    if (!t) throw Object.assign(new Error("Not signed in"), { status: 401 });
    let r;
    try {
      r = await fetch(`${BASE}/functions/v1/api/${encodeURIComponent(action)}`, {
        method: "POST",
        headers: { apikey: KEY, authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
      });
    } catch {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) write(null);
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }

  return {
    get signedIn() { return !!session; },
    signUp, signIn, recover, updatePassword, signOut, consumeRedirect, api, forget: () => write(null),
  };
})();
