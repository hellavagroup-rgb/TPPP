import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({ db: dbMock }));

import {
  ClientAllocationUpdateError,
  DatabaseStorage,
} from "./storage";

type State = {
  slot: { id: string; isBooked: boolean };
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