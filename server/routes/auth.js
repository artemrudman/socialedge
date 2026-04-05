// ── Auth routes ─────────────────────────────────────────────────────────────
const { Router } = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { stmts } = require("../db");
const { signToken, requireAuth, toPublicUser } = require("../middleware/auth");

const router = Router();
const SALT_ROUNDS = 12;

// ─── Helpers ────────────────────────────────────────────────────────────────
function uid() {
  return "u_" + Date.now() + "_" + crypto.randomBytes(6).toString("hex");
}
function now() {
  return Date.now();
}

// ─── POST /auth/register  (email + password) ───────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    if (!email?.trim()) return res.status(400).json({ error: "Email is required" });
    if (!password || password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const existing = stmts.findByEmail.get(email.trim().toLowerCase());
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const id = uid();
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const ts = now();

    stmts.create.run({
      id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hash,
      google_id: null,
      avatar_url: null,
      plan: "free",
      created_at: ts,
      updated_at: ts,
    });

    const user = stmts.findById.get(id);
    const token = signToken(id);

    res.status(201).json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── POST /auth/login  (email + password) ──────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim()) return res.status(400).json({ error: "Email is required" });
    if (!password) return res.status(400).json({ error: "Password is required" });

    const user = stmts.findByEmail.get(email.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: "No account found with this email" });

    if (!user.password) {
      // User registered via Google only — no password set
      return res.status(401).json({
        error: "This account uses Google Sign-In. Please sign in with Google.",
      });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Incorrect password" });

    const token = signToken(user.id);
    res.json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── POST /auth/google  (Google ID token from extension) ───────────────────
router.post("/google", async (req, res) => {
  try {
    const { token: googleToken, credential } = req.body;
    const idToken = credential || googleToken; // support both field names

    if (!idToken) {
      return res.status(400).json({ error: "Google token is required" });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const client = new OAuth2Client(clientId);

    // Verify the Google ID token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    if (!email) {
      return res.status(400).json({ error: "Google account has no email" });
    }

    // 1. Check if user already exists by google_id
    let user = stmts.findByGoogleId.get(googleId);

    if (!user) {
      // 2. Check if email already registered (maybe via email/password)
      user = stmts.findByEmail.get(email.toLowerCase());

      if (user) {
        // Link Google to existing email account
        stmts.linkGoogle.run(googleId, picture || null, now(), user.id);
        user = stmts.findById.get(user.id);
      } else {
        // 3. Create new user
        const id = uid();
        const ts = now();
        stmts.create.run({
          id,
          name: name || email.split("@")[0],
          email: email.toLowerCase(),
          password: null,
          google_id: googleId,
          avatar_url: picture || null,
          plan: "free",
          created_at: ts,
          updated_at: ts,
        });
        user = stmts.findById.get(id);
      }
    }

    const token = signToken(user.id);
    res.json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error("Google auth error:", err);
    if (err.message?.includes("Token used too late") || err.message?.includes("Invalid token")) {
      return res.status(401).json({ error: "Google token expired or invalid. Please try again." });
    }
    res.status(500).json({ error: "Google authentication failed" });
  }
});

// ─── GET /auth/me  (get current user) ──────────────────────────────────────
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

// ─── PATCH /auth/plan  (update plan — for admin/testing) ───────────────────
router.patch("/plan", requireAuth, (req, res) => {
  const { plan } = req.body;
  if (!["free", "pro"].includes(plan)) {
    return res.status(400).json({ error: "Plan must be 'free' or 'pro'" });
  }
  stmts.updatePlan.run(plan, now(), req.user.id);
  const updated = stmts.findById.get(req.user.id);
  res.json({ user: toPublicUser(updated) });
});

module.exports = router;
