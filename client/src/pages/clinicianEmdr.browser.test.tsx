// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Clinicians from "./clinicians";
import ClinicianProfile from "./clinician-profile";

const h = vi.hoisted(() => ({ toast: vi.fn(), role: "admin" }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "clinician-user", email: "clinician@example.com", role: h.role, name: "Clinician" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/use-insurers", () => ({ useInsurers: () => ({ data: [] }) }));

const caches: QueryClient[] = [];
afterEach(() => {
  cleanup();
  caches.splice(0).forEach(cache => cache.clear());
  h.toast.mockClear();
  h.role = "admin";
  vi.unstubAllGlobals();
});

function setupDirectory() {
  const writes: Array<{ path: string; body: any }> = [];
  let clinicians = [
    {
      id: "clinician-a", userId: "clinician-user", name: "Clinician A",
      email: "clinician@example.com", avatar: "CA", isActive: true,
      tier: "Mid", capacity: 15, maxNewClients: 3, specialties: [],
      worksWithCouples: false, allocateForBupa: false, emdrTrained: false,
      insurers: [], contactMethods: [],
    },
    {
      id: "clinician-b", userId: "other-user", name: "Clinician B",
      email: "other@example.com", avatar: "CB", isActive: true,
      tier: "Mid", capacity: 15, maxNewClients: 3, specialties: [],
      worksWithCouples: false, allocateForBupa: false, emdrTrained: true,
      insurers: [], contactMethods: [],
    },
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (init?.method === "PATCH" || init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      if (path === "/api/clinicians/clinician-a") {
        clinicians = clinicians.map(clinician => clinician.id === "clinician-a" ? { ...clinician, ...body } : clinician);
      }
      return new Response(JSON.stringify(path.endsWith("/with-user") ? { clinician: body } : body));
    }
    const data = path === "/api/clinicians" ? clinicians
      : path === "/api/tenant" ? {}
        : path === "/api/stripe/status" ? { configured: false }
          : [];
    return new Response(JSON.stringify(data));
  }));

  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() },
      mutations: { retry: false },
    },
  });
  caches.push(cache);
  render(<QueryClientProvider client={cache}><Clinicians /></QueryClientProvider>);
  return { writes };
}

it("shows the directory EMDR badge only for clinicians whose status is marked", async () => {
  setupDirectory();
  const markedCard = await screen.findByTestId("card-clinician-clinician-b");
  expect(markedCard.textContent).toContain("EMDR Trained");
  expect(screen.getByTestId("card-clinician-clinician-a").textContent).not.toContain("EMDR Trained");
});

it("lets an administrator mark an existing clinician as EMDR trained", async () => {
  const { writes } = setupDirectory();
  await screen.findByTestId("card-clinician-clinician-a");
  fireEvent.click(screen.getByTestId("button-edit-clinician-a"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "EMDR Trained" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => expect(writes).toEqual([{
    path: "/api/clinicians/clinician-a",
    body: expect.objectContaining({ emdrTrained: true }),
  }]));
});

it("includes an explicit EMDR-trained choice when an administrator creates a clinician", async () => {
  const { writes } = setupDirectory();
  fireEvent.click(await screen.findByTestId("button-add-clinician"));
  fireEvent.change(screen.getByTestId("input-new-clinician-name"), { target: { value: "New Clinician" } });
  fireEvent.change(screen.getByTestId("input-new-clinician-email"), { target: { value: "new@example.com" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "EMDR Trained" }));
  fireEvent.click(screen.getByTestId("button-submit-clinician"));

  await waitFor(() => expect(writes).toEqual([{
    path: "/api/clinicians/with-user",
    body: expect.objectContaining({ name: "New Clinician", email: "new@example.com", emdrTrained: true }),
  }]));
});

it("lets a clinician update only their own profile through the self-service route", async () => {
  h.role = "clinician";
  const writes: Array<{ path: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (init?.method === "PATCH") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ emdrTrained: true }));
    }
    if (path === "/api/clinicians/me") {
      return new Response(JSON.stringify({
        id: "own-clinician", userId: "clinician-user", avatar: "C", bio: "",
        location: "", nhsTrust: "", tier: "Mid", insurers: [], maxNewClients: 3,
        worksWithCouples: false, allocateForBupa: false, emdrTrained: false,
        email: "clinician@example.com", availability: [],
      }));
    }
    return new Response(JSON.stringify([]));
  }));
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() },
      mutations: { retry: false },
    },
  });
  caches.push(cache);
  render(<QueryClientProvider client={cache}><ClinicianProfile /></QueryClientProvider>);

  fireEvent.click(await screen.findByRole("checkbox", { name: "EMDR Trained" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(writes).toEqual([{
    path: "/api/clinicians/me",
    body: expect.objectContaining({ emdrTrained: true }),
  }]));
  expect(writes[0].path).not.toContain("own-clinician");
});
