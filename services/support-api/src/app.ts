import cors from "@fastify/cors";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  LogController,
} from "fastify";

import { hasValidBearerToken } from "./auth.js";
import { loadConfig, type AppConfig } from "./config.js";
import { resolveCorrelationId } from "./correlation.js";
import { findOrder, normalizeOrderId } from "./orders.js";
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  noQueryParametersSchema,
  orderParamsSchema,
  orderResponseSchema,
  supportCaseCreatedResponseSchema,
  supportCaseRequestRuntimeSchema,
} from "./schemas.js";
import { createSupportCaseService } from "./support-cases.js";
import type { SupportCaseRequest } from "./types.js";

interface OrderParams {
  readonly orderId: string;
}

interface RequestError extends Error {
  readonly statusCode?: number;
  readonly validation?: unknown;
}

const ORDER_ID_FOR_LOG_PATTERN = /^ACME-[0-9]{4}$/;
const SAFE_REQUEST_VALIDATION_LOG_MESSAGE =
  "The request did not satisfy the API contract.";

export interface BuildAppOptions {
  readonly config?: AppConfig;
  readonly loggerInstance?: FastifyBaseLogger;
  readonly logger?: boolean;
}

function getOrderIdForLog(request: FastifyRequest): string | undefined {
  const params = request.params as Partial<OrderParams> | undefined;
  if (
    typeof params?.orderId === "string" &&
    ORDER_ID_FOR_LOG_PATTERN.test(params.orderId)
  ) {
    return params.orderId;
  }

  const body = request.body as Partial<SupportCaseRequest> | undefined;
  return typeof body?.orderId === "string" &&
    ORDER_ID_FOR_LOG_PATTERN.test(body.orderId)
    ? body.orderId
    : undefined;
}

function routeForLog(request: FastifyRequest): string {
  return request.routeOptions.url ?? "unmatched";
}

function matchedRoute(request: FastifyRequest): string | undefined {
  const route = request.routeOptions.url;
  return typeof route === "string" && route.startsWith("/")
    ? route
    : undefined;
}

function normalizeRequestError(error: unknown): RequestError {
  if (error instanceof Error) {
    return error;
  }

  const normalized = new Error("A non-Error value was thrown");
  normalized.name = "UnknownThrownValue";
  return normalized;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const loggerBindings = {
    "service.name": config.serviceName,
    "deployment.environment": config.deploymentEnvironment,
  };

  const app = options.loggerInstance
    ? Fastify({
        loggerInstance: options.loggerInstance.child(loggerBindings),
        logController: new LogController({ disableRequestLogging: true }),
        ajv: { customOptions: { allErrors: true, removeAdditional: false } },
      })
    : Fastify({
        logger:
          options.logger === false
            ? false
            : {
                level: config.logLevel,
                base: loggerBindings,
              },
        logController: new LogController({ disableRequestLogging: true }),
        ajv: { customOptions: { allErrors: true, removeAdditional: false } },
      });

  const supportCases = createSupportCaseService();

  const requireBearerToken = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!config.requireAuth) {
      return;
    }
    if (
      hasValidBearerToken(
        request.headers.authorization,
        config.supportApiToken,
      )
    ) {
      return;
    }

    return reply
      .header("www-authenticate", 'Bearer realm="acme-support-api"')
      .code(401)
      .send({
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        correlationId: request.correlationId,
        message: "A valid bearer token is required.",
      });
  };

  app.decorateRequest("correlationId", "");

  await app.register(cors, {
    credentials: false,
    allowedHeaders: ["content-type", "x-correlation-id", "traceparent", "tracestate"],
    exposedHeaders: ["x-correlation-id"],
    methods: ["GET", "POST", "OPTIONS"],
    origin(origin, callback) {
      callback(null, origin === undefined || config.corsOrigins.includes(origin));
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    request.correlationId = resolveCorrelationId(request, config.correlationId);
    void reply.header("x-correlation-id", request.correlationId);

    const span = trace.getActiveSpan();
    span?.setAttribute("correlation_id", request.correlationId);
    span?.setAttribute("demo.correlation_id", request.correlationId);
    span?.setAttribute("deployment.environment", config.deploymentEnvironment);
    const route = matchedRoute(request);
    if (route !== undefined) {
      span?.setAttribute("http.route", route);
      span?.updateName(`${request.method} ${route}`);
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const orderId = getOrderIdForLog(request);
    request.log.info(
      {
        correlation_id: request.correlationId,
        "http.method": request.method,
        "http.route": routeForLog(request),
        "http.status_code": reply.statusCode,
        ...(orderId === undefined ? {} : { order_id: orderId }),
      },
      "request completed",
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const requestError = normalizeRequestError(error);
    const orderId = getOrderIdForLog(request);
    const commonLogFields = {
      correlation_id: request.correlationId,
      "http.method": request.method,
      "http.route": routeForLog(request),
      ...(orderId === undefined ? {} : { order_id: orderId }),
    };

    if (
      requestError.validation !== undefined ||
      (requestError.statusCode !== undefined &&
        requestError.statusCode >= 400 &&
        requestError.statusCode < 500)
    ) {
      request.log.warn(
        {
          ...commonLogFields,
          "http.status_code": 400,
          "error.type": "RequestValidationError",
          "error.code": "REQUEST_VALIDATION_FAILED",
          "error.message": SAFE_REQUEST_VALIDATION_LOG_MESSAGE,
        },
        "request validation failed",
      );

      return reply.code(400).send({
        error: "Bad Request",
        code: "REQUEST_VALIDATION_FAILED",
        correlationId: request.correlationId,
        message: "The request did not satisfy the API contract.",
      });
    }

    trace.getActiveSpan()?.recordException(requestError);
    trace
      .getActiveSpan()
      ?.setStatus({ code: SpanStatusCode.ERROR, message: "UNEXPECTED_ERROR" });
    request.log.error(
      {
        ...commonLogFields,
        "http.status_code": 500,
        "error.type": requestError.name,
        "error.code": "UNEXPECTED_ERROR",
        "error.message": requestError.message,
        err: requestError,
      },
      "unexpected request failure",
    );

    return reply.code(500).send({
      error: "Internal Server Error",
      code: "UNEXPECTED_ERROR",
      correlationId: request.correlationId,
    });
  });

  app.get(
    "/health",
    {
      schema: {
        querystring: noQueryParametersSchema,
        response: {
          200: healthResponseSchema,
          400: apiErrorResponseSchema,
        },
      },
    },
    async () => ({ status: "ok" as const, service: "acme-support-api" as const }),
  );

  app.get(
    "/ready",
    {
      schema: {
        querystring: noQueryParametersSchema,
        response: {
          200: healthResponseSchema,
          400: apiErrorResponseSchema,
        },
      },
    },
    async () => ({ status: "ok" as const, service: "acme-support-api" as const }),
  );

  app.get<{ Params: OrderParams }>(
    "/orders/:orderId",
    {
      onRequest: requireBearerToken,
      schema: {
        params: orderParamsSchema,
        response: {
          200: orderResponseSchema,
          400: apiErrorResponseSchema,
          401: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const orderId = normalizeOrderId(request.params.orderId);
      const order = findOrder(orderId);

      if (order === undefined) {
        return reply.code(404).send({
          error: "Not Found",
          code: "ORDER_NOT_FOUND",
          correlationId: request.correlationId,
          message: `No order was found for ${orderId}.`,
        });
      }

      return reply.code(200).send(order);
    },
  );

  app.post<{ Body: SupportCaseRequest }>(
    "/support-cases",
    {
      onRequest: requireBearerToken,
      schema: {
        body: supportCaseRequestRuntimeSchema,
        response: {
          201: supportCaseCreatedResponseSchema,
          400: apiErrorResponseSchema,
          401: apiErrorResponseSchema,
          500: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const created = supportCases.create(request.body, request.correlationId);
      return reply.code(201).send(created);
    },
  );

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: "Not Found",
      code: "ROUTE_NOT_FOUND",
      correlationId: request.correlationId,
      message: "The requested route does not exist.",
    }),
  );

  await app.ready();
  return app;
}
