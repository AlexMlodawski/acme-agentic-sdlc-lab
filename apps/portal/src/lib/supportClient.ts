import {
  createSupportCaseWithMapper,
  type CreateSupportCaseInput,
} from "@/lib/supportClientCore";

export {
  getDemoCorrelationId,
  SupportClientError,
  type CreateSupportCaseInput,
} from "@/lib/supportClientCore";

export function mapSupportCaseRequest({
  orderId,
  selectedPriority,
  description,
}: CreateSupportCaseInput) {
  return {
    orderId: orderId.trim().toUpperCase(),
    priority: selectedPriority,
    description: description.trim(),
  };
}

export async function createSupportCase(
  input: CreateSupportCaseInput,
  fetcher: typeof fetch = globalThis.fetch,
) {
  return createSupportCaseWithMapper(input, mapSupportCaseRequest, fetcher);
}
