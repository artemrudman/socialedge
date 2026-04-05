// ── SocialEdge API Server ────────────────────────────────────────────────────
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: true })); // allow extension origin
app.use(express.json({ limit: "1mb" }));

// Request logger (dev)
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use("/auth", authRoutes);

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "socialedge-api", version: "1.0.0" });
});

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  SocialEdge API running on http://localhost:${PORT}\n`);
});
