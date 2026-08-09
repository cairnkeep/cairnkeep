# Spike Conventions

Patterns and stack choices established across spike sessions. New spikes follow
these unless the question requires otherwise.

## Stack

Use the target harness's exact installed runtime for compatibility probes. For
Prime Agent, that means its user-local Python 3.11 kernel and pinned Python MCP
SDK, while Cairnkeep runs from the current repository build.

## Structure

Keep executable probes and their skill fixtures inside numbered spike
directories. Write runtime evidence to an operator-selected temporary JSON path;
do not commit credentials, live memory, or machine-specific endpoints.

## Patterns

- Use a random loopback port, mandatory bearer authentication, a disposable
  Cairnkeep base directory, and an exact server-side custom tool profile.
- Record timestamped categorical events with a bounded summary and no payloads.
- Test a fresh client, an independent client, a server restart, invalid
  authentication, and a second project identity before claiming persistence or
  isolation.

## Tools and libraries

- Prime Agent 0.7.1 with its isolated Python 3.11 runtime.
- Python MCP 2.0.0; use `http_client=` for streamable HTTP.
- Cairnkeep 2.10.0 built with Node.js 22 or newer.
