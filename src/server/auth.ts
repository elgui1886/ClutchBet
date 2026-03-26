import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = "agentic-workflow-secret-key";
const DASHBOARD_USER = "maremmabet";
const DASHBOARD_PASSWORD = "12345678";

export const authRouter = Router();

authRouter.post("/login", (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (username === DASHBOARD_USER && password === DASHBOARD_PASSWORD) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Support token via Authorization header or query param (for EventSource/SSE)
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : (req.query.token as string | undefined);

  if (!token) {
    res.status(401).json({ error: "Missing or invalid token" });
    return;
  }

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token expired or invalid" });
  }
}
