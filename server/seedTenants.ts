/**
 * Multi-tenant test seed script
 * Run with: npx tsx server/seedTenants.ts
 *
 * Creates two tenants for testing:
 *   Tenant A – "Perinatal Psychology Practice"
 *   Tenant B – "Riverside Therapy Centre"
 *
 * Each gets:
 *   - 1 admin  (password: testpass123)
 *   - 2 clinicians  (password: testpass123)
 *   - 1 form template
 *   - 5 sample clients at various workflow stages
 *
 * Safe to re-run – uses onConflictDoNothing / onConflictDoUpdate.
 */

import { db } from "./db";
import {
  tenants,
  users,
  clinicians,
  formTemplates,
  clients,
} from "../shared/schema";
import { eq } from "drizzle-orm";

// password hash for "testpass123"
// generated with the same scrypt + salt approach used in auth.ts
// To regenerate: node -e "const crypto=require('crypto'); const salt=crypto.randomBytes(16).toString('hex'); crypto.scrypt('testpass123',salt,64,(e,h)=>console.log(h.toString('hex')+'.'+salt))"
const PASSWORD_HASH =
  "fcb409dfa9deef417f034fbb3122e06ae20d47362393f0e0882a256d2dae5a5c18b0d2e41246fb5be12e6e0570aeacb156a3faac32d133fcfe9512b1a5d37925.a5e9b48006f6596c64a5231f551ae24c";

// ─── Tenant A ────────────────────────────────────────────────────────────────
const TENANT_A_ID = "11111111-0000-0000-0000-000000000001";
const TENANT_B_ID = "22222222-0000-0000-0000-000000000002";

const TENANT_A_ADMIN_ID    = "11111111-0001-0000-0000-000000000001";
const TENANT_A_CLIN1_UID   = "11111111-0002-0000-0000-000000000001";
const TENANT_A_CLIN2_UID   = "11111111-0003-0000-0000-000000000001";
const TENANT_A_CLIN1_ID    = "11111111-0002-0001-0000-000000000001";
const TENANT_A_CLIN2_ID    = "11111111-0003-0001-0000-000000000001";
const TENANT_A_FORM_ID     = "11111111-0004-0000-0000-000000000001";

const TENANT_B_ADMIN_ID    = "22222222-0001-0000-0000-000000000002";
const TENANT_B_CLIN1_UID   = "22222222-0002-0000-0000-000000000002";
const TENANT_B_CLIN2_UID   = "22222222-0003-0000-0000-000000000002";
const TENANT_B_CLIN1_ID    = "22222222-0002-0001-0000-000000000002";
const TENANT_B_CLIN2_ID    = "22222222-0003-0001-0000-000000000002";
const TENANT_B_FORM_ID     = "22222222-0004-0000-0000-000000000002";

const basicFormFields = [
  { id: "fullName", type: "text", label: "Full Name", required: true },
  { id: "email", type: "email", label: "Email address", required: true },
  { id: "phone", type: "tel", label: "Telephone number", required: true },
  { id: "reasonForSupport", type: "textarea", label: "What has led you to seek support at this time?", required: true },
  { id: "availability", type: "textarea", label: "What days and times would you be available for therapy?", required: true },
  { id: "consent", type: "radio", label: "Do you consent to us using this information to match you with a clinician?", required: true, options: ["Yes", "No"] },
];

async function seed() {
  console.log("=== Multi-tenant seed starting ===\n");

  // ── Tenants ──────────────────────────────────────────────────────────────
  await db.insert(tenants).values([
    { id: TENANT_A_ID, name: "Perinatal Psychology Practice" },
    { id: TENANT_B_ID, name: "Riverside Therapy Centre" },
  ]).onConflictDoNothing();
  console.log("✓ Tenants");

  // ── Users ─────────────────────────────────────────────────────────────────
  await db.insert(users).values([
    // Tenant A
    { id: TENANT_A_ADMIN_ID,  email: "admin@practice-a.test",  password: PASSWORD_HASH, role: "admin",     name: "Alice Admin",    tenantId: TENANT_A_ID },
    { id: TENANT_A_CLIN1_UID, email: "sara@practice-a.test",   password: PASSWORD_HASH, role: "clinician", name: "Sara Patel",     tenantId: TENANT_A_ID },
    { id: TENANT_A_CLIN2_UID, email: "james@practice-a.test",  password: PASSWORD_HASH, role: "clinician", name: "James Okafor",   tenantId: TENANT_A_ID },
    // Tenant B
    { id: TENANT_B_ADMIN_ID,  email: "admin@riverside.test",   password: PASSWORD_HASH, role: "admin",     name: "Ben Admin",      tenantId: TENANT_B_ID },
    { id: TENANT_B_CLIN1_UID, email: "lucy@riverside.test",    password: PASSWORD_HASH, role: "clinician", name: "Lucy Chen",      tenantId: TENANT_B_ID },
    { id: TENANT_B_CLIN2_UID, email: "mark@riverside.test",    password: PASSWORD_HASH, role: "clinician", name: "Mark Williams",  tenantId: TENANT_B_ID },
  ]).onConflictDoNothing();
  console.log("✓ Users");

  // ── Clinicians ────────────────────────────────────────────────────────────
  await db.insert(clinicians).values([
    // Tenant A
    {
      id: TENANT_A_CLIN1_ID, userId: TENANT_A_CLIN1_UID,
      avatar: "SP", specialties: ["Anxiety", "Depression", "Birth Trauma", "CBT", "EMDR"],
      capacity: 15, currentLoad: 6, maxNewClients: 3,
      bio: "CBT and EMDR specialist with a focus on perinatal anxiety and birth trauma.",
      insurers: ["Bupa", "Axa", "Vitality"], location: "North London",
      worksWithCouples: false, tier: "Associate", contactMethods: ["Email"],
      tenantId: TENANT_A_ID,
    },
    {
      id: TENANT_A_CLIN2_ID, userId: TENANT_A_CLIN2_UID,
      avatar: "JO", specialties: ["OCD", "Perinatal Loss", "Couples", "CFT", "ACT"],
      capacity: 12, currentLoad: 4, maxNewClients: 4,
      bio: "CFT and ACT practitioner. Special interest in perinatal OCD and pregnancy loss.",
      insurers: ["Aviva", "Bupa", "Cigna"], location: "South London",
      worksWithCouples: true, tier: "Senior", contactMethods: ["Email", "WhatsApp"],
      tenantId: TENANT_A_ID,
    },
    // Tenant B
    {
      id: TENANT_B_CLIN1_ID, userId: TENANT_B_CLIN1_UID,
      avatar: "LC", specialties: ["Trauma", "PTSD", "Anxiety", "Depression", "EMDR", "CBT"],
      capacity: 14, currentLoad: 8, maxNewClients: 2,
      bio: "EMDR-trained psychologist specialising in trauma and PTSD in the perinatal period.",
      insurers: ["Bupa", "Vitality", "WPA"], location: "East London",
      worksWithCouples: false, tier: "Associate", contactMethods: ["Email"],
      tenantId: TENANT_B_ID,
    },
    {
      id: TENANT_B_CLIN2_ID, userId: TENANT_B_CLIN2_UID,
      avatar: "MW", specialties: ["Mindfulness", "ACT", "Bonding", "Parent-Infant", "CBT"],
      capacity: 16, currentLoad: 10, maxNewClients: 2,
      bio: "Mindfulness and ACT therapist with expertise in parent-infant bonding and postnatal adjustment.",
      insurers: ["Axa", "Cigna", "Aviva"], location: "West London",
      worksWithCouples: true, tier: "Associate", contactMethods: ["Email", "WhatsApp"],
      tenantId: TENANT_B_ID,
    },
  ] as any[]).onConflictDoNothing();
  console.log("✓ Clinicians");

  // ── Form Templates ────────────────────────────────────────────────────────
  await db.insert(formTemplates).values([
    {
      id: TENANT_A_FORM_ID,
      title: "Therapy Enquiry Form",
      description: "Standard intake form for new clients.",
      fields: basicFormFields,
      tenantId: TENANT_A_ID,
    },
    {
      id: TENANT_B_FORM_ID,
      title: "Riverside Intake Form",
      description: "Intake questionnaire for new Riverside clients.",
      fields: basicFormFields,
      tenantId: TENANT_B_ID,
    },
  ]).onConflictDoNothing();
  console.log("✓ Form templates");

  // ── Clients ───────────────────────────────────────────────────────────────
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  await db.insert(clients).values([
    // Tenant A clients
    {
      displayId: "WA1000001", email: "client1@practice-a.test", phone: "07700900001",
      status: "New", referralSource: "GP", insurer: "Bupa",
      presentingIssues: ["Anxiety", "Birth Trauma"],
      tenantId: TENANT_A_ID, createdAt: daysAgo(5), updatedAt: daysAgo(5),
    },
    {
      displayId: "WA1000002", email: "client2@practice-a.test", phone: "07700900002",
      status: "Forms Sent", referralSource: "Self-referral", insurer: "Axa",
      presentingIssues: ["Postnatal Depression"],
      formsSentAt: daysAgo(3),
      tenantId: TENANT_A_ID, createdAt: daysAgo(7), updatedAt: daysAgo(3),
    },
    {
      displayId: "WA1000003", email: "client3@practice-a.test", phone: "07700900003",
      status: "Forms Completed", referralSource: "GP", insurer: "Vitality",
      presentingIssues: ["OCD", "Anxiety"],
      formsSentAt: daysAgo(10), formsCompletedAt: daysAgo(8),
      tenantId: TENANT_A_ID, createdAt: daysAgo(12), updatedAt: daysAgo(8),
    },
    {
      displayId: "WA1000004", email: "client4@practice-a.test", phone: "07700900004",
      status: "Assigned", referralSource: "Self-referral", insurer: "Bupa",
      presentingIssues: ["Birth Trauma", "PTSD"],
      assignedClinicianId: TENANT_A_CLIN1_ID,
      formsSentAt: daysAgo(20), formsCompletedAt: daysAgo(18), allocatedAt: daysAgo(15),
      tenantId: TENANT_A_ID, createdAt: daysAgo(22), updatedAt: daysAgo(15),
    },
    {
      displayId: "WA1000005", email: "client5@practice-a.test", phone: "07700900005",
      status: "Scheduled", referralSource: "GP", insurer: "Aviva",
      presentingIssues: ["Perinatal Loss"],
      assignedClinicianId: TENANT_A_CLIN2_ID,
      formsSentAt: daysAgo(30), formsCompletedAt: daysAgo(28), allocatedAt: daysAgo(25), confirmedAt: daysAgo(20),
      tenantId: TENANT_A_ID, createdAt: daysAgo(35), updatedAt: daysAgo(20),
    },

    // Tenant B clients
    {
      displayId: "WB2000001", email: "client1@riverside.test", phone: "07700900101",
      status: "New", referralSource: "Self-referral", insurer: "Bupa",
      presentingIssues: ["Anxiety"],
      tenantId: TENANT_B_ID, createdAt: daysAgo(2), updatedAt: daysAgo(2),
    },
    {
      displayId: "WB2000002", email: "client2@riverside.test", phone: "07700900102",
      status: "Forms Sent", referralSource: "GP", insurer: "Vitality",
      presentingIssues: ["Postnatal Anxiety", "Depression"],
      formsSentAt: daysAgo(1),
      tenantId: TENANT_B_ID, createdAt: daysAgo(4), updatedAt: daysAgo(1),
    },
    {
      displayId: "WB2000003", email: "client3@riverside.test", phone: "07700900103",
      status: "Forms Completed", referralSource: "GP", insurer: "Axa",
      presentingIssues: ["Trauma", "PTSD"],
      formsSentAt: daysAgo(9), formsCompletedAt: daysAgo(7),
      tenantId: TENANT_B_ID, createdAt: daysAgo(11), updatedAt: daysAgo(7),
    },
    {
      displayId: "WB2000004", email: "client4@riverside.test", phone: "07700900104",
      status: "Assigned", referralSource: "Self-referral", insurer: "Bupa",
      presentingIssues: ["Bonding Difficulties"],
      assignedClinicianId: TENANT_B_CLIN2_ID,
      formsSentAt: daysAgo(18), formsCompletedAt: daysAgo(16), allocatedAt: daysAgo(13),
      tenantId: TENANT_B_ID, createdAt: daysAgo(20), updatedAt: daysAgo(13),
    },
    {
      displayId: "WB2000005", email: "client5@riverside.test", phone: "07700900105",
      status: "Scheduled", referralSource: "GP", insurer: "Cigna",
      presentingIssues: ["Perinatal OCD", "Anxiety"],
      assignedClinicianId: TENANT_B_CLIN1_ID,
      formsSentAt: daysAgo(28), formsCompletedAt: daysAgo(26), allocatedAt: daysAgo(23), confirmedAt: daysAgo(18),
      tenantId: TENANT_B_ID, createdAt: daysAgo(30), updatedAt: daysAgo(18),
    },
  ] as any[]).onConflictDoNothing();
  console.log("✓ Clients (5 per tenant)");

  console.log(`
=== Seed complete ===

Tenant A – Perinatal Psychology Practice
  Admin:      admin@practice-a.test  /  testpass123
  Clinician:  sara@practice-a.test   /  testpass123
  Clinician:  james@practice-a.test  /  testpass123

Tenant B – Riverside Therapy Centre
  Admin:      admin@riverside.test   /  testpass123
  Clinician:  lucy@riverside.test    /  testpass123
  Clinician:  mark@riverside.test    /  testpass123
`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
}).finally(() => process.exit(0));
