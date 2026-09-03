# Local quickstart

## Requirements

- Node.js 24.19.0
- npm 11.17.0
- Git
- Python 3.12.10 and `uv` 0.12.0 for full verification
- Chromium only if you run the browser test

## Run

```bash
npm ci --ignore-scripts
npm run up
```

The launcher prints exactly which loopback URLs it owns. It does not load `.env`
files or pass application credentials into the local services.

Open <http://127.0.0.1:3000> and use these fictional cases:

| Order | Expected result |
| --- | --- |
| `ACME-1042` | delayed |
| `ACME-2048` | shipped |
| `ACME-3096` | delivered |
| `ACME-4040` | safe not-found state |

## Verify

```bash
npm run verify
npx --no-install playwright install chromium
npm run e2e:local
npm run e2e:built
```

The default run makes no external business request. Package installation is the
only step that normally requires Internet access.

## Guided workshop launch

To collect the ports/profile interactively, choose the final action, request every
repository preview from the default browser, and keep a terminal menu open for the
whole session, run:

```text
npm run guided
```

The default choice remains the local mock profile. The optional account-backed WXO
choice asks for an endpoint, agent ID, and masked API key, keeps the values
server-side for that foreground session, and does not infer Draft/Live status or
import, deploy, or promote anything.
See [`guided-launcher.md`](guided-launcher.md) for the prompts, menu, preview list,
and troubleshooting steps.
