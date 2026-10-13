// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DynamicFormFields } from "./DynamicFormFields";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ selected, onSelect }: any) => <div>
    <span data-testid="selected">{selected ? `${selected.getFullYear()}-${selected.getMonth() + 1}-${selected.getDate()}` : "empty"}</span>
    <button onClick={() => onSelect(new Date(1992, 8, 14))}>Choose DOB</button>
    <button onClick={() => onSelect(undefined)}>Clear DOB</button>
  </div>,
}));
afterEach(cleanup);
const fields = [{ id: "dob", type: "date", label: "Date of Birth", required: true }];

it("stores a selected DOB as a date-only value, never a UTC timestamp", () => {
  const onChange = vi.fn();
  render(<DynamicFormFields fields={fields} values={{}} onChange={onChange} />);
  fireEvent.click(screen.getByText("Choose DOB"));
  expect(onChange).toHaveBeenCalledWith("dob", "1992-09-14");
  fireEvent.click(screen.getByText("Clear DOB"));
  expect(onChange).toHaveBeenLastCalledWith("dob", undefined);
});

it("renders a saved draft DOB and restores its calendar selection", () => {
  render(<DynamicFormFields fields={fields} values={{ dob: "1992-09-14" }} onChange={vi.fn()} />);
  expect(screen.getByText("14/09/1992")).toBeTruthy();
  expect(screen.getByTestId("selected").textContent).toBe("1992-9-14");
});
