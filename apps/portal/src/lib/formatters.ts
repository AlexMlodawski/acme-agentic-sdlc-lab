const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatOrderStatus(status: string): string {
  return status
    .trim()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatDeliveryDate(value: string): string {
  const normalized = DATE_ONLY_PATTERN.test(value) ? `${value}T00:00:00Z` : value;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function getOrderStatusTone(status: string): "warning" | "success" | "neutral" {
  const normalized = status.trim().toLowerCase();

  if (["delayed", "exception", "cancelled"].includes(normalized)) {
    return "warning";
  }

  if (["delivered", "complete", "completed"].includes(normalized)) {
    return "success";
  }

  return "neutral";
}
