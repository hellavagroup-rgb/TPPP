import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { availabilityTimeOffBlocks, tenants } from "@shared/schema";

const dbMock = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({ db: dbMock }));

import {
  ClientAllocationUpdateError,
  DatabaseStorage,
  ManualAssignmentError,
} from "./storage";

type State = {
  slot: { id: string; isBooked: boolean; retiredAt?: Date; retirementReason?: string };
  clinician: { id: string; currentLoad: number };
  client: {
    id: string;
    status: string;
    assignedSlotId: string | null;
    assignedSlot: string | null;
    assignedClinicianId: string | null;
  };
};

function transactionalState(
  state: State,
  failOn: "slot" | "clinician" | "client" | null,
) {
  dbMock.transaction.mockImplementation(async (callback) => {
    const draft = structuredClone(state);
    let updateNumber = 0;
    const tx = {
      delete: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
      update: vi.fn(() => {
        updateNumber += 1;
        const target = updateNumber === 1
          ? "slot"
          : updateNumber === 2
            ? "clinician"
            : "client";
        let values: Record<string, unknown> = {};
        const execute = async () => {
          if (target === failOn) {
            throw new Error(`${target} update failed`);
          }
          if (target === "slot") {
            Object.assign(draft.slot, values);
            return [{ id: draft.slot.id }];
          }
          if (target === "clinician") {
            draft.clinician.currentLoad = Math.max(draft.clinician.currentLoad - 1, 0);
            return [];
          }
          Object.assign(draft.client, values);
          return [draft.client];
        };
        const query = {
          set(nextValues: Record<string, unknown>) {
            values = nextValues;
            return query;
          },
          where() {
            return query;
          },
          returning() {
            return execute();
          },
          then<TResult1 = unknown, TResult2 = never>(
            onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            return execute().then(onfulfilled, onrejected);
          },
        };
        return query;
      }),
    };

    try {
      const result = await callback(tx);
      Object.assign(state.slot, draft.slot);
      Object.assign(state.clinician, draft.clinician);
      Object.assign(state.client, draft.client);
      return result;
    } catch (error) {
      throw error;
    }
  });
}

describe("DatabaseStorage.updateClientAndReleaseSlot", () => {
  let state: State;

  beforeEach(() => {
    dbMock.transaction.mockReset();
    state = {
      slot: { id: "slot-1", isBooked: true },
      clinician: { id: "clinician-1", currentLoad: 3 },
      client: {
        id: "client-1",
        status: "Assigned",
        assignedSlotId: "slot-1",
        assignedSlot: "Monday 09:00",
        assignedClinicianId: "clinician-1",
      },
    };
  });

  it.each(["slot", "clinician", "client"] as const)(
    "rolls back the slot, clinician, and client when the %s update fails",
    async (failurePoint) => {
      transactionalState(state, failurePoint);
      const original = structuredClone(state);
      const storage = new DatabaseStorage();

      await expect(storage.updateClientAndReleaseSlot(
        state.client.id,
        {
          status: "Forms Completed" as any,
          assignedSlotId: null,
          assignedSlot: null,
          assignedClinicianId: null,
        },
        state.slot.id,
        state.clinician.id,
      )).rejects.toBeInstanceOf(ClientAllocationUpdateError);

      expect(state).toEqual(original);
    },
  );

  it("does not reactivate a retired slot when returning a selected client for reallocation", async () => {
    state.client.status = "OptionSelected";
    state.slot.retiredAt = new Date("2026-09-01T12:00:00Z");
    state.slot.retirementReason = "No longer available";
    const retiredAt = state.slot.retiredAt;
    transactionalState(state, null);
    const storage = new DatabaseStorage();
    await storage.updateClientAndReleaseSlot(state.client.id, {
      status: "Forms Completed", assignedSlotId: null, assignedSlot: null, assignedClinicianId: null,
    }, state.slot.id, state.clinician.id, "tenant-a");
    expect(state.slot.isBooked).toBe(false);
    expect(state.slot.retiredAt).toEqual(retiredAt);
    expect(state.slot.retirementReason).toBe("No longer available");
    expect(state.client.status).toBe("Forms Completed");
  });

  it("commits the slot release and cleared client assignment together", async () => {
    transactionalState(state, null);
    const storage = new DatabaseStorage();

    await storage.updateClientAndReleaseSlot(
      state.client.id,
      {
        status: "Forms Completed" as any,
        assignedSlotId: null,
        assignedSlot: null,
        assignedClinicianId: null,
      },
      state.slot.id,
      state.clinician.id,
    );

    expect(state.slot.isBooked).toBe(false);
    expect(state.clinician.currentLoad).toBe(2);
    expect(state.client).toMatchObject({
      status: "Forms Completed",
      assignedSlotId: null,
      assignedSlot: null,
      assignedClinicianId: null,
    });
  });

  it("does not decrement the clinician workload below zero", async () => {
    state.clinician.currentLoad = 0;
    transactionalState(state, null);
    const storage = new DatabaseStorage();

    await storage.updateClientAndReleaseSlot(
      state.client.id,
      {
        status: "Forms Completed" as any,
        assignedSlotId: null,
        assignedSlot: null,
        assignedClinicianId: null,
      },
      state.slot.id,
      state.clinician.id,
    );

    expect(state.clinician.currentLoad).toBe(0);
  });
});

type AssignmentState = {
  client: {
    id: string;
    tenantId: string;
    displayId: string;
    status: string;
    completedAt?: Date | null;
    assignedSlotId: string | null;
    assignedSlot: string | null;
    assignedClinicianId: string | null;
  };
  clinician: { id: string; tenantId: string; currentLoad: number };
  slot: {
    id: string;
    tenantId: string;
    clinicianId: string;
    isBooked: boolean;
    type: "Recurring" | "SpecificDate";
    day: string | null;
    date: string | null;
    startTime: string;
    startDate?: string | null;
    endDate?: string | null;
    retiredAt?: Date | null;
  };
};

function assignmentTransactions(
  state: AssignmentState,
  failOn: "slot" | "clinician" | "client" | null = null,
  missing: "client" | "clinician" | "slot" | null = null,
) {
  let previous = Promise.resolve();
  dbMock.transaction.mockImplementation(async (callback) => {
    const run = previous.then(async () => {
      const draft = structuredClone(state);
      let selectNumber = 0;
      let updateNumber = 0;
      const tx = {
        select: vi.fn(() => {
          selectNumber += 1;
          const row = selectNumber === 1
            ? (missing === "client" ? undefined : draft.client)
            : selectNumber === 2
              ? (missing === "clinician" ? undefined : draft.clinician)
              : (missing === "slot" ? undefined : draft.slot);
          const query = {
            from() {
              return query;
            },
            where() {
              return query;
            },
            for: vi.fn(async () => [row]),
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve([row]).then(onfulfilled, onrejected);
            },
          };
          return query;
        }),
        update: vi.fn(() => {
          updateNumber += 1;
          const target = updateNumber === 1
            ? "slot"
            : updateNumber === 2
              ? "clinician"
              : "client";
          let values: Record<string, unknown> = {};
          const execute = async () => {
            if (target === failOn) throw new Error(`${target} update failed`);
            if (target === "slot") {
              if (draft.slot.isBooked) return [];
              Object.assign(draft.slot, values);
              return [{ id: draft.slot.id }];
            }
            if (target === "clinician") {
              draft.clinician.currentLoad += 1;
              return [{ id: draft.clinician.id }];
            }
            Object.assign(draft.client, values);
            return [draft.client];
          };
          const query = {
            set(nextValues: Record<string, unknown>) {
              values = nextValues;
              return query;
            },
            where() {
              return query;
            },
            returning() {
              return execute();
            },
          };
          return query;
        }),
      };

      const result = await callback(tx);
      Object.assign(state.slot, draft.slot);
      Object.assign(state.clinician, draft.clinician);
      Object.assign(state.client, draft.client);
      return result;
    });
    previous = run.then(() => undefined, () => undefined);
    return run;
  });
}

describe("DatabaseStorage.assignClinicianToClient", () => {
  let state: AssignmentState;

  beforeEach(() => {
    dbMock.transaction.mockReset();
    state = {
      client: {
        id: "client-1",
        tenantId: "tenant-1",
        displayId: "W00000001",
        status: "Forms Completed",
        assignedSlotId: null,
        assignedSlot: null,
        assignedClinicianId: null,
      },
      clinician: { id: "clinician-1", tenantId: "tenant-1", currentLoad: 2 },
      slot: {
        id: "slot-1",
        tenantId: "tenant-1",
        clinicianId: "clinician-1",
        isBooked: false,
        type: "Recurring",
        day: "Monday",
        date: null,
        startTime: "09:00",
      },
    };
  });

  it("cannot allocate another slot to a completed booking until it is reopened", async () => {
    state.client.completedAt = new Date("2026-04-12");
    assignmentTransactions(state);
    const before = structuredClone(state);
    await expect(new DatabaseStorage().assignClinicianToClient(
      "client-1", "clinician-1", "slot-1", "tenant-1",
    )).rejects.toThrow("Reopen this completed booking");
    expect(state).toEqual(before);
  });

  it("claims the slot, increments workload, and assigns the client atomically", async () => {
    assignmentTransactions(state);

    const result = await new DatabaseStorage().assignClinicianToClient(
      "client-1", "clinician-1", "slot-1", "tenant-1", "manual", "Admin choice",
    );

    expect(result).toMatchObject({
      status: "Assigned",
      assignedClinicianId: "clinician-1",
      assignedSlotId: "slot-1",
      assignedSlot: "Monday 09:00",
    });
    expect(state.slot.isBooked).toBe(true);
    expect(state.clinician.currentLoad).toBe(3);
  });

  it.each(["client", "clinician", "slot"] as const)(
    "rejects a cross-tenant %s without changing any records",
    async (resource) => {
      state[resource].tenantId = "tenant-2";
      assignmentTransactions(state);
      const original = structuredClone(state);

      await expect(new DatabaseStorage().assignClinicianToClient(
        "client-1", "clinician-1", "slot-1", "tenant-1",
      )).rejects.toMatchObject({ reason: "access_denied" });
      expect(state).toEqual(original);
    },
  );

  it.each([
    ["client", "client_not_found"],
    ["clinician", "clinician_not_found"],
    ["slot", "slot_not_found"],
  ] as const)("reports a missing %s without changing any records", async (resource, reason) => {
    assignmentTransactions(state, null, resource);
    const original = structuredClone(state);

    await expect(new DatabaseStorage().assignClinicianToClient(
      "client-1", "clinician-1", "slot-1", "tenant-1",
    )).rejects.toMatchObject({ reason });
    expect(state).toEqual(original);
  });

  it("rejects a slot owned by a different clinician", async () => {
    state.slot.clinicianId = "clinician-2";
    assignmentTransactions(state);
    const original = structuredClone(state);

    await expect(new DatabaseStorage().assignClinicianToClient(
      "client-1", "clinician-1", "slot-1", "tenant-1",
    )).rejects.toMatchObject({ reason: "slot_clinician_mismatch" });
    expect(state).toEqual(original);
  });

  it("rejects a client with only a legacy assigned-slot marker", async () => {
    state.client.assignedSlot = "Tuesday 14:00";
    assignmentTransactions(state);
    const original = structuredClone(state);

    await expect(new DatabaseStorage().assignClinicianToClient(
      "client-1", "clinician-1", "slot-1", "tenant-1",
    )).rejects.toMatchObject({ reason: "client_already_assigned" });
    expect(state).toEqual(original);
  });

  it("rejects an occupied slot without changing client or workload", async () => {
    state.slot.isBooked = true;
    assignmentTransactions(state);
    const original = structuredClone(state);

    await expect(new DatabaseStorage().assignClinicianToClient(
      "client-1", "clinician-1", "slot-1", "tenant-1",
    )).rejects.toMatchObject({ reason: "slot_unavailable" });
    expect(state).toEqual(original);
  });

  it.each(["tenant-1", "tenant-2"])("reserves a pending recurring slot for %s without changing its start date", async tenantId => {
    state.client.tenantId = tenantId;
    state.clinician.tenantId = tenantId;
    state.slot.tenantId = tenantId;
    state.slot.startDate = "2999-01-01";
    assignmentTransactions(state);

    const result = await new DatabaseStorage().assignClinicianToClient(
      "client-1", "clinician-1", "slot-1", tenantId,
    );
    expect(result).toMatchObject({ status: "Assigned", assignedSlotId: "slot-1" });
    expect(state.slot.isBooked).toBe(true);
    expect(state.slot.startDate).toBe("2999-01-01");
    expect(state.clinician.currentLoad).toBe(3);
  });

  it.each([
    ["expired one-off", { type: "SpecificDate", date: "2000-01-01" }, "slot_unavailable"],
    ["expired recurring window", { type: "Recurring", endDate: "2000-01-01" }, "slot_unavailable"],
    ["vacation", { type: "Vacation" }, "slot_unavailable"],
    ["retired slot", { retiredAt: new Date("2026-01-01") }, "access_denied"],
    ["booked slot", { isBooked: true }, "slot_unavailable"],
    ["invalid one-off date", { type: "SpecificDate", date: "2026-02-30" }, "slot_unavailable"],
  ])("does not assign an %s", async (_description, slotPatch, reason) => {
    Object.assign(state.slot, slotPatch);
    assignmentTransactions(state);
    const original = structuredClone(state);

    await expect(new DatabaseStorage().assignClinicianToClient(
      "client-1", "clinician-1", "slot-1", "tenant-1",
    )).rejects.toMatchObject({ reason });
    expect(state).toEqual(original);
  });

  it("allows only one of two concurrent claims to commit", async () => {
    assignmentTransactions(state);
    const storage = new DatabaseStorage();

    const results = await Promise.allSettled([
      storage.assignClinicianToClient("client-1", "clinician-1", "slot-1", "tenant-1"),
      storage.assignClinicianToClient("client-1", "clinician-1", "slot-1", "tenant-1"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ reason: "slot_unavailable" }),
    });
    expect(state.clinician.currentLoad).toBe(3);
  });

  it("allows only one of two different clients to claim the same slot concurrently", async () => {
    let transactionNumber = 0;
    let slotClaimed = false;
    let workloadIncrements = 0;
    let clientAssignments = 0;
    const slotClaimQueries: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    dbMock.transaction.mockImplementation(async (callback) => {
      transactionNumber += 1;
      const clientNumber = transactionNumber;
      let selectNumber = 0;
      let updateNumber = 0;
      const tx = {
        select: vi.fn(() => {
          selectNumber += 1;
          const row = selectNumber === 1
            ? { ...state.client, id: `client-${clientNumber}` }
            : selectNumber === 2
              ? state.clinician
              : state.slot;
          const query = {
            from() {
              return query;
            },
            where() {
              return query;
            },
            async for() {
              await Promise.resolve();
              return [row];
            },
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve([row]).then(onfulfilled, onrejected);
            },
          };
          return query;
        }),
        update: vi.fn(() => {
          updateNumber += 1;
          const target = updateNumber === 1
            ? "slot"
            : updateNumber === 2
              ? "clinician"
              : "client";
          const query = {
            set() {
              return query;
            },
            where(condition: unknown) {
              if (target === "slot") {
                slotClaimQueries.push(dialect.sqlToQuery(condition as any));
              }
              return query;
            },
            async returning() {
              if (target === "slot") {
                if (slotClaimed) return [];
                slotClaimed = true;
                return [{ id: state.slot.id }];
              }
              if (target === "clinician") {
                workloadIncrements += 1;
                return [{ id: state.clinician.id }];
              }
              clientAssignments += 1;
              return [{ ...state.client, id: `client-${clientNumber}`, status: "Assigned" }];
            },
          };
          return query;
        }),
      };
      return callback(tx);
    });

    const storage = new DatabaseStorage();
    const results = await Promise.allSettled([
      storage.assignClinicianToClient("client-1", "clinician-1", "slot-1", "tenant-1"),
      storage.assignClinicianToClient("client-2", "clinician-1", "slot-1", "tenant-1"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(workloadIncrements).toBe(1);
    expect(clientAssignments).toBe(1);
    expect(slotClaimQueries).toHaveLength(2);
    for (const claim of slotClaimQueries) {
      expect(claim.sql).toContain('"time_slots"."id" = ');
      expect(claim.sql).toContain('"time_slots"."tenant_id" = ');
      expect(claim.sql).toContain('"time_slots"."clinician_id" = ');
      expect(claim.sql).toContain('"time_slots"."is_booked" = ');
      expect(claim.params).toEqual(["slot-1", "tenant-1", "clinician-1", false]);
    }
  });

  it.each(["slot", "clinician", "client"] as const)(
    "rolls back every assignment mutation when the %s update fails",
    async (failurePoint) => {
      assignmentTransactions(state, failurePoint);
      const original = structuredClone(state);

      await expect(new DatabaseStorage().assignClinicianToClient(
        "client-1", "clinician-1", "slot-1", "tenant-1",
      )).rejects.toBeInstanceOf(ManualAssignmentError);
      expect(state).toEqual(original);
    },
  );
});

type ReassignmentState = {
  client: AssignmentState["client"];
  oldClinician: AssignmentState["clinician"];
  newClinician: AssignmentState["clinician"];
  oldSlot: AssignmentState["slot"];
  newSlot: AssignmentState["slot"];
};

function reassignmentTransactions(
  state: ReassignmentState,
  failOn: "claim" | "release" | "oldClinician" | "client" | "newClinician" | null = null,
) {
  let previous = Promise.resolve();
  const claimQueries: Array<{ sql: string; params: unknown[] }> = [];
  const lockRequests: string[] = [];
  const dialect = new PgDialect();
  dbMock.transaction.mockImplementation(async (callback) => {
    const run = previous.then(async () => {
      const draft = structuredClone(state);
      let selectNumber = 0;
      let updateNumber = 0;
      const tx = {
        select: vi.fn(() => {
          selectNumber += 1;
          const rows = [
            draft.client.tenantId === "tenant-1" ? draft.client : undefined,
            draft.oldClinician.tenantId === "tenant-1" ? draft.oldClinician : undefined,
            draft.newClinician.tenantId === "tenant-1" ? draft.newClinician : undefined,
            draft.newSlot.tenantId === "tenant-1" ? draft.newSlot : undefined,
          ];
          let selectedRows: unknown[] = [rows[selectNumber - 1]].filter(Boolean);
          const query = {
            from(table: unknown) {
              // These fixtures exercise allocation atomicity without time off.
              // Configuration/block reads are separate from the four ownership
              // reads above and must return real empty results, not [undefined].
              if (table === tenants) selectedRows = [{ enabled: false }];
              if (table === availabilityTimeOffBlocks) selectedRows = [];
              return query;
            },
            where() { return query; },
            limit: async (count: number) => selectedRows.slice(0, count),
            for: vi.fn(async (mode: string) => {
              lockRequests.push(mode);
              return selectedRows;
            }),
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve(selectedRows).then(onfulfilled, onrejected);
            },
          };
          return query;
        }),
        update: vi.fn(() => {
          updateNumber += 1;
          let target = (["claim", "release", "oldClinician", "client", "newClinician"] as const)[updateNumber - 1];
          let values: Record<string, unknown> = {};
          const query = {
            set(nextValues: Record<string, unknown>) {
              values = nextValues;
              // A duplicate request sees the newly assigned slot while holding
              // the client lock, so it becomes a status-only client update.
              if (updateNumber === 1 && "status" in nextValues) target = "client";
              return query;
            },
            where(condition: unknown) {
              if (target === "claim") claimQueries.push(dialect.sqlToQuery(condition as any));
              return query;
            },
            async returning() {
              if (target === failOn) throw new Error(`${target} update failed`);
              if (target === "claim") {
                if (draft.newSlot.isBooked) return [];
                Object.assign(draft.newSlot, values);
                return [{ id: draft.newSlot.id }];
              }
              if (target === "release") {
                Object.assign(draft.oldSlot, values);
                return [];
              }
              if (target === "oldClinician") {
                draft.oldClinician.currentLoad = Math.max(0, draft.oldClinician.currentLoad - 1);
                return [];
              }
              if (target === "client") {
                Object.assign(draft.client, values);
                return [draft.client];
              }
              draft.newClinician.currentLoad += 1;
              return [{ id: draft.newClinician.id }];
            },
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return query.returning().then(onfulfilled, onrejected);
            },
          };
          return query;
        }),
      };
      const result = await callback(tx);
      Object.assign(state.client, draft.client);
      Object.assign(state.oldClinician, draft.oldClinician);
      Object.assign(state.newClinician, draft.newClinician);
      Object.assign(state.oldSlot, draft.oldSlot);
      Object.assign(state.newSlot, draft.newSlot);
      return result;
    });
    previous = run.then(() => undefined, () => undefined);
    return run;
  });
  return { claimQueries, lockRequests };
}

describe("DatabaseStorage.reassignClient", () => {
  let state: ReassignmentState;

  beforeEach(() => {
    dbMock.transaction.mockReset();
    state = {
      client: {
        id: "client-1",
        tenantId: "tenant-1",
        displayId: "W00000001",
        status: "Assigned",
        assignedSlotId: "slot-old",
        assignedSlot: "Monday 09:00",
        assignedClinicianId: "clinician-old",
      },
      oldClinician: { id: "clinician-old", tenantId: "tenant-1", currentLoad: 3 },
      newClinician: { id: "clinician-new", tenantId: "tenant-1", currentLoad: 1 },
      oldSlot: {
        id: "slot-old", tenantId: "tenant-1", clinicianId: "clinician-old",
        isBooked: true, type: "Recurring", day: "Monday", date: null, startTime: "09:00",
      },
      newSlot: {
        id: "slot-new", tenantId: "tenant-1", clinicianId: "clinician-new",
        isBooked: false, type: "Recurring", day: "Tuesday", date: null, startTime: "10:00",
      },
    };
  });

  it("rejects status edits on completed bookings until the booking is explicitly reopened", async () => {
    state.client.status = "BookingConfirmed";
    state.client.completedAt = new Date("2026-04-12");
    reassignmentTransactions(state);
    const before = structuredClone(state);
    const storage = new DatabaseStorage();

    await expect(storage.reassignClient(
      "client-1", "clinician-old", "slot-old", "Assigned", "tenant-1",
    )).rejects.toThrow("Reopen this completed booking");
    expect(state).toEqual(before);

    // The dedicated reopen route clears completedAt and writes its audit event.
    state.client.completedAt = null;
    const result = await storage.reassignClient(
      "client-1", "clinician-old", "slot-old", "Assigned", "tenant-1",
    );
    expect(result?.client.status).toBe("Assigned");
    expect(state.client.completedAt).toBeNull();
  });

  it.each(["client", "oldClinician", "newClinician", "newSlot"] as const)(
    "rejects a cross-tenant %s without changing records",
    async (resource) => {
      state[resource].tenantId = "tenant-2";
      reassignmentTransactions(state);
      const original = structuredClone(state);

      const operation = new DatabaseStorage().reassignClient(
        "client-1", "clinician-new", "slot-new", "Assigned", "tenant-1",
      );
      if (resource === "client") await expect(operation).resolves.toBeUndefined();
      else await expect(operation).rejects.toBeTruthy();
      expect(state).toEqual(original);
    },
  );

  it("claims only an available tenant-and-clinician-scoped slot", async () => {
    const { claimQueries, lockRequests } = reassignmentTransactions(state);

    await new DatabaseStorage().reassignClient(
      "client-1", "clinician-new", "slot-new", "Assigned", "tenant-1",
    );

    expect(lockRequests).toEqual(["update", "update", "update"]);
    expect(claimQueries).toHaveLength(1);
    expect(claimQueries[0].sql).toContain('"time_slots"."tenant_id" = ');
    expect(claimQueries[0].sql).toContain('"time_slots"."clinician_id" = ');
    expect(claimQueries[0].sql).toContain('"time_slots"."is_booked" = ');
    expect(claimQueries[0].params).toEqual(["slot-new", "tenant-1", "clinician-new", false]);
    expect(state).toMatchObject({
      client: { assignedClinicianId: "clinician-new", assignedSlotId: "slot-new" },
      oldClinician: { currentLoad: 2 },
      newClinician: { currentLoad: 2 },
      oldSlot: { isBooked: false },
      newSlot: { isBooked: true },
    });
  });

  it("rejects an occupied new slot without releasing the old allocation", async () => {
    state.newSlot.isBooked = true;
    reassignmentTransactions(state);
    const original = structuredClone(state);

    await expect(new DatabaseStorage().reassignClient(
      "client-1", "clinician-new", "slot-new", "Assigned", "tenant-1",
    )).rejects.toThrow("Slot is already booked");
    expect(state).toEqual(original);
  });

  it("rejects a different clinician paired with the client's current slot", async () => {
    reassignmentTransactions(state);
    const original = structuredClone(state);

    await expect(new DatabaseStorage().reassignClient(
      "client-1", "clinician-new", "slot-old", "Assigned", "tenant-1",
    )).rejects.toThrow("Current slot does not belong to selected clinician");
    expect(state).toEqual(original);
  });

  it("lets only one of two competing reassignment requests commit", async () => {
    reassignmentTransactions(state);
    const storage = new DatabaseStorage();
    const results = await Promise.allSettled([
      storage.reassignClient("client-1", "clinician-new", "slot-new", "Assigned", "tenant-1"),
      storage.reassignClient("client-1", "clinician-new", "slot-new", "Assigned", "tenant-1"),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
    expect(state.oldClinician.currentLoad).toBe(2);
    expect(state.newClinician.currentLoad).toBe(2);
    expect(state.client.assignedSlotId).toBe("slot-new");
  });

  it.each(["claim", "release", "oldClinician", "client", "newClinician"] as const)(
    "rolls back all reassignment mutations when the %s mutation fails",
    async (failurePoint) => {
      reassignmentTransactions(state, failurePoint);
      const original = structuredClone(state);

      await expect(new DatabaseStorage().reassignClient(
        "client-1", "clinician-new", "slot-new", "Assigned", "tenant-1",
      )).rejects.toThrow();
      expect(state).toEqual(original);
    },
  );
});