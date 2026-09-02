import type { AgentProvider } from "@/lib/agent/AgentProvider";
import { getReturnPolicyGuidance } from "@/lib/agent/returnPolicy";
import { formatDeliveryDate, formatOrderStatus } from "@/lib/formatters";
import type { AgentReply, OrderRecord } from "@/lib/types";

const ORDER_ID_PATTERN = /\bACME-\d{4}\b/i;
const STATUS_INTENT_PATTERN = /\b(status|track|tracking|where|arriv|delivery|delayed|shipment)\w*/i;
const RETURN_INTENT_PATTERN = /\b(return|refund|damaged|broken|incorrect|wrong|personalized|customized|personalised|customised|opened|final sale)\b/i;

export type OrderLookup = (orderId: string) => Promise<OrderRecord | null>;

export function formatOrderReply(order: OrderRecord): string {
  return `Order ${order.orderId} is ${formatOrderStatus(order.status).toLowerCase()}. Estimated delivery: ${formatDeliveryDate(order.estimatedDeliveryDate)} via ${order.carrier}. Tracking number: ${order.trackingNumber}.`;
}

export class StubAgentProvider implements AgentProvider {
  readonly mode = "stub" as const;

  constructor(private readonly lookupOrder: OrderLookup) {}

  async sendMessage(message: string): Promise<AgentReply> {
    const normalizedMessage = message.trim();
    const matchedOrderId = normalizedMessage.match(ORDER_ID_PATTERN)?.[0]?.toUpperCase();
    const asksForStatus = STATUS_INTENT_PATTERN.test(normalizedMessage);
    const asksAboutReturns = RETURN_INTENT_PATTERN.test(normalizedMessage);

    if (asksForStatus && !matchedOrderId) {
      return {
        message: "Please share the order ID in the format ACME-1234 so I can check its current status.",
        source: "stub",
      };
    }

    const responseParts: string[] = [];

    if (asksForStatus && matchedOrderId) {
      try {
        const order = await this.lookupOrder(matchedOrderId);

        if (!order) {
          return {
            message: `I couldn't find order ${matchedOrderId}. Please check the ID; I won't guess a different order number.`,
            orderId: matchedOrderId,
            source: "stub",
          };
        }

        responseParts.push(formatOrderReply(order));
      } catch {
        return {
          message: "I couldn't check the order status right now. Please try again shortly or use the order lookup form.",
          orderId: matchedOrderId,
          source: "stub",
        };
      }
    }

    if (asksAboutReturns) {
      responseParts.push(getReturnPolicyGuidance(normalizedMessage));
    }

    if (responseParts.length === 0) {
      return {
        message:
          "I can check an order status and explain Acme's return policy. Ask about an order using an ID such as ACME-1042, or ask a return-policy question.",
        source: "stub",
      };
    }

    return {
      message: responseParts.join("\n\n"),
      ...(matchedOrderId ? { orderId: matchedOrderId } : {}),
      source: "stub",
    };
  }
}
