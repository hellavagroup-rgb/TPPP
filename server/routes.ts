import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import ExcelJS from "exceljs";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireAdmin, requireClinician, hashPassword, auditLog } from "./auth";
import passport from "passport";
import { 
  insertClientSchema, insertClinicianSchema, insertTimeSlotSchema, 
  insertFormTemplateSchema, insertTaskSchema, insertUserSchema 
} from "@shared/schema";
import { z } from "zod";
import { sendEmail, generateFormInviteEmail, generatePasswordResetEmail, generateTaskReminderEmail, generateAvailabilityReminderEmail, generateFormCompletionEmail, generateNewReferralEmail, generateWaitlistUpdateEmail, generatePaymentLinkEmail, generatePaymentFailureEmail } from "./email";
import { forceReseedDatabase } from "./seed";
import { seedDemoData } from "./seedDemo";
import { parseIntakeEmailBody } from "./intakeParser";
import { requireTenant } from './middleware/tenant';
import { requireSuperAdmin } from './middleware/superAdmin';
import { db } from "./db";
import { tenants, users, clients, clinicians, tasks, formTemplates, formSubmissions, timeSlots, emailTemplates, nonEngagementCategories, customInsurers, auditLogs, intakeMessages, gmailConnections, paymentCharges } from "@shared/schema";
import { isStripeConfigured, getStripeInstance, createCheckoutSession, chargeOffSession, constructWebhookEvent } from "./stripe";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "./encryption";
import { getAuthUrl, exchangeCodeForTokens, syncConnection, buildRedirectUri } from "./gmailSync";
import { isNull, eq, and, inArray } from "drizzle-orm";

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

  // ONE-TIME migration: create default tenant and assign all users to it
  app.post("/api/admin/seed-tenant", requireAdmin, async (req, res) => {
    try {
      const existing = await db.select().from(tenants).limit(1);
      let tenant = existing[0];
      if (!tenant) {
        const [created] = await db.insert(tenants).values({
          name: "The Perinatal Psychology Practice",
        }).returning();
        tenant = created;
        console.log("Created tenant:", tenant.id);
      } else {
        console.log("Tenant already exists:", tenant.id);
      }
      const tables = [
        { name: "users", table: users },
        { name: "clients", table: clients },
        { name: "clinicians", table: clinicians },
        { name: "tasks", table: tasks },
        { name: "formTemplates", table: formTemplates },
        { name: "formSubmissions", table: formSubmissions },
        { name: "timeSlots", table: timeSlots },
        { name: "emailTemplates", table: emailTemplates },
        { name: "nonEngagementCategories", table: nonEngagementCategories },
        { name: "customInsurers", table: customInsurers },
        { name: "auditLogs", table: auditLogs },
      ];
      const counts: Record<string, number> = {};
      for (const { name, table } of tables) {
        const updated = await (db.update(table) as any).set({ tenantId: tenant.id }).where(isNull((table as any).tenantId)).returning();
        counts[name] = updated.length;
      }
      // Fix stuck legacy assignments: clear assignedSlot/assignedClinicianId for any client
      // where assignedSlotId is null but text fields remain. This covers:
      //   - Confirmed (Scheduled) clients: slot was deleted on confirm but text fields not cleared
      //   - De-allocated clients: status rolled back but text fields not cleared
      const stuckClients = await db.select().from(clients).where(isNull(clients.assignedSlotId));
      let stuckFixed = 0;
      for (const c of stuckClients) {
        if (c.assignedSlot || c.assignedClinicianId) {
          await db.update(clients).set({ assignedSlot: null, assignedClinicianId: null }).where(eq(clients.id, c.id));
          stuckFixed++;
        }
      }
      counts["stuckLegacyAssignmentsFixed"] = stuckFixed;

      // Deduplicate recurring slots: for each clinician+day+startTime with multiple
      // unbooked copies, keep the oldest and delete the rest
      const allRecurring = await db.select().from(timeSlots)
        .where(eq(timeSlots.type, "Recurring"));
      const slotGroups = new Map<string, typeof allRecurring>();
      for (const slot of allRecurring) {
        const key = `${slot.clinicianId}|${slot.day}|${slot.startTime}`;
        if (!slotGroups.has(key)) slotGroups.set(key, []);
        slotGroups.get(key)!.push(slot);
      }
      let dupsDeleted = 0;
      for (const [, group] of slotGroups) {
        const unbookedCopies = group.filter(s => !s.isBooked);
        if (unbookedCopies.length <= 1) continue;
        // Keep the oldest (lowest timestamp in ID), delete the rest
        unbookedCopies.sort((a, b) => a.id.localeCompare(b.id));
        const toDelete = unbookedCopies.slice(1);
        for (const slot of toDelete) {
          await db.delete(timeSlots).where(eq(timeSlots.id, slot.id));
          dupsDeleted++;
        }
      }
      counts["duplicateSlotsRemoved"] = dupsDeleted;

      res.json({ success: true, tenantId: tenant.id, updated: counts });
    } catch (error) {
      console.error("Seed tenant error:", error);
      res.status(500).json({ error: "Failed to seed tenant" });
    }
  });


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
      
      const user = await storage.createUser({
        ...validated,
        email: validated.email.toLowerCase(),
        password: hashedPassword
      });

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
      if (email && email !== req.user!.email) {
        await storage.updateUser(req.user!.id, { email });
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
        email,
        name,
        password: placeholderPassword,
        role: "clinician",
      });

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
      const emailResult = await sendEmail({
        to: user.email,
        subject: "Your Login Credentials - The Perinatal Psychology Practice",
        html: `
          <h1>Welcome to The Perinatal Psychology Practice</h1>
          <p>Hello ${user.name},</p>
          <p>Your login credentials have been generated. Here are your details:</p>
          <p><strong>Email:</strong> ${user.email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <p>Please log in and change your password as soon as possible.</p>
          <p>Best regards,<br>The Perinatal Psychology Practice Team</p>
        `,
        text: `Welcome to The Perinatal Psychology Practice\n\nHello ${user.name},\n\nYour login credentials have been generated.\n\nEmail: ${user.email}\nTemporary Password: ${tempPassword}\n\nPlease log in and change your password as soon as possible.`,
      });

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

      // Handle name and email updates separately (stored on user record, not clinician)
      const { email, name, ...clinicianUpdates } = req.body;
      if (clinician.userId) {
        const userUpdates: { email?: string; name?: string } = {};
        if (email) userUpdates.email = email;
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
      await storage.deleteClinician(req.params.id);
      res.json({ success: true, message: "Clinician permanently deleted" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete clinician" });
    }
  });

  // ============ ADMIN USERS ============
  // Get all admin users
  app.get("/api/admin-users", requireAdmin, async (req, res) => {
    try {
      const admins = await storage.getAdminUsers();
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
        email,
        name,
        password: placeholderPassword,
        role: "admin",
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
      const emailResult = await sendEmail({
        to: email,
        subject: "You've been invited as an Admin - The Perinatal Psychology Practice",
        html: `<p>Hello ${name},</p><p>You have been invited to join The Perinatal Psychology Practice as an administrator.</p><p>Please click the link below to set up your password and activate your account:</p><p><a href="${inviteUrl}">${inviteUrl}</a></p><p>This link will expire in 7 days.</p><p>Best regards,<br>The Perinatal Psychology Practice</p>`,
        text: `Hello ${name},\n\nYou have been invited to join The Perinatal Psychology Practice as an administrator.\n\nPlease click the link below to set up your password and activate your account:\n${inviteUrl}\n\nThis link will expire in 7 days.\n\nBest regards,\nThe Perinatal Psychology Practice`,
      });

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

      res.json({ valid: true, name: user.name, email: user.email });
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
      const slots = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
      res.json(slots);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch time slots" });
    }
  });

  // Add new time slots (additive - does not delete existing slots)
  app.post("/api/timeslots/:clinicianId", requireAuth, async (req, res) => {
    try {
      // Check authorization: Admin can edit any, Clinician can only edit their own
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

      const inserted = await storage.addTimeSlots(req.params.clinicianId, newSlots);
      
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

      await storage.deleteTimeSlotById(req.params.slotId);
      const allSlots = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
      res.json(allSlots);
    } catch (error: any) {
      console.error("Error deleting time slot:", error);
      res.status(500).json({ error: "Failed to delete time slot" });
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
      if (!client.isArchived) {
        return res.status(400).json({ error: "Only archived clients can be permanently deleted" });
      }

      const deleted = await storage.deleteClientPermanently(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete client" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to permanently delete client" });
    }
  });

  app.get("/api/clients/:id", requireAdmin, auditLog("view", "client"), async (req, res) => {
    try {
      const client = await storage.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

  app.post("/api/clients", requireAdmin, auditLog("create", "client"), async (req, res) => {
    try {
      const validated = insertClientSchema.parse(req.body);
      const client = await storage.createClient(validated, req.tenant?.id);

      // Send new referral notification to admins with newReferrals enabled
      try {
        const adminUsers = await storage.getAdminUsers();
        const clientName = `${validated.firstName || ''} ${validated.lastName || ''}`.trim() || 'Unknown';
        for (const admin of adminUsers) {
          const prefs = admin.notificationPrefs as { newReferrals?: boolean } | null;
          if (prefs?.newReferrals !== false) {
            const emailOptions = await generateNewReferralEmail(client.displayId, clientName);
            await sendEmail({
              ...emailOptions,
              to: admin.email
            });
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
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  app.patch("/api/clients/:id", requireAdmin, auditLog("edit", "client"), async (req, res) => {
    try {
      // Get current client to check for status change
      const currentClient = await storage.getClientById(req.params.id);
      const oldStatus = currentClient?.status;
      
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
              amountPence,
              successUrl: `${appBase}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
              cancelUrl: `${appBase}/payment-cancel`,
              tenantId: req.tenant?.id,
              tenantStripeKey: req.tenant?.stripeSecretKey,
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
              const emailOptions = await generatePaymentLinkEmail(checkoutResult.url, amountPounds);
              await sendEmail({ ...emailOptions, to: updated.email });
              console.log(`Auto-generated payment link and emailed to client ${updated.id}`);
            }
          }
        } catch (paymentError) {
          console.error("Failed to auto-create checkout session on AwaitingConfirmation:", paymentError);
        }
      }

      // Send waitlist update notification if status changed
      if (req.body.status && oldStatus && req.body.status !== oldStatus) {
        try {
          const adminUsers = await storage.getAdminUsers();
          const clientName = `${updated.firstName || ''} ${updated.lastName || ''}`.trim() || 'Unknown';
          for (const admin of adminUsers) {
            const prefs = admin.notificationPrefs as { waitlistUpdates?: boolean } | null;
            if (prefs?.waitlistUpdates !== false) {
              const emailOptions = await generateWaitlistUpdateEmail(
                updated.displayId,
                clientName,
                oldStatus,
                req.body.status
              );
              await sendEmail({
                ...emailOptions,
                to: admin.email
              });
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

      await storage.assignClinicianToClient(req.params.clientId, clinicianId, slotId, allocationMethod, allocationReason);
      
      const updated = await storage.getClientById(req.params.clientId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to assign clinician" });
    }
  });

  app.post("/api/clients/:clientId/reassign", requireAdmin, auditLog("reassign", "client"), async (req, res) => {
    try {
      const { clinicianId, slotId, status } = req.body;
      
      if (!status) {
        return res.status(400).json({ error: "Missing status" });
      }

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
      
      if (existingDraft) {
        // Convert draft to final submission
        const converted = await storage.submitDraft(existingDraft.id, data);
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
        }, req.tenant?.id);
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
          const emailOptions = await generateFormCompletionEmail();
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

      // Save or update draft
      const draft = await storage.saveOrUpdateDraft(clientId, formId, data);

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
      // Verify client exists
      const client = await storage.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
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
      const validated = insertFormTemplateSchema.partial().parse(req.body);
      const updated = await storage.updateFormTemplate(req.params.id, validated);
      if (!updated) {
        return res.status(404).json({ error: "Form not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update form" });
    }
  });

  app.delete("/api/forms/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteFormTemplate(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete form" });
    }
  });

  // ============ TASKS ============
  app.get("/api/activity/recent", requireAdmin, async (req, res) => {
    try {
      const logs = await storage.getRecentAuditLogs(20, "add_slots");
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
              const emailOptions = await generateTaskReminderEmail(
                assigneeUser.name,
                validated.title,
                validated.description || '',
                dueDateStr
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

      const form = await storage.getFormTemplateById(formId);
      if (!form) {
        return res.status(404).json({ error: "Form not found" });
      }

      // Generate form URL - use request host for correct URL
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const baseUrl = `${protocol}://${host}`;
      const formUrl = `${baseUrl}/fill/${client.id}/${formId}`;

      // Generate and send email
      const emailOptions = await generateFormInviteEmail(form.title, formUrl);
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

      const emailOptions = await generateTaskReminderEmail(
        task.assignee,
        task.title,
        task.description || '',
        task.dueDate instanceof Date ? task.dueDate.toLocaleDateString() : task.dueDate
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

        const emailOptions = await generateAvailabilityReminderEmail(user.name, loginUrl);
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
      const resetToken = require('crypto').randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      // Store token securely in database (do not log tokens)
      await storage.createPasswordResetToken(user.id, resetToken, expiresAt);

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const baseUrl = `${protocol}://${host}`;
      const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

      const emailOptions = await generatePasswordResetEmail(user.name, resetUrl);
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
      const template = await storage.getEmailTemplateByKey(req.params.key);
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
        const rows = await storage.getAllCompletedFormSubmissions();
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
      const deleted = await storage.deleteNonEngagementCategory(req.params.id);
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

  // Public endpoint — returns only branding fields, no auth required
  app.get("/api/tenant/branding", async (req, res) => {
    try {
      const [tenant] = await db.select({
        name: tenants.name,
        logoUrl: tenants.logoUrl,
        primaryColor: tenants.primaryColor,
        accentColor: tenants.accentColor,
      }).from(tenants).limit(1);
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
        .orderBy(intakeMessages.receivedAt);
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
      const parsed = message.extractedData as Record<string, string> | null;
      const clientEmail = (parsed && Object.entries(parsed).find(([k]) => k.toLowerCase().includes("email"))?.[1])
        || message.fromAddress;
      const clientPhone = message.extractedPhone
        || (parsed && Object.entries(parsed).find(([k]) => ["phone","telephone","mobile"].some(p => k.toLowerCase().includes(p)))?.[1])
        || "";
      const clientName = message.extractedName
        || (parsed && Object.entries(parsed).find(([k]) => ["your name","name"].some(p => k.toLowerCase() === p))?.[1])
        || null;
      const [newClient] = await db.insert(clients).values({
        displayId,
        email: clientEmail,
        phone: clientPhone,
        status: "New",
        tenantId: req.tenant.id,
        ...(clientName ? { notes: `Converted from intake email. Name extracted: ${clientName}` } : {}),
      } as any).returning();
      await db
        .update(intakeMessages)
        .set({ status: "linked", linkedClientId: newClient.id })
        .where(eq(intakeMessages.id, message.id));
      res.json({ success: true, client: newClient });
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "A client with this email address already exists" });
      }
      res.status(500).json({ error: "Failed to convert intake message to client" });
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

      const amountPence = client.agreedRatePence ?? 0;
      if (amountPence <= 0) {
        return res.status(400).json({ error: "Client has no agreed rate set. Please set the agreed rate before creating a payment link." });
      }

      const appBase = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const result = await createCheckoutSession({
        clientId: client.id,
        clientEmail: client.email,
        clientDisplayId: client.displayId,
        amountPence,
        successUrl: `${appBase}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${appBase}/payment-cancel`,
        tenantId: req.tenant?.id,
        tenantStripeKey: req.tenant?.stripeSecretKey,
      });

      if (!result) return res.status(500).json({ error: "Failed to create checkout session" });

      // Store customer ID and checkout URL on client; mark as setup_pending
      await db.update(clients).set({
        stripeCustomerId: result.customerId,
        stripeCheckoutUrl: result.url,
        paymentStatus: "setup_pending",
        updatedAt: new Date(),
      }).where(eq(clients.id, clientId));

      res.json({ url: result.url, customerId: result.customerId });
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

    // Step 1: Parse raw body to extract tenantId from metadata (before verifying)
    // This lets us look up the tenant's webhook secret for multi-tenant verification
    let parsedBody: any;
    try {
      parsedBody = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    // Extract tenantId from metadata (we store it there at checkout session creation)
    const metaTenantId: string | null =
      parsedBody?.data?.object?.metadata?.tenantId ?? null;

    // Step 2: Look up tenant to get their stored webhook secret and Stripe key
    // STRIPE_WEBHOOK_SECRET env var is a dev-only escape hatch; it must NOT be used in production.
    const isDev = process.env.NODE_ENV !== "production";
    let webhookSecret: string | null = null;
    let tenantStripeKey: string | null = null;

    if (metaTenantId) {
      try {
        const [tenant] = await db.select().from(tenants).where(eq(tenants.id, metaTenantId));
        if (tenant) {
          // Decrypt at-rest encrypted credentials before use
          if (tenant.stripeWebhookSecret) {
            try {
              webhookSecret = decryptSecret(tenant.stripeWebhookSecret);
            } catch (e) {
              console.error("Webhook: failed to decrypt webhook secret for tenant", metaTenantId, e);
              return res.status(400).json({ error: "Unable to decrypt webhook secret for this tenant" });
            }
          }
          if (tenant.stripeSecretKey) {
            try {
              tenantStripeKey = decryptSecret(tenant.stripeSecretKey);
            } catch (e) {
              console.error("Webhook: failed to decrypt Stripe key for tenant", metaTenantId, e);
              return res.status(400).json({ error: "Unable to decrypt Stripe key for this tenant" });
            }
          }
        }
      } catch (e) {
        console.error("Webhook: failed to look up tenant:", e);
      }
    }

    // Fall back to env vars only in development to ease local testing
    if (!webhookSecret) {
      if (isDev && process.env.STRIPE_WEBHOOK_SECRET) {
        console.warn(
          "[DEV ONLY] Using global STRIPE_WEBHOOK_SECRET env var as webhook secret fallback. " +
          "In production every tenant must have their own webhook secret stored in the database."
        );
        webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      } else {
        return res.status(400).json({ error: "Webhook secret not configured for this tenant" });
      }
    }
    if (!tenantStripeKey && isDev && process.env.STRIPE_SECRET_KEY) {
      tenantStripeKey = process.env.STRIPE_SECRET_KEY;
    }

    // Step 3: Verify signature with the tenant's webhook secret
    let event: any;
    try {
      event = constructWebhookEvent(rawBody, sig, webhookSecret, tenantStripeKey);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err?.message);
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
          // Get the payment intent to find the payment method
          const paymentIntentId = session.payment_intent;
          if (paymentIntentId) {
            const stripeInstance = getStripeInstance(tenantStripeKey);
            if (stripeInstance) {
              const pi = await stripeInstance.paymentIntents.retrieve(paymentIntentId);
              const paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;

              if (paymentMethodId) {
                // Validate tenant ownership before mutating
                const clientForUpdate = await storage.getClientById(clientId);
                if (!clientForUpdate) {
                  return res.json({ received: true });
                }
                if (metaTenantId && clientForUpdate.tenantId !== metaTenantId) {
                  console.error(`Webhook: tenant mismatch for client ${clientId}`);
                  return res.json({ received: true });
                }

                await db.update(clients).set({
                  stripePaymentMethodId: paymentMethodId,
                  paymentStatus: "active",
                  updatedAt: new Date(),
                }).where(eq(clients.id, clientId));

                // Record the initial charge (idempotent — checked above)
                const client = clientForUpdate;
                if (client) {
                  await storage.createPaymentCharge({
                    clientId,
                    amountPence: session.amount_total,
                    stripePaymentIntentId: paymentIntentId,
                    status: "succeeded",
                    notes: "Initial session payment via Checkout",
                    tenantId: client.tenantId,
                  });
                }
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
                  const emailOptions = generatePaymentFailureEmail(client.displayId, clientName, amountPounds, failureReason);
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
                  const emailOptions = generatePaymentFailureEmail(client.displayId, clientName, amountPounds, failureReason);
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

  // Update tenant branding
  app.patch("/api/super-admin/tenants/:id/branding", requireSuperAdmin, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1).optional(),
        logoUrl: z.string().url().optional().or(z.literal("")),
        primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
      });
      const body = schema.parse(req.body);
      const [updated] = await db.update(tenants).set(body).where(eq(tenants.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ error: "Tenant not found" });
      res.json({ ...updated, stripeSecretKey: updated.stripeSecretKey ? "***" : null, stripeWebhookSecret: updated.stripeWebhookSecret ? "***" : null });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: "Failed to update branding" });
    }
  });

  // Logo upload for a tenant
  const logoUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(process.cwd(), "client", "public", "logos");
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || ".png";
        cb(null, `${req.params.id}${ext}`);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/gif", "image/webp"];
      cb(null, allowed.includes(file.mimetype));
    },
  });

  app.post("/api/super-admin/tenants/:id/logo-upload", requireSuperAdmin, logoUpload.single("logo"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded or unsupported type" });
      const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
      const logoUrl = `/logos/${req.params.id}${ext}`;
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
