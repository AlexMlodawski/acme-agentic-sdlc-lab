const correlationId = {
  type: "string",
  minLength: 1,
  maxLength: 128,
} as const;

export const noQueryParametersSchema = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
} as const;

export const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "service"],
  properties: {
    status: { type: "string", const: "ok" },
    service: { type: "string", const: "acme-support-api" },
  },
} as const;

export const orderParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["orderId"],
  properties: {
    orderId: {
      type: "string",
      pattern: "^[Aa][Cc][Mm][Ee]-[0-9]{4}$",
    },
  },
} as const;

export const orderResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "orderId",
    "customerName",
    "status",
    "estimatedDeliveryDate",
    "carrier",
    "trackingNumber",
  ],
  properties: {
    orderId: { type: "string", pattern: "^ACME-[0-9]{4}$" },
    customerName: { type: "string", minLength: 1 },
    status: {
      type: "string",
      enum: ["processing", "shipped", "delayed", "delivered"],
    },
    estimatedDeliveryDate: { type: "string", format: "date" },
    carrier: { type: "string", minLength: 1 },
    trackingNumber: { type: "string", minLength: 1 },
  },
} as const;

export const apiErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "code", "correlationId"],
  properties: {
    error: {
      type: "string",
      enum: ["Bad Request", "Unauthorized", "Not Found", "Internal Server Error"],
    },
    code: { type: "string", minLength: 1 },
    correlationId,
    message: { type: "string", minLength: 1 },
  },
} as const;

export const supportCaseRequestRuntimeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["orderId", "priority", "description"],
  properties: {
    orderId: { type: "string", pattern: "^ACME-[0-9]{4}$" },
    priority: {
      type: "string",
      enum: ["low", "normal", "high", "urgent"],
    },
    description: {
      type: "string",
      minLength: 10,
      maxLength: 1000,
    },
  },
} as const;

export const supportCaseCreatedResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["caseId", "status", "priority", "correlationId"],
  properties: {
    caseId: { type: "string", pattern: "^CASE-[0-9]{8}-[0-9]{3}$" },
    status: { type: "string", const: "created" },
    priority: {
      type: "string",
      enum: ["low", "normal", "high", "urgent"],
    },
    correlationId,
  },
} as const;
