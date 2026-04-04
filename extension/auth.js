// ── SocialEdge Auth Module ──────────────────────────────────────────────────
// Connects to the SocialEdge backend for authentication.
// Google Sign-In uses chrome.identity to get a Google ID token,
// then sends it to the backend for verification + user creation.

const API_BASE = "http://localhost:3000"; // TODO: change to production URL

const Auth = (() => {
  const SESSION_KEY = "_se_session";

  let _session = null; // { user: { id, name, email, plan, avatarUrl, ... }, token }

  /* ── Initialise: read stored session, verify with server ─────────────── */
  async function init() {
    const data = await chrome.storage.local.get([SESSION_KEY]);
    _session = data[SESSION_KEY] || null;

    // Verify token is still valid by calling /auth/me
    if (_session?.token) {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${_session.token}` },
        });
        if (res.ok) {
          const { user } = await res.json();
          _session.user = user;
          await _saveSession(_session);
        } else {
          // Token expired or invalid — clear session
          _session = null;
          await chrome.storage.local.remove(SESSION_KEY);
        }
      } catch {
        // Server unreachable — keep cached session for offline use
      }
    }
    return _session;
  }

  /* ── Getters ─────────────────────────────────────────────────────────── */
  function getUser()    { return _session?.user || null; }
  function getToken()   { return _session?.token || null; }
  function isLoggedIn() { return !!_session?.user; }
  function isPro()      { return _session?.user?.plan === "pro"; }

  /* ── Session persistence ─────────────────────────────────────────────── */
  async function _saveSession(session) {
    _session = session;
    await chrome.storage.local.set({ [SESSION_KEY]: session });
  }

  /* ── API helper ──────────────────────────────────────────────────────── */
  async function _api(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  /* ── Register (email + password) ─────────────────────────────────────── */
  async function register(name, email, password) {
    const { user, token } = await _api("/auth/register", { name, email, password });
    await _saveSession({ user, token });
    return user;
  }

  /* ── Login (email + password) ────────────────────────────────────────── */
  async function login(email, password) {
    const { user, token } = await _api("/auth/login", { email, password });
    await _saveSession({ user, token });
    return user;
  }

  /* ── Google Sign-In ──────────────────────────────────────────────────── */
  async function loginWithGoogle() {
    // Get Google OAuth token using chrome.identity
    const googleToken = await _getGoogleIdToken();
    const { user, token } = await _api("/auth/google", { credential: googleToken });
    await _saveSession({ user, token });
    return user;
  }

  async function _getGoogleIdToken() {
    return new Promise((resolve, reject) => {
      // Get the extension's own redirect URL
      const redirectUri = chrome.identity.getRedirectURL();
      const manifest = chrome.runtime.getManifest();
      const clientId = manifest.oauth2?.client_id;

      if (!clientId) {
        return reject(new Error("Google Client ID not configured in manifest.json"));
      }

      // Build the Google OAuth URL
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("response_type", "id_token");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", "openid email profile");
      authUrl.searchParams.set("nonce", crypto.randomUUID());
      authUrl.searchParams.set("prompt", "select_account");

      chrome.identity.launchWebAuthFlow(
        { url: authUrl.toString(), interactive: true },
        (responseUrl) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!responseUrl) {
            return reject(new Error("Google sign-in was cancelled"));
          }

          // Extract id_token from the redirect URL fragment
          const hash = new URL(responseUrl).hash.substring(1);
          const params = new URLSearchParams(hash);
          const idToken = params.get("id_token");

          if (!idToken) {
            return reject(new Error("No ID token received from Google"));
          }
          resolve(idToken);
        }
      );
    });
  }

  /* ── Logout ──────────────────────────────────────────────────────────── */
  async function logout() {
    _session = null;
    await chrome.storage.local.remove(SESSION_KEY);
  }

  /* ── Update plan ─────────────────────────────────────────────────────── */
  async function updatePlan(plan) {
    if (!_session?.token) return;
    const res = await fetch(`${API_BASE}/auth/plan`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${_session.token}`,
      },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to update plan");
    _session.user = data.user;
    await _saveSession(_session);
    return data.user;
  }

  return {
    init,
    getUser,
    getToken,
    isLoggedIn,
    isPro,
    register,
    login,
    loginWithGoogle,
    logout,
    updatePlan,
  };
})();
