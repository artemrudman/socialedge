// ── JWT auth middleware ──────────────────────────────────────────────────────
const jwt = require("jsonwebtoken");
const { stmts } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "90d" });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Express middleware: attaches req.user (full DB row) if valid token
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const payload = verifyToken(header.slice(7));
    const user = stmts.findById.get(payload.sub);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Sanitise user row before sending to client
function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    avatarUrl: row.avatar_url,
    googleLinked: !!row.google_id,
    createdAt: row.created_at,
  };
}

module.exports = { signToken, verifyToken, requireAuth, toPublicUser };
