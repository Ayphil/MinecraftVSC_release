// Public values only: the Supabase project URL and its publishable key (the same ones baked into mcvsc.exe).
// Never put a secret / service-role key here: everything in this folder is public.
// If you change supabaseUrl, change connect-src in account.html's Content-Security-Policy and in _headers too.
window.MCVSC = Object.freeze({
  supabaseUrl: "https://ddvoqdiiqslfygjtyhfh.supabase.co",
  supabaseKey: "sb_publishable_pL0gH0LG8KfEbUKaMxep-A_aJiyaUPg",
  minPassword: 10,
  // Turn on once Stripe checkout works in live mode: the home page then shows paid plans' prices and buy buttons
  // instead of "Coming soon". (The account page asks the server instead.)
  billingOpen: false,
  // New accounts: off until paid plans open (also turn sign-ups off in Supabase, and keep the API's ALLOWED_EMAILS).
  // The account page then only offers "Sign in".
  signupOpen: false,
  download: "https://github.com/Ayphil/MinecraftVSC_release/releases/latest/download/mcvsc.exe",
});
