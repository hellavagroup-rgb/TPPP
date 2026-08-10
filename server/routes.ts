import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import ExcelJS from "exceljs";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireAdmin, requireClinician, hashPassword, auditLog, destroySessionsForUser } from "./auth";
import passport from "passport";
import { 
  insertClientSchema, insertClinicianSchema, insertTimeSlotSchema, 
  insertFormTemplateSchema, insertTaskSchema, insertUserSchema,
  type InsertFormTemplate
} from "@shared/schema";
import { z } from "zod";
import { sendEmail, buildFromAddress, generateFormInviteEmail, generatePasswordResetEmail, generateTaskReminderEmail, generateAvailabilityReminderEmail, generateFormCompletionEmail, generateNewReferralEmail, generateWaitlistUpdateEmail, generatePaymentLinkEmail, generatePaymentFailureEmail, generateClinicianWelcomeEmail, generateAdminInviteEmail, generateAllocationOptionsEmail, generateBookingConfirmedEmail, getFormCompletionPageContent, GENERIC_PRACTICE_NAME } from "./email";
import { forceReseedDatabase } from "./seed";
import { seedDemoData } from "./seedDemo";
import { parseIntakeEmailBody } from "./intakeParser";
import { syncAllActiveConnections } from "./gmailSync";
import { requireTenant } from './middleware/tenant';
import { requireSuperAdmin } from './middleware/superAdmin';
import { db } from "./db";
import { tenants, users, clients, clinicians, tasks, formTemplates, formSubmissions, timeSlots, emailTemplates, nonEngagementCategories, customInsurers, auditLogs, intakeMessages, gmailConnections, paymentCharges, clientClinicianOptions } from "@shared/schema";
import { isStripeConfigured, getStripeInstance, createCheckoutSession, chargeOffSession, constructWebhookEvent } from "./stripe";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "./encryption";
import { getAuthUrl, exchangeCodeForTokens, syncConnection, buildRedirectUri } from "./gmailSync";
import { isNull, isNotNull, eq, and, inArray, desc, like } from "drizzle-orm";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Health check endpoint for deployment
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Setup authentication
  setupAuth(app);
  app.use('/api', requireTenant as any);

  // Admin endpoint to force reseed database (must be after auth setup)
  app.post("/api/admin/reseed", requireAdmin, async (req, res) => {
    try {
      console.log("=== ADMIN TRIGGERED FORCE RESEED ===");
      await forceReseedDatabase();
      res.json({ success: true, message: "Database reseeded successfully" });
    } catch (error) {
      console.error("Force reseed failed:", error);
      res.status(500).json({ error: "Failed to reseed database" });
    }
  });

  // Admin endpoint to seed rich demo data (clients, tasks, slots, submissions)
  app.post("/api/admin/seed-demo", requireAdmin, async (req, res) => {
    try {
      console.log("=== ADMIN TRIGGERED DEMO SEED ===");
      await seedDemoData();
      res.json({ success: true, message: "Demo data seeded successfully" });
    } catch (error) {
      console.error("Demo seed failed:", error);
      res.status(500).json({ error: "Failed to seed demo data" });
    }
  });

  // NOTE: the former "/api/admin/seed-tenant" one-time migration endpoint has been
  // removed. It auto-assigned ANY row with a null tenantId (across every tenant) to
  // "whichever tenant was created first", and was reachable by any regular tenant
  // admin (not just a super-admin). This is what caused a clinician's user account to
  // be silently reassigned from her real tenant to the first-created tenant, which in
  // turn leaked that tenant's branding into her password-reset email. Null-tenantId
  // rows are now only ever reported (never auto-assigned) via fixNullTenantIds() in
  // server/seed.ts, and cross-tenant fixes must go through the deliberate, audited
  // "/api/super-admin/users/reassign-tenant" endpoint below.

  // ============ AUTH ROUTES ============
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ error: "Internal server error" });
      }
      if (!user) {
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      req.logIn(user, (err) => {
        if (err) {
          return res.status(500).json({ error: "Login failed" });
        }
        return res.json({ user });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // ============ USER MANAGEMENT ============
  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const validated = insertUserSchema.parse(req.body);
      
      // Check if user already exists
      const existing = await storage.getUserByEmail(validated.email.toLowerCase());
      if (existing) {
        return res.status(400).json({ error: "User already exists" });
      }

      // Hash password
      const hashedPassword = await hashPassword(validated.password);
      
      // Always force the new user into the creating admin's own tenant —
      // never trust a tenantId supplied in the request body. Without this,
      // any tenant admin could create a login account (with a password they
      // control) inside a different tenant, or omit tenantId entirely and
      // reproduce the historical blank-tenant account bug.
      const user = await storage.createUser({
        ...validated,
        email: validated.email.toLowerCase(),
        password: hashedPassword,
        tenantId: req.tenant?.id,
      } as any);

      // Don't return password
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Update current user profile
  app.patch("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      const userId = (req.user as any).id;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name is required" });
      }

      const updatedUser = await storage.updateUser(userId, { name: name.trim() });
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password: _, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      console.error("Failed to update profile:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // Update notification preferences
  app.patch("/api/auth/notifications", requireAuth, async (req, res) => {
    try {
      const { notificationPrefs } = req.body;
      const userId = (req.user as any).id;

      const updatedUser = await storage.updateUser(userId, { notificationPrefs });
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password: _, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      console.error("Failed to update notification preferences:", error);
      res.status(500).json({ error: "Failed to update notification preferences" });
    }
  });

  // ============ CLINICIAN ROUTES ============
  app.get("/api/clinicians", requireAuth, async (req, res) => {
    try {
      const clinicians = await storage.getAllClinicians(req.tenant?.id);
      const allClients = await storage.getAllClients(false, req.tenant?.id);
      
      // Build a count map: clinicianId -> { "day startTime" -> number of legacy clients }
      // Using counts (not a Set) so two slots with the same day+time only get marked
      // booked proportionally to the number of legacy clients at that exact time.
      const legacyBookedSlots = new Map<string, Map<string, number>>();
      allClients.forEach(client => {
        if (client.assignedSlot && client.assignedClinicianId && !client.assignedSlotId &&
            !["Archived"].includes(client.status)) {
          const key = client.assignedClinicianId;
          if (!legacyBookedSlots.has(key)) legacyBookedSlots.set(key, new Map());
          const slotKey = client.assignedSlot.toLowerCase();
          const clinicianMap = legacyBookedSlots.get(key)!;
          clinicianMap.set(slotKey, (clinicianMap.get(slotKey) || 0) + 1);
        }
      });

      const cliniciansWithAvailability = await Promise.all(
        clinicians.map(async (clinician) => {
          const availability = await storage.getTimeSlotsByClinicianId(clinician.id);
          const legacySlots = legacyBookedSlots.get(clinician.id);
          // Clone the map so we can decrement counts as we consume them
          const remainingCounts = legacySlots ? new Map(legacySlots) : null;
          const enrichedAvailability = availability.map(slot => {
            if (!slot.isBooked && remainingCounts && slot.day && slot.startTime) {
              const slotKey = `${slot.day} ${slot.startTime}`.toLowerCase();
              const count = remainingCounts.get(slotKey) || 0;
              if (count > 0) {
                remainingCounts.set(slotKey, count - 1);
                return { ...slot, isBooked: true, legacyBooked: true };
              }
            }
            return slot;
          });
          return { ...clinician, availability: enrichedAvailability };
        })
      );
      
      res.json(cliniciansWithAvailability);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clinicians" });
    }
  });

  app.get("/api/clinicians/me", requireClinician, async (req, res) => {
    try {
      const clinician = await storage.getClinicianByUserId(req.user!.id);
      if (!clinician) {
        return res.status(404).json({ error: "Clinician profile not found" });
      }
      
      const availability = await storage.getTimeSlotsByClinicianId(clinician.id);
      res.json({ ...clinician, availability });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clinician profile" });
    }
  });

  app.get("/api/clinicians/me/slot-clients", requireClinician, async (req, res) => {
    try {
      const clinician = await storage.getClinicianByUserId(req.user!.id);
      if (!clinician) return res.status(404).json({ error: "Clinician profile not found" });
      const allClients = await storage.getAllClients(false, req.tenant?.id);
      const map: Record<string, { displayId: string; status: string }> = {};
      for (const client of allClients) {
        if (client.assignedClinicianId === clinician.id && client.assignedSlotId && client.displayId) {
          map[client.assignedSlotId] = { displayId: client.displayId, status: client.status };
        }
      }
      res.json(map);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch slot client info" });
    }
  });

  app.patch("/api/clinicians/me", requireClinician, async (req, res) => {
    try {
      const clinician = await storage.getClinicianByUserId(req.user!.id);
      if (!clinician) {
        return res.status(404).json({ error: "Clinician profile not found" });
      }

      // Handle email update separately (stored on user record)
      const { email, ...clinicianUpdates } = req.body;
      if (email && email.toLowerCase() !== req.user!.email.toLowerCase()) {
        await storage.updateUser(req.user!.id, { email: email.toLowerCase() });
      }

      const updated = await storage.updateClinician(clinician.id, clinicianUpdates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update clinician" });
    }
  });

  app.post("/api/clinicians", requireAdmin, async (req, res) => {
    try {
      const validated = insertClinicianSchema.parse(req.body);
      const clinician = await storage.createClinician(validated, req.tenant?.id);
      res.json(clinician);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create clinician" });
    }
  });

  // Create clinician with associated user account (no email sent)
  app.post("/api/clinicians/with-user", requireAdmin, async (req, res) => {
    try {
      const { name, email, tier, bio, location, nhsTrust, capacity, maxNewClients, worksWithCouples, insurers, contactMethods, specialties } = req.body;
      
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      // Check if email already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already in use" });
      }

      // Create user account with placeholder password (login disabled until Generate Login is clicked)
      // Using a random unguessable hash that can't be used for login
      const placeholderPassword = `DISABLED_${crypto.randomBytes(32).toString('hex')}`;
      const user = await storage.createUser({
        email: email.toLowerCase(),
        name,
        password: placeholderPassword,
        role: "clinician",
        tenantId: req.tenant?.id,
      } as any);

      // Create clinician profile
      const clinician = await storage.createClinician({
        userId: user.id,
        avatar: name.substring(0, 2).toUpperCase(),
        tier: tier || "Mid",
        bio: bio || "",
        location: location || "",
        nhsTrust: nhsTrust || "",
        capacity: capacity || 15,
        maxNewClients: maxNewClients ?? 3,
        worksWithCouples: worksWithCouples ?? false,
        insurers: insurers || [],
        contactMethods: contactMethods || [],
        specialties: specialties || [],
      }, req.tenant?.id);

      res.json({ clinician });
    } catch (error) {
      console.error("Failed to create clinician with user:", error);
      res.status(500).json({ error: "Failed to create clinician" });
    }
  });

  // Generate login credentials and send email to clinician
  app.post("/api/clinicians/:id/generate-login", requireAdmin, async (req, res) => {
    try {
      const clinician = await storage.getClinicianById(req.params.id);
      if (!clinician) {
        return res.status(404).json({ error: "Clinician not found" });
      }
      if (clinician.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!clinician.userId) {
        return res.status(400).json({ error: "Clinician has no associated user account" });
      }

      // Get user to find email
      const user = await storage.getUser(clinician.userId);
      if (!user) {
        return res.status(404).json({ error: "User account not found" });
      }

      // Generate new temporary password
      const tempPassword = `Welcome${crypto.randomBytes(8).toString('base64url')}!`;
      const hashedPassword = await hashPassword(tempPassword);

      // Update user with new password
      await storage.updateUser(clinician.userId, { password: hashedPassword });

      // Send welcome email with credentials
      const practiceName = req.tenant?.name || GENERIC_PRACTICE_NAME;
      const tenantCtx = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
      const welcomeEmail = await generateClinicianWelcomeEmail(user.name, user.email, tempPassword, tenantCtx);
      const emailResult = await sendEmail({ ...welcomeEmail, to: user.email });

      if (!emailResult.success) {
        console.error("Failed to send login email:", emailResult.error);
        return res.status(500).json({ error: "Failed to send email" });
      }

      res.json({ success: true, message: "Login credentials sent to clinician's email" });
    } catch (error) {
      console.error("Failed to generate login:", error);
      res.status(500).json({ error: "Failed to generate login" });
    }
  });

  app.patch("/api/clinicians/:id", requireAdmin, async (req, res) => {
    try {
      const clinician = await storage.getClinicianById(req.params.id);
      if (!clinician) {
        return res.status(404).json({ error: "Clinician not found" });
      }
      if (clinician.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Handle name and email updates separately (stored on user record, not clinician)
      const { email, name, ...clinicianUpdates } = req.body;
      if (clinician.userId) {
        const userUpdates: { email?: string; name?: string } = {};
        if (email) userUpdates.email = email.toLowerCase();
        if (name) userUpdates.name = name;
        if (Object.keys(userUpdates).length > 0) {
          await storage.updateUser(clinician.userId, userUpdates);
        }
      }

      const updated = await storage.updateClinician(req.params.id, clinicianUpdates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update clinician" });
    }
  });

  app.delete("/api/clinicians/:id", requireAdmin, async (req, res) => {
    try {
      const clinician = await storage.getClinicianById(req.params.id);
      if (!clinician) {
        return res.status(404).json({ error: "Clinician not found" });
      }
      if (clinician.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteClinician(req.params.id);
      res.json({ success: true, message: "Clinician permanently deleted" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete clinician" });
    }
  });

  // ============ ADMIN USERS ============
  // Get all admin users (scoped to current tenant)
  app.get("/api/admin-users", requireAdmin, async (req, res) => {
    try {
      const tenantId = req.tenant?.id;
      if (!tenantId) return res.status(400).json({ error: "Tenant not found" });
      const admins = await storage.getAdminUsersByTenantId(tenantId);
      // Strip password hashes for security
      const safeAdmins = admins.map(({ password, ...admin }) => admin);
      res.json(safeAdmins);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch admin users" });
    }
  });

  // Invite new admin user (sends email with setup link)
  app.post("/api/admin-users/invite", requireAdmin, async (req, res) => {
    try {
      const { name, email } = req.body;
      
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      // Check if email already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already in use" });
      }

      // Create admin user with placeholder password (can't login until they set password)
      const placeholderPassword = `PENDING_INVITE_${crypto.randomBytes(32).toString('hex')}`;
      const user = await storage.createUser({
        email: email.toLowerCase(),
        name,
        password: placeholderPassword,
        role: "admin",
        tenantId: req.tenant?.id ?? null,
      });

      // Generate invite token (valid for 7 days)
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await storage.createInviteToken(user.id, token, expiresAt);

      // Build invite URL
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const baseUrl = `${protocol}://${host}`;
      const inviteUrl = `${baseUrl}/accept-invite?token=${token}`;

      // Send invite email
      const invitePracticeName = req.tenant?.name || GENERIC_PRACTICE_NAME;
      const inviteTenantCtx = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
      const inviteEmail = await generateAdminInviteEmail(name, inviteUrl, inviteTenantCtx);
      const emailResult = await sendEmail({ ...inviteEmail, to: email });

      if (!emailResult.success) {
        // Delete the user if email failed
        await storage.deleteUser(user.id);
        return res.status(500).json({ error: "Failed to send invite email" });
      }

      res.json({ success: true, message: "Invite sent successfully" });
    } catch (error) {
      console.error("Failed to invite admin user:", error);
      res.status(500).json({ error: "Failed to invite admin user" });
    }
  });

  // Accept admin invite and set password (public endpoint)
  app.post("/api/admin-users/accept-invite", async (req, res) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ error: "Token and password are required" });
      }

      // Validate password meets security requirements
      const passwordErrors: string[] = [];
      if (password.length < 8) {
        passwordErrors.push("at least 8 characters");
      }
      if (!/[A-Z]/.test(password)) {
        passwordErrors.push("one uppercase letter");
      }
      if (!/[a-z]/.test(password)) {
        passwordErrors.push("one lowercase letter");
      }
      if (!/[0-9]/.test(password)) {
        passwordErrors.push("one number");
      }
      if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        passwordErrors.push("one special character");
      }
      if (passwordErrors.length > 0) {
        return res.status(400).json({ 
          error: `Password must contain: ${passwordErrors.join(", ")}` 
        });
      }

      // Find and validate token
      const inviteToken = await storage.getInviteTokenByToken(token);
      if (!inviteToken) {
        return res.status(400).json({ error: "Invalid or expired invite link" });
      }
      if (inviteToken.usedAt) {
        return res.status(400).json({ error: "This invite has already been used" });
      }
      if (new Date() > inviteToken.expiresAt) {
        return res.status(400).json({ error: "This invite link has expired" });
      }

      // Hash password and update user
      const hashedPassword = await hashPassword(password);
      await storage.updateUser(inviteToken.userId, { password: hashedPassword });

      // Mark token as used
      await storage.markInviteTokenUsed(inviteToken.id);

      res.json({ success: true, message: "Account activated successfully. You can now log in." });
    } catch (error) {
      console.error("Failed to accept invite:", error);
      res.status(500).json({ error: "Failed to accept invite" });
    }
  });

  // Get invite token info (public endpoint for the accept-invite page)
  app.get("/api/admin-users/invite/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      const inviteToken = await storage.getInviteTokenByToken(token);
      if (!inviteToken) {
        return res.status(400).json({ error: "Invalid invite link", valid: false });
      }
      if (inviteToken.usedAt) {
        return res.status(400).json({ error: "This invite has already been used", valid: false });
      }
      if (new Date() > inviteToken.expiresAt) {
        return res.status(400).json({ error: "This invite link has expired", valid: false });
      }

      // Get user info for display
      const user = await storage.getUserById(inviteToken.userId);
      if (!user) {
        return res.status(400).json({ error: "User not found", valid: false });
      }

      let tenantName: string | null = null;
      let tenantLogoUrl: string | null = null;
      if (user.tenantId) {
        const [tenant] = await db.select({ name: tenants.name, logoUrl: tenants.logoUrl })
          .from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
        if (tenant) {
          tenantName = tenant.name;
          tenantLogoUrl = tenant.logoUrl;
        }
      }

      res.json({ valid: true, name: user.name, email: user.email, tenantName, tenantLogoUrl });
    } catch (error) {
      console.error("Failed to validate invite:", error);
      res.status(500).json({ error: "Failed to validate invite", valid: false });
    }
  });

  // Delete admin user
  app.delete("/api/admin-users/:id", requireAdmin, async (req, res) => {
    try {
      // Prevent deleting yourself
      if (req.params.id === req.user!.id) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      const user = await storage.getUserById(req.params.id);
      if (!user || user.role !== "admin") {
        return res.status(404).json({ error: "Admin user not found" });
      }

      // Ensure the target user belongs to the same tenant
      if (user.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete admin user" });
    }
  });

  // Link admin to clinician profile
  app.patch("/api/admin-users/:id/link-clinician", requireAdmin, async (req, res) => {
    try {
      const { clinicianId } = req.body;
      
      const user = await storage.getUserById(req.params.id);
      if (!user || user.role !== "admin") {
        return res.status(404).json({ error: "Admin user not found" });
      }

      // Ensure the target user belongs to the same tenant
      if (user.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Validate clinician exists if provided
      if (clinicianId) {
        const clinician = await storage.getClinicianById(clinicianId);
        if (!clinician) {
          return res.status(404).json({ error: "Clinician not found" });
        }
      }

      await storage.updateUser(req.params.id, { linkedClinicianId: clinicianId || null });
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to link admin to clinician:", error);
      res.status(500).json({ error: "Failed to link admin to clinician" });
    }
  });

  // Promote clinician to admin (keeps clinician profile linked)
  app.post("/api/clinicians/:id/promote-to-admin", requireAdmin, async (req, res) => {
    try {
      const clinician = await storage.getClinicianById(req.params.id);
      if (!clinician) {
        return res.status(404).json({ error: "Clinician not found" });
      }

      if (!clinician.userId) {
        return res.status(400).json({ error: "Clinician has no user account" });
      }

      const user = await storage.getUserById(clinician.userId);
      if (!user) {
        return res.status(404).json({ error: "User account not found" });
      }

      if (user.role === "admin") {
        return res.status(400).json({ error: "User is already an admin" });
      }

      // Update role to admin and link to their clinician profile
      await storage.updateUser(clinician.userId, { 
        role: "admin",
        linkedClinicianId: clinician.id
      });

      res.json({ success: true, message: "Clinician promoted to admin" });
    } catch (error) {
      console.error("Failed to promote clinician to admin:", error);
      res.status(500).json({ error: "Failed to promote clinician to admin" });
    }
  });

  // ============ AVAILABILITY / TIME SLOTS ============
  app.get("/api/timeslots/:clinicianId", requireAuth, async (req, res) => {
    try {
      const targetClinician = await storage.getClinicianById(req.params.clinicianId);
      if (!targetClinician) {
        return res.status(404).json({ error: "Clinician not found" });
      }
      if (targetClinician.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      const slots = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
      res.json(slots);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch time slots" });
    }
  });

  // Add new time slots (additive - does not delete existing slots)
  app.post("/api/timeslots/:clinicianId", requireAuth, async (req, res) => {
    try {
      const targetClinician = await storage.getClinicianById(req.params.clinicianId);
      if (!targetClinician) {
        return res.status(404).json({ error: "Clinician not found" });
      }
      if (targetClinician.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Check authorization: Admin can edit any (within their tenant), Clinician can only edit their own
      if (req.user!.role === "clinician") {
        const clinician = await storage.getClinicianByUserId(req.user!.id);
        if (!clinician || clinician.id !== req.params.clinicianId) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const newSlots = req.body; // Array of new slots to add

      // Prevent duplicate recurring slots (same day + startTime)
      // Uses the same legacy-enrichment logic as the calendar so the check
      // matches exactly what is visible as "open" on the availability calendar.
      const newRecurring = Array.isArray(newSlots)
        ? newSlots.filter((s: any) => s.type === "Recurring")
        : [];
      if (newRecurring.length > 0) {
        const existing = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
        const allClients = await storage.getAllClients(false, req.tenant?.id);

        // Build legacy count map: "day starttime" -> number of legacy clients
        const legacyCounts = new Map<string, number>();
        allClients.forEach(c => {
          if (c.assignedClinicianId === req.params.clinicianId &&
              c.assignedSlot && !c.assignedSlotId &&
              c.status !== "Archived") {
            const key = c.assignedSlot.toLowerCase();
            legacyCounts.set(key, (legacyCounts.get(key) || 0) + 1);
          }
        });

        // Block adding a slot if any active (non-expired) recurring slot already exists
        // at the same day+time — regardless of whether it is currently booked or open.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activeSlots = existing.filter(s => {
          if (s.type !== "Recurring") return false;
          if (s.endDate) {
            const end = new Date(s.endDate);
            end.setHours(0, 0, 0, 0);
            if (end < today) return false;
          }
          return true;
        });

        const duplicates = newRecurring.filter((ns: any) =>
          activeSlots.some(es => es.day === ns.day && es.startTime === ns.startTime)
        );
        if (duplicates.length > 0) {
          const dupDesc = duplicates.map((d: any) => `${d.day} at ${d.startTime}`).join(", ");
          return res.status(409).json({
            error: `Duplicate slot: ${dupDesc}. This clinician already has a slot at this time. It will become available to re-add once the current client is confirmed.`
          });
        }
      }

      const inserted = await storage.addTimeSlots(req.params.clinicianId, newSlots, req.tenant?.id);
      
      const clinician = await storage.getClinicianById(req.params.clinicianId);
      let clinicianName = "Unknown";
      if (clinician?.userId) {
        const clinicianUser = await storage.getUserById(clinician.userId);
        clinicianName = clinicianUser?.name || "Unknown";
      }
      const slotCount = Array.isArray(newSlots) ? newSlots.length : 1;
      const slotDetails = Array.isArray(newSlots) && newSlots[0] 
        ? `${newSlots[0].day} ${newSlots[0].startTime}-${newSlots[0].endTime}${slotCount > 1 ? ` (+${slotCount - 1} more)` : ''}`
        : '';
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "add_slots",
        resourceType: "timeslot",
        resourceId: req.params.clinicianId,
        ipAddress: `${clinicianName}|${slotCount} slot${slotCount > 1 ? 's' : ''}|${slotDetails}`,
      });

      const allSlots = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
      res.json(allSlots);
    } catch (error) {
      console.error("Error adding time slots:", error);
      res.status(500).json({ error: "Failed to add time slots" });
    }
  });

  // Delete a specific time slot (permanently removes it, even if booked)
  app.delete("/api/timeslots/:clinicianId/:slotId", requireAuth, async (req, res) => {
    try {
      if (req.user!.role === "clinician") {
        const clinician = await storage.getClinicianByUserId(req.user!.id);
        if (!clinician || clinician.id !== req.params.clinicianId) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const slot = await storage.getTimeSlotById(req.params.slotId);
      if (!slot) {
        return res.status(404).json({ error: "Time slot not found" });
      }
      if (slot.clinicianId !== req.params.clinicianId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      // Derive tenant ownership from the clinician rather than the slot's own
      // tenantId column: legacy slots inserted before per-slot tenant tagging
      // was added can have a null tenantId, and clinicianId is always reliably
      // tenant-scoped.
      const owningClinician = await storage.getClinicianById(req.params.clinicianId);
      if (!owningClinician || owningClinician.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteTimeSlotById(req.params.slotId);
      const allSlots = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
      res.json(allSlots);
    } catch (error: any) {
      console.error("Error deleting time slot:", error);
      res.status(500).json({ error: "Failed to delete time slot" });
    }
  });

  // Toggle location type on a single slot (admin only, tenant-scoped)
  app.patch("/api/timeslots/:slotId/location-type", requireAdmin, async (req, res) => {
    try {
      const { locationType } = req.body as { locationType: string };
      if (locationType !== "online" && locationType !== "in_person") {
        return res.status(400).json({ error: "Invalid locationType" });
      }
      const updated = await storage.updateTimeSlotLocationType(
        req.params.slotId,
        req.tenant!.id,
        locationType,
      );
      if (!updated) return res.status(404).json({ error: "Slot not found or access denied" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update slot location type" });
    }
  });

  // Update tenant-level availability settings (admin only)
  app.patch("/api/tenant/availability-settings", requireAdmin, async (req, res) => {
    try {
      const { defaultLocationType } = req.body as { defaultLocationType: string };
      if (defaultLocationType !== "online" && defaultLocationType !== "in_person") {
        return res.status(400).json({ error: "Invalid defaultLocationType" });
      }
      await db.update(tenants)
        .set({ defaultLocationType })
        .where(eq(tenants.id, req.tenant!.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update availability settings" });
    }
  });

  // ============ CLIENT ROUTES (GDPR Protected) ============
  app.get("/api/clients", requireAdmin, auditLog("view", "client"), async (req, res) => {
    try {
      const includeArchived = req.query.includeArchived === "true";
      const [clientList, failedPayments] = await Promise.all([
        storage.getAllClients(includeArchived, req.tenant?.id),
        storage.getClientsWithFailedPayments(req.tenant?.id),
      ]);
      const failedMap = new Map(failedPayments.map(fp => [fp.clientId, fp.failureReason]));
      const clients = clientList.map(c => ({
        ...c,
        hasFailedPayment: failedMap.has(c.id),
        latestFailureReason: failedMap.get(c.id) ?? null,
      }));
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.post("/api/clients/:id/restore", requireAdmin, auditLog("update", "client"), async (req, res) => {
    try {
      const clientToRestore = await storage.getClientById(req.params.id);
      if (!clientToRestore) return res.status(404).json({ error: "Client not found" });
      if (clientToRestore.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });
      const restored = await storage.restoreClient(req.params.id);
      if (!restored) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(restored);
    } catch (error) {
      res.status(500).json({ error: "Failed to restore client" });
    }
  });

  app.post("/api/clients/:id/delete-permanently", requireAdmin, auditLog("delete", "client"), async (req, res) => {
    try {
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: "Password is required" });
      }

      const user = await storage.getUser(req.user!.id);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const { comparePasswords } = await import("./auth");
      const isValid = await comparePasswords(password, user.password);
      if (!isValid) {
        return res.status(403).json({ error: "Incorrect password" });
      }

      const client = await storage.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (client.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (!client.isArchived) {
        return res.status(400).json({ error: "Only archived clients can be permanently deleted" });
      }

      const deleted = await storage.deleteClientPermanently(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("[delete-permanently] error:", error?.code, error?.message, error);
      res.status(500).json({ error: error?.message || "Failed to permanently delete client" });
    }
  });

  app.get("/api/clients/:id", requireAdmin, auditLog("view", "client"), async (req, res) => {
    try {
      const client = await storage.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (client.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(client);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

  app.post("/api/clients", requireAdmin, auditLog("create", "client"), async (req, res) => {
    try {
      const validated = insertClientSchema.parse(req.body);
      // CY&A: auto-set needsAdminCall when contact preference is phone
      const clientDataToCreate = validated.contactPreference === "phone"
        ? { ...validated, needsAdminCall: true }
        : validated;
      const client = await storage.createClient(clientDataToCreate, req.tenant?.id);

      // Send new referral notification to admins with newReferrals enabled
      try {
        const adminUsers = req.tenant?.id ? await storage.getAdminUsersByTenantId(req.tenant.id) : [];
        const clientName = `${validated.firstName || ''} ${validated.lastName || ''}`.trim() || 'Unknown';
        for (const admin of adminUsers) {
          const prefs = admin.notificationPrefs as { newReferrals?: boolean } | null;
          if (prefs?.newReferrals !== false) {
            const tc = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
            const emailOptions = await generateNewReferralEmail(client.displayId, clientName, tc);
            await sendEmail({ ...emailOptions, to: admin.email });
          }
        }
      } catch (emailError) {
        console.error("Failed to send new referral notifications:", emailError);
      }

      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Failed to create client:", error);
      // Surface unique constraint violations with a helpful message
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505")) {
        if (msg.includes("email")) {
          return res.status(409).json({ error: "A client with this email address already exists." });
        }
        if (msg.includes("display_id")) {
          return res.status(409).json({ error: "A client with this W-Number already exists." });
        }
        return res.status(409).json({ error: "A client with these details already exists." });
      }
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  app.patch("/api/clients/:id", requireAdmin, auditLog("edit", "client"), async (req, res) => {
    try {
      // Get current client to check for status change
      const currentClient = await storage.getClientById(req.params.id);
      if (!currentClient) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (currentClient.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      const oldStatus = currentClient?.status;

      // Validate displayId change if provided
      if (req.body.displayId && req.body.displayId !== currentClient.displayId) {
        const newId = String(req.body.displayId).trim().toUpperCase();
        if (!newId) {
          return res.status(400).json({ error: "Client ID cannot be empty" });
        }
        // Replacing a PENDING ID: accept any non-empty string (name or W number)
        // For regular IDs: enforce W+digits format
        const isPendingReplacement = currentClient.displayId?.startsWith("PENDING-");
        if (!isPendingReplacement && !/^W\d+$/.test(newId)) {
          return res.status(400).json({ error: "Client ID must start with W followed by numbers (e.g. W12345678)" });
        }
        const existing = await storage.getClientByDisplayId(newId);
        if (existing && existing.id !== currentClient.id) {
          return res.status(409).json({ error: `Client ID ${newId} is already in use` });
        }
        req.body.displayId = newId;
      }
      
      // Add workflow timestamps based on status change
      const updateData = { ...req.body };
      if (req.body.status && req.body.status !== oldStatus) {
        const now = new Date();
        if (req.body.status === "Forms Sent") {
          updateData.formsSentAt = now;
        } else if (req.body.status === "Forms Completed") {
          updateData.formsCompletedAt = now;
        } else if (req.body.status === "Assigned") {
          updateData.allocatedAt = now;
        } else if (req.body.status === "AwaitingConfirmation") {
          updateData.awaitingConfirmationAt = now;
        } else if (req.body.status === "Scheduled") {
          updateData.confirmedAt = now;
        }
      }
      
      const slotToDelete = (req.body.status === "Scheduled" && req.body.status !== oldStatus && currentClient?.assignedSlotId)
        ? currentClient.assignedSlotId
        : null;
      
      // When confirming, always clear ALL three assignment fields — the slot is being deleted
      // and the text fields must also be cleared to prevent legacy enrichment hiding future slots
      if (req.body.status === "Scheduled" && req.body.status !== oldStatus) {
        updateData.assignedSlotId = null;
        updateData.assignedSlot = null;
        updateData.assignedClinicianId = null;
      }

      // When moving backward from an allocated state, release the slot and clear assignment fields
      const ALLOCATED_STATUSES = ["Assigned", "AwaitingConfirmation", "Scheduled"];
      const isDeallocation = req.body.status && oldStatus &&
        ALLOCATED_STATUSES.includes(oldStatus) &&
        !ALLOCATED_STATUSES.includes(req.body.status);

      if (isDeallocation) {
        if (currentClient?.assignedSlotId) {
          try {
            await db.update(timeSlots).set({ isBooked: false }).where(eq(timeSlots.id, currentClient.assignedSlotId));
          } catch (err) {
            console.error("Failed to unbook slot on de-allocation:", err);
          }
        }
        updateData.assignedSlotId = null;
        updateData.assignedSlot = null;
        updateData.assignedClinicianId = null;
      }
      
      const updated = await storage.updateClient(req.params.id, updateData);
      
      if (slotToDelete && updated) {
        try {
          await storage.deleteTimeSlot(slotToDelete);
        } catch (err) {
          console.error("Failed to delete slot on confirmation:", err);
        }
      }
      if (!updated) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Auto-create Stripe checkout and email payment link when moving to AwaitingConfirmation
      if (
        req.body.status === "AwaitingConfirmation" &&
        oldStatus !== "AwaitingConfirmation" &&
        isStripeConfigured(req.tenant?.stripeSecretKey) &&
        !updated.stripeCheckoutUrl // Only if checkout not already created
      ) {
        try {
          // Resolve agreed rate: use client's rate if set, otherwise default from clinician
          let amountPence = updated.agreedRatePence ?? 0;
          if (amountPence <= 0 && updated.assignedClinicianId) {
            const assignedClinician = await storage.getClinicianById(updated.assignedClinicianId);
            if (assignedClinician?.sessionRatePence && assignedClinician.sessionRatePence > 0) {
              amountPence = assignedClinician.sessionRatePence;
              // Persist the defaulted rate on the client record
              await db.update(clients).set({ agreedRatePence: amountPence, updatedAt: new Date() })
                .where(eq(clients.id, updated.id));
            }
          }

          if (!updated.email) {
            console.warn(`AwaitingConfirmation: client ${updated.id} has no email — cannot send payment link`);
          } else if (amountPence <= 0) {
            console.warn(`AwaitingConfirmation: client ${updated.id} has no agreed rate and no clinician default — checkout skipped`);
          } else {
            const appBase = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
            const checkoutResult = await createCheckoutSession({
              clientId: updated.id,
              clientEmail: updated.email,
              clientDisplayId: updated.displayId,
              clientName: [updated.firstName, updated.lastName].filter(Boolean).join(" ") || null,
              amountPence,
              successUrl: `${appBase}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
              cancelUrl: `${appBase}/payment-cancel`,
              tenantId: req.tenant?.id,
              tenantStripeKey: req.tenant?.stripeSecretKey,
              practiceName: req.tenant?.name,
            });
            if (checkoutResult) {
              await db.update(clients).set({
                stripeCustomerId: checkoutResult.customerId,
                stripeCheckoutUrl: checkoutResult.url,
                paymentStatus: "setup_pending",
                updatedAt: new Date(),
              }).where(eq(clients.id, updated.id));

              // Email the payment link to the client
              const amountPounds = (amountPence / 100).toFixed(2);
              const tcAuto = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
              const emailOptions = await generatePaymentLinkEmail(checkoutResult.url, amountPounds, tcAuto);
              await sendEmail({ ...emailOptions, to: updated.email });
              console.log(`Auto-generated payment link and emailed to client ${updated.id}`);
            }
          }
        } catch (paymentError) {
          console.error("Failed to auto-create checkout session on AwaitingConfirmation:", paymentError);
        }
      }

      // CY&A: auto-send booking confirmed email when manually advancing to BookingConfirmed
      if (req.body.status === "BookingConfirmed" && oldStatus !== "BookingConfirmed" && req.tenant?.bookingConfirmedEmailEnabled && updated.email) {
        try {
          const confirmedClinician = updated.assignedClinicianId
            ? await db.select().from(clinicians).where(eq(clinicians.id, updated.assignedClinicianId)).limit(1).then(r => r[0])
            : undefined;
          const clinicianUser = confirmedClinician?.userId
            ? await db.select({ name: users.name }).from(users).where(eq(users.id, confirmedClinician.userId)).limit(1).then(r => r[0])
            : undefined;
          const slotRow = updated.assignedSlotId
            ? await db.select().from(timeSlots).where(eq(timeSlots.id, updated.assignedSlotId)).limit(1).then(r => r[0])
            : undefined;
          const tcBook = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
          const bookEmail = await generateBookingConfirmedEmail({
            clinicianName: clinicianUser?.name || 'Your Clinician',
            day: slotRow?.day || null,
            startTime: slotRow?.startTime || '',
            endTime: slotRow?.endTime || '',
            zoomLink: confirmedClinician?.zoomLink || null,
          }, tcBook);
          await sendEmail({ ...bookEmail, to: updated.email });
          console.log(`Booking confirmed email sent to client ${req.params.id} (manual advance)`);
        } catch (bookEmailErr) {
          console.error('Failed to send booking confirmed email (manual advance):', bookEmailErr);
        }
      }

      // Send waitlist update notification if status changed
      if (req.body.status && oldStatus && req.body.status !== oldStatus) {
        try {
          const adminUsers = req.tenant?.id ? await storage.getAdminUsersByTenantId(req.tenant.id) : [];
          const clientName = `${updated.firstName || ''} ${updated.lastName || ''}`.trim() || 'Unknown';
          for (const admin of adminUsers) {
            const prefs = admin.notificationPrefs as { waitlistUpdates?: boolean } | null;
            if (prefs?.waitlistUpdates !== false) {
              const tcW = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
              const emailOptions = await generateWaitlistUpdateEmail(
                updated.displayId,
                clientName,
                oldStatus,
                req.body.status,
                tcW
              );
              await sendEmail({ ...emailOptions, to: admin.email });
            }
          }
        } catch (emailError) {
          console.error("Failed to send waitlist update notifications:", emailError);
        }
      }

      res.json(updated);
    } catch (error) {
      console.error("Failed to update client:", error);
      res.status(500).json({ error: "Failed to update client" });
    }
  });

  app.post("/api/clients/:clientId/assign", requireAdmin, auditLog("assign", "client"), async (req, res) => {
    try {
      const { clinicianId, slotId, allocationMethod = "form", allocationReason } = req.body;
      
      if (!clinicianId || !slotId) {
        return res.status(400).json({ error: "Missing clinicianId or slotId" });
      }

      const clientToAssign = await storage.getClientById(req.params.clientId);
      if (!clientToAssign) return res.status(404).json({ error: "Client not found" });
      if (clientToAssign.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });

      await storage.assignClinicianToClient(req.params.clientId, clinicianId, slotId, allocationMethod, allocationReason);
      
      const updated = await storage.getClientById(req.params.clientId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to assign clinician" });
    }
  });

  // CY&A: Multi-clinician allocation — inserts client_clinician_options rows and holds slots
  app.post("/api/clients/:clientId/allocate-options", requireAdmin, auditLog("assign", "client"), async (req, res) => {
    try {
      const { selections } = req.body;
      // selections: [{clinicianId, slotId}, ...]

      if (!Array.isArray(selections) || selections.length < 1 || selections.length > 3) {
        return res.status(400).json({ error: "Must provide 1–3 clinician/slot selections" });
      }

      const client = await storage.getClientById(req.params.clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (client.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });

      if (!req.tenant?.multiClinicianAllocationEnabled) {
        return res.status(400).json({ error: "Multi-clinician allocation is not enabled for this tenant" });
      }

      // Reject duplicate slotIds in the request
      const slotIds = selections.map((s: any) => s.slotId);
      if (new Set(slotIds).size !== slotIds.length) {
        return res.status(400).json({ error: "Duplicate slot selections are not allowed" });
      }

      // Validate every selection: must have IDs, slot must be available, slot/clinician must belong to tenant
      for (const sel of selections) {
        if (!sel.clinicianId || !sel.slotId) {
          return res.status(400).json({ error: "Each selection must have clinicianId and slotId" });
        }

        // Verify slot exists, is unbooked, belongs to this tenant, and belongs to the stated clinician
        const [slot] = await db.select().from(timeSlots).where(eq(timeSlots.id, sel.slotId)).limit(1);
        if (!slot) return res.status(400).json({ error: `Slot ${sel.slotId} not found` });
        if (slot.isBooked) return res.status(400).json({ error: `Slot ${sel.slotId} is already booked` });
        if (slot.clinicianId !== sel.clinicianId) {
          return res.status(400).json({ error: `Slot ${sel.slotId} does not belong to clinician ${sel.clinicianId}` });
        }
        if (slot.tenantId && slot.tenantId !== req.tenant?.id) {
          return res.status(403).json({ error: `Slot ${sel.slotId} does not belong to this tenant` });
        }

        // Verify clinician belongs to this tenant
        const [clinician] = await db.select().from(clinicians).where(eq(clinicians.id, sel.clinicianId)).limit(1);
        if (!clinician) return res.status(400).json({ error: `Clinician ${sel.clinicianId} not found` });
        if (clinician.tenantId !== req.tenant?.id) {
          return res.status(403).json({ error: `Clinician ${sel.clinicianId} does not belong to this tenant` });
        }
      }

      const options = selections.map((sel: { clinicianId: string; slotId: string }) => ({
        clientId: req.params.clientId,
        clinicianId: sel.clinicianId,
        slotId: sel.slotId,
        status: "pending" as const,
        selectionToken: crypto.randomBytes(32).toString("hex"),
        tenantId: req.tenant!.id,
      }));

      await db.transaction(async (tx) => {
        // Insert options rows
        await tx.insert(clientClinicianOptions).values(options as any);

        // Hold each selected slot
        for (const sel of selections) {
          await tx.update(timeSlots).set({ isBooked: true }).where(eq(timeSlots.id, sel.slotId));
        }

        // Move client to OptionsSent
        await tx.update(clients).set({
          status: "OptionsSent",
          updatedAt: new Date(),
        }).where(eq(clients.id, req.params.clientId));
      });

      const updated = await storage.getClientById(req.params.clientId);

      // Auto-send allocation email if enabled
      if (req.tenant?.autoAllocationEmailEnabled && updated?.email) {
        try {
          const allOptions = await storage.getClientClinicianOptions(req.params.clientId);
          const optionDetails = await Promise.all(
            allOptions.map(async (opt) => {
              const [clinRow] = await db.select().from(clinicians).where(eq(clinicians.id, opt.clinicianId)).limit(1);
              const clinUser = clinRow?.userId
                ? await db.select({ name: users.name }).from(users).where(eq(users.id, clinRow.userId)).limit(1).then(r => r[0])
                : undefined;
              const slotRow = opt.slotId
                ? await db.select().from(timeSlots).where(eq(timeSlots.id, opt.slotId)).limit(1).then(r => r[0])
                : undefined;
              return {
                clinicianName: clinUser?.name || 'Clinician',
                day: slotRow?.day || null,
                startTime: slotRow?.startTime || '',
                endTime: slotRow?.endTime || '',
                selectionToken: opt.selectionToken,
                locationType: slotRow?.locationType || null,
              };
            })
          );
          // Use the first option's token as the portal entry point (any token gets all options)
          const firstToken = allOptions[0]?.selectionToken;
          const appBase = process.env.APP_BASE_URL;
          if (!appBase || !firstToken) {
            console.warn(`Allocation email skipped: APP_BASE_URL not set or no selection token available for client ${req.params.clientId}`);
            // Skip email — do not fall back to Host header (bearer-token disclosure risk)
          } else {
            const portalUrl = `${appBase}/options/${firstToken}`;
            const tcAlloc = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
            const allocEmail = await generateAllocationOptionsEmail(optionDetails, portalUrl, tcAlloc);
            await sendEmail({ ...allocEmail, to: updated.email });
            console.log(`Allocation options email sent to client ${req.params.clientId}`);
          }
        } catch (emailErr) {
          console.error('Failed to send allocation options email:', emailErr);
        }
      }

      res.json(updated);
    } catch (error) {
      console.error("Failed to allocate options:", error);
      res.status(500).json({ error: "Failed to allocate options" });
    }
  });

  app.post("/api/clients/:clientId/reassign", requireAdmin, auditLog("reassign", "client"), async (req, res) => {
    try {
      const { clinicianId, slotId, status } = req.body;
      
      if (!status) {
        return res.status(400).json({ error: "Missing status" });
      }

      const clientToReassign = await storage.getClientById(req.params.clientId);
      if (!clientToReassign) return res.status(404).json({ error: "Client not found" });
      if (clientToReassign.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });

      const updated = await storage.reassignClient(req.params.clientId, clinicianId || null, slotId || null, status);
      if (!updated) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Failed to reassign client:", error);
      // Return validation errors as 400
      if (error.message?.includes("not found") || error.message?.includes("does not belong") || error.message?.includes("already booked")) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to reassign client" });
    }
  });

  app.post("/api/clients/:id/archive", requireAdmin, auditLog("archive", "client"), async (req, res) => {
    try {
      const { reason, category } = req.body || {};
      const clientToArchive = await storage.getClientById(req.params.id);
      if (!clientToArchive) return res.status(404).json({ error: "Client not found" });
      if (clientToArchive.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });
      const archived = await storage.archiveClient(req.params.id, reason, category);
      if (!archived) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(archived);
    } catch (error) {
      res.status(500).json({ error: "Failed to archive client" });
    }
  });

  // ============ PUBLIC FORM FILL ENDPOINTS ============
  // These endpoints are used by clients to fill out forms (no auth required)
  // Security: Only expose minimal data needed for form filling
  app.get("/api/clients/public/:id", async (req, res) => {
    try {
      const client = await storage.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      // Only return minimal info needed for form filling - no PII
      res.json({
        id: client.id,
        displayId: client.displayId,
        status: client.status,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

  // Public: return customizable form-completion page content for a given client's tenant
  app.get("/api/public/form-completion-page/:clientId", async (req, res) => {
    try {
      const client = await storage.getClientById(req.params.clientId);
      if (!client) {
        return res.json({ heading: 'Thank you for completing our intake form.', body: '' });
      }
      const tenant = await storage.getTenantById(client.tenantId).catch(() => null);
      const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
      const content = await getFormCompletionPageContent(client.tenantId, practiceName);
      res.json(content);
    } catch {
      res.json({ heading: 'Thank you for completing our intake form.', body: '' });
    }
  });

  // Public form submission endpoint with validation
  app.post("/api/form-submissions", async (req, res) => {
    try {
      const { formId, clientId, data } = req.body;
      
      // Validate required fields
      if (!formId || !clientId || !data || typeof data !== "object") {
        return res.status(400).json({ error: "Missing or invalid required fields" });
      }

      // Verify client exists
      const client = await storage.getClientById(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      
      // Prevent duplicate submissions
      if (client.status === "Forms Completed") {
        return res.status(400).json({ error: "Form already submitted" });
      }

      // Verify form exists
      const form = await storage.getFormTemplateById(formId);
      if (!form) {
        return res.status(404).json({ error: "Form not found" });
      }

      // Verify client is in a state that allows form submission (Forms Sent)
      if (client.status !== "Forms Sent" && client.status !== "New") {
        return res.status(400).json({ error: "Form submission not allowed for this client status" });
      }

      // Check for existing draft and convert it, or create new submission
      const existingDraft = await storage.getDraftSubmission(clientId, formId);
      let submission;
      
      // Public routes never have req.tenant resolved (no session to derive it
      // from), so tenant tagging must come from the already-verified client
      // record instead — this is the same reliable-parent-entity pattern used
      // for timeslots. Passing req.tenant?.id here would always be undefined
      // and leave every real client submission with a null tenantId.
      if (existingDraft) {
        // Convert draft to final submission
        const converted = await storage.submitDraft(existingDraft.id, data, client.tenantId);
        if (!converted) {
          throw new Error("Failed to convert draft to submission");
        }
        submission = converted;
      } else {
        // Create new submission
        submission = await storage.createFormSubmission({
          formTemplateId: formId,
          clientId,
          responses: data,
        }, client.tenantId);
      }

      // Extract insurer from form data if present
      // Look for common field IDs that might contain insurer info
      const insurerFieldIds = ["insurer", "insuranceProvider", "insurance", "healthInsurer", "privateInsurer"];
      let insurerValue: string | null = null;
      for (const fieldId of insurerFieldIds) {
        if (data[fieldId] && typeof data[fieldId] === "string") {
          insurerValue = data[fieldId];
          break;
        }
      }

      // Update client status to "Forms Completed" with timestamp and insurer if found
      const clientUpdate: { status: "Forms Completed"; formsCompletedAt: Date; insurer?: string } = { 
        status: "Forms Completed",
        formsCompletedAt: new Date()
      };
      if (insurerValue) {
        clientUpdate.insurer = insurerValue;
      }
      await storage.updateClient(clientId, clientUpdate);

      // Send confirmation email to client if they have an email address
      if (client.email) {
        try {
          const completionTenant = client.tenantId ? await storage.getTenantById(client.tenantId) : null;
          const tcC = completionTenant ? { id: completionTenant.id, name: completionTenant.name, fromEmail: completionTenant.fromEmail } : undefined;
          const emailOptions = await generateFormCompletionEmail(tcC);
          emailOptions.to = client.email;
          await sendEmail(emailOptions);
          console.log(`Form completion email sent to client ${clientId}`);
        } catch (emailError) {
          // Log but don't fail the submission if email fails
          console.error("Failed to send form completion email:", emailError);
        }
      }

      res.json({ success: true, submissionId: submission.id });
    } catch (error) {
      console.error("Form submission error:", error);
      res.status(500).json({ error: "Failed to submit form" });
    }
  });

  // ============ CY&A PUBLIC PORTAL ENDPOINTS ============

  // GET /api/public/options/:selectionToken — return all options for a client identified by any of their selectionTokens
  app.get("/api/public/options/:selectionToken", async (req, res) => {
    try {
      const optionRow = await storage.getClientClinicianOptionByToken(req.params.selectionToken);
      if (!optionRow) return res.status(404).json({ error: "Options not found" });

      const client = await storage.getClientById(optionRow.clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });

      const tenant = await storage.getTenantById(optionRow.tenantId).catch(() => undefined);
      const allOptions = await storage.getClientClinicianOptions(optionRow.clientId);

      const optionsWithDetails = await Promise.all(
        allOptions.map(async (opt) => {
          const [clinicianRow] = await db.select().from(clinicians).where(eq(clinicians.id, opt.clinicianId)).limit(1);
          const clinicianUser = clinicianRow?.userId
            ? await db.select().from(users).where(eq(users.id, clinicianRow.userId)).limit(1).then(r => r[0])
            : undefined;
          const slotRow = opt.slotId
            ? await db.select().from(timeSlots).where(eq(timeSlots.id, opt.slotId)).limit(1).then(r => r[0])
            : undefined;
          return {
            id: opt.id,
            status: opt.status,
            clinicianName: clinicianUser?.name || "Clinician",
            slot: slotRow
              ? { day: slotRow.day, startTime: slotRow.startTime, endTime: slotRow.endTime, locationType: slotRow.locationType }
              : null,
          };
        })
      );

      res.json({
        options: optionsWithDetails,
        clientStatus: client.status,
        tenantName: tenant?.name || "",
        primaryColor: tenant?.primaryColor || null,
      });
    } catch (error) {
      console.error("Failed to fetch options:", error);
      res.status(500).json({ error: "Failed to fetch options" });
    }
  });

  // POST /api/public/options/:selectionToken/select — select one option or decline all
  app.post("/api/public/options/:selectionToken/select", async (req, res) => {
    try {
      const { clinicianOptionId, decline } = req.body;
      const optionRow = await storage.getClientClinicianOptionByToken(req.params.selectionToken);
      if (!optionRow) return res.status(404).json({ error: "Options not found" });

      const client = await storage.getClientById(optionRow.clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });

      // State gate: only allow action when client is still in OptionsSent (i.e. not yet actioned)
      if (client.status !== "OptionsSent") {
        return res.status(409).json({ error: "Selection has already been submitted" });
      }

      const allOptions = await storage.getClientClinicianOptions(optionRow.clientId);

      // Guard against replayed tokens when all options are already resolved
      const alreadyActioned = allOptions.every(o => o.status !== "pending");
      if (alreadyActioned) {
        return res.status(409).json({ error: "Selection has already been submitted" });
      }

      if (decline) {
        // Decline all — release all held slots, flag needsAdminCall
        await db.transaction(async (tx) => {
          for (const opt of allOptions) {
            await tx.update(clientClinicianOptions)
              .set({ status: "declined" })
              .where(eq(clientClinicianOptions.id, opt.id));
            if (opt.slotId) {
              await tx.update(timeSlots).set({ isBooked: false }).where(eq(timeSlots.id, opt.slotId));
            }
          }
          await tx.update(clients)
            .set({ needsAdminCall: true, updatedAt: new Date() })
            .where(eq(clients.id, optionRow.clientId));
        });
        return res.json({ declined: true });
      }

      if (!clinicianOptionId) return res.status(400).json({ error: "Missing clinicianOptionId" });
      const selectedOption = allOptions.find(o => o.id === clinicianOptionId);
      if (!selectedOption) return res.status(400).json({ error: "Option not found" });

      const registrationToken = crypto.randomBytes(32).toString("hex");

      await db.transaction(async (tx) => {
        for (const opt of allOptions) {
          if (opt.id === clinicianOptionId) {
            await tx.update(clientClinicianOptions).set({ status: "selected" }).where(eq(clientClinicianOptions.id, opt.id));
          } else {
            await tx.update(clientClinicianOptions).set({ status: "declined" }).where(eq(clientClinicianOptions.id, opt.id));
            if (opt.slotId) {
              await tx.update(timeSlots).set({ isBooked: false }).where(eq(timeSlots.id, opt.slotId));
            }
          }
        }
        await tx.update(clients).set({
          status: "OptionSelected",
          assignedClinicianId: selectedOption.clinicianId,
          assignedSlotId: selectedOption.slotId || null,
          registrationToken,
          updatedAt: new Date(),
        }).where(eq(clients.id, optionRow.clientId));
      });

      res.json({
        selected: true,
        registrationUrl: `/register/${optionRow.clientId}/${registrationToken}`,
      });
    } catch (error) {
      console.error("Failed to process option selection:", error);
      res.status(500).json({ error: "Failed to process selection" });
    }
  });

  // GET /api/public/register/:clientId/:registrationToken — return registration form data
  app.get("/api/public/register/:clientId/:registrationToken", async (req, res) => {
    try {
      const client = await storage.getClientById(req.params.clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (client.registrationToken !== req.params.registrationToken) return res.status(403).json({ error: "Invalid token" });

      const tenant = client.tenantId ? await storage.getTenantById(client.tenantId).catch(() => undefined) : undefined;
      const tcTemplate = tenant ? await storage.getEmailTemplateByKey("terms_and_conditions", tenant.id) : null;
      const termsText = tcTemplate?.bodyText || "By proceeding you agree to our standard terms and conditions for therapy services. Sessions must be cancelled with at least 24 hours notice. Payment is due at the time of session booking.";

      res.json({
        tenantName: tenant?.name || "",
        primaryColor: tenant?.primaryColor || null,
        termsText,
        agreedRatePence: client.agreedRatePence,
        paymentsEnabled: tenant?.paymentsEnabled ?? true,
        // Only treat as fully submitted once payment is confirmed — RegistrationPending
        // means the client may have cancelled out of Stripe and needs to retry payment.
        alreadySubmitted: client.status === "BookingConfirmed",
        // Pre-fill form data if already saved (e.g. returning after Stripe cancel)
        savedPaymentType: client.paymentType || null,
        savedInsurerDetails: client.insurerDetails || null,
      });
    } catch (error) {
      console.error("Failed to fetch registration data:", error);
      res.status(500).json({ error: "Failed to fetch registration data" });
    }
  });

  // POST /api/public/register/:clientId/:registrationToken — submit registration form
  app.post("/api/public/register/:clientId/:registrationToken", async (req, res) => {
    try {
      const { paymentType, insurerDetails } = req.body;

      // Validate paymentType against allowlist
      const ALLOWED_PAYMENT_TYPES = ["self_pay", "insurer"] as const;
      type AllowedPaymentType = typeof ALLOWED_PAYMENT_TYPES[number];
      if (!paymentType || !ALLOWED_PAYMENT_TYPES.includes(paymentType as AllowedPaymentType)) {
        return res.status(400).json({ error: "Payment type must be 'self_pay' or 'insurer'" });
      }
      const validatedPaymentType = paymentType as AllowedPaymentType;

      const client = await storage.getClientById(req.params.clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (client.registrationToken !== req.params.registrationToken) return res.status(403).json({ error: "Invalid token" });

      // State gate: allow submission from OptionSelected (first attempt) and RegistrationPending
      // (returning after a Stripe cancel). Block once payment is confirmed (BookingConfirmed).
      const allowedRegistrationStatuses = ["OptionSelected", "RegistrationPending"];
      if (!allowedRegistrationStatuses.includes(client.status)) {
        return res.status(409).json({ error: "Registration has already been completed" });
      }

      await storage.updateClient(req.params.clientId, {
        paymentType: validatedPaymentType,
        insurerDetails: validatedPaymentType === "insurer" ? (insurerDetails || null) : null,
        status: "RegistrationPending",
      });

      const tenant = client.tenantId ? await storage.getTenantById(client.tenantId).catch(() => undefined) : undefined;

      // Create Stripe checkout session when payments are enabled, rate is set, and client is self-pay
      if (validatedPaymentType === "self_pay" && tenant?.paymentsEnabled && client.agreedRatePence && client.agreedRatePence > 0) {
        let tenantStripeKey: string | null = null;
        if (tenant.stripeSecretKey) {
          try { tenantStripeKey = decryptSecret(tenant.stripeSecretKey); } catch { /* key decryption failed — Stripe will reject below */ }
        }

        const protocol = (req.headers["x-forwarded-proto"] as string) || "https";
        const host = (req.headers.host as string) || "localhost:5000";
        const baseUrl = `${protocol}://${host}`;

        let session: { url: string; customerId: string; sessionId: string } | null = null;
        try {
          session = await createCheckoutSession({
            clientId: client.id,
            clientEmail: client.email,
            clientDisplayId: client.displayId,
            amountPence: client.agreedRatePence,
            successUrl: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${baseUrl}/register/${client.id}/${req.params.registrationToken}`,
            tenantId: client.tenantId,
            tenantStripeKey,
            practiceName: tenant?.name || null,
          });
        } catch (stripeErr) {
          console.error("Stripe session creation failed:", stripeErr);
        }

        if (!session) {
          // Revert status so the client can retry
          await storage.updateClient(req.params.clientId, { status: "OptionSelected" });
          return res.status(502).json({ error: "Payment setup is unavailable. Please try again or contact the practice." });
        }

        await storage.updateClient(client.id, { stripeCheckoutUrl: session.url });
        return res.json({ checkoutUrl: session.url });
      }

      // Insurer or payments not enabled — advance directly to BookingConfirmed
      await storage.updateClient(req.params.clientId, { status: "BookingConfirmed" });

      // Send booking confirmed email if the tenant flag is on
      if (tenant?.bookingConfirmedEmailEnabled && client.email) {
        try {
          const confirmedClinician = client.assignedClinicianId
            ? await db.select().from(clinicians).where(eq(clinicians.id, client.assignedClinicianId)).limit(1).then(r => r[0])
            : undefined;
          const clinicianUser = confirmedClinician?.userId
            ? await db.select({ name: users.name }).from(users).where(eq(users.id, confirmedClinician.userId)).limit(1).then(r => r[0])
            : undefined;
          const slotRow = client.assignedSlotId
            ? await db.select().from(timeSlots).where(eq(timeSlots.id, client.assignedSlotId)).limit(1).then(r => r[0])
            : undefined;
          const tcBook = tenant ? { id: tenant.id, name: tenant.name, fromEmail: tenant.fromEmail, primaryColor: tenant.primaryColor } : undefined;
          const bookEmail = await generateBookingConfirmedEmail({
            clinicianName: clinicianUser?.name || 'Your Clinician',
            day: slotRow?.day || null,
            startTime: slotRow?.startTime || '',
            endTime: slotRow?.endTime || '',
            zoomLink: confirmedClinician?.zoomLink || null,
          }, tcBook);
          await sendEmail({ ...bookEmail, to: client.email });
          console.log(`Booking confirmed email sent to client ${req.params.clientId} (non-Stripe registration)`);
        } catch (bookEmailErr) {
          console.error('Failed to send booking confirmed email (non-Stripe registration):', bookEmailErr);
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Failed to submit registration:", error);
      res.status(500).json({ error: "Failed to submit registration" });
    }
  });

  // Get existing draft for a client/form (public)
  app.get("/api/form-drafts/:clientId/:formId", async (req, res) => {
    try {
      const { clientId, formId } = req.params;
      
      // Verify client exists
      const client = await storage.getClientById(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Don't return drafts for already-submitted forms
      if (client.status === "Forms Completed") {
        return res.json({ hasDraft: false });
      }

      // Get draft if it exists
      const draft = await storage.getDraftSubmission(clientId, formId);
      
      if (draft) {
        res.json({ 
          hasDraft: true, 
          draftId: draft.id,
          responses: draft.responses,
          savedAt: draft.submittedAt 
        });
      } else {
        res.json({ hasDraft: false });
      }
    } catch (error) {
      console.error("Error checking for draft:", error);
      res.status(500).json({ error: "Failed to check for draft" });
    }
  });

  // Save form progress as draft (public)
  app.post("/api/form-drafts", async (req, res) => {
    try {
      const { formId, clientId, data } = req.body;
      
      // Validate required fields
      if (!formId || !clientId || !data || typeof data !== "object") {
        return res.status(400).json({ error: "Missing or invalid required fields" });
      }

      // Verify client exists
      const client = await storage.getClientById(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Prevent saving draft if already submitted
      if (client.status === "Forms Completed") {
        return res.status(400).json({ error: "Form already submitted" });
      }

      // Verify form exists
      const form = await storage.getFormTemplateById(formId);
      if (!form) {
        return res.status(404).json({ error: "Form not found" });
      }

      // Save or update draft. Derived from the client's own tenantId (a
      // reliable, always-set source) rather than req.tenant, which is never
      // resolved on this unauthenticated public route.
      const draft = await storage.saveOrUpdateDraft(clientId, formId, data, client.tenantId);

      res.json({ 
        success: true, 
        draftId: draft.id,
        savedAt: draft.submittedAt 
      });
    } catch (error) {
      console.error("Draft save error:", error);
      res.status(500).json({ error: "Failed to save draft" });
    }
  });

  // Get form submissions for a client (admin only)
  app.get("/api/clients/:id/submissions", requireAdmin, async (req, res) => {
    try {
      // Verify client exists and belongs to this tenant
      const client = await storage.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (client.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const submissions = await storage.getFormSubmissionsByClientId(req.params.id);
      
      // Enrich with form template info
      const enrichedSubmissions = await Promise.all(
        submissions.map(async (sub) => {
          const form = await storage.getFormTemplateById(sub.formTemplateId);
          return {
            ...sub,
            formTitle: form?.title || "Unknown Form",
            formFields: form?.fields || [],
          };
        })
      );
      
      res.json(enrichedSubmissions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch submissions" });
    }
  });

  // ============ FORM TEMPLATES ============
  app.get("/api/forms", requireAuth, async (req, res) => {
    try {
      const forms = await storage.getAllFormTemplates(req.tenant?.id);
      res.json(forms);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch forms" });
    }
  });

  // Public form access for clients filling out forms - returns sanitized form
  app.get("/api/forms/:id", async (req, res) => {
    try {
      const form = await storage.getFormTemplateById(req.params.id);
      if (!form) {
        return res.status(404).json({ error: "Form not found" });
      }
      // Return only fields needed for public form filling
      res.json({
        id: form.id,
        title: form.title,
        description: form.description,
        fields: form.fields,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch form" });
    }
  });

  app.post("/api/forms", requireAdmin, async (req, res) => {
    try {
      const validated = insertFormTemplateSchema.parse(req.body);
      const form = await storage.createFormTemplate(validated, req.tenant?.id);
      res.json(form);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create form" });
    }
  });

  app.patch("/api/forms/:id", requireAdmin, async (req, res) => {
    try {
      const form = await storage.getFormTemplateById(req.params.id);
      if (!form) return res.status(404).json({ error: "Form not found" });
      if (form.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });
      const validated = insertFormTemplateSchema.partial().parse(req.body);
      const updated = await storage.updateFormTemplate(req.params.id, validated);
      if (!updated) {
        return res.status(404).json({ error: "Form not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Failed to update form:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: "Failed to update form" });
    }
  });

  app.delete("/api/forms/:id", requireAdmin, async (req, res) => {
    try {
      const form = await storage.getFormTemplateById(req.params.id);
      if (!form) return res.status(404).json({ error: "Form not found" });
      if (form.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });
      await storage.deleteFormTemplate(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete form" });
    }
  });

  // ============ TASKS ============
  app.get("/api/activity/recent", requireAdmin, async (req, res) => {
    try {
      const logs = await storage.getRecentAuditLogs(20, "add_slots", req.tenant?.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch recent activity" });
    }
  });

  app.get("/api/tasks", requireAdmin, async (req, res) => {
    try {
      const tasks = await storage.getAllTasks(req.tenant?.id);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", requireAdmin, async (req, res) => {
    try {
      // Parse dueDate string to Date object if it's a string
      const body = { ...req.body };
      if (typeof body.dueDate === 'string') {
        body.dueDate = new Date(body.dueDate);
      }
      const validated = insertTaskSchema.parse(body);
      const task = await storage.createTask(validated, req.tenant?.id);

      if (validated.assignee) {
        try {
          const assigneeUser = await storage.getUserByName(validated.assignee);
          console.log(`Task notification: assignee="${validated.assignee}", userFound=${!!assigneeUser}, email=${assigneeUser?.email}`);
          if (assigneeUser) {
            const prefs = assigneeUser.notificationPrefs as { taskAssignments?: boolean } | null;
            console.log(`Task notification: prefs=${JSON.stringify(prefs)}`);
            if (prefs?.taskAssignments !== false) {
              const dueDateStr = validated.dueDate ? 
                new Date(validated.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 
                'Not specified';
              const tcT = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
              const emailOptions = await generateTaskReminderEmail(
                assigneeUser.name,
                validated.title,
                validated.description || '',
                dueDateStr,
                tcT
              );
              console.log(`Task notification: sending email to ${assigneeUser.email}`);
              const result = await sendEmail({
                ...emailOptions,
                to: assigneeUser.email
              });
              console.log(`Task notification: email result=${JSON.stringify(result)}`);
            }
          }
        } catch (emailError) {
          console.error("Failed to send task assignment email:", emailError);
        }
      }

      res.json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", requireAdmin, async (req, res) => {
    try {
      const task = await storage.getTaskById(req.params.id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (task.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });
      // Parse dueDate string to Date object if present
      const body = { ...req.body };
      if (typeof body.dueDate === 'string') {
        body.dueDate = new Date(body.dueDate);
      }
      const updated = await storage.updateTask(req.params.id, body);
      if (!updated) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", requireAdmin, async (req, res) => {
    try {
      const task = await storage.getTaskById(req.params.id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (task.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });
      await storage.deleteTask(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // ============ EMAIL ROUTES ============
  
  // Send form to client via email
  app.post("/api/email/send-form", requireAdmin, async (req, res) => {
    try {
      const { clientId, formId } = req.body;
      
      if (!clientId || !formId) {
        return res.status(400).json({ error: "Missing clientId or formId" });
      }

      // Get client and form details
      const client = await storage.getClientById(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (client.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const form = await storage.getFormTemplateById(formId);
      if (!form) {
        return res.status(404).json({ error: "Form not found" });
      }
      if (form.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Generate form URL - use request host for correct URL
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const baseUrl = `${protocol}://${host}`;
      const formUrl = `${baseUrl}/fill/${client.id}/${formId}`;

      // Generate and send email
      const tcF = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
      const emailOptions = await generateFormInviteEmail(form.title, formUrl, tcF);
      emailOptions.to = client.email;

      const result = await sendEmail(emailOptions);
      
      if (!result.success) {
        return res.status(500).json({ error: result.error || "Failed to send email" });
      }

      // Update client status to "Forms Sent" with timestamp
      await storage.updateClient(clientId, { status: "Forms Sent", formsSentAt: new Date() });

      res.json({ success: true, message: "Form sent successfully" });
    } catch (error) {
      console.error("Send form email error:", error);
      res.status(500).json({ error: "Failed to send form email" });
    }
  });

  // Send task reminder email
  app.post("/api/email/task-reminder", requireAdmin, async (req, res) => {
    try {
      const { taskId, recipientEmail } = req.body;
      
      if (!taskId || !recipientEmail) {
        return res.status(400).json({ error: "Missing taskId or recipientEmail" });
      }

      const task = await storage.getTaskById(taskId);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      if (task.tenantId !== req.tenant?.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const tcTR = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
      const emailOptions = await generateTaskReminderEmail(
        task.assignee,
        task.title,
        task.description || '',
        task.dueDate instanceof Date ? task.dueDate.toLocaleDateString() : task.dueDate,
        tcTR
      );
      emailOptions.to = recipientEmail;

      const result = await sendEmail(emailOptions);
      
      if (!result.success) {
        return res.status(500).json({ error: result.error || "Failed to send reminder" });
      }

      res.json({ success: true, message: "Reminder sent successfully" });
    } catch (error) {
      console.error("Send task reminder error:", error);
      res.status(500).json({ error: "Failed to send task reminder" });
    }
  });

  // Send availability reminders to all clinicians
  app.post("/api/email/availability-reminders", requireAdmin, async (req, res) => {
    try {
      const clinicians = await storage.getAllClinicians(req.tenant?.id);
      
      // Get the login URL
      const baseUrl = req.headers.host?.includes('replit.app')
        ? `https://${req.headers.host}`
        : 'http://localhost:5000';
      const loginUrl = `${baseUrl}/login`;

      let sentCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const clinician of clinicians) {
        // Get the user associated with this clinician to get their email
        if (!clinician.userId) {
          failedCount++;
          errors.push(`No userId for clinician ${clinician.id}`);
          continue;
        }
        const user = await storage.getUser(clinician.userId);
        if (!user || !user.email) {
          failedCount++;
          errors.push(`No email for clinician ${clinician.id}`);
          continue;
        }

        const tcA = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
        const emailOptions = await generateAvailabilityReminderEmail(user.name, loginUrl, tcA);
        emailOptions.to = user.email;

        const result = await sendEmail(emailOptions);
        
        if (result.success) {
          sentCount++;
        } else {
          failedCount++;
          errors.push(`Failed to send to ${user.email}: ${result.error}`);
        }
      }

      res.json({ 
        success: true, 
        message: `Sent ${sentCount} reminders, ${failedCount} failed`,
        sentCount,
        failedCount,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Send availability reminders error:", error);
      res.status(500).json({ error: "Failed to send availability reminders" });
    }
  });

  // Change password (authenticated users)
  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current password and new password are required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters" });
      }
      const user = await storage.getUserById(req.user!.id);
      if (!user || !user.password) {
        return res.status(400).json({ error: "Unable to change password" });
      }
      const { comparePasswords } = await import("./auth");
      const isValid = await comparePasswords(currentPassword, user.password);
      if (!isValid) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }
      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUser(user.id, { password: hashedPassword });
      await auditLog(req, "password_changed", "user", user.id);
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // Request password reset
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const user = await storage.getUserByEmail(email.toLowerCase());
      
      // Always return success to prevent email enumeration
      if (!user) {
        return res.json({ success: true, message: "If the email exists, a reset link will be sent" });
      }

      // Generate reset token and store with expiry (7 days)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      // Store token securely in database (do not log tokens)
      await storage.createPasswordResetToken(user.id, resetToken, expiresAt);

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const baseUrl = `${protocol}://${host}`;
      const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

      const resetTenant = user.tenantId ? await storage.getTenantById(user.tenantId) : null;
      const tcPR = resetTenant ? { id: resetTenant.id, name: resetTenant.name, fromEmail: resetTenant.fromEmail } : undefined;
      const emailOptions = await generatePasswordResetEmail(user.name, resetUrl, tcPR);
      emailOptions.to = user.email;

      const result = await sendEmail(emailOptions);
      
      if (!result.success) {
        console.error("Password reset email failed:", result.error);
      }

      res.json({ success: true, message: "If the email exists, a reset link will be sent" });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  // Validate a password reset token (public endpoint for the reset-password page)
  app.get("/api/auth/reset-password/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const resetToken = await storage.getPasswordResetTokenByToken(token);
      if (!resetToken) {
        return res.status(400).json({ error: "Invalid or expired reset link", valid: false });
      }
      if (resetToken.usedAt) {
        return res.status(400).json({ error: "This reset link has already been used", valid: false });
      }
      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ error: "This reset link has expired", valid: false });
      }

      const user = await storage.getUserById(resetToken.userId);
      if (!user) {
        return res.status(400).json({ error: "User not found", valid: false });
      }

      let tenantName: string | null = null;
      let tenantLogoUrl: string | null = null;
      if (user.tenantId) {
        const [tenant] = await db.select({ name: tenants.name, logoUrl: tenants.logoUrl })
          .from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
        if (tenant) {
          tenantName = tenant.name;
          tenantLogoUrl = tenant.logoUrl;
        }
      }

      res.json({ valid: true, email: user.email, tenantName, tenantLogoUrl });
    } catch (error) {
      console.error("Failed to validate reset token:", error);
      res.status(500).json({ error: "Failed to validate reset link", valid: false });
    }
  });

  // Complete a password reset using a valid token
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res.status(400).json({ error: "Token and new password are required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const resetToken = await storage.getPasswordResetTokenByToken(token);
      if (!resetToken) {
        return res.status(400).json({ error: "Invalid or expired reset link" });
      }
      if (resetToken.usedAt) {
        return res.status(400).json({ error: "This reset link has already been used" });
      }
      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ error: "This reset link has expired" });
      }

      const user = await storage.getUserById(resetToken.userId);
      if (!user) {
        return res.status(400).json({ error: "User not found" });
      }

      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUser(user.id, { password: hashedPassword });
      await storage.markPasswordResetTokenUsed(resetToken.id);
      await auditLog(req, "password_reset_completed", "user", user.id);

      res.json({ success: true, message: "Password reset successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ============ EMAIL TEMPLATES ============
  app.get("/api/email-templates", requireAdmin, async (req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates(req.tenant?.id);
      res.json(templates);
    } catch (error) {
      console.error("Get email templates error:", error);
      res.status(500).json({ error: "Failed to get email templates" });
    }
  });

  app.get("/api/email-templates/:key", requireAdmin, async (req, res) => {
    try {
      const template = await storage.getEmailTemplateByKey(req.params.key, req.tenant?.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error("Get email template error:", error);
      res.status(500).json({ error: "Failed to get email template" });
    }
  });

  app.put("/api/email-templates/:key", requireAdmin, async (req, res) => {
    try {
      const { name, subject, bodyText } = req.body;
      if (!name || !subject || !bodyText) {
        return res.status(400).json({ error: "Name, subject, and body are required" });
      }
      const template = await storage.upsertEmailTemplate({
        templateKey: req.params.key,
        name,
        subject,
        bodyText,
        tenantId: req.tenant?.id,
      });
      res.json(template);
    } catch (error) {
      console.error("Update email template error:", error);
      res.status(500).json({ error: "Failed to update email template" });
    }
  });

  // ============ DATA EXPORT ============
  app.get("/api/export/:type", requireAdmin, auditLog("export", "data"), async (req, res) => {
    try {
      const { type } = req.params;
      const format = (req.query.format as string) || "csv";
      let data: any[] = [];
      let filename = "";

      if (type === "form-responses") {
        const rows = await storage.getAllCompletedFormSubmissions(req.tenant?.id);
        filename = "form-responses";

        // Collect all unique field labels across all forms
        const allFieldLabels = new Set<string>();
        const processedRows = rows.map(({ submission, clientName, clientDisplayId, formTitle, formFields }) => {
          const fields = Array.isArray(formFields) ? formFields : [];
          const responses = (submission.responses || {}) as Record<string, any>;
          const fieldMap: Record<string, string> = {};
          fields.forEach((f: any) => {
            if (f.label) {
              allFieldLabels.add(f.label);
              const raw = responses[f.id];
              fieldMap[f.label] = Array.isArray(raw) ? raw.join(", ") : raw != null ? String(raw) : "";
            }
          });
          return { clientDisplayId, clientName, formTitle, submittedAt: submission.submittedAt, fieldMap };
        });

        const fieldLabelsList = Array.from(allFieldLabels);

        if (format === "xlsx") {
          const wsData = [
            ["Client ID", "Client Name", "Form", "Submitted At", ...fieldLabelsList],
            ...processedRows.map(r => [
              r.clientDisplayId,
              r.clientName,
              r.formTitle,
              r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
              ...fieldLabelsList.map(l => r.fieldMap[l] ?? ""),
            ]),
          ];
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet("Form Responses");
          wsData.forEach(row => ws.addRow(row));
          const buf = await wb.xlsx.writeBuffer();
          const timestamp = new Date().toISOString().slice(0, 10);
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          res.setHeader("Content-Disposition", `attachment; filename="${filename}_${timestamp}.xlsx"`);
          return res.send(Buffer.from(buf));
        }

        // CSV for form-responses
        const timestamp = new Date().toISOString().slice(0, 10);
        const csvHeaders = ["Client ID", "Client Name", "Form", "Submitted At", ...fieldLabelsList];
        const csvEscape = (v: any) => {
          const s = v != null ? String(v) : "";
          // Neutralize spreadsheet formula injection by prefixing dangerous lead chars
          const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
          return safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes("\t") ? `"${safe.replace(/"/g, '""')}"` : safe;
        };
        const csvRows = [
          csvHeaders.map(csvEscape).join(","),
          ...processedRows.map(r => [
            csvEscape(r.clientDisplayId),
            csvEscape(r.clientName),
            csvEscape(r.formTitle),
            csvEscape(r.submittedAt ? new Date(r.submittedAt).toISOString() : ""),
            ...fieldLabelsList.map(l => csvEscape(r.fieldMap[l] ?? "")),
          ].join(",")),
        ];
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}_${timestamp}.csv"`);
        return res.send(csvRows.join("\n"));
      }

      switch (type) {
        case "clients": {
          data = await storage.getAllClients(true, req.tenant?.id);
          filename = "clients";
          break;
        }
        case "clinicians": {
          data = await storage.getAllClinicians(req.tenant?.id);
          filename = "clinicians";
          break;
        }
        case "tasks": {
          data = await storage.getAllTasks(req.tenant?.id);
          filename = "tasks";
          break;
        }
        default:
          return res.status(400).json({ error: "Invalid export type. Use: clients, clinicians, tasks, form-responses" });
      }

      const timestamp = new Date().toISOString().slice(0, 10);

      if (format === "xlsx") {
        const flatRows = data.map(row => {
          const flat: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            flat[k] = v != null && typeof v === "object" ? JSON.stringify(v) : v;
          }
          return flat;
        });
        const headers = flatRows.length > 0 ? Object.keys(flatRows[0]) : [];
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet(filename);
        ws.addRow(headers);
        flatRows.forEach(row => ws.addRow(headers.map(h => row[h])));
        const buf = await wb.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}_${timestamp}.xlsx"`);
        return res.send(Buffer.from(buf));
      }

      // CSV format
      if (data.length === 0) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}_${timestamp}.csv"`);
        return res.send("");
      }

      const headers = Object.keys(data[0]);
      const genericCsvEscape = (val: any): string => {
        if (val === null || val === undefined) return "";
        const str = String(val);
        // Neutralize spreadsheet formula injection by prefixing dangerous lead chars
        const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
        if (safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes("\t")) {
          return `"${safe.replace(/"/g, '""')}"`;
        }
        return safe;
      };
      const csvRows = [
        headers.join(","),
        ...data.map(row =>
          headers.map(h => genericCsvEscape(row[h])).join(",")
        )
      ];

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}_${timestamp}.csv"`);
      res.send(csvRows.join("\n"));
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  // ============ CUSTOM INSURERS ============
  const BUILTIN_INSURERS = ["Aviva", "Axa", "Bupa", "Bupa Global", "Cigna", "Other", "Vitality", "WPA"];

  app.get("/api/insurers", requireAuth, async (req, res) => {
    try {
      const custom = await storage.getCustomInsurers(req.tenant?.id);
      const customNames = custom.map(c => c.name).filter(n => !BUILTIN_INSURERS.includes(n));
      res.json([...BUILTIN_INSURERS, ...customNames]);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch insurers" });
    }
  });

  app.post("/api/insurers", requireAdmin, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Insurer name is required" });
      }
      const trimmed = name.trim();
      const normalised = trimmed.toLowerCase();
      if (BUILTIN_INSURERS.some(i => i.toLowerCase() === normalised)) {
        return res.status(409).json({ error: "This insurer already exists" });
      }
      const existing = await storage.getCustomInsurers(req.tenant?.id);
      if (existing.some(c => c.name.toLowerCase() === normalised)) {
        return res.status(409).json({ error: "This insurer already exists" });
      }
      const insurer = await storage.addCustomInsurer(trimmed, req.tenant?.id);
      res.json(insurer);
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505") {
        return res.status(409).json({ error: "This insurer already exists" });
      }
      res.status(500).json({ error: "Failed to add insurer" });
    }
  });

  // ============ NON-ENGAGEMENT CATEGORIES ============
  app.get("/api/non-engagement-categories", requireAdmin, async (req, res) => {
    try {
      const categories = await storage.getAllNonEngagementCategories(req.tenant?.id);
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/non-engagement-categories", requireAdmin, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Category name is required" });
      }
      const category = await storage.createNonEngagementCategory({ name: name.trim() }, req.tenant?.id);
      res.json(category);
    } catch (error: any) {
      if (error?.constraint || error?.code === "23505") {
        return res.status(409).json({ error: "This category already exists" });
      }
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  app.delete("/api/non-engagement-categories/:id", requireAdmin, async (req, res) => {
    try {
      const deleted = await storage.deleteNonEngagementCategory(req.params.id, req.tenant?.id);
      if (!deleted) {
        return res.status(404).json({ error: "Category not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  // Backfill: re-parse all existing intake message bodies for this tenant
  app.post("/api/intake-messages/backfill-parse", requireAdmin, async (req, res) => {
    try {
      if (!req.tenant?.gmailIntakeEnabled) {
        return res.status(403).json({ error: "Gmail Intake is not enabled for this tenant" });
      }
      const rows = await db
        .select()
        .from(intakeMessages)
        .where(eq(intakeMessages.tenantId, req.tenant.id));

      let updated = 0;
      for (const row of rows) {
        const parsed = parseIntakeEmailBody(row.body);
        await db
          .update(intakeMessages)
          .set({
            extractedData: parsed.fields,
            extractedName: parsed.name ?? row.extractedName,
            extractedPhone: parsed.phone ?? row.extractedPhone,
          })
          .where(eq(intakeMessages.id, row.id));
        updated++;
      }
      res.json({ success: true, updated });
    } catch (error) {
      res.status(500).json({ error: "Backfill failed" });
    }
  });

  // ============ TENANT INFO ============
  app.get("/api/tenant", requireAuth, async (req, res) => {
    try {
      if (!req.tenant) return res.status(403).json({ error: "No tenant" });
      res.json(req.tenant);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tenant" });
    }
  });

  // Public endpoint — returns only branding fields, no auth required.
  // Pass ?clientId=<id> to resolve the tenant from a specific client record.
  app.get("/api/tenant/branding", async (req, res) => {
    try {
      let tenantId: string | undefined;

      const clientId = req.query.clientId as string | undefined;
      if (clientId) {
        const [row] = await db
          .select({ tenantId: clients.tenantId })
          .from(clients)
          .where(eq(clients.id, clientId))
          .limit(1);
        tenantId = row?.tenantId ?? undefined;
      }

      if (!tenantId) {
        // No client (or a client with no resolvable tenant) was specified — never fall back to
        // "the first tenant" here, as that would leak one practice's branding into a context
        // that isn't scoped to any tenant at all.
        return res.status(404).json({ error: "No tenant configured" });
      }

      const [tenant] = await db.select({
        name: tenants.name,
        logoUrl: tenants.logoUrl,
        primaryColor: tenants.primaryColor,
        accentColor: tenants.accentColor,
      }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

      if (!tenant) return res.status(404).json({ error: "No tenant configured" });
      res.json(tenant);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tenant branding" });
    }
  });

  // ============ GMAIL CONNECTIONS ============

  // Debug: return what redirect URI would be used (helps confirm Google Cloud setup)
  app.get("/api/auth/gmail/debug-redirect-uri", requireAdmin, (req, res) => {
    res.json({ redirectUri: buildRedirectUri(req) });
  });

  // Debug: return the full OAuth URL without redirecting so it can be inspected
  app.get("/api/auth/gmail/debug-oauth-url", requireAdmin, (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({ error: "Google OAuth not configured" });
    }
    const redirectUri = buildRedirectUri(req);
    const state = Buffer.from(JSON.stringify({ tenantId: req.tenant?.id, userId: (req.user as any)?.id, redirectUri })).toString("base64url");
    const url = getAuthUrl(state, redirectUri);
    res.json({ redirectUri, clientId: process.env.GOOGLE_CLIENT_ID, url });
  });

  // Start OAuth flow — redirect user to Google consent
  app.get("/api/auth/gmail/connect", requireAdmin, (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({ error: "Google OAuth is not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)" });
    }
    const redirectUri = buildRedirectUri(req);
    const state = Buffer.from(JSON.stringify({ tenantId: req.tenant?.id, userId: (req.user as any)?.id, redirectUri })).toString("base64url");
    const url = getAuthUrl(state, redirectUri);
    console.log("[gmail oauth] redirect_uri:", redirectUri);
    console.log("[gmail oauth] full url:", url);
    res.redirect(url);
  });

  // OAuth callback — exchange code, store tokens, kick off first sync
  app.get("/api/auth/gmail/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error || !code || !state) {
      return res.redirect("/settings?tab=gmail&error=oauth_denied");
    }
    try {
      const { tenantId, redirectUri } = JSON.parse(Buffer.from(state, "base64url").toString());
      const tokens = await exchangeCodeForTokens(code, redirectUri);
      if (!tokens.access_token || !tokens.refresh_token) {
        return res.redirect("/settings?tab=gmail&error=no_tokens");
      }

      // Fetch the Gmail address for this account
      const { google: _g } = await import("googleapis");
      const auth = new (await import("googleapis")).google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri,
      );
      auth.setCredentials(tokens);
      const gmail = _g.gmail({ version: "v1", auth });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const gmailAddress = profile.data.emailAddress!;

      // Upsert connection (same address replaces old tokens)
      const existing = await db
        .select()
        .from(gmailConnections)
        .where(and(eq(gmailConnections.tenantId, tenantId), eq(gmailConnections.gmailAddress, gmailAddress)));

      let conn: typeof gmailConnections.$inferSelect;
      if (existing.length > 0) {
        const [updated] = await db
          .update(gmailConnections)
          .set({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            historyId: null,
            isActive: true,
          })
          .where(eq(gmailConnections.id, existing[0].id))
          .returning();
        conn = updated;
      } else {
        const [inserted] = await db
          .insert(gmailConnections)
          .values({
            tenantId,
            gmailAddress,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          } as any)
          .returning();
        conn = inserted;
      }

      // Kick off first sync in background
      syncConnection(conn).catch(() => {});

      res.redirect("/settings?tab=gmail&connected=" + encodeURIComponent(gmailAddress));
    } catch (err) {
      console.error("[gmail oauth callback]", err);
      res.redirect("/settings?tab=gmail&error=oauth_failed");
    }
  });

  // List connections for this tenant
  app.get("/api/gmail-connections", requireAdmin, async (req, res) => {
    try {
      const rows = await db
        .select({
          id: gmailConnections.id,
          gmailAddress: gmailConnections.gmailAddress,
          label: gmailConnections.label,
          isActive: gmailConnections.isActive,
          lastSyncAt: gmailConnections.lastSyncAt,
          createdAt: gmailConnections.createdAt,
        })
        .from(gmailConnections)
        .where(eq(gmailConnections.tenantId, req.tenant!.id));
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch Gmail connections" });
    }
  });

  // Update label for a connection
  app.patch("/api/gmail-connections/:id", requireAdmin, async (req, res) => {
    try {
      const { label } = req.body;
      const [row] = await db
        .update(gmailConnections)
        .set({ label })
        .where(and(eq(gmailConnections.id, req.params.id), eq(gmailConnections.tenantId, req.tenant!.id)))
        .returning();
      if (!row) return res.status(404).json({ error: "Connection not found" });
      res.json(row);
    } catch {
      res.status(500).json({ error: "Failed to update connection" });
    }
  });

  // Disconnect (delete) a Gmail connection
  app.delete("/api/gmail-connections/:id", requireAdmin, async (req, res) => {
    try {
      const rows = await db
        .delete(gmailConnections)
        .where(and(eq(gmailConnections.id, req.params.id), eq(gmailConnections.tenantId, req.tenant!.id)))
        .returning();
      if (rows.length === 0) return res.status(404).json({ error: "Connection not found" });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  // Manual sync trigger for a single connection
  app.post("/api/gmail-connections/:id/sync", requireAdmin, async (req, res) => {
    try {
      const [conn] = await db
        .select()
        .from(gmailConnections)
        .where(and(eq(gmailConnections.id, req.params.id), eq(gmailConnections.tenantId, req.tenant!.id)));
      if (!conn) return res.status(404).json({ error: "Connection not found" });
      const count = await syncConnection(conn);
      res.json({ success: true, newMessages: count });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Sync failed" });
    }
  });

  // Re-sweep: reset historyId so the next sync does a full 30-day sweep instead
  // of starting from the stored incremental checkpoint. Used to backfill emails
  // that were previously missed (e.g. due to over-aggressive category filters).
  app.post("/api/gmail-connections/:id/resweep", requireAdmin, async (req, res) => {
    try {
      const [conn] = await db
        .select()
        .from(gmailConnections)
        .where(and(eq(gmailConnections.id, req.params.id), eq(gmailConnections.tenantId, req.tenant!.id)));
      if (!conn) return res.status(404).json({ error: "Connection not found" });
      // Clear historyId so syncConnection falls through to a full sweep
      const connWithReset = { ...conn, historyId: null };
      const count = await syncConnection(connWithReset);
      res.json({ success: true, newMessages: count });
    } catch (err: any) {
      const msg: string = err?.message || "";
      if (msg.includes("invalid_grant") || msg.includes("Token has been expired")) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      res.status(500).json({ error: msg || "Re-sweep failed" });
    }
  });

  // ============ INTAKE MESSAGES ============
  app.post("/api/intake-messages", requireAdmin, async (req, res) => {
    try {
      if (!req.tenant?.gmailIntakeEnabled) {
        return res.status(403).json({ error: "Gmail Intake is not enabled for this tenant" });
      }
      const { channel, threadId, fromAddress, subject, body } = req.body;
      if (!channel || !fromAddress || !subject || !body) {
        return res.status(400).json({ error: "channel, fromAddress, subject and body are required" });
      }
      const parsed = parseIntakeEmailBody(body);
      const [message] = await db.insert(intakeMessages).values({
        tenantId: req.tenant.id,
        channel,
        threadId: threadId ?? null,
        fromAddress,
        subject,
        body,
        extractedName: parsed.name,
        extractedPhone: parsed.phone,
        extractedData: parsed.fields,
        status: "new",
      } as any).returning();
      res.json(message);
    } catch (error) {
      res.status(500).json({ error: "Failed to create intake message" });
    }
  });

  app.get("/api/intake-messages", requireAdmin, async (req, res) => {
    try {
      if (!req.tenant?.gmailIntakeEnabled) {
        return res.json([]);
      }
      const messages = await db
        .select()
        .from(intakeMessages)
        .where(eq(intakeMessages.tenantId, req.tenant.id))
        .orderBy(desc(intakeMessages.receivedAt));
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch intake messages" });
    }
  });

  app.post("/api/intake-messages/:id/convert-to-client", requireAdmin, async (req, res) => {
    try {
      if (!req.tenant?.gmailIntakeEnabled) {
        return res.status(403).json({ error: "Gmail Intake is not enabled for this tenant" });
      }
      const [message] = await db
        .select()
        .from(intakeMessages)
        .where(and(eq(intakeMessages.id, req.params.id), eq(intakeMessages.tenantId, req.tenant.id)))
        .limit(1);
      if (!message) {
        return res.status(404).json({ error: "Intake message not found" });
      }
      if (message.status !== "new") {
        return res.status(400).json({ error: "Message has already been processed" });
      }

      const suffix = Math.random().toString(36).toUpperCase().slice(2, 8);
      const displayId = `PENDING-${suffix}`;
      // Always re-parse from the raw body so we use the latest parser logic
      const reparsed = parseIntakeEmailBody(message.body || "");
      const parsed: Record<string, string> | null =
        reparsed.fields && Object.keys(reparsed.fields).length >= 2
          ? reparsed.fields
          : (message.extractedData as Record<string, string> | null);

      // Helper: search extractedData by partial label match
      const pick = (...keys: string[]): string | undefined => {
        if (!parsed) return undefined;
        for (const key of keys) {
          const found = Object.entries(parsed).find(([k]) => k.toLowerCase().includes(key.toLowerCase()));
          if (found?.[1]?.trim()) return found[1].trim();
        }
        return undefined;
      };

      // Email — only use the extracted field if it differs from the sender's address.
      // When they're the same the form was filled in by a referrer (not the client),
      // so we generate a unique placeholder to avoid duplicate-email conflicts.
      const extractedEmail = pick("email");
      const isReferrerEmail = !extractedEmail || extractedEmail.toLowerCase() === message.fromAddress.toLowerCase();
      const clientEmail = isReferrerEmail
        ? `intake-${displayId.toLowerCase()}@noemail.placeholder`
        : extractedEmail;

      // Phone
      const clientPhone = message.extractedPhone || pick("phone", "mobile", "telephone", "contact number") || "";

      // Name — look for dedicated first/last fields, then fall back to full name
      const rawFirstName = pick("first name", "forename", "given name");
      const rawLastName = pick("last name", "surname", "family name");
      const rawFullName = message.extractedName || pick("full name", "your name", "name");
      let firstName: string | undefined;
      let lastName: string | undefined;
      if (rawFirstName || rawLastName) {
        firstName = rawFirstName;
        lastName = rawLastName;
      } else if (rawFullName) {
        const parts = rawFullName.trim().split(/\s+/);
        firstName = parts[0];
        lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
      }

      // Other mapped fields
      const referralSource = pick("referral source", "referred by", "how did you hear", "how did you find", "source");
      const presentingRaw = pick("presenting issue", "presenting concern", "reason for referral", "reason for contact", "what brings", "difficulty", "concern");
      const insurerRaw = pick("insurer", "insurance company", "insurance provider", "health insurer", "private health");
      const dobRaw = pick("date of birth", "dob", "d.o.b", "birth date");

      // Build a concise summary in notes — full structured data is accessible via the linked intake message
      const notesLines: string[] = [];
      if (isReferrerEmail && message.fromAddress) {
        notesLines.push(`Referred by: ${message.fromAddress}`);
      }
      const nameForNote = rawFullName || [firstName, lastName].filter(Boolean).join(" ");
      if (nameForNote) notesLines.push(`Client name: ${nameForNote}`);
      if (dobRaw) notesLines.push(`Date of birth: ${dobRaw}`);
      // Fall back to raw body only when parser produced no structured fields at all
      if (notesLines.length === 0 && !parsed && message.body) {
        notesLines.push("--- Original enquiry (unparsed) ---");
        notesLines.push(message.body.slice(0, 2000));
      }
      const notes = notesLines.join("\n").slice(0, 4000) || undefined;

      const [newClient] = await db.insert(clients).values({
        displayId,
        email: clientEmail,
        phone: clientPhone || null,
        referralSource: "Online Intake Form",
        presentingIssues: presentingRaw ? [presentingRaw] : [],
        insurer: insurerRaw ?? null,
        status: "New",
        tenantId: req.tenant.id,
        notes: notes ?? null,
      }).returning();

      await db
        .update(intakeMessages)
        .set({ status: "linked", linkedClientId: newClient.id })
        .where(eq(intakeMessages.id, message.id));
      res.json({ success: true, client: newClient });
    } catch (error: any) {
      console.error("[convert-to-client] error:", error?.code, error?.message, error);
      // Drizzle wraps the underlying postgres error — the code may be on error.cause
      // rather than the top-level error object, so check both and fall back to the
      // message string (which Drizzle includes verbatim from postgres).
      const pgCode = error?.code ?? error?.cause?.code;
      const errMsg: string = error?.message ?? error?.cause?.message ?? "";
      const isDuplicate = pgCode === "23505" || errMsg.includes("23505") || errMsg.includes("unique") || errMsg.includes("duplicate");
      if (isDuplicate) {
        const onEmail = errMsg.includes("email") || errMsg.includes("clients_email");
        return res.status(409).json({
          error: onEmail
            ? "A client with this email address already exists. If this is the same person, locate their existing record and manually link the intake message."
            : "A client with these details already exists.",
        });
      }
      res.status(500).json({ error: "Failed to convert intake message to client" });
    }
  });

  // Get the original intake message linked to a client (if any)
  app.get("/api/clients/:id/intake-message", requireAdmin, async (req, res) => {
    try {
      const client = await storage.getClientById(req.params.id);
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (client.tenantId !== req.tenant?.id) return res.status(403).json({ error: "Access denied" });
      const [message] = await db
        .select()
        .from(intakeMessages)
        .where(and(eq(intakeMessages.linkedClientId, req.params.id), eq(intakeMessages.tenantId, req.tenant.id)))
        .limit(1);
      if (!message) return res.status(404).json({ error: "No linked intake message" });

      // Always re-parse the body — the new parser handles forwarded emails and
      // asterisk-tab format that the original parser may have misread as preamble text.
      if (message.body) {
        const reparsed = parseIntakeEmailBody(message.body);
        if (Object.keys(reparsed.fields).length >= 2) {
          return res.json({ ...message, extractedData: reparsed.fields });
        }
      }

      res.json(message);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch intake message" });
    }
  });

  // Manual Gmail sync trigger (admin only)
  app.post("/api/gmail/sync", requireAdmin, async (req, res) => {
    try {
      await syncAllActiveConnections();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to sync" });
    }
  });

  app.post("/api/intake-messages/:id/ignore", requireAdmin, async (req, res) => {
    try {
      if (!req.tenant?.gmailIntakeEnabled) {
        return res.status(403).json({ error: "Gmail Intake is not enabled for this tenant" });
      }
      const [message] = await db
        .select()
        .from(intakeMessages)
        .where(and(eq(intakeMessages.id, req.params.id), eq(intakeMessages.tenantId, req.tenant.id)))
        .limit(1);
      if (!message) return res.status(404).json({ error: "Intake message not found" });
      await db
        .update(intakeMessages)
        .set({ status: "ignored" })
        .where(eq(intakeMessages.id, message.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to ignore intake message" });
    }
  });

  app.post("/api/intake-messages/:id/unignore", requireAdmin, async (req, res) => {
    try {
      if (!req.tenant?.gmailIntakeEnabled) {
        return res.status(403).json({ error: "Gmail Intake is not enabled for this tenant" });
      }
      const [message] = await db
        .select()
        .from(intakeMessages)
        .where(and(eq(intakeMessages.id, req.params.id), eq(intakeMessages.tenantId, req.tenant.id)))
        .limit(1);
      if (!message) return res.status(404).json({ error: "Intake message not found" });
      await db
        .update(intakeMessages)
        .set({ status: "new" })
        .where(eq(intakeMessages.id, message.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to unignore intake message" });
    }
  });

  app.post("/api/intake-messages/bulk-ignore", requireAdmin, async (req, res) => {
    try {
      if (!req.tenant?.gmailIntakeEnabled) {
        return res.status(403).json({ error: "Gmail Intake is not enabled for this tenant" });
      }
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      await db
        .update(intakeMessages)
        .set({ status: "ignored" })
        .where(and(eq(intakeMessages.tenantId, req.tenant.id), inArray(intakeMessages.id, ids)));
      res.json({ success: true, count: ids.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to bulk ignore intake messages" });
    }
  });

  // ============ STRIPE / PAYMENTS ============

  // Check if Stripe is configured
  app.get("/api/stripe/status", requireAuth, async (req, res) => {
    const tenantKey = req.tenant?.stripeSecretKey;
    res.json({
      configured: isStripeConfigured(tenantKey),
      webhookConfigured: !!req.tenant?.stripeWebhookSecret,
      encryptionReady: isEncryptionConfigured(),
    });
  });

  // Save Stripe keys for tenant (keys are encrypted at rest via STRIPE_ENCRYPTION_KEY)
  app.post("/api/settings/stripe", requireAdmin, async (req, res) => {
    try {
      const { stripeSecretKey, stripeWebhookSecret } = req.body as {
        stripeSecretKey?: string;
        stripeWebhookSecret?: string;
      };
      if (!req.tenant) return res.status(400).json({ error: "Tenant not found" });
      if (!isEncryptionConfigured()) {
        return res.status(503).json({
          error: "STRIPE_ENCRYPTION_KEY environment variable is not configured. " +
                 "Set it to a 32-byte base64-encoded value before storing Stripe credentials.",
        });
      }
      const updates: Record<string, string | null> = {};
      if (stripeSecretKey !== undefined) {
        updates.stripeSecretKey = stripeSecretKey ? encryptSecret(stripeSecretKey) : null;
      }
      if (stripeWebhookSecret !== undefined) {
        updates.stripeWebhookSecret = stripeWebhookSecret ? encryptSecret(stripeWebhookSecret) : null;
      }

      // Enforce: a webhook secret must be stored before (or alongside) a secret key
      const willHaveSecretKey = "stripeSecretKey" in updates
        ? !!updates.stripeSecretKey
        : !!req.tenant.stripeSecretKey;
      const willHaveWebhookSecret = "stripeWebhookSecret" in updates
        ? !!updates.stripeWebhookSecret
        : !!req.tenant.stripeWebhookSecret;

      if (willHaveSecretKey && !willHaveWebhookSecret) {
        return res.status(400).json({
          error: "A webhook signing secret is required alongside the Stripe secret key. " +
                 "Create a webhook endpoint in your Stripe Dashboard and paste the signing secret here.",
        });
      }

      await db.update(tenants).set(updates).where(eq(tenants.id, req.tenant.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save Stripe settings" });
    }
  });

  // Create a Checkout session for a client (sends payment link to their email)
  app.post("/api/stripe/checkout", requireAdmin, async (req, res) => {
    try {
      if (!isStripeConfigured(req.tenant?.stripeSecretKey)) {
        return res.status(400).json({ error: "Stripe is not configured" });
      }
      const { clientId } = req.body as { clientId: string };
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      const client = await storage.getClientById(clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (req.tenant?.id && client.tenantId !== req.tenant.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (!client.email) return res.status(400).json({ error: "Client has no email address" });

      let amountPence = client.agreedRatePence ?? 0;
      if (amountPence <= 0 && client.assignedClinicianId) {
        const assignedClinician = await storage.getClinicianById(client.assignedClinicianId);
        if (assignedClinician?.sessionRatePence && assignedClinician.sessionRatePence > 0) {
          amountPence = assignedClinician.sessionRatePence;
          await db.update(clients).set({ agreedRatePence: amountPence, updatedAt: new Date() })
            .where(eq(clients.id, clientId));
        }
      }
      if (amountPence <= 0) {
        return res.status(400).json({ error: "No rate found. Set a session rate on the client or their assigned clinician first." });
      }

      const appBase = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const result = await createCheckoutSession({
        clientId: client.id,
        clientEmail: client.email,
        clientDisplayId: client.displayId,
        clientName: [client.firstName, client.lastName].filter(Boolean).join(" ") || null,
        amountPence,
        successUrl: `${appBase}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${appBase}/payment-cancel`,
        tenantId: req.tenant?.id,
        tenantStripeKey: req.tenant?.stripeSecretKey,
        practiceName: req.tenant?.name,
      });

      if (!result) return res.status(500).json({ error: "Failed to create checkout session" });

      // Store customer ID and checkout URL on client; mark as setup_pending
      await db.update(clients).set({
        stripeCustomerId: result.customerId,
        stripeCheckoutUrl: result.url,
        paymentStatus: "setup_pending",
        updatedAt: new Date(),
      }).where(eq(clients.id, clientId));

      // Email the payment link to the client
      let emailSent = false;
      try {
        const amountPounds = (amountPence / 100).toFixed(2);
        const tcPL = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail, primaryColor: req.tenant.primaryColor } : undefined;
        const emailOptions = await generatePaymentLinkEmail(result.url, amountPounds, tcPL);
        const emailResult = await sendEmail({ ...emailOptions, to: client.email });
        emailSent = emailResult.success;
      } catch (emailError) {
        console.error("Failed to send payment link email:", emailError);
      }

      res.json({ url: result.url, customerId: result.customerId, emailSent });
    } catch (error: any) {
      console.error("Stripe checkout error:", error?.message);
      res.status(500).json({ error: error?.message || "Failed to create checkout session" });
    }
  });

  // Stripe webhook — called by Stripe to confirm payment & card save
  // Note: /api/stripe/webhook is exempted from requireTenant middleware (unauthenticated, called by Stripe)
  app.post("/api/stripe/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    const rawBody = (req as any).rawBody as Buffer;

    if (!sig || !rawBody) {
      return res.status(400).json({ error: "Missing stripe-signature header or raw body" });
    }

    // Step 1: Identify the tenant by trying each configured tenant's webhook secret
    // against the signature, rather than trusting event metadata for tenant lookup.
    // This is necessary because many Stripe event types (customer.*, invoice.*,
    // payment_method.*, etc.) never carry the tenantId metadata we only set on the
    // checkout sessions / payment intents we create ourselves — relying on metadata
    // to pick a tenant before verifying meant those events always failed with a
    // generic "webhook secret not configured" error even when the tenant genuinely
    // had one configured. Only a tenant's real secret can produce a valid signature,
    // so trying each is both correct and safe.
    const isDev = process.env.NODE_ENV !== "production";
    let event: any = null;
    let metaTenantId: string | null = null;
    let tenantStripeKey: string | null = null;

    try {
      const candidateTenants = await db.select().from(tenants).where(isNotNull(tenants.stripeWebhookSecret));
      for (const t of candidateTenants) {
        let secret: string;
        try {
          secret = decryptSecret(t.stripeWebhookSecret!);
        } catch (e) {
          console.error("Webhook: failed to decrypt webhook secret for tenant", t.id, e);
          continue;
        }
        let key: string | null = null;
        if (t.stripeSecretKey) {
          try { key = decryptSecret(t.stripeSecretKey); } catch { /* key only needed to call Stripe API, not for verification */ }
        }
        try {
          event = constructWebhookEvent(rawBody, sig, secret, key);
          metaTenantId = t.id;
          tenantStripeKey = key;
          break;
        } catch {
          // Signature didn't match this tenant's secret — try the next one
        }
      }
    } catch (e) {
      console.error("Webhook: failed to look up tenants:", e);
    }

    // Dev-only escape hatch for local testing with the Stripe CLI when no tenant
    // secret matches (e.g. no tenant has real keys set up yet in dev).
    if (!event && isDev && process.env.STRIPE_WEBHOOK_SECRET) {
      try {
        event = constructWebhookEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_SECRET_KEY || null);
        tenantStripeKey = process.env.STRIPE_SECRET_KEY || null;
        console.warn("[DEV ONLY] Verified webhook using global STRIPE_WEBHOOK_SECRET fallback (no tenant secret matched).");
      } catch {
        // fall through to the error below
      }
    }

    if (!event) {
      console.error("Webhook signature verification failed: no tenant secret matched");
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    // Step 4: Process the event
    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const clientId = session.metadata?.clientId;
        if (!clientId) return res.json({ received: true });

        // Idempotency: skip if we've already processed a succeeded charge for this session
        const existingCharge = session.payment_intent
          ? await db.select().from(paymentCharges)
              .where(eq(paymentCharges.stripePaymentIntentId, session.payment_intent))
              .then(rows => rows[0])
          : null;

        if (!existingCharge) {
          // Validate tenant ownership before any mutation
          const clientForUpdate = await storage.getClientById(clientId);
          if (!clientForUpdate) return res.json({ received: true });
          if (clientForUpdate.tenantId !== metaTenantId) {
            console.error(`Webhook: tenant mismatch for client ${clientId}`);
            return res.json({ received: true });
          }

          const client = clientForUpdate;
          const paymentIntentId = session.payment_intent;

          // Persist paymentStatus = active; opportunistically save payment method if retrievable
          const clientUpdate: Record<string, unknown> = { paymentStatus: "active", updatedAt: new Date() };
          if (paymentIntentId) {
            try {
              const stripeInstance = getStripeInstance(tenantStripeKey);
              if (stripeInstance) {
                const pi = await stripeInstance.paymentIntents.retrieve(paymentIntentId);
                const paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
                if (paymentMethodId) clientUpdate.stripePaymentMethodId = paymentMethodId;
              }
            } catch (pmErr) {
              console.error("Webhook: failed to retrieve payment method:", pmErr);
            }
          }
          await db.update(clients).set(clientUpdate as any).where(eq(clients.id, clientId));

          // Record the initial charge (idempotent — existingCharge was null above)
          if (paymentIntentId) {
            await storage.createPaymentCharge({
              clientId,
              amountPence: session.amount_total,
              stripePaymentIntentId: paymentIntentId,
              status: "succeeded",
              notes: "Initial session payment via Checkout",
              tenantId: client.tenantId,
            });
          }

          // CY&A: advance to BookingConfirmed when client came through the CY&A registration flow
          const paymentTenant = client.tenantId ? await storage.getTenantById(client.tenantId).catch(() => undefined) : undefined;
          if (client.status === "RegistrationPending") {
            await db.update(clients).set({
              status: "BookingConfirmed",
              updatedAt: new Date(),
            }).where(eq(clients.id, clientId));

            // Send booking confirmed email if the tenant flag is on
            if (paymentTenant?.bookingConfirmedEmailEnabled && client.email) {
              try {
                const confirmedClinician = client.assignedClinicianId
                  ? await db.select().from(clinicians).where(eq(clinicians.id, client.assignedClinicianId)).limit(1).then(r => r[0])
                  : undefined;
                const clinicianUser = confirmedClinician?.userId
                  ? await db.select({ name: users.name }).from(users).where(eq(users.id, confirmedClinician.userId)).limit(1).then(r => r[0])
                  : undefined;
                const slotRow = client.assignedSlotId
                  ? await db.select().from(timeSlots).where(eq(timeSlots.id, client.assignedSlotId)).limit(1).then(r => r[0])
                  : undefined;
                const tcBook = paymentTenant ? { id: paymentTenant.id, name: paymentTenant.name, fromEmail: paymentTenant.fromEmail, primaryColor: paymentTenant.primaryColor } : undefined;
                const bookEmail = await generateBookingConfirmedEmail({
                  clinicianName: clinicianUser?.name || 'Your Clinician',
                  day: slotRow?.day || null,
                  startTime: slotRow?.startTime || '',
                  endTime: slotRow?.endTime || '',
                  zoomLink: confirmedClinician?.zoomLink || null,
                }, tcBook);
                await sendEmail({ ...bookEmail, to: client.email });
                console.log(`Booking confirmed email sent to client ${clientId}`);
              } catch (bookEmailErr) {
                console.error('Failed to send booking confirmed email (Stripe webhook):', bookEmailErr);
              }
            }
          }
        }
      }

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as any;
        const [charge] = await db.select().from(paymentCharges)
          .where(eq(paymentCharges.stripePaymentIntentId, pi.id));
        if (charge && charge.status === "pending") {
          await storage.updatePaymentCharge(charge.id, { status: "succeeded" });
        }
      }

      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as any;
        const failureReason: string = pi.last_payment_error?.message || "Unknown reason";
        const [charge] = await db.select().from(paymentCharges)
          .where(eq(paymentCharges.stripePaymentIntentId, pi.id));

        if (charge) {
          // Only transition to failed if not already in a terminal state (idempotent on retries)
          const alreadyFailed = charge.status === "failed";
          if (!alreadyFailed) {
            await storage.updatePaymentCharge(charge.id, { status: "failed", failureReason });
          }

          // Notify admins — scoped to the client's tenant to prevent cross-tenant disclosure.
          // Only send on first transition to avoid duplicate emails on webhook retries.
          if (!alreadyFailed) {
            try {
              const client = await storage.getClientById(charge.clientId);
              if (client) {
                const adminUsers = await storage.getAdminUsersByTenantId(client.tenantId);
                if (adminUsers.length > 0) {
                  const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Unknown';
                  const amountPounds = charge.amountPence ? (charge.amountPence / 100).toFixed(2) : '0.00';
                  const failTenant = await storage.getTenantById(client.tenantId).catch(() => null);
                  const tcFail = failTenant ? { id: failTenant.id, name: failTenant.name, fromEmail: failTenant.fromEmail, primaryColor: failTenant.primaryColor } : undefined;
                  const emailOptions = generatePaymentFailureEmail(client.displayId, clientName, amountPounds, failureReason, tcFail);
                  for (const admin of adminUsers) {
                    await sendEmail({ ...emailOptions, to: admin.email });
                  }
                }
              }
            } catch (notifyErr) {
              console.error("Webhook: failed to send payment failure notifications:", notifyErr);
            }
          }
        } else {
          // No charge record exists (e.g. PI was created outside our charge flow or DB missed it).
          // Try to identify the client from PI metadata and notify admins scoped to that tenant.
          const clientId: string | undefined = pi.metadata?.clientId;
          const piTenantId: string | undefined = pi.metadata?.tenantId ?? metaTenantId ?? undefined;
          if (clientId && piTenantId) {
            try {
              const client = await storage.getClientById(clientId);
              // Verify the client belongs to the tenant in the event metadata
              if (client && client.tenantId === piTenantId) {
                const adminUsers = await storage.getAdminUsersByTenantId(piTenantId);
                if (adminUsers.length > 0) {
                  const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Unknown';
                  const amountPounds = pi.amount ? (pi.amount / 100).toFixed(2) : '0.00';
                  const failTenant2 = await storage.getTenantById(piTenantId).catch(() => null);
                  const tcFail2 = failTenant2 ? { id: failTenant2.id, name: failTenant2.name, fromEmail: failTenant2.fromEmail, primaryColor: failTenant2.primaryColor } : undefined;
                  const emailOptions = generatePaymentFailureEmail(client.displayId, clientName, amountPounds, failureReason, tcFail2);
                  for (const admin of adminUsers) {
                    await sendEmail({ ...emailOptions, to: admin.email });
                  }
                }
              }
            } catch (notifyErr) {
              console.error("Webhook: failed to send payment failure notifications (no charge record):", notifyErr);
            }
          }
        }
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("Webhook processing error:", error?.message);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Charge a subsequent session off-session (admin or assigned clinician)
  app.post("/api/stripe/charge", requireAuth, async (req, res) => {
    try {
      if (!isStripeConfigured(req.tenant?.stripeSecretKey)) {
        return res.status(400).json({ error: "Stripe is not configured" });
      }
      const { clientId, amountPence, notes } = req.body as {
        clientId: string;
        amountPence?: number;
        notes?: string;
      };
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      const client = await storage.getClientById(clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (req.tenant?.id && client.tenantId !== req.tenant.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Access check: admin can charge any client; clinician can only charge their assigned client
      const reqUser = req.user as any;
      if (reqUser?.role !== "admin") {
        const clinician = await storage.getClinicianByUserId(reqUser?.id);
        if (!clinician || client.assignedClinicianId !== clinician.id) {
          return res.status(403).json({ error: "You can only charge sessions for your own clients" });
        }
      }
      if (!client.stripeCustomerId || !client.stripePaymentMethodId) {
        return res.status(400).json({ error: "Client does not have a saved payment method. They must complete the initial checkout first." });
      }

      const amount = amountPence ?? client.agreedRatePence ?? 0;
      if (amount <= 0) return res.status(400).json({ error: "Invalid amount" });

      // Create a pending charge record first
      const charge = await storage.createPaymentCharge({
        clientId,
        amountPence: amount,
        status: "pending",
        notes: notes || null,
        chargedByUserId: (req.user as any)?.id,
        tenantId: client.tenantId,
      });

      try {
        const result = await chargeOffSession({
          customerId: client.stripeCustomerId,
          paymentMethodId: client.stripePaymentMethodId,
          amountPence: amount,
          clientDisplayId: client.displayId,
          clientId: client.id,
          tenantId: req.tenant?.id,
          tenantStripeKey: req.tenant?.stripeSecretKey,
        });

        await storage.updatePaymentCharge(charge.id, {
          stripePaymentIntentId: result.paymentIntentId,
          status: result.status === "succeeded" ? "succeeded" : "pending",
        });

        res.json({ success: true, chargeId: charge.id, status: result.status });
      } catch (stripeError: any) {
        await storage.updatePaymentCharge(charge.id, { status: "failed", failureReason: stripeError?.message || "Unknown reason" });
        res.status(402).json({ error: stripeError?.message || "Payment failed" });
      }
    } catch (error: any) {
      console.error("Charge error:", error?.message);
      res.status(500).json({ error: error?.message || "Failed to charge session" });
    }
  });

  // Get payment history for a client (admin or assigned clinician)
  app.get("/api/stripe/charges/:clientId", requireAuth, async (req, res) => {
    try {
      const reqUser = req.user as any;
      const client = await storage.getClientById(req.params.clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });
      if (req.tenant?.id && client.tenantId !== req.tenant.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      // Access check: admin sees all, clinician sees only their assigned client
      if (reqUser?.role !== "admin") {
        const clinician = await storage.getClinicianByUserId(reqUser?.id);
        if (!clinician || client.assignedClinicianId !== clinician.id) {
          return res.status(403).json({ error: "Access denied" });
        }
      }
      const charges = await storage.getPaymentChargesByClientId(req.params.clientId);
      res.json(charges);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch charges" });
    }
  });

  // Get all payment charges across all clients (admin only)
  app.get("/api/stripe/charges", requireAdmin, async (req, res) => {
    try {
      const charges = await storage.getAllPaymentCharges(req.tenant?.id);
      res.json(charges);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch charges" });
    }
  });

  // Update agreed rate for a client
  app.patch("/api/clients/:id/agreed-rate", requireAdmin, async (req, res) => {
    try {
      const { agreedRatePence } = req.body as { agreedRatePence: number };
      if (typeof agreedRatePence !== "number") {
        return res.status(400).json({ error: "agreedRatePence must be a number" });
      }
      const tenantId = req.tenant?.id;
      const whereClause = tenantId
        ? and(eq(clients.id, req.params.id), eq(clients.tenantId, tenantId))
        : eq(clients.id, req.params.id);
      const [updated] = await db.update(clients)
        .set({ agreedRatePence, updatedAt: new Date() })
        .where(whereClause)
        .returning();
      if (!updated) return res.status(404).json({ error: "Client not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update rate" });
    }
  });

  // ============ SUPER-ADMIN ROUTES ============
  // All routes below are gated by requireSuperAdmin (x-super-admin-key header).
  // They bypass tenant middleware via the open-path check in middleware/tenant.ts.

  // Verify the key is valid (used by the frontend on first load)
  app.get("/api/super-admin/verify", requireSuperAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  // List all tenants with status summary
  app.get("/api/super-admin/tenants", requireSuperAdmin, async (_req, res) => {
    try {
      const allTenants = await db.select().from(tenants).orderBy(tenants.createdAt);

      // For each tenant, check gmail connection status
      const tenantIds = allTenants.map(t => t.id);
      const gmailRows = tenantIds.length
        ? await db.select({ tenantId: gmailConnections.tenantId, gmailAddress: gmailConnections.gmailAddress, isActive: gmailConnections.isActive })
            .from(gmailConnections)
            .where(inArray(gmailConnections.tenantId, tenantIds))
        : [];

      const gmailByTenant = new Map<string, typeof gmailRows>();
      for (const row of gmailRows) {
        if (!gmailByTenant.has(row.tenantId)) gmailByTenant.set(row.tenantId, []);
        gmailByTenant.get(row.tenantId)!.push(row);
      }

      const result = allTenants.map(t => ({
        ...t,
        // Never expose decrypted secrets in the list view
        stripeSecretKey: t.stripeSecretKey ? "***" : null,
        stripeWebhookSecret: t.stripeWebhookSecret ? "***" : null,
        stripeConnected: !!t.stripeSecretKey,
        gmailConnections: gmailByTenant.get(t.id) || [],
      }));

      res.json(result);
    } catch (error) {
      console.error("Super-admin list tenants error:", error);
      res.status(500).json({ error: "Failed to fetch tenants" });
    }
  });

  // Get a single tenant (never return decrypted secrets)
  app.get("/api/super-admin/tenants/:id", requireSuperAdmin, async (req, res) => {
    try {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      // Select only safe status columns — never return OAuth tokens to the browser
      const gmailRows = await db.select({
        id: gmailConnections.id,
        tenantId: gmailConnections.tenantId,
        gmailAddress: gmailConnections.gmailAddress,
        label: gmailConnections.label,
        isActive: gmailConnections.isActive,
        lastSyncAt: gmailConnections.lastSyncAt,
        createdAt: gmailConnections.createdAt,
      }).from(gmailConnections).where(eq(gmailConnections.tenantId, tenant.id));

      res.json({
        ...tenant,
        stripeSecretKey: tenant.stripeSecretKey ? "***" : null,
        stripeWebhookSecret: tenant.stripeWebhookSecret ? "***" : null,
        stripeConnected: !!tenant.stripeSecretKey,
        stripeWebhookConnected: !!tenant.stripeWebhookSecret,
        gmailConnections: gmailRows,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tenant" });
    }
  });

  // Reset a user's password (super-admin only)
  app.post("/api/super-admin/users/reset-password", requireSuperAdmin, async (req, res) => {
    try {
      const { email, newPassword } = z.object({
        email: z.string().email(),
        newPassword: z.string().min(8),
      }).parse(req.body);
      const user = await storage.getUserByEmail(email.toLowerCase());
      if (!user) return res.status(404).json({ error: "User not found" });
      const hashed = await hashPassword(newPassword);
      await storage.updateUser(user.id, { password: hashed });
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to reset password" });
    }
  });

  // Reassign a user (and their linked clinician profile, if any) to a different
  // tenant. This is the ONLY supported way to move a user/clinician between
  // tenants — it is deliberate, audited, and scoped to a single account, unlike
  // the removed bulk "seed-tenant" migration.
  app.post("/api/super-admin/users/reassign-tenant", requireSuperAdmin, async (req, res) => {
    try {
      const { email, newTenantId } = z.object({
        email: z.string().email(),
        newTenantId: z.string().uuid(),
      }).parse(req.body);

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, newTenantId));
      if (!tenant) return res.status(404).json({ error: "Target tenant not found" });

      const user = await storage.getUserByEmail(email.toLowerCase());
      if (!user) return res.status(404).json({ error: "User not found" });

      const previousTenantId = user.tenantId;
      await storage.updateUser(user.id, { tenantId: newTenantId } as any);

      let clinicianUpdated = false;
      const clinician = await storage.getClinicianByUserId(user.id);
      if (clinician && clinician.tenantId !== newTenantId) {
        await db.update(clinicians).set({ tenantId: newTenantId }).where(eq(clinicians.id, clinician.id));
        clinicianUpdated = true;
      }

      // Force an immediate logout for this user if they have a live session —
      // the tenant lookup itself is always fresh on the server, but a browser
      // tab that already loaded data under the old tenant would otherwise keep
      // showing it (client-side query cache is only cleared on login/logout).
      const destroyedSessions = await destroySessionsForUser(user.id);

      console.log(`[super-admin] Reassigned user ${user.id} (${user.email}) from tenant ${previousTenantId} to ${newTenantId} (${tenant.name}). Clinician profile updated: ${clinicianUpdated}. Sessions terminated: ${destroyedSessions}`);

      res.json({ success: true, previousTenantId, newTenantId, tenantName: tenant.name, clinicianUpdated, sessionsTerminated: destroyedSessions });
    } catch (error) {
      console.error("Reassign tenant error:", error);
      res.status(400).json({ error: "Failed to reassign tenant" });
    }
  });

  // Bulk variant of the above — lets a super-admin fix a batch of accounts that
  // were corrupted by the same past incident (e.g. several accounts silently
  // reassigned to the wrong tenant) in one action instead of one-by-one.
  app.post("/api/super-admin/users/reassign-tenant-bulk", requireSuperAdmin, async (req, res) => {
    try {
      const { emails, newTenantId } = z.object({
        emails: z.array(z.string().email()).min(1).max(200),
        newTenantId: z.string().uuid(),
      }).parse(req.body);

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, newTenantId));
      if (!tenant) return res.status(404).json({ error: "Target tenant not found" });

      const results: { email: string; success: boolean; error?: string; previousTenantId?: string | null; clinicianUpdated?: boolean; sessionsTerminated?: number }[] = [];

      for (const rawEmail of emails) {
        const email = rawEmail.toLowerCase().trim();
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            results.push({ email, success: false, error: "User not found" });
            continue;
          }

          const previousTenantId = user.tenantId;
          await storage.updateUser(user.id, { tenantId: newTenantId } as any);

          let clinicianUpdated = false;
          const clinician = await storage.getClinicianByUserId(user.id);
          if (clinician && clinician.tenantId !== newTenantId) {
            await db.update(clinicians).set({ tenantId: newTenantId }).where(eq(clinicians.id, clinician.id));
            clinicianUpdated = true;
          }

          // Force logout of any live session so a browser that already loaded
          // data under the old (wrong) tenant can't keep showing it — see the
          // single-user reassign endpoint above for the full rationale.
          const destroyedSessions = await destroySessionsForUser(user.id);

          console.log(`[super-admin] Bulk-reassigned user ${user.id} (${user.email}) from tenant ${previousTenantId} to ${newTenantId} (${tenant.name}). Clinician profile updated: ${clinicianUpdated}. Sessions terminated: ${destroyedSessions}`);
          results.push({ email, success: true, previousTenantId, clinicianUpdated, sessionsTerminated: destroyedSessions });
        } catch (err) {
          console.error(`Bulk reassign failed for ${email}:`, err);
          results.push({ email, success: false, error: "Unexpected error" });
        }
      }

      res.json({ success: true, tenantName: tenant.name, results });
    } catch (error) {
      console.error("Bulk reassign tenant error:", error);
      res.status(400).json({ error: "Failed to bulk reassign tenant" });
    }
  });

  // One-time repair: backfills tenantId on any form_submissions row that was
  // created via the public submit/draft endpoints before those routes tagged
  // tenantId from the client record. Only ever sets tenantId derived from the
  // row's own client (a reliable, always-correct source) — never guesses.
  app.post("/api/super-admin/form-submissions/backfill-tenant-ids", requireSuperAdmin, async (req, res) => {
    try {
      const updated = await storage.backfillFormSubmissionTenantIds();
      console.log(`[super-admin] Backfilled tenantId on ${updated} form_submissions row(s) from their client's tenant`);
      res.json({ success: true, updated });
    } catch (error) {
      console.error("Backfill form submission tenant IDs error:", error);
      res.status(500).json({ error: "Failed to backfill form submission tenant IDs" });
    }
  });

  // List all form templates across all tenants, with the owning tenant's name,
  // so a super-admin can pick a source form to copy elsewhere.
  app.get("/api/super-admin/forms", requireSuperAdmin, async (_req, res) => {
    try {
      const rows = await db.select({
        id: formTemplates.id,
        title: formTemplates.title,
        description: formTemplates.description,
        createdAt: formTemplates.createdAt,
        tenantId: formTemplates.tenantId,
        tenantName: tenants.name,
      })
        .from(formTemplates)
        .leftJoin(tenants, eq(formTemplates.tenantId, tenants.id))
        .orderBy(formTemplates.title);
      res.json(rows);
    } catch (error) {
      console.error("Super-admin list forms error:", error);
      res.status(500).json({ error: "Failed to fetch forms" });
    }
  });

  // Copy a form template from one tenant to another. Always creates a brand
  // new, independently-owned row in the target tenant (never shares or
  // repoints the original) — the target tenant can then freely edit its copy
  // via the normal /api/forms routes without ever touching the source
  // tenant's form, and the source tenant's form is completely unaffected.
  // This is the supported way to let one tenant reuse another tenant's form
  // (with that tenant's permission) while keeping full tenant isolation.
  app.post("/api/super-admin/forms/copy-to-tenant", requireSuperAdmin, async (req, res) => {
    try {
      const { formTemplateId, targetTenantId, newTitle } = z.object({
        formTemplateId: z.string().uuid(),
        targetTenantId: z.string().uuid(),
        newTitle: z.string().min(1).optional(),
      }).parse(req.body);

      const sourceForm = await storage.getFormTemplateById(formTemplateId);
      if (!sourceForm) return res.status(404).json({ error: "Source form not found" });

      const [targetTenant] = await db.select().from(tenants).where(eq(tenants.id, targetTenantId));
      if (!targetTenant) return res.status(404).json({ error: "Target tenant not found" });

      const copiedForm = await storage.createFormTemplate({
        title: newTitle ?? sourceForm.title,
        description: sourceForm.description,
        fields: sourceForm.fields,
      } as InsertFormTemplate, targetTenantId);

      console.log(`[super-admin] Copied form template ${sourceForm.id} ("${sourceForm.title}") from tenant ${sourceForm.tenantId} to tenant ${targetTenantId} (${targetTenant.name}) as new form ${copiedForm.id}`);

      res.json({ success: true, form: copiedForm, tenantName: targetTenant.name });
    } catch (error) {
      console.error("Copy form to tenant error:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: "Failed to copy form to tenant" });
    }
  });

  // Update tenant branding
  app.patch("/api/super-admin/tenants/:id/branding", requireSuperAdmin, async (req, res) => {
    try {
      const b = req.body as Record<string, any>;
      const hexRe = /^#[0-9a-fA-F]{6}$/i;
      const patch: Record<string, any> = {};
      if (typeof b.name === "string" && b.name.trim().length > 0) patch.name = b.name.trim();
      if (typeof b.logoUrl === "string") patch.logoUrl = b.logoUrl || null;
      if (typeof b.primaryColor === "string") patch.primaryColor = hexRe.test(b.primaryColor) ? b.primaryColor : null;
      if (typeof b.accentColor === "string") patch.accentColor = hexRe.test(b.accentColor) ? b.accentColor : null;
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });
      const [updated] = await db.update(tenants).set(patch).where(eq(tenants.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ error: "Tenant not found" });
      res.json({ ...updated, stripeSecretKey: updated.stripeSecretKey ? "***" : null, stripeWebhookSecret: updated.stripeWebhookSecret ? "***" : null });
    } catch (error) {
      console.error("Branding save error:", error);
      res.status(500).json({ error: "Failed to update branding" });
    }
  });

  // Logo upload for a tenant — stored as base64 data URL in the DB so it
  // survives container restarts and redeploys with zero filesystem dependency.
  const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/gif", "image/webp"];
      cb(null, allowed.includes(file.mimetype));
    },
  });

  app.post("/api/super-admin/tenants/:id/logo-upload", requireSuperAdmin, logoUpload.single("logo"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded or unsupported type" });
      const b64 = req.file.buffer.toString("base64");
      const logoUrl = `data:${req.file.mimetype};base64,${b64}`;
      const [updated] = await db.update(tenants).set({ logoUrl }).where(eq(tenants.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ error: "Tenant not found" });
      res.json({ logoUrl });
    } catch (error) {
      console.error("Logo upload error:", error);
      res.status(500).json({ error: "Failed to upload logo" });
    }
  });

  // Update tenant feature flags
  app.patch("/api/super-admin/tenants/:id/features", requireSuperAdmin, async (req, res) => {
    try {
      const schema = z.object({
        paymentsEnabled: z.boolean().optional(),
        tasksEnabled: z.boolean().optional(),
        analyticsEnabled: z.boolean().optional(),
        waitlistEnabled: z.boolean().optional(),
        formsEnabled: z.boolean().optional(),
        dataExportEnabled: z.boolean().optional(),
        nonEngagementEnabled: z.boolean().optional(),
        gmailIntakeEnabled: z.boolean().optional(),
        // CY&A feature flags
        contactPreferenceEnabled: z.boolean().optional(),
        multiClinicianAllocationEnabled: z.boolean().optional(),
        autoAllocationEmailEnabled: z.boolean().optional(),
        registrationFormEnabled: z.boolean().optional(),
        bookingConfirmedEmailEnabled: z.boolean().optional(),
        writeuppChecklistEnabled: z.boolean().optional(),
        clinicianProfileConfig: z.object({
          showTier: z.boolean().optional(),
          showTherapyMode: z.boolean().optional(),
        }).optional(),
      });
      const body = schema.parse(req.body);
      const [updated] = await db.update(tenants).set(body).where(eq(tenants.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ error: "Tenant not found" });
      res.json({ ...updated, stripeSecretKey: updated.stripeSecretKey ? "***" : null, stripeWebhookSecret: updated.stripeWebhookSecret ? "***" : null });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: "Failed to update features" });
    }
  });

  // Update tenant Stripe credentials (encrypted at rest)
  app.patch("/api/super-admin/tenants/:id/stripe", requireSuperAdmin, async (req, res) => {
    try {
      const schema = z.object({
        stripeSecretKey: z.string().optional(),
        stripeWebhookSecret: z.string().optional(),
      });
      const body = schema.parse(req.body);

      const updates: { stripeSecretKey?: string | null; stripeWebhookSecret?: string | null } = {};

      // Enforce encryption-at-rest: refuse to store plaintext secrets if key is missing
      const hasSecret = (body.stripeSecretKey && body.stripeSecretKey !== "") ||
                        (body.stripeWebhookSecret && body.stripeWebhookSecret !== "");
      if (hasSecret && !isEncryptionConfigured()) {
        return res.status(422).json({
          error: "STRIPE_ENCRYPTION_KEY is not configured. Set a 32-byte base64 key before saving credentials.",
        });
      }

      if (body.stripeSecretKey !== undefined) {
        if (body.stripeSecretKey === "") {
          updates.stripeSecretKey = null;
        } else {
          updates.stripeSecretKey = encryptSecret(body.stripeSecretKey);
        }
      }

      if (body.stripeWebhookSecret !== undefined) {
        if (body.stripeWebhookSecret === "") {
          updates.stripeWebhookSecret = null;
        } else {
          updates.stripeWebhookSecret = encryptSecret(body.stripeWebhookSecret);
        }
      }

      const [updated] = await db.update(tenants).set(updates).where(eq(tenants.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ error: "Tenant not found" });
      res.json({
        stripeConnected: !!updated.stripeSecretKey,
        stripeWebhookConnected: !!updated.stripeWebhookSecret,
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: "Failed to update Stripe credentials" });
    }
  });

  // Seed the Intake Inbox feature with fictional demo enquiries for a tenant (demo/showcase use only)
  app.post("/api/super-admin/tenants/:id/seed-intake-demo", requireSuperAdmin, async (req, res) => {
    try {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      await db.update(tenants).set({ gmailIntakeEnabled: true }).where(eq(tenants.id, tenant.id));

      const existing = await db
        .select({ id: intakeMessages.id })
        .from(intakeMessages)
        .where(and(eq(intakeMessages.tenantId, tenant.id), like(intakeMessages.threadId, "demo-seed-%")));
      if (existing.length > 0) {
        return res.json({ success: true, alreadySeeded: true, existingCount: existing.length, gmailIntakeEnabled: true });
      }

      const SEED_MESSAGES: { threadId: string; channel: "email" | "whatsapp" | "phone"; fromAddress: string; subject: string; body: string }[] = [
        {
          threadId: "demo-seed-001",
          channel: "email",
          fromAddress: "olivia.bennett@example.com",
          subject: "New enquiry: Therapy Enquiry Form",
          body: [
            "Your Name", "Olivia Bennett",
            "Email", "olivia.bennett@example.com",
            "Phone", "07700 900123",
            "I am looking for", "Therapy for myself",
            "What are your main concerns at the moment?", "Anxiety since finding out I'm pregnant",
            "How long have these difficulties been present?", "2-6 weeks",
            "Where would you like support to take place?", "Online",
            "Availability", "Weekday mornings",
            "Our current fees are £200-250 per session. Does this feel manageable for you?", "Yes",
            "Additional comments", "This is my first pregnancy and I'd like some support early on.",
          ].join("\n"),
        },
        {
          threadId: "demo-seed-002",
          channel: "email",
          fromAddress: "priya.shah@example.com",
          subject: "New enquiry: Therapy Enquiry Form",
          body: [
            "Your Name", "Priya Shah",
            "Email", "priya.shah@example.com",
            "Phone", "07700 900456",
            "I am looking for", "Therapy for myself",
            "What are your main concerns at the moment?", "Postnatal depression",
            "Please briefly describe what you're most worried about right now",
              "I had my baby 10 weeks ago and haven't felt like myself since. I feel low most days.",
            "How long have these difficulties been present?", "More than 6 weeks",
            "Have you had therapy before?", "Yes",
            "Are there any immediate safety concerns?", "None of the above",
            "Where would you like support to take place?", "In person",
            "Availability", "Weekday afternoons",
            "Our current fees are £200-250 per session. Does this feel manageable for you?", "Yes",
          ].join("\n"),
        },
        {
          threadId: "demo-seed-003",
          channel: "email",
          fromAddress: "megan.turner@example.com",
          subject: "New enquiry: Therapy Enquiry Form",
          body: [
            "Your Name", "Megan Turner",
            "Email", "megan.turner@example.com",
            "Phone", "07700 900789",
            "I am looking for", "Therapy for myself",
            "What are your main concerns at the moment?", "Birth trauma",
            "Please briefly describe what you're most worried about right now",
              "I had an emergency c-section and have been having flashbacks. Struggling to sleep.",
            "How long have these difficulties been present?", "2-6 weeks",
            "Have you had therapy before?", "No",
            "Are there any immediate safety concerns?", "None of the above",
            "Where would you like support to take place?", "Online",
            "Availability", "Evenings or weekends",
            "Our current fees are £200-250 per session. Does this feel manageable for you?", "Yes",
          ].join("\n"),
        },
        {
          threadId: "demo-seed-004",
          channel: "email",
          fromAddress: "hannah.wright@example.com",
          subject: "Referral from GP surgery",
          body: [
            "Your Name", "Hannah Wright",
            "Email", "hannah.wright@example.com",
            "Phone", "07700 900321",
            "I am looking for", "Therapy for myself",
            "What are your main concerns at the moment?", "Stress and low mood, trying to conceive",
            "How long have these difficulties been present?", "More than 6 weeks",
            "Where would you like support to take place?", "Online",
            "Availability", "Flexible",
            "Our current fees are £200-250 per session. Does this feel manageable for you?", "Need to check with insurer",
            "Additional comments", "Referred by my GP, Dr. Cole. Have Vitality health insurance.",
          ].join("\n"),
        },
        {
          threadId: "demo-seed-005",
          channel: "whatsapp",
          fromAddress: "+44 7700 900654",
          subject: "WhatsApp enquiry",
          body: "Hi, I saw your practice online and wanted to ask about availability for prenatal anxiety support. My name is Zara Ahmed, is it possible to have a call this week?",
        },
      ];

      const inserted: string[] = [];
      for (const msg of SEED_MESSAGES) {
        const parsed = parseIntakeEmailBody(msg.body);
        await db.insert(intakeMessages).values({
          tenantId: tenant.id,
          channel: msg.channel,
          threadId: msg.threadId,
          fromAddress: msg.fromAddress,
          subject: msg.subject,
          body: msg.body,
          extractedName: parsed.name,
          extractedPhone: parsed.phone,
          extractedData: parsed.fields,
          status: "new",
        } as any);
        inserted.push(msg.threadId);
      }

      res.json({ success: true, alreadySeeded: false, insertedCount: inserted.length, gmailIntakeEnabled: true });
    } catch (error) {
      console.error("Failed to seed demo intake messages:", error);
      res.status(500).json({ error: "Failed to seed demo intake messages" });
    }
  });

  // Disconnect Gmail for a tenant (clear a specific connection)
  app.delete("/api/super-admin/tenants/:id/gmail/:connectionId", requireSuperAdmin, async (req, res) => {
    try {
      await db.delete(gmailConnections).where(
        and(eq(gmailConnections.id, req.params.connectionId), eq(gmailConnections.tenantId, req.params.id))
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to disconnect Gmail" });
    }
  });

  // Create a new tenant + first admin user
  app.post("/api/super-admin/tenants", requireSuperAdmin, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1, "Practice name is required"),
        slug: z.string().regex(/^[a-z0-9-]*$/).optional().or(z.literal("")),
        adminEmail: z.string().email("Valid admin email is required"),
        adminName: z.string().min(1, "Admin name is required"),
        adminPassword: z.string().min(8, "Password must be at least 8 characters"),
        logoUrl: z.string().optional(),
        primaryColor: z.string().optional(),
        accentColor: z.string().optional(),
      });
      const body = schema.parse(req.body);

      // Check email uniqueness
      const existing = await storage.getUserByEmail(body.adminEmail.toLowerCase());
      if (existing) {
        return res.status(400).json({ error: "Email already in use" });
      }

      // Create tenant
      const [tenant] = await db.insert(tenants).values({
        name: body.name,
        slug: body.slug || null,
        logoUrl: body.logoUrl || null,
        primaryColor: body.primaryColor || null,
        accentColor: body.accentColor || null,
      }).returning();

      // Create first admin user
      const hashedPassword = await hashPassword(body.adminPassword);
      const user = await storage.createUser({
        email: body.adminEmail.toLowerCase(),
        name: body.adminName,
        password: hashedPassword,
        role: "admin",
        tenantId: tenant.id,
      });

      res.status(201).json({
        tenant: { ...tenant, stripeSecretKey: null, stripeWebhookSecret: null },
        adminUser: { id: user.id, email: user.email, name: user.name },
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      console.error("Super-admin create tenant error:", error);
      res.status(500).json({ error: "Failed to create tenant" });
    }
  });

  return httpServer;
}
