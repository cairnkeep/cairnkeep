# Managed Cairnkeep distributions

A private overlay becomes significantly easier to operate when it is treated as
a **distribution** rather than a directory of configuration fragments. The
distribution owns the `cairn` command on enrolled machines while consuming the
public `@cairnkeep/cli` package as an exact dependency.

This keeps Cairnkeep neutral and upgradeable. The distribution owns environment
policy, data routing, launchers, private integrations, and delivery through an
approved package registry. It should not patch or fork the core implementation.

## Command contract

An overlay package can expose its own `cairn` binary and delegate to its pinned
core dependency:

- `cairn bootstrap <project>` runs core bootstrap and then applies the overlay.
- `cairn doctor` runs core diagnostics plus overlay policy checks.
- `cairn config explain` reports effective storage and service destinations
  without printing credentials.
- `cairn overlay info` reports distribution and core versions separately.
- `cairn core <command>` explicitly bypasses overlay behavior for diagnosis.
- Other commands, especially `memory-server`, delegate to the pinned core with
  the validated machine and project environment loaded.

Do not replace core source files. A small wrapper preserves the upstream command
surface while making managed bootstrap the default users reasonably expect.

## Distribution manifest

Store non-secret capabilities and data-routing policy in
`cairnkeep.overlay.json`. The reference schema is
[`schemas/cairnkeep-overlay.schema.json`](../schemas/cairnkeep-overlay.schema.json),
with a complete example in
[`examples/overlay-distribution`](../examples/overlay-distribution/cairnkeep.overlay.json).

The distribution version and core version are independent. Pin the core exactly
and test every distribution release against it.

After a successful bootstrap, write an untracked project profile lock containing
the distribution identity, versions, and non-secret policy. Refuse a different
overlay identity before making changes. A stale lock should make `doctor` fail
with an instruction to rerun managed bootstrap.

## Configuration and secrets

Use two explicit configuration layers:

1. A mode-0600 machine profile in the user's configuration directory.
2. An optional untracked, mode-0600 project override in `.ai/.env`.

Validate both files before sourcing them: reject symlinks, permissive modes, and
tracked project files. The manifest and project lock must never contain tokens,
cookies, private keys, or credential-bearing URLs.

`cairn config explain` should answer these questions directly:

- Is memory local or remote?
- Which transport is used?
- Which directory or endpoint receives memory?
- Is document RAG disabled, local, or remote?
- Which configuration files selected those values?

## Private package delivery

A distribution can be an ordinary scoped npm package with:

- `@cairnkeep/cli` as an exact dependency;
- a `bin.cairn` entry for the wrapper;
- `publishConfig.access` set to `restricted`;
- an explicit guard that rejects the public npm registry;
- registry credentials supplied by a user credential helper or protected CI
  variables, never by repository files.

Support installation from a private registry, a reviewed tarball, and a local
checkout. Avoid `postinstall` enrollment: installing a package must not silently
replace machine policy. Provide an explicit enrollment command with a retained
rollback target.

## Release and fleet safety

Every release should verify:

- fresh managed bootstrap and idempotent reruns;
- core delegation and the explicit core escape hatch;
- profile mismatch rejection before mutation;
- storage and RAG policy enforcement;
- secret and runtime-artifact exclusion from the package;
- package installation from the produced tarball;
- checksums, an SBOM, and an immutable version;
- pre-upgrade and post-upgrade `doctor` results;
- rollback to the previous command or package version.

For a fleet migration, update the machine operating layer once, reapply managed
bootstrap to projects without altering tracked Git status, and validate every
profile lock. Storage migrations require their own backup, integrity, canary,
and rollback procedure; changing an overlay version alone must not move data.
