import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import type { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { pool } from "./db";
import type { User } from "@shared/schema";

const scryptAsync = promisify(scrypt);

const PgSession = connectPgSimple(session);
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function createPersistentSessionStore(dbPool: typeof pool = pool): session.Store {
  return new PgSession({
    pool: dbPool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: SESSION_MAX_AGE_MS,
  });
}

export function buildSessionOptions(store: session.Store): session.SessionOptions {
  return {
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret-" + Date.now(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: SESSION_MAX_AGE_MS,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
    store,
  };
}

// Exposed so super-admin tenant reassignment can revoke every live session for
// a user. connect-pg-simple intentionally does not expose Store.all(), so use a
// targeted, parameterized delete against its JSON session payload.
export async function destroySessionsForUser(
  userId: string,
  dbPool: Pick<typeof pool, "query"> = pool,
): Promise<number> {
  const result = await dbPool.query(
    `DELETE FROM "user_sessions"
     WHERE sess -> 'passport' ->> 'user' = $1`,
    [userId],
  );
  return result.rowCount ?? 0;
}

// Password hashing utilities (using scrypt - more secure than bcrypt)
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(
  supplied: string,
  stored: string,
): Promise<boolean> {
  const [hashedPassword, salt] = stored.split(".");
  const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
  const suppliedPasswordBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
}

// Extend Express User type
declare global {
  namespace Express {
    interface User extends Omit<import("@shared/schema").User, "password"> {}
    interface Request {
      tenant?: import("@shared/schema").Tenant;
    }
  }
}

export function setupAuth(app: Express) {
  // Session configuration - require SESSION_SECRET in production
  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET environment variable is required in production");
    }
    console.warn("⚠️  WARNING: Using insecure default session secret. Set SESSION_SECRET environment variable.");
  }
  
  const persistentStore = createPersistentSessionStore();
  console.info("[startup] configured PostgreSQL-backed session store");

  const sessionSettings = buildSessionOptions(persistentStore);

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure Passport Local Strategy
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email.toLowerCase());

          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }

          const isValid = await comparePasswords(password, user.password);

          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }

          // Return user without password
          const { password: _, ...safeUser } = user;
          return done(null, safeUser);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );

  // Serialize user to session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      const { password: _, ...safeUser } = user;
      done(null, safeUser);
    } catch (err) {
      done(err);
    }
  });
}

// Middleware to require authentication
export function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  console.warn("[auth] rejected request: session expired or invalid", {
    method: req.method,
    path: req.originalUrl,
  });
  res.status(401).json({ error: "Unauthorized" });
}

// Middleware to require admin role
export function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role === "admin") {
    return next();
  }
  res.status(403).json({ error: "Forbidden: Admin access required" });
}

// Middleware to require clinician role (or admin)
export function requireClinician(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role === "clinician" || req.user.role === "admin") {
    return next();
  }
  res.status(403).json({ error: "Forbidden: Clinician access required" });
}

// Audit logging middleware
export function auditLog(action: string, resourceType: string) {
  return async (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) {
      try {
        await storage.createAuditLog({
          userId: req.user.id,
          tenantId: req.tenant?.id || null,
          action,
          resourceType,
          resourceId: req.params.id || null,
          ipAddress: req.ip || req.connection.remoteAddress || null,
        });
      } catch (err) {
        console.error("Audit log failed:", err);
      }
    }
    next();
  };
}
