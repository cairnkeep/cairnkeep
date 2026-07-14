# Contributing to Cairnkeep

Contributions are welcome through GitHub issues and pull requests.

## Before starting

- Open or reference an issue for behavior changes that affect users, storage,
  security boundaries, or public interfaces.
- Keep the core provider-neutral. Do not add employer names, private repository
  names, internal endpoints, credentials, or environment-specific defaults.
- Do not include generated authorship or assistant attribution in commits,
  source files, or documentation.
- Report security vulnerabilities privately as described in
  [SECURITY.md](SECURITY.md), not through a public issue.

## Development setup

The memory server requires Node.js 18 or newer. Node.js 22 or 24 is recommended
for development; current CI uses Node.js 24 and retains a clean Node.js 18
compatibility boot check.

```bash
git clone https://github.com/cairnkeep/cairnkeep.git
cd cairnkeep/mcp-memory-server
npm ci
npm test
```

The repository-level checks exercise the CLI, bootstrap scripts, documentation
parity, and public-content guard:

```bash
cd ..
npm run check:public
```

Some integration verifiers require optional sibling tools or configured API
endpoints. They are not part of the default offline test suite.

## Pull requests

- Create a focused branch from `main`.
- Keep commits coherent and use imperative commit subjects.
- Add or update tests for behavioral changes.
- Update user documentation when configuration or commands change.
- Confirm `npm run check:public` and `npm --prefix mcp-memory-server test` pass.
- Keep the working tree free of generated databases, logs, credentials, and
  local planning artifacts not intended for publication.

By contributing, you agree that your contribution is licensed under the
Apache License 2.0 found in [LICENSE](LICENSE).

Release publishing is maintainer-only and documented in
[docs/releasing.md](docs/releasing.md).
