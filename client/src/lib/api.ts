// API client for backend communication
import type { SafeUser } from "@shared/schema";

class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "APIError";
  }
}

async function fetchAPI(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "include", // Important for session cookies
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new APIError(response.status, error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============ AUTH API ============
export async function login(email: string, password: string): Promise<SafeUser> {
  const { user } = await fetchAPI("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return user;
}

export async function logout(): Promise<void> {
  await fetchAPI("/api/auth/logout", { method: "POST" });
}

export async function getCurrentUser(): Promise<SafeUser | null> {
  try {
    const { user } = await fetchAPI("/api/auth/me");
    return user;
  } catch (error) {
    if (error instanceof APIError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

// ============ CLINICIAN API ============
export async function getClinicians() {
  return fetchAPI("/api/clinicians");
}

export async function getMyClinician() {
  return fetchAPI("/api/clinicians/me");
}

export async function updateMyClinician(updates: any) {
  return fetchAPI("/api/clinicians/me", {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

// ============ TIME SLOTS API ============
export async function getTimeSlots(clinicianId: string) {
  return fetchAPI(`/api/timeslots/${clinicianId}`);
}

export async function updateTimeSlots(clinicianId: string, slots: any[]) {
  return fetchAPI(`/api/timeslots/${clinicianId}`, {
    method: "PUT",
    body: JSON.stringify(slots),
  });
}

// ============ CLIENT API ============
export async function getClients() {
  return fetchAPI("/api/clients");
}

export async function getClient(id: string) {
  return fetchAPI(`/api/clients/${id}`);
}

export async function createClient(client: any) {
  return fetchAPI("/api/clients", {
    method: "POST",
    body: JSON.stringify(client),
  });
}

export async function updateClient(id: string, updates: any) {
  return fetchAPI(`/api/clients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function assignClinician(clientId: string, clinicianId: string, slotId: string) {
  return fetchAPI(`/api/clients/${clientId}/assign`, {
    method: "POST",
    body: JSON.stringify({ clinicianId, slotId }),
  });
}

// ============ FORM API ============
export async function getForms() {
  return fetchAPI("/api/forms");
}

export async function getForm(id: string) {
  return fetchAPI(`/api/forms/${id}`);
}

export async function createForm(form: any) {
  return fetchAPI("/api/forms", {
    method: "POST",
    body: JSON.stringify(form),
  });
}

export async function updateForm(id: string, updates: any) {
  return fetchAPI(`/api/forms/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteForm(id: string) {
  return fetchAPI(`/api/forms/${id}`, {
    method: "DELETE",
  });
}

// ============ TASK API ============
export async function getTasks() {
  return fetchAPI("/api/tasks");
}

export async function createTask(task: any) {
  return fetchAPI("/api/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export async function updateTask(id: string, updates: any) {
  return fetchAPI(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}
