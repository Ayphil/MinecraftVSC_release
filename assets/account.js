// Account page: sign in / up / reset, then plan, usage, worlds, billing, password, and account deletion.
// Everything from the server is put on the page with textContent, never as HTML.
"use strict";
(() => {
  // Never work inside someone else's frame (clickjacking). _headers says the same with frame-ancestors, where the
  // host supports it.
  if (window.top !== window.self) {
    document.body.replaceChildren();
    return;
  }
  const $ = (id) => document.getElementById(id);
  const cfg = window.MCVSC;
  const PLAN_NAMES = { free: "Free", starter: "Starter", plus: "Plus", pro: "Pro" };
  const PRICES = { starter: { year: "$9/yr" }, plus: { year: "$18/yr", month: "$2/mo" }, pro: { year: "$45/yr", month: "$5/mo" } };
  const PLAN_KEY = "mcvsc.wantPlan";   // a plan picked on the home page, kept across the confirmation email

  // ---------- small helpers ----------
  function show(view) {
    for (const id of ["view-loading", "view-auth", "view-newpass", "view-dash"]) $(id).hidden = id !== view;
    $("signout").hidden = view !== "view-dash";
  }
  function say(el, text, kind) {
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }
  async function busy(form, fn) {
    const btns = form.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    try { return await fn(); } finally { btns.forEach((b) => (b.disabled = false)); }
  }
  const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
  const gb = (n) => {
    const [v, unit] = n >= 1024 ** 3 ? [n / 1024 ** 3, " GB"] : [n / 1024 ** 2, " MB"];
    return (Number.isInteger(v) || v >= 10 ? v.toFixed(0) : v.toFixed(1)) + unit;
  };
  const date = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  // Only ever navigate to Stripe's own pages, whatever the server returns.
  function goStripe(url, host) {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== host) throw new Error("Unexpected payment page address; not opening it.");
    location.assign(u.href);
  }

  const params = new URLSearchParams(location.search);
  const planParam = params.get("plan");
  if (planParam === "starter" || planParam === "plus" || planParam === "pro") store.set(PLAN_KEY, planParam);

  // ---------- signed out ----------
  function tab(which) {
    const signup = which === "signup";
    $("tab-signin").setAttribute("aria-selected", String(!signup));
    $("tab-signup").setAttribute("aria-selected", String(signup));
    $("form-signin").hidden = signup;
    $("form-signup").hidden = !signup;
    $("form-reset").hidden = true;
    say($("auth-msg"), "");
    (signup ? $("form-signup") : $("form-signin")).querySelector("input").focus();
  }
  $("tab-signin").addEventListener("click", () => tab("signin"));
  $("tab-signup").addEventListener("click", () => tab("signup"));
  $("show-reset").addEventListener("click", () => {
    $("form-signin").hidden = true;
    $("form-reset").hidden = false;
    $("form-reset").email.value = $("form-signin").email.value;
    say($("auth-msg"), "");
  });
  $("hide-reset").addEventListener("click", () => tab("signin"));

  $("form-signin").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget, email = f.email.value.trim(), password = f.password.value;
    if (!emailOk(email) || !password) return say($("auth-msg"), "Enter your email and password.", "err");
    busy(f, async () => {
      try {
        await Auth.signIn(email, password);
        f.reset();
        await openDash();
      } catch (err) { say($("auth-msg"), err.message, "err"); }
    });
  });

  $("form-signup").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget, email = f.email.value.trim(), password = f.password.value;
    if (!emailOk(email)) return say($("auth-msg"), "Enter a valid email address.", "err");
    if (password.length < cfg.minPassword) return say($("auth-msg"), `Use at least ${cfg.minPassword} characters for the password.`, "err");
    if (password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4)
      return say($("auth-msg"), "Don't use your email name in the password.", "err");
    if (!f.agree.checked) return say($("auth-msg"), "Please accept the Terms to create an account.", "err");
    busy(f, async () => {
      try {
        const r = await Auth.signUp(email, password);
        f.reset();
        if (r.signedIn) return openDash();
        say($("auth-msg"), `Almost done: we sent a confirmation link to ${email}. Open it to finish creating your account.`, "ok");
      } catch (err) { say($("auth-msg"), err.message, "err"); }
    });
  });

  $("form-reset").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget, email = f.email.value.trim();
    if (!emailOk(email)) return say($("auth-msg"), "Enter a valid email address.", "err");
    busy(f, async () => {
      try {
        await Auth.recover(email);
        // Same answer whether or not the address has an account.
        say($("auth-msg"), `If ${email} has an account, a reset link is on its way.`, "ok");
      } catch (err) { say($("auth-msg"), err.message, "err"); }
    });
  });

  // ---------- new password (from a reset link) ----------
  function checkNewPassword(f, msg) {
    const p = f.password.value;
    if (p.length < cfg.minPassword) { say(msg, `Use at least ${cfg.minPassword} characters.`, "err"); return null; }
    if (p !== f.again.value) { say(msg, "The two passwords don't match.", "err"); return null; }
    return p;
  }
  $("form-newpass").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget, p = checkNewPassword(f, $("np-msg"));
    if (!p) return;
    busy(f, async () => {
      try {
        await Auth.updatePassword(p);
        f.reset();
        await openDash("Password saved. Use it in mcvsc next time it asks you to sign in.");
      } catch (err) { say($("np-msg"), err.message, "err"); }
    });
  });

  // ---------- signed in ----------
  let account = null;

  async function openDash(note) {
    show("view-loading");
    for (const id of ["dash-msg", "pw-msg", "del-msg"]) say($(id), "");
    try {
      account = await Auth.api("account");
    } catch (err) {
      if (err.status === 401) return signedOut(err.message);
      show("view-dash");
      say($("dash-msg"), err.message, "err");
      return;
    }
    render(account);
    show("view-dash");
    if (note) say($("dash-msg"), note, "ok");

    const want = store.get(PLAN_KEY);
    if (want && account.plan === "free" && account.billingEnabled) {
      const card = document.querySelector(`.plan[data-plan="${want}"]`);
      if (card) {
        card.classList.add("picked");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        if (!note) say($("dash-msg"), `You picked ${PLAN_NAMES[want]}. Choose it below to go to checkout.`, "ok");
      }
    }
    store.set(PLAN_KEY, null);
  }

  function render(a) {
    $("d-email").textContent = a.email || "";
    $("d-download").href = cfg.download;

    const paid = a.plan !== "free";
    $("d-plan").textContent = PLAN_NAMES[a.plan] || a.plan;
    const st = $("d-status");
    const statusText = {
      active: ["Active", "good"], trialing: ["Trial", "good"], past_due: ["Payment failed", "warn"],
      unpaid: ["Unpaid", "bad"], canceled: ["Cancelled", ""], incomplete: ["Payment pending", "warn"],
      incomplete_expired: ["Checkout expired", ""], paused: ["Paused", "warn"],
    }[a.status] || ["Free plan", "good"];
    st.textContent = paid || a.status ? statusText[0] : "Free plan";
    st.className = "badge " + (paid || a.status ? statusText[1] : "good");

    let period = paid && a.interval ? `Billed ${a.interval === "year" ? "yearly" : "monthly"}. ` : "";
    if (paid && a.periodEnd) period += (a.cancelAtPeriodEnd ? "Ends on " : "Renews on ") + date(a.periodEnd) + ".";
    if (a.status === "past_due") period = "Your last payment didn't go through. Update your card in Manage billing to keep your space.";
    if (a.cancelAtPeriodEnd && paid) period += " After that you're on Free. Nothing is deleted right away: you get 6 months to download or clean up, and we email you first.";
    $("d-period").textContent = period;

    const pct = a.quota > 0 ? Math.min(100, (a.used / a.quota) * 100) : 100;
    const m = $("d-meter");
    m.firstElementChild.style.width = pct.toFixed(1) + "%";
    m.classList.toggle("full", pct >= 95);
    m.setAttribute("aria-valuenow", pct.toFixed(0));
    $("d-used").textContent = `${gb(a.used)} used`;
    $("d-quota").textContent = `of ${gb(a.quota)}`;
    if (a.used > a.quota) say($("dash-msg"), "You're over your plan's storage. Your worlds stay downloadable, but new uploads are paused until you clean up old versions in mcvsc or upgrade.", "err");

    $("d-portal").hidden = !(a.hasBilling && a.billingEnabled);

    // plan cards: prices only once checkout is open
    document.documentElement.classList.toggle("billing-open", !!a.billingEnabled);
    const free = a.plans.find((p) => p.id === "free");
    if (free) document.querySelector("[data-free-space]").textContent = gb(free.quota);
    const hint = $("plans-hint");
    if (!a.billingEnabled) hint.textContent = "Paid plans are coming soon. Everything works on Free in the meantime.";
    else if (paid) hint.textContent = "To switch plan or billing period, or to cancel, use Manage billing.";
    else hint.textContent = "Every plan gets every feature; you only pay for space. Checkout and card details are handled by Stripe.";
    $("d-notify-row").hidden = !!a.billingEnabled || a.notifyPaid === undefined;   // undefined: older server
    $("d-notify").checked = !!a.notifyPaid;
    for (const card of document.querySelectorAll("#d-plans .plan")) {
      const id = card.dataset.plan, buy = card.querySelector(".buy");
      const offered = a.plans.find((p) => p.id === id) || {};
      const button = (text, cls, attrs = {}) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = text;
        Object.assign(b.dataset, attrs);
        if (!attrs.action) b.disabled = true;
        return b;
      };
      card.classList.toggle("featured", id === a.plan);
      buy.replaceChildren();
      if (id === a.plan) buy.append(button("Current plan", "btn secondary block"));
      else if (id === "free") buy.append(button(paid ? "Cancel in Manage billing" : "Free plan", "btn secondary block"));
      else if (!a.billingEnabled || !(offered.year || offered.month)) buy.append(button("Coming soon", "btn secondary block"));
      else if (paid) buy.append(button(`Switch to ${PLAN_NAMES[id]}`, "btn secondary block", a.hasBilling ? { action: "portal" } : {}));
      else {
        if (offered.year) buy.append(button(`Choose ${PLAN_NAMES[id]} · ${PRICES[id].year}`, "btn block", { action: "checkout", interval: "year" }));
        if (offered.month) buy.append(button(`Monthly · ${PRICES[id].month}`, "btn secondary block", { action: "checkout", interval: "month" }));
      }
    }

    // worlds
    const tbody = $("d-worlds").querySelector("tbody");
    tbody.replaceChildren();
    for (const w of a.worlds) {
      const tr = document.createElement("tr");
      const name = document.createElement("td"), mp = document.createElement("td"), status = document.createElement("td");
      name.textContent = w.name;
      mp.className = "opt muted";
      mp.textContent = w.modpack || "—";
      status.className = "muted";
      status.textContent = !w.exists ? "Not uploaded yet"
        : w.lockMachine ? `Checked out on ${w.lockMachine}${w.lockTime ? " since " + new Date(w.lockTime).toLocaleString() : ""}${quiet(w.lockSeen)}`
        : "In the cloud";
      tr.append(name, mp, status);
      tbody.append(tr);
    }
    $("d-worlds").hidden = a.worlds.length === 0;
    $("d-noworlds").hidden = a.worlds.length !== 0;
  }

  // The PC holding a world checks in every few minutes while mcvsc is open; quiet for longer, it's closed or off.
  function quiet(seen) {
    const ms = seen ? Date.now() - Date.parse(seen) : 0;
    if (!(ms > 20 * 60000)) return "";
    const h = ms / 3600000;
    return ` · last heard from ${h < 1 ? Math.round(ms / 60000) + " min" : h < 48 ? Math.floor(h) + " h" : Math.floor(h / 24) + " days"} ago`;
  }

  $("d-notify").addEventListener("change", async (e) => {
    const box = e.target;
    box.disabled = true;
    try {
      box.checked = (await Auth.api("notify", { paid: box.checked })).notifyPaid;
      say($("dash-msg"), box.checked ? "Done: we'll email you once when paid plans open." : "Okay, no email about paid plans.", "ok");
    } catch (err) {
      box.checked = !box.checked;
      say($("dash-msg"), err.message, "err");
    } finally { box.disabled = false; }
  });

  $("d-plans").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn || btn.disabled) return;
    const plan = btn.closest(".plan").dataset.plan;
    btn.disabled = true;
    say($("dash-msg"), "Opening Stripe…");
    try {
      if (btn.dataset.action === "checkout") goStripe((await Auth.api("checkout", { plan, interval: btn.dataset.interval })).url, "checkout.stripe.com");
      else goStripe((await Auth.api("portal")).url, "billing.stripe.com");
    } catch (err) {
      btn.disabled = false;
      if (err.status === 401) return signedOut(err.message);
      say($("dash-msg"), err.message, "err");
    }
  });

  $("d-portal").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { goStripe((await Auth.api("portal")).url, "billing.stripe.com"); }
    catch (err) {
      btn.disabled = false;
      if (err.status === 401) return signedOut(err.message);
      say($("dash-msg"), err.message, "err");
    }
  });

  $("form-password").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget, p = checkNewPassword(f, $("pw-msg"));
    if (!p) return;
    busy(f, async () => {
      try {
        await Auth.updatePassword(p);
        f.reset();
        say($("pw-msg"), "Password changed.", "ok");
      } catch (err) { say($("pw-msg"), err.message, "err"); }
    });
  });

  $("form-delete").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget, msg = $("del-msg");
    const typed = f.confirm.value.trim();
    if (!account || typed.toLowerCase() !== String(account.email).toLowerCase()) return say(msg, "Type your email address exactly as shown above.", "err");
    if (!f.password.value) return say(msg, "Enter your password.", "err");
    if (!confirm("Delete your mcvsc account, every world and every snapshot? This can't be undone.")) return;
    busy(f, async () => {
      try {
        // A fresh sign-in proves it's really you; the server checks it happened in the last few minutes.
        await Auth.signIn(account.email, f.password.value);
        f.password.value = "";
        for (let i = 0; i < 60; i++) {
          say(msg, i === 0 ? "Deleting…" : `Deleting… (still freeing stored files, step ${i + 1})`);
          const r = await Auth.api("delete_account", { confirm: typed });
          if (r.deleted) {
            Auth.forget();
            account = null;
            return signedOut("Your account and all its data were deleted. Thanks for trying mcvsc.", "ok");
          }
          if (!r.more) break;
        }
        say(msg, "Deletion didn't finish. Try again; it continues where it stopped.", "err");
      } catch (err) { say(msg, err.message, "err"); }
    });
  });

  $("signout").addEventListener("click", async () => {
    await Auth.signOut();
    account = null;
    signedOut("You're signed out.", "ok");
  });

  function signedOut(text, kind = "err") {
    show("view-auth");
    const wantsSignup = params.get("mode") === "signup";
    $("tab-signup").hidden = !cfg.signupOpen;
    tab(wantsSignup && cfg.signupOpen ? "signup" : "signin");
    if (text) say($("auth-msg"), text, kind);
    else if (wantsSignup && !cfg.signupOpen) say($("auth-msg"), "mcvsc isn't open to new accounts yet. It opens together with paid plans.", "ok");
  }

  // ---------- start ----------
  async function start() {
    const redirect = Auth.consumeRedirect();
    const checkout = params.get("checkout");
    if (checkout) history.replaceState(null, "", location.pathname);

    if (redirect?.error) return signedOut(redirect.error);
    if (redirect?.type === "recovery") { show("view-newpass"); $("form-newpass").password.focus(); return; }
    if (!Auth.signedIn) return signedOut("", "");

    if (redirect?.type === "signup") return openDash("Email confirmed. Welcome to mcvsc! Sign in to the app with the same email and password.");
    if (checkout === "cancel") return openDash("Checkout cancelled. Nothing was charged.");
    if (checkout === "success") {
      await openDash("Payment received, thank you! Updating your plan…");
      // The plan changes when Stripe's webhook arrives, usually within seconds.
      for (let i = 0; i < 10 && account && account.plan === "free"; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try { account = await Auth.api("account"); render(account); } catch { break; }
      }
      if (account) say($("dash-msg"), account.plan === "free"
        ? "Payment received. Your plan will show here in a minute; refresh the page if it doesn't."
        : `You're on ${PLAN_NAMES[account.plan]} now: ${gb(account.quota)} of storage. Enjoy!`, "ok");
      return;
    }
    return openDash();
  }
  start();
})();
