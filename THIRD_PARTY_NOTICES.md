# Third-party notices

This source repository does not vendor Node.js packages, Python wheels, browser
binaries, IBM Bob, or tenant exports. Package managers download dependencies
under the licenses published by their respective authors.

Before each public release, maintainers should:

1. run `npm run sbom`;
2. confirm that the generated CycloneDX 1.6 document contains both locked npm and
   Python components;
3. run the complete npm and Python vulnerability audits;
4. review every dependency license, copied fragment, asset, and required notice;
5. attach the generated SBOM and human-reviewed notice bundle to the release;
6. verify that no downloaded binary or build cache entered the source archive.

The generated SBOM and `license-inventory.json` are dependency metadata inventories,
not legal opinions. Package metadata does not contain complete license/attribution
text for every package, so this source file
cannot mark the human licensing gate complete automatically.

Major directly declared dependencies include Next.js, React, Fastify,
OpenTelemetry, Vitest, Playwright, Pydantic, HTTPX, and the IBM watsonx
Orchestrate ADK. Their inclusion here does not alter their own license terms.
