import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { authRouter, authMiddleware } from "./auth.js";
import { configRouter } from "./routes/config.js";
import { promptsRouter } from "./routes/prompts.js";
import { workflowsRouter } from "./routes/workflows.js";
import { analysisRouter } from "./routes/analysis.js";

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT ?? "3000", 10);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- Public routes ---
app.use("/api/auth", authRouter);

// --- Protected routes ---
app.use("/api/config", authMiddleware, configRouter);
app.use("/api/prompts", authMiddleware, promptsRouter);
app.use("/api/workflows", authMiddleware, workflowsRouter);
app.use("/api/analysis", authMiddleware, analysisRouter);

// --- Serve Angular SPA (production build) ---
const distPath = path.resolve("dashboard", "dist", "dashboard", "browser");
app.use(express.static(distPath));
app.get("/{*splat}", (_req, res, next) => {
  if (_req.path.startsWith("/api")) return next();
  res.sendFile(path.join(distPath, "index.html"), (err) => {
    if (err) res.status(404).send("Dashboard not built. Run: npm run dashboard:build");
  });
});

app.listen(PORT, () => {
  console.log(`🖥️  Dashboard server running on http://localhost:${PORT}`);
});
