export const orderStatuses = [
  "processing",
  "shipped",
  "delayed",
  "delivered",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export interface OrderRecord {
  readonly orderId: string;
  readonly customerName: string;
  readonly status: OrderStatus;
  readonly estimatedDeliveryDate: string;
  readonly carrier: string;
  readonly trackingNumber: string;
}

export const supportCasePriorities = ["low", "normal", "high", "urgent"] as const;

export type SupportCasePriority = (typeof supportCasePriorities)[number];

export interface SupportCaseRequest {
  readonly orderId: string;
  readonly priority: SupportCasePriority;
  readonly description: string;
}

export interface SupportCaseCreated {
  readonly caseId: string;
  readonly status: "created";
  readonly priority: SupportCasePriority;
  readonly correlationId: string;
}

export interface ApiErrorResponse {
  readonly error:
    | "Bad Request"
    | "Unauthorized"
    | "Not Found"
    | "Internal Server Error";
  readonly code: string;
  readonly correlationId: string;
  readonly message?: string;
}
