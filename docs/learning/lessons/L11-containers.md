# L11 - Containers and isolation

**Status:** Brief
**Track:** Operator
**Planned time:** 40 minutes

## Outcome

Select and operate local stdio, authenticated HTTP, persistent service, or
isolated workspace container modes while preserving data deliberately.

## Planned lesson

- Minimal server image versus workspace base image.
- Rootless execution, read-only filesystems, volumes, and secret mounts.
- Loopback HTTP, TLS/rebinding boundaries, and trust domains.
- Podman Compose and Quadlet persistence.
- Sandbox-copy versus shared-host workspace modes.
- Backup and rollback before image replacement.

## Hands-on lab

Start a loopback authenticated server with a disposable token file and volume,
probe health and memory persistence across container replacement, then remove
only the course resources.

## Acceptance criteria

- No credential appears in the image, command line, or repository.
- The service binds only to the documented interface.
- Memory survives container replacement and disappears only when the course
  volume is deliberately removed.
- The learner can enumerate every mount and network boundary.

## Planned video

Use a diagram first, then replace a running container while retaining its
volume. Target 15 minutes.

## Source material

- [Containers](../../containers.md)
