# Historic booking reconciliation — read-only production dry run

Observed 30 September 2026. This is a point-in-time inventory of the CY&A Psychology practice only; **no production record was modified**. Refresh the in-app inventory and review each case individually before any action. These are portal facts, not proof of what happened in the external practice system.

| Portal classification | Client IDs | Portal evidence / staff question |
| --- | --- | --- |
| Awaiting confirmation; no assigned slot | WU1977753, WU4023310, WU4065370, WU4071158, WU4073111, WU4076111, WU4080933, WU4084866, WU4085113, WU4086461, WU4087148 | No assigned clinician or slot. Check external diary and family message. Do not confirm or invent an allocation. |
| Awaiting confirmation; reserved slot | WU4043803, WU4065395, WU4066029, WU4075870 | Each has a slot reserved; no portal booking snapshot or portal charge. Review diary, payment provider and consent individually before any portal action. |
| Registration/payment pending; reserved slot | WU4089984, WU4091294, WU4102144 | Registration submitted with recorded consent evidence and selected/reserved appointment. No portal charge, booking snapshot, or accepted booking-confirmation email recorded. Verify any payment with the provider; setup pending does not mean paid. |
| Confirmed in portal; setup pending badge | WU4049571, WU4075330 | Both have portal booking snapshots and an accepted booking-confirmation timestamp. Do not reconfirm; investigate the stale payment-setup indication separately. |

Overall, 15 are AwaitingConfirmation, four have a slot and 11 do not; three are RegistrationPending and two are BookingConfirmed.

## WU4091294 — evidence comparison

- Portal: submitted intake and registration, consent evidence, option-selection audit event and reserved recurring Monday appointment. No portal charge, booking snapshot, accepted booking-confirmation timestamp or booking-confirmed audit event.
- The stored practice **intake acknowledgement** is titled “Thank You for Completing Your Intake Form - CY&A”. It says staff will review the form and share recommendations, **then** the family can book. That text is not an appointment confirmation. A selected-option or registration acknowledgement is not the booking-confirmed email either.
- The **actual message the family received** is not available in the portal evidence reviewed here. Ask the family or staff for the original message with subject, body and date, compare it with the portal email and booking events, and check the external diary appointment and any independent payment-provider record. Do not conclude that the family misunderstood, that the appointment did not happen, or that payment/consent occurred outside the portal based on a badge or note.
- If staff verifies misleading message copy, correct the applicable tenant email template only after reviewing the original; do not rewrite historical delivery evidence. The current stored intake acknowledgement makes no appointment promise.

## Individual review decisions

1. **External diary appointment verified:** In the new inventory, record its unique diary reference, clinician, exact date/time and what was learned from the family's actual message. This creates an audited *external review*, not a portal booking/payment/consent/email event. Missing or conflicting portal allocation blocks the review until clarified; absent allocation is allowed for a booking that happened outside the portal.
2. **No external appointment verified:** Keep the existing portal status; repair an invalid or missing allocation separately only if a real slot is available. Verify payment with Stripe before using any supported portal progression. Never create an appointment simply to make the board look complete.
3. **Already confirmed in portal:** Keep the original snapshot and audit trail. Investigate the payment badge independently; do not confirm twice.

No bulk status update or automatic production correction is approved by this dry run. Staff must review the actual external diary, message, consent record and provider outcome for each client. The app detects duplicate portal slot claims and duplicate reviewed external appointments before recording a review.