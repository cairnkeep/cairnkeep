# L08 - Multiple machines

**Status:** Brief
**Track:** Practitioner
**Planned time:** 40 minutes

## Outcome

Choose between independent local stores, export/import migration, and a trusted
remote service, then execute a backup-first migration without data loss.

## Planned lesson

- Independent local memory versus intentional centralization.
- WAL-safe `cairn memory export` and backup-first import.
- Trusted-client automation with private configuration.
- Authenticated HTTP routing and one-server/one-trust-domain limitations.
- Migration ordering, rollback, and old-client compatibility.
- Verifying source and destination before decommissioning anything.

## Hands-on lab

Create a disposable store, write two synthetic facts, export it, import into a
second isolated base directory, verify both facts, and demonstrate rollback to
the pre-import backup.

## Acceptance criteria

- Source data remains intact throughout the exercise.
- The destination is backed up automatically before import.
- The learner verifies counts and exact synthetic values on both sides.
- No remote service is introduced merely to complete the migration lab.

## Planned video

Record the backup, migration, verification, and rollback without cuts that hide
state transitions. Target 12 minutes.

## Source material

- [Storage and deployment](../../storage.md#inspecting-and-moving-memory)
