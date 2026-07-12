# Security Policy

## Supported versions

Security fixes are applied to the latest released version of
`@cairnkeep/cli`. Users should upgrade to the newest npm release before
reporting an issue that may already be resolved.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include secrets,
private endpoints, memory databases, or reproduction data in public logs.

Use GitHub's private vulnerability reporting flow:

https://github.com/cairnkeep/cairnkeep/security/advisories/new

Include the affected version, impact, reproduction steps, and any suggested
mitigation. Use synthetic data and redact credentials and private repository
details.

The project will acknowledge the report, validate the issue, and coordinate a
fix and disclosure through the private advisory. No response-time guarantee is
provided, but confirmed issues will be prioritized according to impact.

## Scope

Reports are especially useful for:

- memory-scope isolation or path traversal;
- unauthorized HTTP access to the MCP server;
- credential, cookie, or stored-memory disclosure;
- unsafe command or file execution;
- package or bootstrap integrity problems.

Configuration mistakes that deliberately disable documented safeguards are
normally outside scope unless the safe default is ineffective.
