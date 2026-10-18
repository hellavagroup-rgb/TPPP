// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClinicianRecommendationToggle } from "./ClinicianRecommendationToggle";

afterEach(cleanup);

describe("ClinicianRecommendationToggle", () => {
  it("selects a clinician directly without requiring a slot interaction", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<ClinicianRecommendationToggle clinicianName="Dr Amara Patel" selected={false} onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "Recommend Dr Amara Patel" });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<ClinicianRecommendationToggle clinicianName="Dr Amara Patel" selected onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "Remove Dr Amara Patel recommendation" }).getAttribute("aria-pressed")).toBe("true");
  });
});
