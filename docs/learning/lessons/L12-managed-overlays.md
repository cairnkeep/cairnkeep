# L12 - Managed overlays

**Status:** Brief
**Track:** Operator
**Planned time:** 45 minutes

## Outcome

Design a private managed distribution that pins the public core, injects policy
through supported seams, delivers no secrets, and upgrades fleets safely.

## Planned lesson

- Why an overlay is a distribution, not a fork of core behavior.
- Manifest, core pin, launcher seams, and project profile lock.
- Private registry and derived container image options.
- Machine-private configuration versus distributable defaults.
- Bootstrap, diagnostics, fleet status/update, release gates, and rollback.
- Compatibility guarantees for existing clients and stored memory.

## Hands-on lab

Build a generic example overlay that adds a harmless pre-launch environment
marker, packages it to a local registry, bootstraps two disposable projects,
upgrades the pin, verifies fleet status, and rolls one project back.

## Acceptance criteria

- The public core remains provider-neutral and unmodified.
- The package and image contain no credential or machine-private configuration.
- Effective storage and service destinations are explainable before launch.
- Upgrade and rollback preserve the disposable memory store.

## Planned video

Show the same project under public core and a generic managed overlay, then
explain the small delta. Target 15 minutes; keep registry administration in the
written operator lab.

## Source material

- [Building a private overlay](../../building-an-overlay.md)
- [Managed distributions](../../overlay-distributions.md)
