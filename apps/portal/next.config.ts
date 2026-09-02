import type { NextConfig } from "next";

import { resolveDemoCorrelationId } from "./src/lib/demoCorrelationId";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_DEMO_CORRELATION_ID:
      resolveDemoCorrelationId(process.env.DEMO_CORRELATION_ID),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
