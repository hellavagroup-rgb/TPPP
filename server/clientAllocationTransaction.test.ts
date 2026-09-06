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
  failOn: "slot" | "client" | null,
) {
  dbMock.transaction.mockImplementation(async (callback) => {
    const draft = structuredClone(state);
    let updateNumber = 0;
    const tx = {
      update: vi.fn(() => {
        updateNumber += 1;
        const target = updateNumber === 1 ? "slot" : "client";
        let values: Record<string, unknown> = {};
        const query = {
          set(nextValues: Record<string, unknown>) {
            values = nextValues;
            return query;
          },
          where() {
            return query;
          },
          async returning() {
            if (target === failOn) {
              throw new Error(`${target} update failed`);
            }
            if (target === "slot") {
              Object.assign(draft.slot, values);
              return [{ id: draft.slot.id }];
            }
            Object.assign(draft.client, values);
            return [draft.client];
          },
        };
        return query;
      }),
    };

    try {
      const result = await callback(tx);
      Object.assign(state.slot, draft.slot);
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
      client: {
        id: "client-1",
        status: "Assigned",
        assignedSlotId: "slot-1",
        assignedSlot: "Monday 09:00",
        assignedClinicianId: "clinician-1",
      },
    };
  });

  it.each(["slot", "client"] as const)(
    "rolls back both records when the %s update fails",
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
    );

    expect(state.slot.isBooked).toBe(false);
    expect(state.client).toMatchObject({
      status: "Forms Completed",
      assignedSlotId: null,
      assignedSlot: null,
      assignedClinicianId: null,
    });
  });
});