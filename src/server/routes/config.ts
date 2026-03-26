import { Router, type Request, type Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";

export const configRouter = Router();

const CHANNELS_PATH = path.resolve("config", "channels.yaml");
const ANALYSIS_PATH = path.resolve("config", "analysis.yaml");
const ENV_PATH = path.resolve(".env");

// --- channels.yaml ---
configRouter.get("/channels", (_req: Request, res: Response) => {
  try {
    const content = fs.readFileSync(CHANNELS_PATH, "utf-8");
    res.json({ content });
  } catch {
    res.status(500).json({ error: "Failed to read channels.yaml" });
  }
});

configRouter.put("/channels", (req: Request, res: Response) => {
  try {
    fs.writeFileSync(CHANNELS_PATH, req.body.content, "utf-8");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to write channels.yaml" });
  }
});

// --- analysis.yaml ---
configRouter.get("/analysis", (_req: Request, res: Response) => {
  try {
    const content = fs.readFileSync(ANALYSIS_PATH, "utf-8");
    res.json({ content });
  } catch {
    res.status(500).json({ error: "Failed to read analysis.yaml" });
  }
});

configRouter.put("/analysis", (req: Request, res: Response) => {
  try {
    fs.writeFileSync(ANALYSIS_PATH, req.body.content, "utf-8");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to write analysis.yaml" });
  }
});

// --- .env ---
configRouter.get("/env", (_req: Request, res: Response) => {
  try {
    const content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
    res.json({ content });
  } catch {
    res.status(500).json({ error: "Failed to read .env" });
  }
});

configRouter.put("/env", (req: Request, res: Response) => {
  try {
    fs.writeFileSync(ENV_PATH, req.body.content, "utf-8");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to write .env" });
  }
});
