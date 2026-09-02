import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendAssistantMessage: vi.fn(),
  lookupOrder: vi.fn(),
}));

vi.mock("@/lib/portalClient", () => ({
  sendAssistantMessage: mocks.sendAssistantMessage,
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

vi.mock("@/components/AssistantPanel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/AssistantPanel")>();
  return original;
});

vi.mock("@/lib/supportClient", () => ({
  createSupportCase: vi.fn(),
  getDemoCorrelationId: () => "ACME-LAB-LOCAL",
  SupportClientError: class SupportClientError extends Error {
    correlationId = "ACME-LAB-LOCAL";
    code = "TEST_SUPPORT_ERROR";
    status = 502;
  },
}));

import { SupportPortal } from "@/components/SupportPortal";

const ORDER = {
  orderId: "ACME-1042",
  customerName: "Jordan Lee",
  status: "delayed",
  estimatedDeliveryDate: "2026-08-26",
  carrier: "Acme Express",
  trackingNumber: "AX-88271042",
};

const REPLY_1 = {
  message: "Order ACME-1042 is delayed. Estimated delivery is August 26, 2026.",
  orderId: "ACME-1042",
  threadId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  source: "orchestrate" as const,
};

const REPLY_2 = {
  message: "Standard items may be returned within 30 days of delivery.",
  orderId: "ACME-1042",
  threadId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  source: "orchestrate" as const,
};

async function renderWithOrder() {
  const user = userEvent.setup();
  mocks.lookupOrder.mockResolvedValue(ORDER);
  render(<SupportPortal />);

  await user.type(screen.getByTestId("order-id-input"), "ACME-1042");
  await user.click(screen.getByTestId("order-lookup-button"));
  await screen.findByTestId("order-status-card");

  return user;
}

beforeEach(() => {
  mocks.sendAssistantMessage.mockReset();
  mocks.lookupOrder.mockReset();
});

describe("AssistantPanel — entry and toggle", () => {
  it("is absent before an order is looked up", () => {
    mocks.lookupOrder.mockResolvedValue(ORDER);
    render(<SupportPortal />);
    expect(screen.queryByTestId("assistant-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-panel")).not.toBeInTheDocument();
  });

  it("shows the toggle button after a successful order lookup", async () => {
    await renderWithOrder();
    expect(screen.getByTestId("assistant-toggle")).toBeVisible();
    expect(screen.getByTestId("assistant-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("assistant-panel")).not.toBeInTheDocument();
  });

  it("opens and closes the panel with the toggle", async () => {
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    expect(screen.getByTestId("assistant-panel")).toBeVisible();
    expect(screen.getByTestId("assistant-toggle")).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByTestId("assistant-toggle"));
    expect(screen.queryByTestId("assistant-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-toggle")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("AssistantPanel — happy path", () => {
  it("sends a message with orderId and renders the assistant reply", async () => {
    mocks.sendAssistantMessage.mockResolvedValue(REPLY_1);
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    const input = screen.getByTestId("assistant-input");
    await user.type(input, "What is the status of my order?");
    await user.click(screen.getByTestId("assistant-send"));

    expect(mocks.sendAssistantMessage).toHaveBeenCalledWith({
      message: "What is the status of my order?",
      orderId: "ACME-1042",
      threadId: undefined,
    });

    const userMsg = await screen.findByTestId("assistant-msg-user");
    expect(userMsg).toHaveTextContent("What is the status of my order?");

    const assistantMsg = await screen.findByTestId("assistant-msg-assistant");
    expect(assistantMsg).toHaveTextContent(REPLY_1.message);
    expect(assistantMsg.tagName).toBe("LI");
    expect(assistantMsg).toHaveAttribute("data-role", "assistant");
    expect(assistantMsg.closest("ol")).toBe(screen.getByTestId("assistant-messages").querySelector("ol"));
  });

  it("reuses the thread ID for a follow-up turn", async () => {
    mocks.sendAssistantMessage.mockResolvedValueOnce(REPLY_1).mockResolvedValueOnce(REPLY_2);
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));

    await user.type(screen.getByTestId("assistant-input"), "Status?");
    await user.click(screen.getByTestId("assistant-send"));
    await screen.findByTestId("assistant-msg-assistant");

    await user.type(screen.getByTestId("assistant-input"), "What about returns?");
    await user.click(screen.getByTestId("assistant-send"));

    const assistantMsgs = await screen.findAllByTestId("assistant-msg-assistant");
    expect(assistantMsgs).toHaveLength(2);

    expect(mocks.sendAssistantMessage).toHaveBeenNthCalledWith(2, {
      message: "What about returns?",
      orderId: "ACME-1042",
      threadId: REPLY_1.threadId,
    });
  });

  it("clears the input after a successful send", async () => {
    mocks.sendAssistantMessage.mockResolvedValue(REPLY_1);
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    await user.type(screen.getByTestId("assistant-input"), "My question");
    await user.click(screen.getByTestId("assistant-send"));

    await screen.findByTestId("assistant-msg-assistant");
    expect(screen.getByTestId("assistant-input")).toHaveValue("");
  });

  it("does not render assistant output as HTML", async () => {
    mocks.sendAssistantMessage.mockResolvedValue({
      ...REPLY_1,
      message: "<script>alert('xss')</script>",
    });
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    await user.type(screen.getByTestId("assistant-input"), "Test");
    await user.click(screen.getByTestId("assistant-send"));

    const assistantMsg = await screen.findByTestId("assistant-msg-assistant");
    expect(assistantMsg.querySelector("script")).toBeNull();
    expect(assistantMsg).toHaveTextContent("<script>");
  });
});

describe("AssistantPanel — error and retry", () => {
  it("shows an error state with retry when the adapter throws", async () => {
    mocks.sendAssistantMessage.mockRejectedValue(new Error("network down"));
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    await user.type(screen.getByTestId("assistant-input"), "Help");
    await user.click(screen.getByTestId("assistant-send"));

    const errorEl = await screen.findByTestId("assistant-error");
    expect(errorEl).toBeVisible();
    expect(screen.getByTestId("assistant-retry")).toBeVisible();
  });

  it("retries with the original message when 'Try again' is clicked", async () => {
    mocks.sendAssistantMessage
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(REPLY_1);
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    await user.type(screen.getByTestId("assistant-input"), "Retry me");
    await user.click(screen.getByTestId("assistant-send"));
    await screen.findByTestId("assistant-error");

    await user.click(screen.getByTestId("assistant-retry"));
    await screen.findByTestId("assistant-msg-assistant");

    expect(mocks.sendAssistantMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendAssistantMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Retry me" }),
    );
  });
});

describe("AssistantPanel — reset", () => {
  it("clears the conversation and thread when 'Start over' is clicked", async () => {
    mocks.sendAssistantMessage.mockResolvedValue(REPLY_1);
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    await user.type(screen.getByTestId("assistant-input"), "What is my status?");
    await user.click(screen.getByTestId("assistant-send"));
    await screen.findByTestId("assistant-msg-assistant");

    await user.click(screen.getByTestId("assistant-reset"));

    expect(screen.queryByTestId("assistant-msg-user")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-msg-assistant")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-input")).toHaveValue("");
    expect(screen.queryByTestId("assistant-reset")).not.toBeInTheDocument();
  });

  it("starts a new thread after reset", async () => {
    mocks.sendAssistantMessage
      .mockResolvedValueOnce(REPLY_1)
      .mockResolvedValueOnce({ ...REPLY_2, threadId: "new-thread-id-0000-0000-000000000000" });
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    await user.type(screen.getByTestId("assistant-input"), "First question");
    await user.click(screen.getByTestId("assistant-send"));
    await screen.findByTestId("assistant-msg-assistant");

    await user.click(screen.getByTestId("assistant-reset"));

    await user.type(screen.getByTestId("assistant-input"), "Second question");
    await user.click(screen.getByTestId("assistant-send"));

    expect(mocks.sendAssistantMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Second question", threadId: undefined }),
    );
  });

  it("resets state when a new order lookup is performed", async () => {
    mocks.sendAssistantMessage.mockResolvedValue(REPLY_1);
    const user = await renderWithOrder();

    await user.click(screen.getByTestId("assistant-toggle"));
    await user.type(screen.getByTestId("assistant-input"), "Question");
    await user.click(screen.getByTestId("assistant-send"));
    await screen.findByTestId("assistant-msg-assistant");

    // perform a new order lookup — panel should close and thread clear
    await user.clear(screen.getByTestId("order-id-input"));
    await user.type(screen.getByTestId("order-id-input"), "ACME-1042");
    await user.click(screen.getByTestId("order-lookup-button"));
    await screen.findByTestId("order-status-card");

    expect(screen.queryByTestId("assistant-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-toggle")).toHaveAttribute("aria-expanded", "false");
  });
});
