import type { SupportCaseCreated, SupportCaseRequest } from "./types.js";

export interface SupportCaseService {
  create(
    request: SupportCaseRequest,
    correlationId: string,
  ): SupportCaseCreated;
}

export function createSupportCaseService(): SupportCaseService {
  return {
    create(request, correlationId) {
      return {
        caseId: "CASE-20260827-001",
        status: "created",
        priority: request.priority,
        correlationId,
      };
    },
  };
}
