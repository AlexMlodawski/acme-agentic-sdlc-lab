export const RETURN_POLICY_SUMMARY =
  "Standard returns are accepted within 30 days of delivery. Opened products may be returned within 14 days when complete and undamaged. Damaged or incorrect items must be reported within 48 hours and qualify for a prepaid return label. Personalized and final-sale products are excluded. Refunds are confirmed only after the case is reviewed.";

export function getReturnPolicyGuidance(message: string): string {
  const normalized = message.toLowerCase();

  if (/damaged|broken|incorrect|wrong item/.test(normalized)) {
    return "Return-policy guidance: report a damaged or incorrect item within 48 hours of delivery. Acme provides a prepaid return label for eligible damaged or incorrectly shipped products. A refund can only be confirmed after the case is reviewed.";
  }

  if (/personalized|customi[sz]ed|final sale/.test(normalized)) {
    return "Return-policy guidance: personalized products and items marked final sale are not eligible for the standard return program. Support can review the circumstances, but I cannot promise a refund.";
  }

  if (/opened|open product|open box/.test(normalized)) {
    return "Return-policy guidance: an opened product may be returned within 14 days of delivery when it is complete and undamaged. Eligibility and any refund are confirmed after review.";
  }

  return `Return-policy guidance: ${RETURN_POLICY_SUMMARY}`;
}
