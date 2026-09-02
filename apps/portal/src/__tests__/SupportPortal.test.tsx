import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupportCase: vi.fn(),
  lookupOrder: vi.fn(),
}));

vi.mock("@/lib/portalClient", () => ({
  lookupOrder: mocks.lookupOrder,
  PortalApiError: class PortalApiError extends Error {
    status: number;
    code: string;

    constructor(message = "test error", status = 500, code = "TEST_ERROR") {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("@/lib/supportClient", () => ({
  createSupportCase: mocks.createSupportCase,
  getDemoCorrelationId: () => "ACME-LAB-LOCAL",
  SupportClientError: class SupportClientError extends Error {
    correlationId = "ACME-LAB-LOCAL";
    code = "TEST_SUPPORT_ERROR";
    status = 502;
  },
}));

import { SupportPortal } from "@/components/SupportPortal";
import { PortalApiError } from "@/lib/portalClient";

const ORDER = {
  orderId: "ACME-1042",
  customerName: "Jordan Lee",
  status: "delayed",
  estimatedDeliveryDate: "2026-08-26",
  carrier: "Acme Express",
  trackingNumber: "AX-88271042",
};

beforeEach(() => {
  mocks.createSupportCase.mockReset();
  mocks.lookupOrder.mockReset();
  mocks.lookupOrder.mockResolvedValue(ORDER);
});

describe("SupportPortal customer journey", () => {
  it("renders a customer-only self-service experience with no presentation or conversational UI", () => {
    const { container } = render(<SupportPortal />);

    expect(screen.getByRole("heading", { level: 1, name: "Support for every step of your order." })).toBeVisible();
    expect(screen.getByText("Demo-safe lookup")).toBeVisible();
    expect(screen.getByText("Uses fictional data; no account or payment details required.")).toBeVisible();
    expect(screen.getByTestId("order-id-input")).toBeVisible();
    expect(screen.getByTestId("order-lookup-button")).toBeEnabled();
    expect(screen.getByTestId("return-policy-card")).toBeVisible();
    expect(screen.getByText("Timing is confirmed only after individual review.")).toBeVisible();
    expect(screen.getByTestId("support-case-order-required")).toBeVisible();
    expect(screen.getByTestId("contact-options")).toBeVisible();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");

    expect(screen.queryByTestId("agent-chat-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-chat-send")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-chat-messages")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("showcase-status-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("showcase-cursor")).not.toBeInTheDocument();
    // assistant entry and panel are only available after order lookup
    expect(screen.queryByTestId("assistant-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-panel")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/watsonx|candidate|pipeline|controller|automation|quality assurance/i);
  });

  it("looks up a known order, projects deterministic details, and completes the case flow", async () => {
    const user = userEvent.setup();
    mocks.createSupportCase.mockResolvedValue({
      caseId: "CASE-20260827-001",
      status: "created",
      priority: "high",
      correlationId: "ACME-LAB-LOCAL",
    });
    render(<SupportPortal />);

    await user.type(screen.getByTestId("order-id-input"), "acme-1042");
    await user.click(screen.getByTestId("order-lookup-button"));

    const orderCard = await screen.findByTestId("order-status-card");
    expect(orderCard).toBeVisible();
    expect(screen.getByTestId("order-id-input")).toHaveValue("ACME-1042");
    expect(screen.getByTestId("order-status-value")).toHaveTextContent("Delayed");
    expect(screen.getByTestId("order-delivery-date")).toHaveTextContent("August 26, 2026");
    expect(screen.getByTestId("order-line-item")).toHaveTextContent("Voyager carry-on");
    expect(screen.getByTestId("order-line-item")).toHaveTextContent("TRV-VGR-22-SLT");
    expect(screen.getByTestId("order-line-item")).toHaveTextContent("$189.00");
    expect(screen.getByRole("heading", { level: 2, name: "Delivery update" })).toBeVisible();
    expect(within(screen.getByLabelText("Order summary")).getByText("Payment received")).toBeVisible();

    const timeline = screen.getByTestId("order-timeline");
    const currentStep = within(timeline).getByText("In transit").closest("li");
    expect(currentStep).toHaveAttribute("aria-current", "step");
    expect(currentStep).toHaveTextContent("Carrier delay reported");
    expect(within(timeline).getByText("Delivered").closest("li")).not.toHaveAttribute("aria-current");

    await user.selectOptions(screen.getByTestId("priority-select"), "high");
    await user.type(
      screen.getByTestId("support-case-description"),
      "The order is delayed and I need help with the delivery date.",
    );
    await user.click(screen.getByTestId("create-support-case-button"));

    expect(await screen.findByTestId("support-case-success")).toBeVisible();
    expect(screen.getByTestId("support-case-id")).toHaveTextContent("CASE-20260827-001");
    expect(mocks.createSupportCase).toHaveBeenCalledWith({
      orderId: "ACME-1042",
      selectedPriority: "high",
      description: "The order is delayed and I need help with the delivery date.",
    });
  });

  it("validates an order ID before sending a request", async () => {
    const user = userEvent.setup();
    render(<SupportPortal />);

    await user.type(screen.getByTestId("order-id-input"), "wrong-order");
    await user.click(screen.getByTestId("order-lookup-button"));

    expect(screen.getByTestId("order-lookup-error")).toHaveTextContent("ACME-1234");
    expect(screen.getByTestId("order-id-input")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.lookupOrder).not.toHaveBeenCalled();
  });

  it("distinguishes a missing order from a temporarily unavailable service", async () => {
    const user = userEvent.setup();
    mocks.lookupOrder.mockRejectedValueOnce(new PortalApiError("missing", 404, "ORDER_NOT_FOUND"));
    render(<SupportPortal />);

    await user.type(screen.getByTestId("order-id-input"), "ACME-9999");
    await user.click(screen.getByTestId("order-lookup-button"));

    expect(await screen.findByTestId("order-lookup-error")).toHaveTextContent("couldn't find that order");
    expect(screen.queryByTestId("order-status-card")).not.toBeInTheDocument();
  });

  it("shows a safe case error without exposing an exception", async () => {
    const user = userEvent.setup();
    mocks.createSupportCase.mockRejectedValue(new Error("private internal stack details"));
    render(<SupportPortal />);

    await user.type(screen.getByTestId("order-id-input"), "ACME-1042");
    await user.click(screen.getByTestId("order-lookup-button"));
    await screen.findByTestId("order-status-card");
    await user.type(
      screen.getByTestId("support-case-description"),
      "The order is delayed and I need help with the delivery date.",
    );
    await user.click(screen.getByTestId("create-support-case-button"));

    const error = await screen.findByTestId("support-case-error");
    expect(error).toHaveTextContent("We couldn't create your support case.");
    expect(error).toHaveTextContent("ACME-LAB-LOCAL");
    expect(error).not.toHaveTextContent("private internal stack details");
    expect(screen.queryByTestId("support-case-success")).not.toBeInTheDocument();
  });
});
