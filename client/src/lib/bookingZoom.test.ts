import { describe, expect, it } from "vitest";
import { isPendingZoomDelivery } from "@shared/bookingZoom";

describe("pending Zoom delivery eligibility", () => {
  const confirmedOnlineClient = {
    status: "BookingConfirmed",
    isArchived: false,
    slotLocationType: "online",
    zoomLinkSentAt: null,
  };

  it("includes confirmed online clients whose Zoom link has not been delivered", () => {
    expect(isPendingZoomDelivery(confirmedOnlineClient)).toBe(true);
  });

  it.each([
    { ...confirmedOnlineClient, zoomLinkSentAt: new Date() },
    { ...confirmedOnlineClient, slotLocationType: "in_person" },
    { ...confirmedOnlineClient, isArchived: true },
    { ...confirmedOnlineClient, status: "RegistrationPending" },
    { ...confirmedOnlineClient, status: "Scheduled" },
  ])("excludes delivered, in-person, archived, and non-workflow clients", (client) => {
    expect(isPendingZoomDelivery(client)).toBe(false);
  });
});