# L01 - Try it safely

**Status:** Ready
**Track:** Quickstart
**Time:** 15 minutes
**Tested with:** Cairnkeep 2.2.1

## Outcome

You can launch the published memory-server image as an unprivileged,
read-only container and identify the only persistent resource it creates.

## Prerequisites

- Podman installed and able to run rootless containers.
- No Cairnkeep installation or coding harness is required.

## Mental model

This is a packaging and isolation trial, not the complete harness workflow.
The server communicates over stdio and waits for an MCP client. The container is
ephemeral; the named course volume is persistent.

## Exercise

1. Pull the public image:

   ```bash
   podman pull ghcr.io/cairnkeep/cairnkeep:2.2.1
   ```

2. Start the stdio server with a read-only root filesystem and no Linux
   capabilities:

   ```bash
   podman run --rm -i \
     --userns=keep-id:uid=10001,gid=10001 \
     --read-only --cap-drop=all --security-opt=no-new-privileges \
     --tmpfs=/tmp:rw,noexec,nosuid,size=64m,mode=1777 \
     --volume cairnkeep-course-data:/data:Z,U \
     ghcr.io/cairnkeep/cairnkeep:2.2.1 stdio
   ```

3. The process waits quietly for MCP input. Press `Ctrl-C` after confirming it
   remains running.

4. Inspect the persistent resource:

   ```bash
   podman volume inspect cairnkeep-course-data
   ```

## Verify

```bash
podman volume exists cairnkeep-course-data
echo $?
```

Exit status `0` confirms that the named volume exists. No listener was exposed
on the network by this lesson.

## Common failures

| Symptom | Cause | Recovery |
|---|---|---|
| `podman: command not found` | Podman is not installed | Skip L01 and continue with host installation in L02 |
| Image pull is denied | Registry or network policy blocks GHCR | Use the npm installation in L02 |
| SELinux mount error | Unsupported volume labelling mode | Confirm the documented Podman/SELinux setup before changing flags |

## Privacy and trust boundary

The command publishes no port and mounts no project directory, home directory,
or credential. Only the named volume is persistent. Do not infer that a
container automatically provides remote memory or a containerized harness.

## Clean up

This deletes only the empty course volume. Do not reuse this command for a
volume containing real memory.

```bash
podman volume rm cairnkeep-course-data
```

## Recap

- The server image runs unprivileged and read-only.
- Stdio does not expose a network listener.
- Persistence belongs to an explicitly named volume.

Next: [L02 - Install the local workflow](L02-installation.md).

## Video

Use [the L01 presenter script](../video-scripts/L01-safe-trial.md).
