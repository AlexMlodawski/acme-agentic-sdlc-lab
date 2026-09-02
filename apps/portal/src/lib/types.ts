export type SupportPriority = "low" | "normal" | "high" | "urgent";

export interface OrderRecord {
  orderId: string;
  customerName: string;
  status: string;
  estimatedDeliveryDate: string;
  carrier: string;
  trackingNumber: string;
}

export interface SupportCaseResult {
  caseId: string;
  status: "created";
  priority: SupportPriority;
  correlationId: string;
}

export interface AssistantMessageRequest {
  message: string;
  orderId?: string;
  threadId?: string;
}

export interface AgentReply {
  message: string;
  orderId?: string;
  threadId?: string;
  source: "stub" | "orchestrate";
}
