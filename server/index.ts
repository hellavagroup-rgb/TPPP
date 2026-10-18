import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabaseIfEmpty } from "./seed";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { syncAllActiveConnections } from "./gmailSync";
import { storage } from "./storage";
import { pollIntakeBounceAlerts } from "./intakeBounceAlerts";
import { sweepReservations } from "./reservationLifecycle";
import { log } from "./log";
export { log } from "./log";

const app = express();

// Trust proxy for production (Replit runs behind HTTPS proxy)
// This is required for secure cookies to work properly
app.set("trust proxy", 1);

// Security headers via helmet (with CSP disabled for development compatibility)
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to allow inline scripts in development
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting - protect against brute force attacks
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  // Stripe webhooks must not be rate-limited — Stripe retries on failure and
  // could be blocked if the general limiter counts its delivery attempts
  skip: (req) => req.originalUrl === "/api/stripe/webhook",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login attempts per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again after 15 minutes" },
  skipSuccessfulRequests: true,
});

// Apply rate limiters
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api", generalLimiter);

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path
    .replace(/^(\/api\/public\/booking\/)[^/]+/, "$1[token]")
    .replace(/^(\/api\/public\/register\/[^/]+\/)[^/]+/, "$1[token]");

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Seed database with initial data if empty
  await seedDatabaseIfEmpty();

  await registerRoutes(httpServer, app);

  // Repair allocations stranded before backward status transitions released
  // their slots. This is idempotent: repaired clients no longer match on later
  // starts, while ambiguous ownership is reported and left untouched.
  const strandedAllocationRepair = await storage.repairStrandedClientAllocations();
  log(
    `[maintenance] stranded allocations identified=${strandedAllocationRepair.identified} repaired=${strandedAllocationRepair.repaired.length} skipped=${strandedAllocationRepair.skipped.length}`,
  );
  const slotIntegrityRepair = await storage.repairSlotIntegrity();
  log(
    `[maintenance] slot integrity identified=${slotIntegrityRepair.identified} repaired=${slotIntegrityRepair.repaired.length} skipped=${slotIntegrityRepair.skipped.length}`,
  );

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  // Background Gmail polling — run immediately on startup, then every 5 minutes
  const GMAIL_POLL_INTERVAL_MS = 5 * 60 * 1000;
  syncAllActiveConnections().catch(err => log(`[gmail] initial sync error: ${err}`));
  setInterval(async () => {
    try {
      await syncAllActiveConnections();
    } catch (err) {
      log(`[gmail] background sync error: ${err}`);
    }
  }, GMAIL_POLL_INTERVAL_MS);

  // Check provider metadata without waiting for someone to open a client panel.
  // Never overlap scans; each attempt also uses an atomic alert claim.
  pollIntakeBounceAlerts().catch(err => log(`[intake bounce] initial poll error: ${err}`));
  setInterval(() => {
    pollIntakeBounceAlerts().catch(err => log(`[intake bounce] poll error: ${err}`));
  }, 5 * 60 * 1000);
  sweepReservations().catch(() => log("[reservations] initial reconciliation failed; existing ownership preserved"));
  setInterval(() => {
    sweepReservations().catch(() => log("[reservations] reconciliation failed; existing ownership preserved"));
  }, 60 * 1000);
})();
