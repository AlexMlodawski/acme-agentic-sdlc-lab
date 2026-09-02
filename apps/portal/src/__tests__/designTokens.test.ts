import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import designTokens from "../../../../design/tokens.json";

const cssTokens = readFileSync(
  resolve(process.cwd(), "src/styles/tokens.css"),
  "utf8",
);

function toKebabCase(value: string): string {
  return value
    .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
    .replace(/([a-z])([0-9]+)/g, "$1-$2");
}

function relativeLuminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${color}`);
  }

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("portal design tokens", () => {
  it.each(["color", "radius", "space", "shadow"] as const)(
    "keeps every %s token aligned with tokens.css",
    (category) => {
      for (const [name, value] of Object.entries(designTokens[category])) {
        expect(cssTokens).toContain(`--${category}-${toKebabCase(name)}: ${value};`);
      }
    },
  );

  it("keeps the primary product color explicit", () => {
    expect(designTokens.color.primary).toBe("#08747C");
  });

  it("keeps small muted and inverse-accent text above WCAG AA contrast", () => {
    expect(
      contrastRatio(designTokens.color.textMuted, designTokens.color.surface),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        designTokens.color.inverseAccent,
        designTokens.color.surfaceInverse,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
