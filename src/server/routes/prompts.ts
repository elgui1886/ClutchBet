import { Router, type Request, type Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";

export const promptsRouter = Router();

const PROMPTS_DIR = path.resolve("prompts");

promptsRouter.get("/", (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(PROMPTS_DIR).filter((f) => f.endsWith(".md"));
    res.json({ files });
  } catch {
    res.status(500).json({ error: "Failed to list prompts" });
  }
});

promptsRouter.get("/:name", (req: Request, res: Response) => {
  const name = path.basename(req.params.name as string);
  if (!name.endsWith(".md")) {
    res.status(400).json({ error: "Only .md files allowed" });
    return;
  }
  const filePath = path.join(PROMPTS_DIR, name);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ name, content });
  } catch {
    res.status(500).json({ error: "Failed to read prompt" });
  }
});

promptsRouter.put("/:name", (req: Request, res: Response) => {
  const name = path.basename(req.params.name as string);
  if (!name.endsWith(".md")) {
    res.status(400).json({ error: "Only .md files allowed" });
    return;
  }
  const filePath = path.join(PROMPTS_DIR, name);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  try {
    fs.writeFileSync(filePath, req.body.content, "utf-8");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to write prompt" });
  }
});
