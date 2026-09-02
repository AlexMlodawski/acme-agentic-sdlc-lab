import type { Metadata, Viewport } from "next";

import designTokens from "../../../../design/tokens.json";

import "./globals.css";

export const metadata: Metadata = {
  title: "Acme Customer Care | Orders and support",
  description: "Track Acme orders, review return options, and contact customer care.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: designTokens.color.theme,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
