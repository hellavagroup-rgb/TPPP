import type { Request, Response } from "express";

// Separate from route registration so session tests need not import/start every integration.
export function handleLoginResult(
  req: Request,
  res: Response,
  err: unknown,
  user: Express.User | false | null,
  info?: { message?: string },
): void {
  if (err) {
    console.error("Authentication service failed during login:", err);
    res.status(503).json({ error: "Login service is temporarily unavailable. Please try again." });
    return;
  }
  if (!user) {
    res.status(401).json({ error: info?.message || "Invalid credentials" });
    return;
  }
  req.logIn(user, (loginError) => {
    if (loginError) {
      console.error("Failed to persist authenticated session:", loginError);
      res.status(503).json({ error: "Login service is temporarily unavailable. Please try again." });
      return;
    }
    res.json({ user });
  });
}
