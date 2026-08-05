# Prompt for Replit: CY&A Client Onboarding Workflow

## Context

We currently have a psych practice onboarding portal serving one client, **TPPP**. We are onboarding a second client, **CY&A**, whose workflow differs from TPPP in several ways. We need to design and implement these changes **without altering or breaking the existing TPPP workflow** — TPPP must continue to function exactly as it does today.

Please treat this as a multi-tenant / client-specific configuration problem: CY&A needs its own workflow logic, form sequencing, and automation rules, while TPPP's existing logic stays untouched. Propose an architecture (e.g. per-client workflow config, feature flags, or separate workflow definitions keyed by client) before implementation, and confirm it cleanly isolates CY&A changes from TPPP.

## Goal

Automate the CY&A intake-to-booking pipeline end to end, replacing several currently-manual admin steps (sending forms, chasing confirmations by phone) with automated, event-triggered actions, while keeping a small number of steps that must remain manual (allocation, and final confirmation that WriteUpp has been updated).

## New CY&A Workflow (step by step)

1. **Initial enquiry** comes in and is manually assigned a write-up number by admin (stays manual).

2. **Contact preference check**: If the enquirer indicates they want to be called rather than emailed, the system must:
   - Flag the client record for admin to phone them.
   - NOT automatically send the intake form.
   - Tag the client record with their preferred contact method (phone or email) — this tag should be visible on the client record/pipeline view.

3. **Manual intake form send (post-review)**: Sending the intake form stays a manual admin action, triggered once the enquiry is converted. Admin needs to read the initial enquiry first to confirm it's a good fit before the form goes out. (Not automated — only skipped/replaced by the "needs a call" flag if the client requested a call instead.)

4. **Manual allocation, multi-option**: Once the client completes the intake form, admin manually allocates them to a clinician based on availability and clinical fit. Admin must be able to select **multiple clinicians** as options for the client to choose from (not just one).

5. **Automated allocation email**: As soon as admin completes allocation, the system automatically emails the client with their appointment option(s). This replaces the current manual phone call to confirm. Use the word **"match"** instead of "allocated" in this email.

6. **Client selects an appointment option**:
   - If they select an option → system automatically sends the **registration form**, which the client must complete before the appointment is confirmed.
   - If they decline all options → client sees a message that someone will contact them, AND the system flags the client record for admin to call.

7. **Registration form** must include:
   - Payment type selection: self-pay OR insurer + insurance details.
   - Terms and conditions, displayed in an **expandable/collapsible** section so the client can review the full text if they choose.

8. **Stripe payment**: Client completes payment via Stripe as part of/following registration.

9. **Automatic pipeline progression**: The client pipeline/status view should show which stage each client is in, and the system should automatically advance clients through stages as it receives their responses (form completed, appointment selected, registration completed, payment completed, etc.). Admins should still be able to manually move a client if needed, but **manual movement should no longer be required** — allocation is the only step that stays manual by design.
   - Not every one of these needs to be a distinct kanban/pipeline stage. Some (e.g. contact-preference tag, "needs a call" flag, payment type, WriteUpp checkboxes) are better represented as notes, tags, or checkboxes on the individual client record rather than as new stages in the overall workflow. Please use judgement on which updates warrant a full pipeline stage versus a field/flag on the client card, and propose this breakdown as part of the plan.

10. **Booking confirmed email**: Once appointment is selected, Stripe payment is completed, and the registration form is completed, the system automatically sends a "Booking Confirmed" email to the client. This email must include the assigned clinician's personal Zoom link (see below).

11. **Clinician Zoom links**: Add a field to each clinician's profile/details for their own unique Zoom link. Whichever clinician is confirmed for the booking, their Zoom link is what gets pulled into the Booking Confirmed email.

12. **Final manual step — WriteUpp handoff**: Actually confirming the appointment in WriteUpp and transferring the client's data into WriteUpp remains a manual, outside-the-system task. Add **two checkboxes** to the client record (e.g. "Appointment confirmed in WriteUpp" and "Data transferred to WriteUpp") that admin must tick before the client can be moved to "Completed" status.

## Data/Field Additions Needed

- Contact preference tag (phone / email) on client record.
- Multi-clinician allocation support (not single-select).
- Flag field: "needs admin call" (used both for call-preference enquiries and for clients who decline all appointment options).
- Registration form fields: payment type (self-pay/insurer), insurer details, terms & conditions (expandable), acceptance checkbox.
- Client status/stage field that updates automatically based on triggered events.
- Two admin-facing checkboxes per client: WriteUpp appointment confirmed, WriteUpp data transferred.
- Clinician profile field: personal Zoom link.

## Non-Functional Requirements

- All of the above applies to the **CY&A workflow only** by default. TPPP's existing workflow, forms, emails, and pipeline logic must remain fully functional and unchanged unless TPPP later opts in.
- TPPP may also want some or all of these automation steps in future, but on an opt-in/opt-out basis. Build this as **configurable per tenant** (e.g. per-client feature flags for each automated step) rather than assuming CY&A's workflow becomes the default for everyone.
- Please flag any ambiguity (e.g., exact email copy, exact wording of decline messaging, waitlist vs. call option details) rather than assuming, since these are still being finalized.

## Deliverable Requested from Replit

A proposed technical plan covering:
1. How CY&A-specific workflow logic will be isolated from TPPP.
2. Data model changes (fields/tables above).
3. Automation/trigger design for each transition (form send, allocation email, registration send, booking confirmed email).
4. UI changes needed on the admin client pipeline view (stage visibility, flags, tags, checkboxes, multi-clinician allocation).
5. Any open questions or assumptions that need sign-off before implementation begins.
