/**
 * Demo seed script — populates rich demo data for a client presentation.
 * Safe to re-run: uses onConflictDoNothing / displayId uniqueness checks.
 *
 * Run with:  npx tsx server/seedDemo.ts
 * Or via:    POST /api/admin/seed-demo  (admin only)
 */

import { db } from "./db";
import {
  clients, tasks, timeSlots, formSubmissions, formTemplates,
} from "../shared/schema";
import { eq } from "drizzle-orm";

// ─── Clinician IDs from seed.ts ────────────────────────────────────────────
const CLIN = {
  ukwuori:  "a3e44310-bbdd-4a0f-9d00-b8415f8c1006",
  helen:    "a23bccaa-6f58-4a4c-9b47-4af4ba7712ee",
  megan:    "5d3ffbd8-1a86-4045-8d14-b58247cd7144",
  caroline: "bd5a5026-57e0-4c77-99ed-b51c2ddbabe5",
  christy:  "0911f785-dbc5-439a-b35c-4c6d02b37a64",
  louisa:   "c7db99bd-331c-457f-85a6-2aadc3397326",
  faye:     "41ae7337-0ac6-4aff-b6fb-75016e2a4931",
  kate:     "3a729eca-bda0-4862-b25a-92eda08600c1",
  sarahJ:   "38fd35f7-1a38-4033-a7a3-28e74a7b5919",
  abi:      "d27bfd5f-917b-492d-8b10-7fbd551ec417",
  sinead:   "3cf26d32-5a7f-42fd-bbe9-73fa6eec0371",
  anna:     "1bbc834e-b620-4d04-bdff-fe7b0cd86ea3",
  amara:    "396f953d-7934-4748-9b09-70130293b5a5",
  rosie:    "6b8a2890-f4e0-4972-8d8b-88ae3cddfc48",
  lauren:   "6be48cab-e85d-4faa-abca-b3817f06fc5f",
  paula:    "f3b0800d-8782-4817-88cd-af3c5fd270c2",
  natalie:  "a32ea839-1ed6-4a23-8f6d-716335791d7e",
  laura:    "9c051821-260c-4869-b208-7fa70820fa46",
  sarahA:   "b8e5e080-7da4-403c-9bfe-39f97af5fd6d",
  danelle:  "2b5915af-6d82-499e-82b0-e43c276fbd4c",
};

// The Perinatal Psychology Practice tenant (created by seedTenants.ts)
const PERINATAL_TENANT_ID = "11111111-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@perinatalpsych.com";

const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const fromNow = (days: number) => new Date(now.getTime() + days * 86_400_000);

// ─── Slot IDs ────────────────────────────────────────────────────────────
const SLOT = {
  helen_mon_10:    "slot-helen-mon-1000",
  helen_mon_11:    "slot-helen-mon-1100",
  helen_wed_11:    "slot-helen-wed-1100",
  helen_wed_12:    "slot-helen-wed-1200",
  helen_fri_10:    "slot-helen-fri-1000",
  megan_tue_09:    "slot-megan-tue-0900",
  megan_tue_10:    "slot-megan-tue-1000",
  megan_thu_14:    "slot-megan-thu-1400",
  megan_thu_15:    "slot-megan-thu-1500",
  faye_mon_09:     "slot-faye-mon-0900",
  faye_wed_13:     "slot-faye-wed-1300",
  faye_fri_11:     "slot-faye-fri-1100",
  kate_tue_10:     "slot-kate-tue-1000",
  kate_tue_11:     "slot-kate-tue-1100",
  kate_sat_09:     "slot-kate-sat-0900",
  anna_mon_14:     "slot-anna-mon-1400",
  anna_thu_10:     "slot-anna-thu-1000",
  anna_thu_11:     "slot-anna-thu-1100",
  louisa_wed_09:   "slot-louisa-wed-0900",
  louisa_fri_13:   "slot-louisa-fri-1300",
  amara_tue_13:    "slot-amara-tue-1300",
  amara_thu_09:    "slot-amara-thu-0900",
  christy_mon_11:  "slot-christy-mon-1100",
  christy_fri_14:  "slot-christy-fri-1400",
  danelle_wed_10:  "slot-danelle-wed-1000",
  danelle_sat_11:  "slot-danelle-sat-1100",
};

// ─── Client IDs ─────────────────────────────────────────────────────────
const CLIENT = {
  // NEW
  c01: "demo-client-01", c02: "demo-client-02", c03: "demo-client-03",
  c04: "demo-client-04", c05: "demo-client-05",
  // FORMS SENT
  c06: "demo-client-06", c07: "demo-client-07", c08: "demo-client-08",
  c09: "demo-client-09",
  // FORMS COMPLETED
  c10: "demo-client-10", c11: "demo-client-11", c12: "demo-client-12",
  c13: "demo-client-13",
  // ALLOCATED
  c14: "demo-client-14", c15: "demo-client-15", c16: "demo-client-16",
  // AWAITING CONFIRMATION
  c17: "demo-client-17", c18: "demo-client-18",
  // CONFIRMED
  c19: "demo-client-19", c20: "demo-client-20", c21: "demo-client-21",
  c22: "demo-client-22",
  // WAITLIST
  c23: "demo-client-23", c24: "demo-client-24",
  // ARCHIVED
  c25: "demo-client-25", c26: "demo-client-26",
};

export async function seedDemoData() {
  console.log("=== DEMO SEED STARTING ===");

  const tenantId = PERINATAL_TENANT_ID;
  console.log(`Tenant ID: ${tenantId}`);;

  // ── Availability slots ─────────────────────────────────────────────────
  console.log("Seeding availability slots...");

  const startDate = "2025-01-06"; // A Monday in the past (ongoing from then)

  const slotRows = [
    // Helen — Mon 10–11, Mon 11–12, Wed 11–12, Wed 12–13, Fri 10–11
    { id: SLOT.helen_mon_10, clinicianId: CLIN.helen, type: "Recurring" as const, day: "Monday",    startTime: "10:00", endTime: "11:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.helen_mon_11, clinicianId: CLIN.helen, type: "Recurring" as const, day: "Monday",    startTime: "11:00", endTime: "12:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },
    { id: SLOT.helen_wed_11, clinicianId: CLIN.helen, type: "Recurring" as const, day: "Wednesday", startTime: "11:00", endTime: "12:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.helen_wed_12, clinicianId: CLIN.helen, type: "Recurring" as const, day: "Wednesday", startTime: "12:00", endTime: "13:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },
    { id: SLOT.helen_fri_10, clinicianId: CLIN.helen, type: "Recurring" as const, day: "Friday",    startTime: "10:00", endTime: "11:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },

    // Megan — Tue 09–10, Tue 10–11, Thu 14–15, Thu 15–16
    { id: SLOT.megan_tue_09, clinicianId: CLIN.megan, type: "Recurring" as const, day: "Tuesday",  startTime: "09:00", endTime: "10:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.megan_tue_10, clinicianId: CLIN.megan, type: "Recurring" as const, day: "Tuesday",  startTime: "10:00", endTime: "11:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },
    { id: SLOT.megan_thu_14, clinicianId: CLIN.megan, type: "Recurring" as const, day: "Thursday", startTime: "14:00", endTime: "15:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.megan_thu_15, clinicianId: CLIN.megan, type: "Recurring" as const, day: "Thursday", startTime: "15:00", endTime: "16:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },

    // Faye — Mon 09–10, Wed 13–14, Fri 11–12
    { id: SLOT.faye_mon_09, clinicianId: CLIN.faye, type: "Recurring" as const, day: "Monday",    startTime: "09:00", endTime: "10:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.faye_wed_13, clinicianId: CLIN.faye, type: "Recurring" as const, day: "Wednesday", startTime: "13:00", endTime: "14:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },
    { id: SLOT.faye_fri_11, clinicianId: CLIN.faye, type: "Recurring" as const, day: "Friday",    startTime: "11:00", endTime: "12:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },

    // Kate — Tue 10–11, Tue 11–12, Sat 09–10
    { id: SLOT.kate_tue_10, clinicianId: CLIN.kate, type: "Recurring" as const, day: "Tuesday",  startTime: "10:00", endTime: "11:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.kate_tue_11, clinicianId: CLIN.kate, type: "Recurring" as const, day: "Tuesday",  startTime: "11:00", endTime: "12:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },
    { id: SLOT.kate_sat_09, clinicianId: CLIN.kate, type: "Recurring" as const, day: "Saturday", startTime: "09:00", endTime: "10:00", frequency: "fortnightly" as const, startDate, isOngoing: true, isBooked: false },

    // Anna — Mon 14–15, Thu 10–11, Thu 11–12
    { id: SLOT.anna_mon_14, clinicianId: CLIN.anna, type: "Recurring" as const, day: "Monday",   startTime: "14:00", endTime: "15:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },
    { id: SLOT.anna_thu_10, clinicianId: CLIN.anna, type: "Recurring" as const, day: "Thursday", startTime: "10:00", endTime: "11:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.anna_thu_11, clinicianId: CLIN.anna, type: "Recurring" as const, day: "Thursday", startTime: "11:00", endTime: "12:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },

    // Louisa — Wed 09–10, Fri 13–14
    { id: SLOT.louisa_wed_09, clinicianId: CLIN.louisa, type: "Recurring" as const, day: "Wednesday", startTime: "09:00", endTime: "10:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.louisa_fri_13, clinicianId: CLIN.louisa, type: "Recurring" as const, day: "Friday",    startTime: "13:00", endTime: "14:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },

    // Amara — Tue 13–14, Thu 09–10
    { id: SLOT.amara_tue_13, clinicianId: CLIN.amara, type: "Recurring" as const, day: "Tuesday",  startTime: "13:00", endTime: "14:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: true  },
    { id: SLOT.amara_thu_09, clinicianId: CLIN.amara, type: "Recurring" as const, day: "Thursday", startTime: "09:00", endTime: "10:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },

    // Christy — Mon 11–12, Fri 14–15
    { id: SLOT.christy_mon_11, clinicianId: CLIN.christy, type: "Recurring" as const, day: "Monday", startTime: "11:00", endTime: "12:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },
    { id: SLOT.christy_fri_14, clinicianId: CLIN.christy, type: "Recurring" as const, day: "Friday", startTime: "14:00", endTime: "15:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },

    // Danelle — Wed 10–11, Sat 11–12
    { id: SLOT.danelle_wed_10, clinicianId: CLIN.danelle, type: "Recurring" as const, day: "Wednesday", startTime: "10:00", endTime: "11:00", frequency: "weekly" as const, startDate, isOngoing: true, isBooked: false },
    { id: SLOT.danelle_sat_11, clinicianId: CLIN.danelle, type: "Recurring" as const, day: "Saturday",  startTime: "11:00", endTime: "12:00", frequency: "fortnightly" as const, startDate, isOngoing: true, isBooked: false },
  ];

  for (const slot of slotRows) {
    await db.insert(timeSlots).values({ ...slot, tenantId } as any).onConflictDoNothing();
  }
  console.log(`✓ ${slotRows.length} availability slots`);

  // ── Clients ───────────────────────────────────────────────────────────
  console.log("Seeding clients...");

  const clientRows = [
    // ── NEW (5) ────────────────────────────────────────────────────────
    {
      id: CLIENT.c01, displayId: "W10000101",
      email: "sophie.harrison@example.com", phone: "07700100101",
      status: "New" as const, referralSource: "GP", insurer: "Bupa",
      presentingIssues: ["Postnatal Depression", "Anxiety"],
      notes: "Referred by Dr. Malik at Kensington Surgery. 8 weeks post-partum, first baby.",
      createdAt: ago(2), updatedAt: ago(2), intakeDate: ago(2),
    },
    {
      id: CLIENT.c02, displayId: "W10000102",
      email: "emily.brooks@example.com", phone: "07700100102",
      status: "New" as const, referralSource: "Self-referral", insurer: "Vitality",
      presentingIssues: ["Birth Trauma", "PTSD"],
      notes: "Experienced emergency caesarean. Struggling with flashbacks and sleep.",
      createdAt: ago(3), updatedAt: ago(3), intakeDate: ago(3),
    },
    {
      id: CLIENT.c03, displayId: "W10000103",
      email: "priya.sharma@example.com", phone: "07700100103",
      status: "New" as const, referralSource: "Midwife", insurer: "Axa",
      presentingIssues: ["Antenatal Anxiety", "Tokophobia"],
      notes: "Currently 24 weeks pregnant. Severe fear of childbirth following previous traumatic delivery.",
      createdAt: ago(1), updatedAt: ago(1), intakeDate: ago(1),
    },
    {
      id: CLIENT.c04, displayId: "W10000104",
      email: "jessica.moore@example.com", phone: "07700100104",
      status: "New" as const, referralSource: "GP", insurer: "Aviva",
      presentingIssues: ["Perinatal OCD", "Intrusive Thoughts"],
      notes: "New mum, 4 months postnatal. OCD presentation with intrusive thoughts about harm to baby.",
      createdAt: ago(4), updatedAt: ago(4), intakeDate: ago(4),
    },
    {
      id: CLIENT.c05, displayId: "W10000105",
      email: "rachel.whitfield@example.com", phone: "07700100105",
      status: "New" as const, referralSource: "Health Visitor", insurer: "WPA",
      presentingIssues: ["Bonding Difficulties", "Low Mood"],
      notes: "Health visitor referral. Struggling to bond with 6-week-old. Partner away for work.",
      createdAt: ago(5), updatedAt: ago(5), intakeDate: ago(5),
    },

    // ── FORMS SENT (4) ────────────────────────────────────────────────
    {
      id: CLIENT.c06, displayId: "W10000106",
      email: "chloe.jenkins@example.com", phone: "07700100106",
      status: "Forms Sent" as const, referralSource: "GP", insurer: "Bupa",
      presentingIssues: ["Anxiety", "Panic Attacks"],
      formsSentAt: ago(3),
      createdAt: ago(7), updatedAt: ago(3), intakeDate: ago(7),
    },
    {
      id: CLIENT.c07, displayId: "W10000107",
      email: "natasha.ali@example.com", phone: "07700100107",
      status: "Forms Sent" as const, referralSource: "Self-referral", insurer: "Cigna",
      presentingIssues: ["Perinatal Loss", "Grief"],
      notes: "Stillbirth 3 months ago. Partner also grieving. Seeking individual support.",
      formsSentAt: ago(5),
      createdAt: ago(10), updatedAt: ago(5), intakeDate: ago(10),
    },
    {
      id: CLIENT.c08, displayId: "W10000108",
      email: "laura.nguyen@example.com", phone: "07700100108",
      status: "Forms Sent" as const, referralSource: "GP", insurer: "Axa",
      presentingIssues: ["Postnatal Depression", "Isolation"],
      formsSentAt: ago(2),
      createdAt: ago(8), updatedAt: ago(2), intakeDate: ago(8),
    },
    {
      id: CLIENT.c09, displayId: "W10000109",
      email: "alice.patel@example.com", phone: "07700100109",
      status: "Forms Sent" as const, referralSource: "IAPT", insurer: "NHS",
      presentingIssues: ["Anxiety", "Depression"],
      formsSentAt: ago(6),
      createdAt: ago(11), updatedAt: ago(6), intakeDate: ago(11),
    },

    // ── FORMS COMPLETED (4) ──────────────────────────────────────────
    {
      id: CLIENT.c10, displayId: "W10000110",
      email: "sarah.kent@example.com", phone: "07700100110",
      status: "Forms Completed" as const, referralSource: "GP", insurer: "Vitality",
      presentingIssues: ["Birth Trauma", "Anxiety"],
      formsSentAt: ago(14), formsCompletedAt: ago(10),
      createdAt: ago(16), updatedAt: ago(10), intakeDate: ago(16),
    },
    {
      id: CLIENT.c11, displayId: "W10000111",
      email: "hannah.cox@example.com", phone: "07700100111",
      status: "Forms Completed" as const, referralSource: "Self-referral", insurer: "Bupa",
      presentingIssues: ["Perinatal OCD", "Anxiety"],
      formsSentAt: ago(12), formsCompletedAt: ago(8),
      createdAt: ago(14), updatedAt: ago(8), intakeDate: ago(14),
    },
    {
      id: CLIENT.c12, displayId: "W10000112",
      email: "gemma.riley@example.com", phone: "07700100112",
      status: "Forms Completed" as const, referralSource: "Midwife", insurer: "Aviva",
      presentingIssues: ["Tokophobia", "PTSD"],
      formsSentAt: ago(18), formsCompletedAt: ago(13),
      createdAt: ago(20), updatedAt: ago(13), intakeDate: ago(20),
    },
    {
      id: CLIENT.c13, displayId: "W10000113",
      email: "amy.turner@example.com", phone: "07700100113",
      status: "Forms Completed" as const, referralSource: "GP", insurer: "WPA",
      presentingIssues: ["Fertility Struggles", "Depression", "Anxiety"],
      notes: "Three failed IVF cycles. Currently considering donor egg route.",
      formsSentAt: ago(9), formsCompletedAt: ago(6),
      createdAt: ago(11), updatedAt: ago(6), intakeDate: ago(11),
    },

    // ── ALLOCATED / ASSIGNED (3) ──────────────────────────────────────
    {
      id: CLIENT.c14, displayId: "W10000114",
      email: "claire.foster@example.com", phone: "07700100114",
      status: "Assigned" as const, referralSource: "GP", insurer: "Bupa",
      presentingIssues: ["Postnatal Depression", "Low Mood"],
      assignedClinicianId: CLIN.megan,
      assignedSlotId: SLOT.megan_tue_09,
      assignedSlot: "Tuesday 09:00–10:00 (weekly)",
      allocationMethod: "manual" as const,
      allocationReason: "Megan has strong postnatal depression experience and a Tuesday morning slot that fits Claire's availability.",
      formsSentAt: ago(22), formsCompletedAt: ago(18), allocatedAt: ago(12),
      createdAt: ago(25), updatedAt: ago(12), intakeDate: ago(25),
    },
    {
      id: CLIENT.c15, displayId: "W10000115",
      email: "danielle.scott@example.com", phone: "07700100115",
      status: "Assigned" as const, referralSource: "Self-referral", insurer: "Axa",
      presentingIssues: ["Birth Trauma", "PTSD", "Anxiety"],
      assignedClinicianId: CLIN.faye,
      assignedSlotId: SLOT.faye_mon_09,
      assignedSlot: "Monday 09:00–10:00 (weekly)",
      allocationMethod: "manual" as const,
      allocationReason: "Faye specialises in birth trauma and EMDR which is the recommended approach for this presentation.",
      formsSentAt: ago(30), formsCompletedAt: ago(25), allocatedAt: ago(14),
      createdAt: ago(33), updatedAt: ago(14), intakeDate: ago(33),
    },
    {
      id: CLIENT.c16, displayId: "W10000116",
      email: "nina.obi@example.com", phone: "07700100116",
      status: "Assigned" as const, referralSource: "GP", insurer: "Cigna",
      presentingIssues: ["Perinatal OCD", "Intrusive Thoughts"],
      assignedClinicianId: CLIN.helen,
      assignedSlotId: SLOT.helen_mon_10,
      assignedSlot: "Monday 10:00–11:00 (weekly)",
      allocationMethod: "form" as const,
      allocationReason: "Helen's CBT expertise is well-suited to Nina's OCD presentation. Monday morning matches stated availability.",
      formsSentAt: ago(20), formsCompletedAt: ago(15), allocatedAt: ago(8),
      createdAt: ago(22), updatedAt: ago(8), intakeDate: ago(22),
    },

    // ── AWAITING CONFIRMATION (2) ─────────────────────────────────────
    {
      id: CLIENT.c17, displayId: "W10000117",
      email: "victoria.lamb@example.com", phone: "07700100117",
      status: "AwaitingConfirmation" as const, referralSource: "GP", insurer: "Vitality",
      presentingIssues: ["Antenatal Anxiety", "Panic Attacks"],
      assignedClinicianId: CLIN.kate,
      assignedSlotId: SLOT.kate_tue_10,
      assignedSlot: "Tuesday 10:00–11:00 (weekly)",
      allocationMethod: "manual" as const,
      allocationReason: "Kate has capacity and experience with antenatal presentations. Tuesday slot fits.",
      formsSentAt: ago(28), formsCompletedAt: ago(22), allocatedAt: ago(15), awaitingConfirmationAt: ago(5),
      createdAt: ago(30), updatedAt: ago(5), intakeDate: ago(30),
    },
    {
      id: CLIENT.c18, displayId: "W10000118",
      email: "lucy.prentice@example.com", phone: "07700100118",
      status: "AwaitingConfirmation" as const, referralSource: "Self-referral", insurer: "Bupa",
      presentingIssues: ["Perinatal Loss", "Complicated Grief"],
      assignedClinicianId: CLIN.louisa,
      assignedSlotId: SLOT.louisa_wed_09,
      assignedSlot: "Wednesday 09:00–10:00 (weekly)",
      allocationMethod: "manual" as const,
      allocationReason: "Louisa specialises in perinatal loss and ACT, which aligns well with Lucy's presentation.",
      formsSentAt: ago(35), formsCompletedAt: ago(28), allocatedAt: ago(18), awaitingConfirmationAt: ago(7),
      createdAt: ago(38), updatedAt: ago(7), intakeDate: ago(38),
    },

    // ── CONFIRMED / SCHEDULED (4) ─────────────────────────────────────
    {
      id: CLIENT.c19, displayId: "W10000119",
      email: "olivia.burns@example.com", phone: "07700100119",
      status: "Scheduled" as const, referralSource: "GP", insurer: "Aviva",
      presentingIssues: ["Postnatal Depression", "Anxiety"],
      assignedClinicianId: CLIN.anna,
      assignedSlotId: SLOT.anna_thu_10,
      assignedSlot: "Thursday 10:00–11:00 (weekly)",
      allocationMethod: "manual" as const,
      formsSentAt: ago(42), formsCompletedAt: ago(36), allocatedAt: ago(28), awaitingConfirmationAt: ago(20), confirmedAt: ago(14),
      createdAt: ago(45), updatedAt: ago(14), intakeDate: ago(45),
    },
    {
      id: CLIENT.c20, displayId: "W10000120",
      email: "katherine.holt@example.com", phone: "07700100120",
      status: "Scheduled" as const, referralSource: "Self-referral", insurer: "WPA",
      presentingIssues: ["Birth Trauma", "PTSD"],
      assignedClinicianId: CLIN.megan,
      assignedSlotId: SLOT.megan_thu_14,
      assignedSlot: "Thursday 14:00–15:00 (weekly)",
      allocationMethod: "form" as const,
      formsSentAt: ago(50), formsCompletedAt: ago(44), allocatedAt: ago(35), awaitingConfirmationAt: ago(25), confirmedAt: ago(18),
      createdAt: ago(55), updatedAt: ago(18), intakeDate: ago(55),
    },
    {
      id: CLIENT.c21, displayId: "W10000121",
      email: "emma.davidson@example.com", phone: "07700100121",
      status: "Scheduled" as const, referralSource: "GP", insurer: "Bupa",
      presentingIssues: ["Perinatal OCD", "Low Mood"],
      assignedClinicianId: CLIN.amara,
      assignedSlotId: SLOT.amara_tue_13,
      assignedSlot: "Tuesday 13:00–14:00 (weekly)",
      allocationMethod: "manual" as const,
      formsSentAt: ago(60), formsCompletedAt: ago(52), allocatedAt: ago(42), awaitingConfirmationAt: ago(30), confirmedAt: ago(22),
      createdAt: ago(65), updatedAt: ago(22), intakeDate: ago(65),
    },
    {
      id: CLIENT.c22, displayId: "W10000122",
      email: "beth.manning@example.com", phone: "07700100122",
      status: "Scheduled" as const, referralSource: "Health Visitor", insurer: "Vitality",
      presentingIssues: ["Bonding Difficulties", "Postnatal Depression"],
      assignedClinicianId: CLIN.helen,
      assignedSlotId: SLOT.helen_wed_11,
      assignedSlot: "Wednesday 11:00–12:00 (weekly)",
      allocationMethod: "manual" as const,
      formsSentAt: ago(38), formsCompletedAt: ago(30), allocatedAt: ago(22), awaitingConfirmationAt: ago(14), confirmedAt: ago(8),
      createdAt: ago(40), updatedAt: ago(8), intakeDate: ago(40),
    },

    // ── WAITLIST (2) ──────────────────────────────────────────────────
    {
      id: CLIENT.c23, displayId: "W10000123",
      email: "diana.stone@example.com", phone: "07700100123",
      status: "Waitlist" as const, referralSource: "GP", insurer: "Cigna",
      presentingIssues: ["Tokophobia", "Anxiety"],
      notes: "Wants a clinician specialising in tokophobia. Currently 16 weeks pregnant. Urgency is growing.",
      formsSentAt: ago(25), formsCompletedAt: ago(20),
      createdAt: ago(28), updatedAt: ago(20), intakeDate: ago(28),
    },
    {
      id: CLIENT.c24, displayId: "W10000124",
      email: "sarah.cooper@example.com", phone: "07700100124",
      status: "Waitlist" as const, referralSource: "Self-referral", insurer: "Axa",
      presentingIssues: ["Fertility Struggles", "Depression"],
      notes: "Currently undergoing IVF. Prefers female clinician. Saturday availability only.",
      formsSentAt: ago(18), formsCompletedAt: ago(14),
      createdAt: ago(20), updatedAt: ago(14), intakeDate: ago(20),
    },

    // ── ARCHIVED (2) ──────────────────────────────────────────────────
    {
      id: CLIENT.c25, displayId: "W10000125",
      email: "kate.marsh@example.com", phone: "07700100125",
      status: "New" as const, referralSource: "GP", insurer: "Bupa",
      presentingIssues: ["Anxiety"],
      isArchived: true, archivedAt: ago(15),
      archiveReason: "Client did not respond to three contact attempts over two weeks. Closed for non-engagement.",
      archiveCategory: "Non-responsive",
      formsSentAt: ago(30),
      createdAt: ago(45), updatedAt: ago(15), intakeDate: ago(45),
    },
    {
      id: CLIENT.c26, displayId: "W10000126",
      email: "jade.fox@example.com", phone: "07700100126",
      status: "Scheduled" as const, referralSource: "Self-referral", insurer: "Vitality",
      presentingIssues: ["Postnatal Depression", "Low Mood"],
      assignedClinicianId: CLIN.rosie,
      isArchived: true, archivedAt: ago(10),
      archiveReason: "Client has completed 12 sessions and has been formally discharged. Good outcome.",
      formsSentAt: ago(120), formsCompletedAt: ago(114), allocatedAt: ago(108), confirmedAt: ago(100),
      createdAt: ago(125), updatedAt: ago(10), intakeDate: ago(125),
    },
  ];

  let inserted = 0;
  for (const client of clientRows) {
    const existing = await db.select({ id: clients.id }).from(clients).where(eq(clients.displayId, client.displayId));
    if (existing.length === 0) {
      await db.insert(clients).values({ ...client, tenantId } as any);
      inserted++;
    }
  }
  console.log(`✓ ${inserted} new clients (${clientRows.length - inserted} already existed)`);

  // ── Tasks ─────────────────────────────────────────────────────────────
  console.log("Seeding tasks...");

  const taskRows = [
    {
      id: "demo-task-01",
      title: "Call Sophie Harrison — urgent follow-up",
      description: "Sophie was referred with postnatal depression and has not yet been contacted. GP has flagged she may be at risk. Call today and confirm receipt of referral.",
      priority: "High" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(1),
      createdAt: ago(1),
    },
    {
      id: "demo-task-02",
      title: "Review OCD safeguarding concerns — Jessica Moore",
      description: "Jessica's intake form indicated intrusive thoughts about harm to baby. Senior clinician to review before allocation. Flag to Dr. Ukwuori for clinical oversight.",
      priority: "High" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: now,
      createdAt: ago(2),
    },
    {
      id: "demo-task-03",
      title: "Chase forms — Natasha Ali (W10000107)",
      description: "Forms were sent 5 days ago. No response yet. Client is dealing with perinatal loss — approach with sensitivity.",
      priority: "Medium" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(2),
      createdAt: ago(3),
    },
    {
      id: "demo-task-04",
      title: "Send payment setup link — Claire Foster",
      description: "Claire (W10000114) has been allocated to Megan. Send Stripe checkout link for session payment setup before first appointment.",
      priority: "Medium" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(3),
      createdAt: ago(1),
    },
    {
      id: "demo-task-05",
      title: "Update Bupa panel — quarterly review",
      description: "Bupa have sent their quarterly panel update request. Confirm which clinicians are still accepting Bupa and update the system accordingly.",
      priority: "Medium" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(7),
      createdAt: ago(2),
    },
    {
      id: "demo-task-06",
      title: "Prepare onboarding pack — Danielle Scott",
      description: "Danielle has been allocated to Faye for birth trauma work. Prepare and send the standard client onboarding pack including practice T&Cs and session information.",
      priority: "Medium" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(4),
      createdAt: ago(1),
    },
    {
      id: "demo-task-07",
      title: "Confirm first appointment — Victoria Lamb",
      description: "Victoria is awaiting confirmation. Email has been sent. Follow up by phone if no response by end of week.",
      priority: "Medium" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(5),
      createdAt: ago(4),
    },
    {
      id: "demo-task-08",
      title: "Monthly analytics report — send to clinical lead",
      description: "Compile the monthly intake report: new referrals, average time-to-allocation, clinician utilisation, and waitlist movement. Send to Dr. Ukwuori by Friday.",
      priority: "Low" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(10),
      createdAt: ago(1),
    },
    {
      id: "demo-task-09",
      title: "Schedule clinical supervision — Q3",
      description: "Book the next group clinical supervision session for all associate clinicians. Check availability across the team and propose 3 dates.",
      priority: "Low" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(14),
      createdAt: ago(3),
    },
    {
      id: "demo-task-10",
      title: "Review therapy enquiry form — update risk section",
      description: "Clinical lead has requested an update to the risk and safety section of the intake form. Review proposed changes and update the form builder accordingly.",
      priority: "Medium" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(6),
      createdAt: ago(2),
    },
    {
      id: "demo-task-11",
      title: "Check waitlist — Diana Stone (urgency escalating)",
      description: "Diana is 16 weeks pregnant and has been on the waitlist for 3 weeks. Review current capacity and see if any clinician can take her on.",
      priority: "High" as const, status: "Pending" as const,
      assignee: "Admin User",
      dueDate: fromNow(2),
      createdAt: ago(1),
    },
    {
      id: "demo-task-12",
      title: "Discharge summary — Jade Fox",
      description: "Jade has been formally discharged after 12 sessions with Rosie. Complete the discharge summary and send to GP with client consent.",
      priority: "Low" as const, status: "Completed" as const,
      assignee: "Admin User",
      comments: "Discharge letter sent to Dr. Patel at Camden Surgery on 12 June. Copy filed.",
      dueDate: ago(8),
      createdAt: ago(12),
    },
    {
      id: "demo-task-13",
      title: "Verify insurance — Alice Patel (NHS pathway)",
      description: "Alice was referred via IAPT. Clarify whether she is self-funding or on a funded pathway before proceeding with allocation.",
      priority: "Medium" as const, status: "Completed" as const,
      assignee: "Admin User",
      comments: "Confirmed self-funding via email. Proceed as standard private referral.",
      dueDate: ago(3),
      createdAt: ago(8),
    },
    {
      id: "demo-task-14",
      title: "Send availability reminder — Helen, Megan, Faye",
      description: "Three clinicians have not updated their availability in over 30 days. Send automated reminder to confirm or update their weekly slot availability.",
      priority: "Low" as const, status: "Completed" as const,
      assignee: "Admin User",
      comments: "Reminders sent 3 June. Helen and Faye confirmed. Megan added two new Thursday slots.",
      dueDate: ago(10),
      createdAt: ago(15),
    },
  ];

  let taskInserted = 0;
  for (const task of taskRows) {
    const existing = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, task.id));
    if (existing.length === 0) {
      await db.insert(tasks).values({ ...task, tenantId } as any);
      taskInserted++;
    }
  }
  console.log(`✓ ${taskInserted} new tasks (${taskRows.length - taskInserted} already existed)`);

  // ── Form submission (for completed clients) ───────────────────────────
  console.log("Seeding sample form submissions...");
  const formList = await db.select().from(formTemplates).limit(1);
  const formId = formList[0]?.id;

  if (formId) {
    const submissions = [
      {
        id: "demo-sub-01", clientId: CLIENT.c10, formTemplateId: formId,
        responses: {
          fullName: "Sarah Kent", dob: "1989-03-15", pronouns: "she/her",
          phone: "07700100110", voicemailOk: "Yes", email: "sarah.kent@example.com",
          perinatalStatus: ["Postpartum"], babyAge: "5 months",
          reasonForSupport: "I had a very difficult birth and have been struggling with flashbacks and anxiety ever since. I feel on edge all the time and am finding it hard to enjoy time with my baby.",
          difficulties: ["Birth trauma / previous trauma", "Anxiety or excessive worry", "Sleep difficulties"],
          difficultyDuration: ">6 months",
          selfHarmThoughts: "No", selfHarmPlans: "No", recentSelfHarm: "No",
          previousTherapy: "Yes", previousTherapyDetails: "CBT for anxiety about 4 years ago. Found it helpful.",
          mentalHealthDiagnosis: "No", currentMedication: "No", nhsCare: "No",
          availability: "Monday and Wednesday mornings, Thursday afternoons.",
          neurodiversity: "No", consent: "Yes",
        },
        submittedAt: ago(10),
        createdAt: ago(10),
      },
      {
        id: "demo-sub-02", clientId: CLIENT.c11, formTemplateId: formId,
        responses: {
          fullName: "Hannah Cox", dob: "1993-07-22", pronouns: "she/her",
          phone: "07700100111", voicemailOk: "Yes", email: "hannah.cox@example.com",
          perinatalStatus: ["Postpartum"], babyAge: "3 months",
          reasonForSupport: "I keep having intrusive thoughts about something happening to my baby. I know I would never act on them but they are extremely distressing and making it hard to sleep.",
          difficulties: ["Intrusive or distressing thoughts"],
          difficultyDuration: "2-6 weeks",
          selfHarmThoughts: "No", selfHarmPlans: "No", recentSelfHarm: "No",
          previousTherapy: "No",
          mentalHealthDiagnosis: "No", currentMedication: "No", nhsCare: "No",
          availability: "Flexible but prefer mornings. Tuesday or Friday best.",
          neurodiversity: "No", consent: "Yes",
        },
        submittedAt: ago(8),
        createdAt: ago(8),
      },
      {
        id: "demo-sub-03", clientId: CLIENT.c12, formTemplateId: formId,
        responses: {
          fullName: "Gemma Riley", dob: "1987-11-05", pronouns: "she/her",
          phone: "07700100112", voicemailOk: "No", email: "gemma.riley@example.com",
          perinatalStatus: ["Pregnant"], dueDate: "2025-09-10",
          reasonForSupport: "I had an emergency caesarean with my first baby and have been terrified of giving birth again ever since. Now pregnant with my second and the fear is overwhelming.",
          difficulties: ["Birth trauma / previous trauma", "Anxiety or excessive worry", "Panic attacks"],
          difficultyDuration: ">6 months",
          selfHarmThoughts: "No", selfHarmPlans: "No", recentSelfHarm: "No",
          previousTherapy: "No",
          mentalHealthDiagnosis: "No", currentMedication: "No", nhsCare: "No",
          availability: "Wednesday mornings or Friday afternoons.",
          neurodiversity: "Yes", neurodiversityDetails: "ADHD - I find it helpful to have clear structure and written summaries after sessions.",
          consent: "Yes",
        },
        submittedAt: ago(13),
        createdAt: ago(13),
      },
    ];

    let subInserted = 0;
    for (const sub of submissions) {
      const existing = await db.select({ id: formSubmissions.id }).from(formSubmissions).where(eq(formSubmissions.id, sub.id));
      if (existing.length === 0) {
        await db.insert(formSubmissions).values({ ...sub, tenantId } as any);
        subInserted++;
      }
    }
    console.log(`✓ ${subInserted} form submissions`);
  }

  console.log("\n=== DEMO SEED COMPLETE ===");
  console.log(`  Clients:     ${clientRows.length} (across all workflow stages)`);
  console.log(`  Tasks:       ${taskRows.length} (high/medium/low, pending + completed)`);
  console.log(`  Slots:       ${slotRows.length} (for 8 clinicians)`);
  console.log(`  Submissions: 3 realistic form responses`);
}

// Run directly: npx tsx server/seedDemo.ts
const isMain = process.argv[1]?.endsWith("seedDemo.ts") || process.argv[1]?.endsWith("seedDemo.js");
if (isMain) {
  seedDemoData().catch((err) => {
    console.error("Demo seed failed:", err);
    process.exit(1);
  }).finally(() => process.exit(0));
}
