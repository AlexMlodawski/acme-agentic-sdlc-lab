import "server-only";

export interface RequestSecurityRejection {
  readonly status: 403 | 415;
  readonly code: "ORIGIN_NOT_ALLOWED" | "UNSUPPORTED_MEDIA_TYPE";
  readonly error: string;
}

function getRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    forwardedProtocol !== undefined &&
    forwardedProtocol !== "http" &&
    forwardedProtocol !== "https"
  ) {
    return null;
  }

  const protocol = forwardedProtocol === undefined
    ? requestUrl.protocol
    : `${forwardedProtocol}:`;
  const host = request.headers.get("host")?.trim() || requestUrl.host;
  if (
    !["http:", "https:"].includes(protocol) ||
    !host ||
    /[,\s/@?#]/.test(host)
  ) {
    return null;
  }

  try {
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

export function validateJsonPostRequest(
  request: Request,
): RequestSecurityRejection | null {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      normalizedOrigin = "invalid";
    }

    if (normalizedOrigin !== getRequestOrigin(request)) {
      return {
        status: 403,
        code: "ORIGIN_NOT_ALLOWED",
        error: "The request origin is not allowed.",
      };
    }
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      error: "Content-Type must be application/json.",
    };
  }

  return null;
}
