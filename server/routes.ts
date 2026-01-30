import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireAdmin, requireClinician, hashPassword, auditLog } from "./auth";
import passport from "passport";
import { 
  insertClientSchema, insertClinicianSchema, insertTimeSlotSchema, 
  insertFormTemplateSchema, insertTaskSchema, insertUserSchema 
} from "@shared/schema";
import { z } from "zod";
import { sendEmail, generateFormInviteEmail, generatePasswordResetEmail, generateTaskReminderEmail, generateAvailabilityReminderEmail, generateFormCompletionEmail } from "./email";
import { forceReseedDatabase } from "./seed";

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
      const clinicians = await storage.getAllClinicians();
      
      // For each clinician, fetch their availability
      const cliniciansWithAvailability = await Promise.all(
        clinicians.map(async (clinician) => {
          const availability = await storage.getTimeSlotsByClinicianId(clinician.id);
          return { ...clinician, availability };
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
      const clinician = await storage.createClinician(validated);
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
      });

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
      const inserted = await storage.addTimeSlots(req.params.clinicianId, newSlots);
      
      const allSlots = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
      res.json(allSlots);
    } catch (error) {
      console.error("Error adding time slots:", error);
      res.status(500).json({ error: "Failed to add time slots" });
    }
  });

  // Delete a specific time slot
  app.delete("/api/timeslots/:clinicianId/:slotId", requireAuth, async (req, res) => {
    try {
      // Check authorization: Admin can delete any, Clinician can only delete their own
      if (req.user!.role === "clinician") {
        const clinician = await storage.getClinicianByUserId(req.user!.id);
        if (!clinician || clinician.id !== req.params.clinicianId) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      await storage.deleteTimeSlotById(req.params.slotId);
      const allSlots = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
      res.json(allSlots);
    } catch (error: any) {
      console.error("Error deleting time slot:", error);
      if (error.message?.includes("assigned to a client")) {
        return res.status(400).json({ error: "Cannot delete slot that is assigned to a client" });
      }
      res.status(500).json({ error: "Failed to delete time slot" });
    }
  });

  // Update a specific time slot
  app.put("/api/timeslots/:clinicianId/:slotId", requireAuth, async (req, res) => {
    try {
      // Check authorization: Admin can update any, Clinician can only update their own
      if (req.user!.role === "clinician") {
        const clinician = await storage.getClinicianByUserId(req.user!.id);
        if (!clinician || clinician.id !== req.params.clinicianId) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const updates = req.body;
      const updated = await storage.updateTimeSlot(req.params.slotId, updates);
      if (!updated) {
        return res.status(404).json({ error: "Time slot not found" });
      }
      
      // Update lastUpdatedAvailability - use empty update to trigger timestamp refresh
      await storage.updateClinician(req.params.clinicianId, {});
      
      const allSlots = await storage.getTimeSlotsByClinicianId(req.params.clinicianId);
      res.json(allSlots);
    } catch (error) {
      console.error("Error updating time slot:", error);
      res.status(500).json({ error: "Failed to update time slot" });
    }
  });

  // Batch operations for time slots
  app.get("/api/timeslots/batch/:batchId", requireAuth, async (req, res) => {
    try {
      const slots = await storage.getSlotsByBatchId(req.params.batchId);
      res.json(slots);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch batch slots" });
    }
  });

  app.put("/api/timeslots/batch/:batchId", requireAuth, async (req, res) => {
    try {
      const updates = req.body;
      const count = await storage.updateSlotsByBatchId(req.params.batchId, updates);
      res.json({ updated: count });
    } catch (error) {
      console.error("Error updating batch slots:", error);
      res.status(500).json({ error: "Failed to update batch slots" });
    }
  });

  app.delete("/api/timeslots/batch/:batchId", requireAuth, async (req, res) => {
    try {
      const count = await storage.deleteSlotsByBatchId(req.params.batchId);
      res.json({ deleted: count });
    } catch (error) {
      console.error("Error deleting batch slots:", error);
      res.status(500).json({ error: "Failed to delete batch slots" });
    }
  });

  // Admin endpoint to clean up corrupted/null time slots
  app.delete("/api/timeslots/cleanup/null-entries", requireAdmin, async (req, res) => {
    try {
      const count = await storage.deleteNullTimeSlots();
      res.json({ deleted: count, message: `Deleted ${count} corrupted/null time slots` });
    } catch (error) {
      console.error("Error cleaning up null slots:", error);
      res.status(500).json({ error: "Failed to clean up null slots" });
    }
  });

  // Admin endpoint to delete all SpecificDate slots for a clinician
  app.delete("/api/timeslots/cleanup/specific-date/:clinicianId", requireAdmin, async (req, res) => {
    try {
      const { clinicianId } = req.params;
      const count = await storage.deleteSpecificDateSlotsByClinicianId(clinicianId);
      res.json({ deleted: count, message: `Deleted ${count} SpecificDate slots for clinician` });
    } catch (error) {
      console.error("Error cleaning up specific date slots:", error);
      res.status(500).json({ error: "Failed to clean up specific date slots" });
    }
  });

  // ============ CLIENT ROUTES (GDPR Protected) ============
  app.get("/api/clients", requireAdmin, auditLog("view", "client"), async (req, res) => {
    try {
      const includeArchived = req.query.includeArchived === "true";
      const clients = await storage.getAllClients(includeArchived);
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
      const client = await storage.createClient(validated);
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
      const updated = await storage.updateClient(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update client" });
    }
  });

  app.post("/api/clients/:clientId/assign", requireAdmin, auditLog("assign", "client"), async (req, res) => {
    try {
      const { clinicianId, slotId, allocationMethod = "form" } = req.body;
      
      if (!clinicianId || !slotId) {
        return res.status(400).json({ error: "Missing clinicianId or slotId" });
      }

      await storage.assignClinicianToClient(req.params.clientId, clinicianId, slotId, allocationMethod);
      
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
      const archived = await storage.archiveClient(req.params.id);
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
        });
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

      // Update client status to "Forms Completed" and insurer if found
      const clientUpdate: { status: "Forms Completed"; insurer?: string } = { status: "Forms Completed" };
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
      const forms = await storage.getAllFormTemplates();
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
      const form = await storage.createFormTemplate(validated);
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
  app.get("/api/tasks", requireAdmin, async (req, res) => {
    try {
      const tasks = await storage.getAllTasks();
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
      const task = await storage.createTask(validated);

      // Send email notification if assignee has task notifications enabled
      if (validated.assignee) {
        try {
          const assigneeUser = await storage.getUserByName(validated.assignee);
          if (assigneeUser) {
            const prefs = assigneeUser.notificationPrefs as { taskAssignments?: boolean } | null;
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
              await sendEmail({
                ...emailOptions,
                to: assigneeUser.email
              });
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

      // Update client status to "Forms Sent"
      await storage.updateClient(clientId, { status: "Forms Sent" });

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
      const clinicians = await storage.getAllClinicians();
      
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
      const templates = await storage.getAllEmailTemplates();
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
      });
      res.json(template);
    } catch (error) {
      console.error("Update email template error:", error);
      res.status(500).json({ error: "Failed to update email template" });
    }
  });

  return httpServer;
}
