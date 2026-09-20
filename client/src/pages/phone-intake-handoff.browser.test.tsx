// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntakeInbox from "./intake-inbox";
import Clients from "./clients";
import FormFill from "./form-fill";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "admin-a", name: "Admin", role: "admin" },
    isLoading: false,
  }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("phone-intake admin handoff", () => {
  const state = {
    messageStatus: "new",
    client: null as Record<string, any> | null,
    submissions: [] as Record<string, any>[],
    deliveries: [] as Record<string, any>[],
  };
  const openedUrls: string[] = [];

  const tenant = {
    id: "tenant-a",
    name: "Test Practice",
    formsEnabled: true,
    contactPreferenceEnabled: true,
    intakeFormId: "intake-form-a",
    registrationFormId: null,
    multiClinicianAllocationEnabled: false,
  };
  const intakeForm = {
    id: "intake-form-a",
    tenantId: "tenant-a",
    title: "Intake details",
    description: "Designated intake form",
    fields: [],
  };

  function queryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: {
          queryFn: async ({ queryKey }) => {
            const response = await fetch(queryKey.join("/"));
            if (!response.ok) throw new Error(await response.text());
            return response.json();
          },
          retry: false,
          staleTime: 0,
        },
        mutations: { retry: false },
      },
    });
  }

  function show(component: React.ReactElement) {
    return render(<QueryClientProvider client={queryClient()}>{component}</QueryClientProvider>);
  }

  beforeEach(() => {
    state.messageStatus = "new";
    state.client = null;
    state.submissions = [];
    state.deliveries = [];
    openedUrls.length = 0;
    window.history.pushState({}, "", "/");
    window.open = vi.fn((url?: string | URL) => {
      if (url) openedUrls.push(String(url));
      return null;
    });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Element.prototype.scrollIntoView = vi.fn();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      const method = init?.method || "GET";

      if (url.pathname === "/api/tenant") return json(tenant);
      if (url.pathname === "/api/forms") return json([intakeForm]);
      if (url.pathname === "/api/forms/intake-form-a") return json(intakeForm);
      if (url.pathname === "/api/intake-messages") {
        return json([{
          id: "message-a",
          channel: "email",
          fromAddress: "client@example.test",
          subject: "New enquiry",
          body: "Please call me",
          extractedName: "Phone Client",
          extractedPhone: "07000000000",
          extractedData: { "Next step": "Please call me" },
          status: state.messageStatus,
          linkedClientId: state.client?.id || null,
          receivedAt: "2026-09-20T09:00:00.000Z",
          threadId: "thread-a",
        }]);
      }
      if (url.pathname === "/api/clients/check-email") return json({ matches: [] });
      if (url.pathname === "/api/intake-messages/message-a/convert-to-client" && method === "POST") {
        const request = JSON.parse(String(init?.body || "{}"));
        expect(request.contactPreference).toBe("phone");
        state.client = {
          id: "client-a",
          tenantId: "tenant-a",
          displayId: "PC001",
          status: "New",
          contactPreference: "phone",
          needsAdminCall: true,
          intakeDate: "2026-09-20T09:05:00.000Z",
          presentingIssues: [],
          insurer: "Private",
          isArchived: false,
        };
        state.messageStatus = "linked";
        return json({ client: state.client, nextStep: "phone" });
      }
      if (url.pathname === "/api/clients" && url.searchParams.has("includeArchived")) {
        return json(state.client ? [state.client] : []);
      }
      if (url.pathname === "/api/clients/public/client-a") return json(state.client);
      if (url.pathname === "/api/clinicians") return json([]);
      if (url.pathname === "/api/non-engagement-categories") return json([]);
      if (url.pathname === "/api/stripe/status") return json({ connected: false });
      if (url.pathname === "/api/tenant/branding") return json({ name: tenant.name, logoUrl: null });
      if (url.pathname === "/api/public/form-completion-page/client-a") {
        return json({ heading: "Intake complete", body: "Thank you." });
      }
      if (url.pathname === "/api/form-drafts/client-a/intake-form-a") return json({ hasDraft: false });
      if (url.pathname === "/api/form-submissions" && method === "POST") {
        const request = JSON.parse(String(init?.body || "{}"));
        expect(request).toMatchObject({ clientId: "client-a", formId: "intake-form-a" });
        state.submissions.push(request);
        Object.assign(state.client!, {
          status: "Forms Completed",
          formsCompletedAt: "2026-09-20T09:15:00.000Z",
        });
        return json({ id: "submission-a", ...request });
      }
      if (url.pathname === "/api/clients/client-a/availability-preference") return json({});

      return json({ error: `Unhandled ${method} ${url.pathname}` }, 404);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("converts, completes the designated form, and reaches shared allocation without an intake delivery", async () => {
    const user = userEvent.setup();

    const inbox = show(<IntakeInbox />);
    await user.click(await screen.findByTestId("button-convert-message-a"));
    await user.click(await screen.findByTestId("button-confirm-convert"));
    await waitFor(() => expect(state.client?.contactPreference).toBe("phone"));
    expect(state.deliveries).toHaveLength(0);
    inbox.unmount();

    const pendingBoard = show(<Clients />);
    const pendingCard = await screen.findByTestId("kanban-card-client-a");
    await user.click(within(pendingCard).getByRole("button", { name: /fill by phone/i }));
    await user.click(await screen.findByTestId("button-start-phone-fill"));
    expect(openedUrls).toEqual([`${window.location.origin}/fill/client-a/intake-form-a`]);
    pendingBoard.unmount();

    window.history.pushState({}, "", "/fill/client-a/intake-form-a");
    const form = show(<FormFill />);
    await user.click(await screen.findByRole("button", { name: "Submit Form" }));
    expect(await screen.findByRole("heading", { name: "Intake complete" })).toBeTruthy();
    expect(state.submissions).toHaveLength(1);
    expect(state.client?.status).toBe("Forms Completed");
    expect(state.deliveries).toHaveLength(0);
    form.unmount();

    window.history.pushState({}, "", "/clients");
    show(<Clients />);
    const completedCard = await screen.findByTestId("kanban-card-client-a");
    expect(screen.getByRole("heading", { name: "Forms Completed" })).toBeTruthy();
    await user.click(within(completedCard).getByRole("button", { name: "Allocate" }));
    expect(await screen.findByRole("heading", { name: "Allocate Clinician Slot" })).toBeTruthy();
    expect(state.deliveries).toHaveLength(0);
  });
});