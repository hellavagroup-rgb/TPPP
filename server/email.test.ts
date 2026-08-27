/**
 * Outlook rendering regression tests for all generate*Email functions.
 *
 * Outlook (and many other desktop clients) strip <style> blocks entirely and
 * ignore CSS class selectors. All styling must be delivered via inline style=
 * attributes on each element. These tests verify that every generated HTML
 * email:
 *   1. Contains no <style> blocks (which Outlook drops).
 *   2. Contains no class= attributes (which would be unstyled in Outlook).
 *
 * The storage module is mocked to return null so each function exercises its
 * built-in default template rather than any database-stored override.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the storage module before importing email.ts so that getStoredTemplate
// always returns null, exercising the hardcoded default template paths.
vi.mock('./storage', () => ({
  storage: {
    getEmailTemplateByKey: vi.fn().mockResolvedValue(null),
  },
}));

import {
  generateFormInviteEmail,
  generatePasswordResetEmail,
  generateTaskReminderEmail,
  generateAvailabilityReminderEmail,
  generateFormCompletionEmail,
  generateFormCompletedNotificationEmail,
  generateNewReferralEmail,
  generateAllocationOptionsEmail,
  generateBookingConfirmedEmail,
  generateWaitlistUpdateEmail,
  generatePaymentLinkEmail,
  generateClinicianWelcomeEmail,
  generateAdminInviteEmail,
  generatePaymentFailureEmail,
} from './email';

// ─── helpers ────────────────────────────────────────────────────────────────

function hasStyleBlock(html: string): boolean {
  return /<style[\s>]/i.test(html);
}

function hasClassAttribute(html: string): boolean {
  // Match class="..." or class='...' or class=word (unquoted)
  return /\bclass\s*=/i.test(html);
}

function assertOutlookSafe(label: string, html: string): void {
  expect(html, `${label}: must not contain a <style> block`).not.toMatch(/<style[\s>]/i);
  expect(html, `${label}: must not contain class= attributes`).not.toMatch(/\bclass\s*=/i);
}

// Minimal tenant contexts used across tests
const tenant = { id: 'tenant-1', name: 'Test Practice', fromEmail: 'noreply@test.com', primaryColor: '#3b82f6' };
const tenantLight = { id: 'tenant-2', name: 'Light Practice', fromEmail: null, primaryColor: '#f0f0f0' }; // light colour → dark text branch
const tenantNone = undefined; // no tenant → generic defaults

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Email Outlook rendering — no <style> blocks or class= attributes', () => {

  describe('generateFormInviteEmail', () => {
    it('is Outlook-safe with a dark primary colour', async () => {
      const email = await generateFormInviteEmail('Intake Form', 'https://example.com/form', tenant);
      assertOutlookSafe('generateFormInviteEmail (dark)', email.html);
    });

    it('is Outlook-safe with a light primary colour', async () => {
      const email = await generateFormInviteEmail('Intake Form', 'https://example.com/form', tenantLight);
      assertOutlookSafe('generateFormInviteEmail (light)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateFormInviteEmail('Intake Form', 'https://example.com/form', tenantNone);
      assertOutlookSafe('generateFormInviteEmail (no tenant)', email.html);
    });
  });

  describe('generatePasswordResetEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generatePasswordResetEmail('Alice', 'https://example.com/reset/abc', tenant);
      assertOutlookSafe('generatePasswordResetEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generatePasswordResetEmail('Alice', 'https://example.com/reset/abc', tenantNone);
      assertOutlookSafe('generatePasswordResetEmail (no tenant)', email.html);
    });
  });

  describe('generateTaskReminderEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generateTaskReminderEmail(
        'Bob', 'Complete Assessment', 'Finish the PHQ-9 form', '2026-09-01', tenant
      );
      assertOutlookSafe('generateTaskReminderEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateTaskReminderEmail(
        'Bob', 'Complete Assessment', 'Finish the PHQ-9 form', '2026-09-01', tenantNone
      );
      assertOutlookSafe('generateTaskReminderEmail (no tenant)', email.html);
    });
  });

  describe('generateAvailabilityReminderEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generateAvailabilityReminderEmail('Carol', 'https://example.com/login', tenant);
      assertOutlookSafe('generateAvailabilityReminderEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateAvailabilityReminderEmail('Carol', 'https://example.com/login', tenantNone);
      assertOutlookSafe('generateAvailabilityReminderEmail (no tenant)', email.html);
    });
  });

  describe('generateFormCompletionEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generateFormCompletionEmail(tenant);
      assertOutlookSafe('generateFormCompletionEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateFormCompletionEmail(tenantNone);
      assertOutlookSafe('generateFormCompletionEmail (no tenant)', email.html);
    });
  });

  describe('generateFormCompletedNotificationEmail', () => {
    it('is Outlook-safe and contains only the safe client reference', async () => {
      const email = await generateFormCompletedNotificationEmail('W12345', 'Intake Form', tenant);
      assertOutlookSafe('generateFormCompletedNotificationEmail', email.html);
      expect(email.subject).toContain('W12345');
      expect(email.html).toContain('Intake Form');
      expect(email.html).not.toContain('responses');
    });
  });

  describe('generateNewReferralEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generateNewReferralEmail('REF-001', 'Dana Smith', tenant);
      assertOutlookSafe('generateNewReferralEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateNewReferralEmail('REF-001', 'Dana Smith', tenantNone);
      assertOutlookSafe('generateNewReferralEmail (no tenant)', email.html);
    });
  });

  describe('generateAllocationOptionsEmail', () => {
    const options = [
      { clinicianName: 'Dr. Eve', day: 'Monday', startTime: '09:00', endTime: '10:00', selectionToken: 'tok1', locationType: 'online' },
      { clinicianName: 'Dr. Frank', day: null, startTime: '14:00', endTime: '15:00', selectionToken: 'tok2', locationType: 'in_person' },
    ];

    it('is Outlook-safe with a tenant', async () => {
      const email = await generateAllocationOptionsEmail(options, 'https://example.com/portal', tenant);
      assertOutlookSafe('generateAllocationOptionsEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateAllocationOptionsEmail(options, 'https://example.com/portal', tenantNone);
      assertOutlookSafe('generateAllocationOptionsEmail (no tenant)', email.html);
    });
  });

  describe('generateBookingConfirmedEmail', () => {
    it('is Outlook-safe with a Zoom link', async () => {
      const email = await generateBookingConfirmedEmail(
        { clinicianName: 'Dr. Grace', day: 'Tuesday', startTime: '11:00', endTime: '12:00', zoomLink: 'https://zoom.us/j/123' },
        tenant
      );
      assertOutlookSafe('generateBookingConfirmedEmail (with zoom)', email.html);
    });

    it('is Outlook-safe without a Zoom link', async () => {
      const email = await generateBookingConfirmedEmail(
        { clinicianName: 'Dr. Grace', day: null, startTime: '11:00', endTime: '12:00', zoomLink: null },
        tenantNone
      );
      assertOutlookSafe('generateBookingConfirmedEmail (no zoom, no tenant)', email.html);
    });
  });

  describe('generateWaitlistUpdateEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generateWaitlistUpdateEmail('REF-002', 'Hank Jones', 'Waiting', 'Matched', tenant);
      assertOutlookSafe('generateWaitlistUpdateEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateWaitlistUpdateEmail('REF-002', 'Hank Jones', 'Waiting', 'Matched', tenantNone);
      assertOutlookSafe('generateWaitlistUpdateEmail (no tenant)', email.html);
    });
  });

  describe('generatePaymentLinkEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generatePaymentLinkEmail('https://stripe.com/pay/abc', '120.00', tenant);
      assertOutlookSafe('generatePaymentLinkEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generatePaymentLinkEmail('https://stripe.com/pay/abc', '120.00', tenantNone);
      assertOutlookSafe('generatePaymentLinkEmail (no tenant)', email.html);
    });
  });

  describe('generateClinicianWelcomeEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generateClinicianWelcomeEmail('Ivy Brown', 'ivy@example.com', 'TempPass123!', tenant);
      assertOutlookSafe('generateClinicianWelcomeEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateClinicianWelcomeEmail('Ivy Brown', 'ivy@example.com', 'TempPass123!', tenantNone);
      assertOutlookSafe('generateClinicianWelcomeEmail (no tenant)', email.html);
    });
  });

  describe('generateAdminInviteEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = await generateAdminInviteEmail('Jack White', 'https://example.com/invite/xyz', tenant);
      assertOutlookSafe('generateAdminInviteEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = await generateAdminInviteEmail('Jack White', 'https://example.com/invite/xyz', tenantNone);
      assertOutlookSafe('generateAdminInviteEmail (no tenant)', email.html);
    });
  });

  describe('generatePaymentFailureEmail', () => {
    it('is Outlook-safe with a tenant', async () => {
      const email = generatePaymentFailureEmail('REF-003', 'Kim Lee', '80.00', 'Card declined', tenant);
      assertOutlookSafe('generatePaymentFailureEmail (tenant)', email.html);
    });

    it('is Outlook-safe with no tenant', async () => {
      const email = generatePaymentFailureEmail('REF-003', 'Kim Lee', '80.00', 'Card declined', tenantNone);
      assertOutlookSafe('generatePaymentFailureEmail (no tenant)', email.html);
    });
  });
});
