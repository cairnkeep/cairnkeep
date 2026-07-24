# L01 Video Script - Try it safely

**Target duration:** 8 minutes
**Companion lesson:** [L01](../lessons/L01-safe-trial.md)

## Recording setup

- Use a terminal with no registry credentials or unrelated containers visible.
- Remove any prior `cairnkeep-course-data` volume before recording.
- Put the complete Podman command in a prepared text file to avoid typing errors.

## 00:00 - Hook

**Say:** “Before installing commands or changing a coding harness, we can inspect
how the Cairnkeep server is packaged and what it is allowed to persist.”

**Show:** An empty terminal and `podman --version`.

## 00:30 - Outcome

**Say:** “We will run the server as an unprivileged, read-only container, expose
no network port, and identify the single named volume that would hold memory.”

## 01:00 - Pull the image

**Say:** “I am pinning the course version rather than using `latest`, so this
recording and the written instructions refer to the same artifact.”

**Do:** Run the L01 `podman pull` command.

**Point out:** The exact image name and version, without dwelling on layer output.

## 02:00 - Explain the isolation flags

**Say:** “The root filesystem is read-only, Linux capabilities are dropped,
new privileges are disabled, and only a constrained temporary directory plus a
named data volume are writable. No home directory or project is mounted.”

**Show:** Highlight the command in sections before running it.

## 03:15 - Start and stop

**Do:** Run the direct Podman stdio command.

**Say:** “The quiet process is expected. It is waiting for MCP messages on
standard input; it is not a web application.”

**Do:** Pause for two seconds, then press `Ctrl-C`.

## 04:30 - Inspect persistence

**Do:** Run `podman volume inspect cairnkeep-course-data`.

**Say:** “The container was disposable. The named volume is separate and would
survive replacement of the container. Removing that volume would remove its
stored databases.”

## 05:40 - Boundary and recovery

**Say:** “This test exposed no port and contacted no remote Cairnkeep server.
If your environment blocks GHCR or Podman, skip this optional trial and use the
npm installation in L02.”

**Do:** Run `podman volume exists cairnkeep-course-data` and show status `0`.

## 06:50 - Cleanup and recap

**Do:** Run `podman volume rm cairnkeep-course-data`.

**Say:** “Never run that cleanup against a real memory volume. We proved three
things: the server runs unprivileged, stdio exposes no listener, and persistence
is explicit. In L02 we install the complete local workflow.”

## Editing notes

- Blur unrelated image and volume names if they appear.
- Add a warning caption before volume removal.
- Link the Containers documentation and L02.
