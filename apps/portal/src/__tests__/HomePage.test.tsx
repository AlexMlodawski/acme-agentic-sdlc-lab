import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/SupportPortal", () => ({
  SupportPortal: () => <main data-testid="support-portal">Acme customer portal</main>,
}));

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("renders the product directly without presentation or QA overlays", () => {
    render(<HomePage />);

    expect(screen.getByTestId("support-portal")).toBeInTheDocument();
    expect(screen.queryByTestId("showcase-shell")).not.toBeInTheDocument();
  });
});
