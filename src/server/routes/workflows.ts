import { Router, type Request, type Response } from "express";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export const workflowsRouter = Router();

let activeProcess: ChildProcess | null = null;
let activeWorkflow: string | null = null;

workflowsRouter.get("/status", (_req: Request, res: Response) => {
  res.json({
    running: activeProcess !== null,
    workflow: activeWorkflow,
  });
});

workflowsRouter.post("/:workflow", (req: Request, res: Response) => {
  const workflow = req.params.workflow;
  if (workflow !== "generation" && workflow !== "analysis") {
    res.status(400).json({ error: "Invalid workflow. Use 'generation' or 'analysis'." });
    return;
  }

  if (activeProcess) {
    res.status(409).json({ error: `Workflow "${activeWorkflow}" is already running. Wait for it to finish.` });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const tsxPath = path.resolve("node_modules", ".bin", "tsx");
  const scriptPath = path.resolve("src", "index.ts");

  activeWorkflow = workflow;
  activeProcess = spawn(tsxPath, [scriptPath, workflow], {
    cwd: path.resolve("."),
    env: { ...process.env },
    shell: true,
  });

  const send = (event: string, data: string) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  activeProcess.stdout?.on("data", (chunk: Buffer) => {
    send("log", chunk.toString());
  });

  activeProcess.stderr?.on("data", (chunk: Buffer) => {
    send("error", chunk.toString());
  });

  activeProcess.on("close", (code) => {
    send("done", `Process exited with code ${code}`);
    res.end();
    activeProcess = null;
    activeWorkflow = null;
  });

  activeProcess.on("error", (err) => {
    send("error", `Failed to start: ${err.message}`);
    res.end();
    activeProcess = null;
    activeWorkflow = null;
  });

  // If client disconnects, kill the process
  req.on("close", () => {
    if (activeProcess) {
      activeProcess.kill();
      activeProcess = null;
      activeWorkflow = null;
    }
  });
});
