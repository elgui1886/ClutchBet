import { Router, type Request, type Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";

export const analysisRouter = Router();

const ANALYSIS_DIR = path.resolve("output", "analysis");

analysisRouter.get("/", (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(ANALYSIS_DIR)) {
      res.json({ files: [] });
      return;
    }
    const files = fs.readdirSync(ANALYSIS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((name) => {
        const stat = fs.statSync(path.join(ANALYSIS_DIR, name));
        return { name, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    res.json({ files });
  } catch {
    res.status(500).json({ error: "Failed to list analysis files" });
  }
});

analysisRouter.get("/:filename", (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename as string);
  if (!filename.endsWith(".md")) {
    res.status(400).json({ error: "Only .md files allowed" });
    return;
  }
  const filePath = path.join(ANALYSIS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ name: filename, content });
  } catch {
    res.status(500).json({ error: "Failed to read file" });
  }
});

analysisRouter.delete("/:filename", (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename as string);
  if (!filename.endsWith(".md")) {
    res.status(400).json({ error: "Only .md files allowed" });
    return;
  }
  const filePath = path.join(ANALYSIS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete file" });
  }
});
