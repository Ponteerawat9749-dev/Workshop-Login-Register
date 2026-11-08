const $ = (id) => document.getElementById(id);
const views = { auth: $("authView"), home: $("homeView"), setup: $("setupView") };
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-ANON");
let sb = null;
if (configured) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

/* ---------- UI helpers ---------- */
function show(name){
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
}

function toast(title, message, type = "error"){
  const el = document.createElement("div");
  el.className = "toast " + (type === "success" ? "success" : "");
  el.setAttribute("role", "alert");
  const body = document.createElement("div");
  const b = document.createElement("b"); b.textContent = title;
  const s = document.createElement("span"); s.textContent = message;
  body.append(b, s);
  const x = document.createElement("button"); x.textContent = "×"; x.setAttribute("aria-label", "Dismiss");
  x.onclick = () => el.remove();
  el.append(body, x);
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 5500);
}

function setLoading(btn, loading, label){
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spinner"></span>' : "";
  if (!loading) btn.textContent = label;
}

function switchTab(tab){
  const login = tab === "login";
  $("tabLogin").classList.toggle("active", login);
  $("tabRegister").classList.toggle("active", !login);
  $("loginForm").classList.toggle("hidden", !login);
  $("registerForm").classList.toggle("hidden", login);
  $("title").textContent = login ? "Welcome back" : "Create your account";
  $("subtitle").textContent = login ? "Sign in to your account to continue." : "Register to get started in seconds.";
}

document.querySelectorAll(".toggle").forEach(btn => btn.addEventListener("click", () => {
  const input = $(btn.dataset.target);
  const hide = input.type === "text";
  input.type = hide ? "password" : "text";
  btn.textContent = hide ? "Show" : "Hide";
}));
$("tabLogin").onclick = () => switchTab("login");
$("tabRegister").onclick = () => switchTab("register");

/* ---------- Auth helpers ---------- */
const toEmail = (username) => `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

async function loadProfile(userId){
  const { data, error } = await sb.from("profiles")
    .select("first_name,last_name,username").eq("id", userId).single();
  if (error) throw error;
  return data;
}

async function renderHome(user){
  try {
    const p = await loadProfile(user.id);
    $("welcome").textContent = `Welcome, ${p.first_name} ${p.last_name}`;
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
  const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
  setLoading($("loginBtn"), false, "Login");

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
  const { data, error } = await sb.auth.signUp({
    email: toEmail(username),
    password,
    options: { data: { username, first_name: first, last_name: last } }
  });
  setLoading($("registerBtn"), false, "Create account");

  if (error) {
    const taken = /already registered|already exists|database error/i.test(error.message);
    return toast("Registration failed", taken ? "That username is already taken." : error.message);
  }
  // Supabase returns an obfuscated user with no identities when the account already exists
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return toast("Registration failed", "That username is already taken.");
  }

  $("registerForm").reset();
  if (data.session) {
    toast("Account created", "Welcome aboard!", "success");
    await renderHome(data.user);
  } else {
    // Email confirmation is enabled in your project — see setup notes (disable it for username login)
    toast("Account created", "Please check your project's email-confirmation settings, then log in.", "success");
    switchTab("login");
  }
});

/* ---------- Logout with confirmation ---------- */
const modal = $("logoutModal");
$("logoutBtn").onclick = () => { modal.classList.remove("hidden"); $("logoutCancel").focus(); };
$("logoutCancel").onclick = () => modal.classList.add("hidden");
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.classList.add("hidden"); });

$("logoutConfirm").onclick = async () => {
  const { error } = await sb.auth.signOut();
  modal.classList.add("hidden");
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

  // Keep UI in sync if the session ends elsewhere (other tab, expiry)
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") show("auth");
  });
})();