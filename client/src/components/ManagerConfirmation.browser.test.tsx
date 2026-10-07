// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManagerConfirmationDialog, ManagerConfirmedBadge } from "./ManagerConfirmationDialog";
import { ManagerConfirmationSettings } from "./ManagerConfirmationSettings";

const fixture = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "manager-1", role: fixture.role, name: "Manager Fixture" } }),
}));
const caches: QueryClient[] = [];
beforeEach(() => {
  fixture.role = "admin";
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  caches.splice(0).forEach(cache => cache.clear());
  vi.unstubAllGlobals();
});

function wrap(node: React.ReactNode) {
  const cache = new QueryClient({ defaultOptions: {
    queries: {
      retry: false,
      queryFn: async ({ queryKey }) => {
        const response = await fetch(queryKey.join("/"));
        if (!response.ok) throw new Error("Could not load");
        return response.json();
      },
    },
    mutations: { retry: false },
  } });
  caches.push(cache);
  return render(<QueryClientProvider client={cache}>{node}</QueryClientProvider>);
}
const choices = [
  { id: "client-a", displayId: "WU-FIXTURE", status: "RegistrationPending" },
  { id: "client-b", displayId: "WU-ARCHIVED", status: "New", isArchived: true },
  { id: "client-c", displayId: "WU-CONFIRMED", status: "Scheduled" },
];

describe("manager confirmation dialog", () => {
  it("requires a reason and masked PIN, posts only override fields, and shows saved confirmation", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
      posts.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ confirmed: true }), { status: 200 });
    }));
    const close = vi.fn();
    wrap(<ManagerConfirmationDialog open onOpenChange={close} clients={choices} initialClientId="client-a" />);
    const save = screen.getByRole("button", { name: "Move to Confirmed" });
    expect(save).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Manager PIN")).toHaveProperty("type", "password");
    fireEvent.change(screen.getByLabelText("Manager PIN"), { target: { value: "864209" } });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Reason for manager confirmation"), { target: { value: "Confirmed in practice records." } });
    expect(save).toHaveProperty("disabled", false);
    fireEvent.click(save);
    await screen.findByRole("status");
    expect(posts).toEqual([{ pin: "864209", reason: "Confirmed in practice records." }]);
    expect(screen.getByRole("status").textContent).toContain("WU-FIXTURE moved to Confirmed");
    expect(screen.queryByLabelText("Manager PIN")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(close).toHaveBeenCalledWith(false);
  });

  it("keeps a failed confirmation open, clears the PIN and preserves the reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Incorrect manager PIN." }), { status: 403 })));
    const close = vi.fn();
    wrap(<ManagerConfirmationDialog open onOpenChange={close} clients={choices} initialClientId="client-a" />);
    fireEvent.change(screen.getByLabelText("Manager PIN"), { target: { value: "000000" } });
    fireEvent.change(screen.getByLabelText("Reason for manager confirmation"), { target: { value: "Confirmed in practice records." } });
    fireEvent.click(screen.getByRole("button", { name: "Move to Confirmed" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Incorrect manager PIN.");
    expect(screen.getByLabelText("Manager PIN")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Reason for manager confirmation")).toHaveProperty("value", "Confirmed in practice records.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it("does not claim a new manager override if the client was confirmed concurrently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ confirmed: true, alreadyConfirmed: true }))));
    wrap(<ManagerConfirmationDialog open onOpenChange={vi.fn()} clients={choices} initialClientId="client-a" />);
    fireEvent.change(screen.getByLabelText("Manager PIN"), { target: { value: "864209" } });
    fireEvent.change(screen.getByLabelText("Reason for manager confirmation"), { target: { value: "Confirmed in practice records." } });
    fireEvent.click(screen.getByRole("button", { name: "Move to Confirmed" }));
    expect((await screen.findByRole("status")).textContent).toContain("No additional override was made");
  });

  it("blocks duplicate submissions while a confirmation is pending", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    wrap(<ManagerConfirmationDialog open onOpenChange={vi.fn()} clients={choices} initialClientId="client-a" />);
    fireEvent.change(screen.getByLabelText("Manager PIN"), { target: { value: "864209" } });
    fireEvent.change(screen.getByLabelText("Reason for manager confirmation"), { target: { value: "Confirmed in practice records." } });
    fireEvent.click(screen.getByRole("button", { name: "Move to Confirmed" }));
    expect(await screen.findByRole("button", { name: "Confirming…" })).toHaveProperty("disabled", true);
    expect(fetchMock).toHaveBeenCalledOnce();
    finish(new Response(JSON.stringify({ confirmed: true })));
    await screen.findByRole("status");
  });

  it("does not let an archived initial client be confirmed", () => {
    wrap(<ManagerConfirmationDialog open onOpenChange={vi.fn()} clients={choices} initialClientId="client-b" />);
    fireEvent.change(screen.getByLabelText("Manager PIN"), { target: { value: "864209" } });
    fireEvent.change(screen.getByLabelText("Reason for manager confirmation"), { target: { value: "Confirmed in practice records." } });
    expect(screen.getByRole("button", { name: "Move to Confirmed" })).toHaveProperty("disabled", true);
  });

  it("clearly labels a manual confirmation without claiming payment or registration was verified", () => {
    wrap(<ManagerConfirmedBadge at="2026-10-07T12:00:00Z" reason="Historical appointment confirmed by manager." />);
    expect(screen.getByText("Manager confirmed · manual override")).toBeTruthy();
    expect(screen.getByText("Historical appointment confirmed by manager.")).toBeTruthy();
    expect(screen.getByText(/Payment and registration evidence were not changed/)).toBeTruthy();
  });
});

describe("manager confirmation settings", () => {
  function setup(configured = false, canConfigure = true) {
    let access = { configured, canConfigure, canOverride: configured && canConfigure,
      managerUserIds: configured ? ["manager-1"] : [], updatedAt: configured ? "2026-10-01T12:00:00Z" : null };
    const saves: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      if (String(input) === "/api/admin-users") return new Response(JSON.stringify([
        { id: "manager-1", name: "Manager Fixture", email: "manager@example.test" },
        { id: "ordinary-1", name: "Admin Fixture", email: "admin@example.test" },
      ]));
      if (init?.method === "PUT") {
        saves.push(JSON.parse(init.body));
        access = { ...access, configured: true, canOverride: true, managerUserIds: saves[0].managerUserIds, updatedAt: "2026-10-07T12:00:00Z" };
        return new Response(JSON.stringify({ saved: true }));
      }
      return new Response(JSON.stringify(access));
    }));
    wrap(<ManagerConfirmationSettings />);
    return saves;
  }

  it("allows private PIN setup for selected admins, requiring account password and repeated PIN", async () => {
    const saves = setup();
    await screen.findByLabelText("Manager PIN");
    expect(screen.getByLabelText(/Manager Fixture/)).toHaveProperty("checked", true);
    expect(screen.getByLabelText(/Admin Fixture/)).toHaveProperty("checked", false);
    fireEvent.click(screen.getByLabelText(/Admin Fixture/));
    const save = screen.getByRole("button", { name: "Save manager confirmation settings" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Manager PIN"), { target: { value: "864209" } });
    fireEvent.change(screen.getByLabelText("Repeat new manager PIN"), { target: { value: "864210" } });
    fireEvent.change(screen.getByLabelText("Your account password"), { target: { value: "account-fixture" } });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Repeat new manager PIN"), { target: { value: "864209" } });
    fireEvent.click(save);
    await screen.findByRole("status");
    expect(saves).toEqual([{
      currentPassword: "account-fixture", newPin: "864209",
      managerUserIds: ["manager-1", "ordinary-1"], expectedUpdatedAt: null,
    }]);
    expect(screen.getByLabelText("Your account password")).toHaveProperty("value", "");
  });

  it("does not show a PIN or permission editor to an unselected administrator", async () => {
    setup(true, false);
    await screen.findByText(/Only selected managers can change these settings/);
    expect(screen.queryByLabelText("Your account password")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the current PIN when selected managers only change permissions", async () => {
    const saves = setup(true);
    await screen.findByLabelText("New manager PIN (optional)");
    fireEvent.change(screen.getByLabelText("Your account password"), { target: { value: "account-fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "Save manager confirmation settings" }));
    await screen.findByRole("status");
    expect(saves[0]).not.toHaveProperty("newPin");
    expect(saves[0].expectedUpdatedAt).toBe("2026-10-01T12:00:00Z");
  });

  it("does not show manager settings to clinicians", () => {
    fixture.role = "clinician";
    vi.stubGlobal("fetch", vi.fn());
    wrap(<ManagerConfirmationSettings />);
    expect(screen.queryByText("Manager confirmation")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
