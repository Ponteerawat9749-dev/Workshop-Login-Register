/* Path to the verified-badge icon shown after the user's name */
const VERIFY_ICON_SRC = "assert/icon-verify.png";

const $ = (id) => document.getElementById(id);
const views = { auth: $("authView"), home: $("homeView"), setup: $("setupView") };
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/* Read config.js safely: missing values fall back to defaults instead of crashing */
const CFG_URL = typeof SUPABASE_URL !== "undefined" ? String(SUPABASE_URL) : "";
const CFG_KEY = typeof SUPABASE_ANON_KEY !== "undefined" ? String(SUPABASE_ANON_KEY) : "";
/* Supabase Auth requires an email, so a username is mapped to an internal address.
   The domain is fixed here — nothing to set in config.js. Don't change it after users have registered. */
const CFG_DOMAIN = "users.workshop-login.app";

const configured = !!CFG_URL && !!CFG_KEY && !CFG_URL.includes("YOUR-PROJECT") && !CFG_KEY.includes("YOUR-ANON");
let sb = null;
if (configured) sb = window.supabase.createClient(CFG_URL, CFG_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

/* ---------- UI helpers ---------- */
function show(name){
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
}

function toast(title, message, type = "error"){
  const dur = 5000;
  const el = document.createElement("div");
  el.className = "toast " + (type === "success" ? "success" : "");
  el.style.setProperty("--dur", dur + "ms");
  el.setAttribute("role", "alert");
  el.innerHTML =
    `<svg class="i t-ico"><use href="#${type === "success" ? "i-check-circle" : "i-alert"}"/></svg>` +
    `<div class="t-body"><b></b><span></span></div>` +
    `<button type="button" aria-label="Dismiss">×</button>`;
  el.querySelector("b").textContent = title;
  el.querySelector("span").textContent = message;

  const close = () => {
    if (el.classList.contains("out")) return;
    el.classList.add("out");
    el.addEventListener("animationend", (e) => { if (e.animationName === "toastOut") el.remove(); });
    setTimeout(() => el.remove(), 500);
  };
  el.querySelector("button").onclick = close;
  $("toasts").appendChild(el);
  setTimeout(close, dur);
}

function setLoading(btn, loading, label){
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spinner"></span>' : "";
  if (!loading) btn.textContent = label;
}

function switchTab(tab){
  const login = tab === "login";
  $("tabs").dataset.active = tab;
  $("tabLogin").classList.toggle("active", login);
  $("tabRegister").classList.toggle("active", !login);
  $("loginForm").classList.toggle("hidden", !login);
  $("registerForm").classList.toggle("hidden", login);
  $("title").textContent = login ? "Welcome back" : "Create your account";
  $("subtitle").textContent = login ? "Sign in to your account to continue." : "Register to get started in seconds.";
}

/* Show / hide password (eye icon morphs) */
document.querySelectorAll(".eye").forEach(btn => btn.addEventListener("click", () => {
  const input = $(btn.dataset.target);
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  btn.classList.toggle("shown", reveal);
  btn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
}));
$("tabLogin").onclick = () => switchTab("login");
$("tabRegister").onclick = () => switchTab("register");

/* Password strength meter */
const STRENGTH_LABELS = ["At least 8 characters.", "Weak", "Fair", "Good", "Strong"];
$("regPass").addEventListener("input", (e) => {
  const pw = e.target.value;
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const level = pw ? Math.max(1, s) : 0;
  $("meter").dataset.level = level;
  $("meterLabel").textContent = STRENGTH_LABELS[level];
});

/* Verified badge: uses assert/icon-verify.png, falls back to an inline SVG if the file is missing */
function makeBadge(){
  const img = new Image();
  img.src = VERIFY_ICON_SRC;
  img.alt = "Verified";
  img.title = "Verified";
  img.onerror = () => {
    const span = document.createElement("span");
    span.innerHTML =
      '<svg viewBox="0 0 24 24" role="img" aria-label="Verified"><circle cx="12" cy="12" r="10" fill="#1d9bf0"/>' +
      '<path d="m8 12.5 2.8 2.8L16 9.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    img.replaceWith(span.firstChild);
  };
  return img;
}

/* Never let a request hang forever: fail after 20s with a visible error */
function withTimeout(promise, ms = 20000){
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("The server took too long to respond. Check your Supabase URL / key and internet connection.")), ms))
  ]);
}

/* ---------- Auth helpers ---------- */
const toEmail = (username) => `${username.trim().toLowerCase()}@${CFG_DOMAIN}`;

async function loadProfile(userId){
  const { data, error } = await sb.from("profiles")
    .select("first_name,last_name,username").eq("id", userId).single();
  if (error) throw error;
  return data;
}

async function renderHome(user){
  try {
    const p = await loadProfile(user.id);
    $("welcomeName").textContent = `${p.first_name} ${p.last_name}`;
    $("badge").replaceChildren(makeBadge());
    $("infoFirst").textContent = p.first_name;
    $("infoLast").textContent = p.last_name;
    $("infoUser").textContent = "@" + p.username;
    $("avatar").textContent = (p.first_name[0] + p.last_name[0]).toUpperCase();
    show("home");
  } catch (e) {
    console.error(e);
    toast("Profile error", "Signed in, but your profile could not be loaded.");
    await sb.auth.signOut();
    show("auth");
  }
}

/* ---------- Login ---------- */
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("loginUser").value.trim().toLowerCase();
  const password = $("loginPass").value;
  if (!username || !password) return toast("Missing information", "Please enter your username and password.");
  if (!USERNAME_RE.test(username)) return toast("Login failed", "Incorrect username or password.");

  setLoading($("loginBtn"), true);
  let data, error;
  try {
    ({ data, error } = await withTimeout(sb.auth.signInWithPassword({ email: toEmail(username), password })));
  } catch (err) {
    console.error("Login error:", err);
    error = err;
  } finally {
    setLoading($("loginBtn"), false, "Login");
  }

  if (error) {
    const invalid = /invalid login credentials/i.test(error.message);
    return toast("Login failed", invalid ? "Incorrect username or password." : error.message);
  }
  $("loginForm").reset();
  await renderHome(data.user);
});

/* ---------- Register ---------- */
$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const first = $("regFirst").value.trim();
  const last  = $("regLast").value.trim();
  const username = $("regUser").value.trim().toLowerCase();
  const password = $("regPass").value;
  const confirm  = $("regConfirm").value;

  if (!first || !last) return toast("Missing information", "Please enter your first and last name.");
  if (!USERNAME_RE.test(username)) return toast("Invalid username", "Use 3–20 letters, numbers or underscores.");
  if (password.length < 8) return toast("Weak password", "Password must be at least 8 characters.");
  if (password !== confirm) return toast("Passwords don't match", "Please re-enter your password.");

  setLoading($("registerBtn"), true);
  let data, error;
  try {
    ({ data, error } = await withTimeout(sb.auth.signUp({
      email: toEmail(username),
      password,
      options: { data: { username, first_name: first, last_name: last } }
    })));
  } catch (err) {
    console.error("Register error:", err);
    error = err;
  } finally {
    setLoading($("registerBtn"), false, "Create account");
  }

  if (error) {
    const taken = /already registered|already exists|database error/i.test(error.message);
    return toast("Registration failed", taken ? "That username is already taken." : error.message);
  }
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return toast("Registration failed", "That username is already taken.");
  }

  $("registerForm").reset();
  $("meter").dataset.level = 0;
  $("meterLabel").textContent = STRENGTH_LABELS[0];
  if (data.session) {
    toast("Account created", "Welcome aboard!", "success");
    await renderHome(data.user);
  } else {
    toast("Account created", "Please check your project's email-confirmation settings, then log in.", "success");
    switchTab("login");
  }
});

/* ---------- Logout with confirmation ---------- */
const modal = $("logoutModal");
function openModal(){
  modal.classList.remove("hidden");
  requestAnimationFrame(() => modal.classList.add("open"));
  $("logoutCancel").focus();
}
function closeModal(){
  modal.classList.remove("open");
  setTimeout(() => modal.classList.add("hidden"), 250);
}
$("logoutBtn").onclick = openModal;
$("logoutCancel").onclick = closeModal;
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });

$("logoutConfirm").onclick = async () => {
  const { error } = await sb.auth.signOut();
  closeModal();
  if (error) return toast("Logout failed", error.message);
  show("auth");
  switchTab("login");
  toast("Logged out", "You have been signed out.", "success");
};

/* ---------- Boot & session handling ---------- */
(async function init(){
  if (!configured) return show("setup");
  const { data: { session } } = await sb.auth.getSession();
  if (session) await renderHome(session.user); else show("auth");

  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") show("auth");
  });
})();