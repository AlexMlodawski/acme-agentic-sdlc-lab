# Contributing

Thank you for improving the lab.

1. Open an issue for material architecture or integration changes.
2. Keep the default path local, deterministic, and zero-secret.
3. Use fictional data only.
4. Add focused tests and run `npm run verify` plus `npm run e2e:local`.
5. Do not commit `.env` files, credentials, tenant exports, recorded auth state,
   IBM binaries, or screenshots containing private data.
6. Mark fixtures and synthetic evidence clearly.
7. Do not weaken `not_completed` or `not_asserted` semantics to make a report green.

By contributing, you agree that your contribution is licensed under Apache-2.0.
