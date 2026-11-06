// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InsurancePaymentDetails } from "./InsurancePaymentDetails";
afterEach(cleanup);
it("renders stored insurer, policy and authorisation evidence", () => {
  render(<InsurancePaymentDetails client={{ paymentType: "insurer", insurerDetails: "Insurer name: Test Insurer\nInsurance policy number: POLICY-TEST\nPreauthorisation code: AUTH-TEST" }} />);
  expect(screen.getByRole("region", { name: "Insurance details" })).toBeTruthy();
  for (const text of ["Test Insurer", "POLICY-TEST", "AUTH-TEST"]) expect(screen.getByText(text)).toBeTruthy();
});
it("shows missing details honestly and uses the existing insurer as a fallback", () => {
  render(<InsurancePaymentDetails client={{ paymentType: "insurer", insurer: "Test Insurer" }} />);
  expect(screen.getByText("Test Insurer")).toBeTruthy();
  expect(screen.getAllByText("Not provided")).toHaveLength(2);
});
it("shows an intake insurer before registration, with policy fields marked as not provided", () => {
  render(<InsurancePaymentDetails client={{ insurer: "Bupa Global" }} />);
  expect(screen.getByRole("region", { name: "Insurance details" })).toBeTruthy();
  expect(screen.getByText("Bupa Global")).toBeTruthy();
  expect(screen.getAllByText("Not provided")).toHaveLength(2);
  expect(screen.getByText(/collected during registration/)).toBeTruthy();
});
it("does not add an insurance section for a self-paying client with no saved insurance", () => {
  render(<InsurancePaymentDetails client={{ paymentType: "self_pay" }} />);
  expect(screen.queryByRole("region", { name: "Insurance payment details" })).toBeNull();
});
