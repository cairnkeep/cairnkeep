# Learning Path Production Plan

This plan grows the course in small publishable waves. Each wave produces a
useful learner outcome on its own and leaves the public material in a coherent
state.

## Guiding principles

- Demonstrate value before architecture.
- Keep public lessons provider-neutral and free of private configuration.
- Teach local storage first; remote storage must always be an explicit choice.
- Write the canonical lesson before recording the video.
- Use short videos that can be replaced independently after product changes.
- Treat commands, expected output, and recovery instructions as tested product
  surfaces rather than informal prose.
- Keep default-off evidence and evaluation features out of the quickstart.
- Never convert framework-fixture results into product-performance claims.

## Wave 0 - Course foundation

**Deliverables**

- Stable lesson IDs L00-L17.
- Quickstart, practitioner, evidence-and-evaluation, and operator tracks.
- Lesson, video, and instructor templates.
- Complete L00-L03 lesson and recording scripts.
- Briefs and acceptance criteria for L04-L17.
- A release-reviewed feature-to-lesson coverage map.

**Exit gate**

- A new learner can follow L00-L03 on a clean machine or stop safely after the
  container trial.
- Every command is current and no optional service is presented as mandatory.

## Wave 1 - Pilot the quickstart

1. Rehearse L00-L03 without recording and log confusing steps.
2. Run the lessons on one clean Linux environment and one macOS environment.
3. Record the four short videos from the supplied scripts.
4. Ask two learners to complete the track without live assistance.
5. Fix every repeated point of confusion before public promotion.

**Artifacts:** four videos, four blog-ready lessons, one learner feedback form.

**Exit gate:** both pilot learners reach a successful `/remember` and `/recall`
round trip and can explain where their memory is stored.

## Wave 2 - Daily practitioner value

Expand L04-L06 and L13 in this order:

1. L04 memory keys, scopes, search, history, and review.
2. L05 wiki, alignment, session hooks, and derived-knowledge boundaries.
3. L06 `/repo-review` and `/security-audit` against a deliberately vulnerable
   toy repository.
4. L13 structured evidence, redaction, deterministic hindsight, compaction,
   artifact inspection, and cleanup against synthetic sessions.

Use the public `cairnkeep-course-labs` repository created for this wave. Its
synthetic Trail Ledger project, prominent safety boundary, eight tagged
checkpoints, executable verification, offline evaluation route, and
`solutions/review-target` branch are the shared demo source. Expand lesson prose
and presenter scripts against those immutable starts rather than copying the
demo into this repository.

**Exit gate:** a learner can complete all labs from a fresh clone, and CI resets
and verifies every starter state.

## Wave 3 - Safe operation

Expand L07-L08 and add a backup/restore lab:

- Draw the local stdio and explicit remote HTTP data flows.
- Demonstrate `cairn memory path`, export, import, and rollback.
- Explain identity, project, and global routing without using real credentials.
- Test the multiple-machine procedure with disposable stores before recording.

**Exit gate:** the learner can predict the storage destination before starting
a session and can restore a snapshot without losing the pre-existing store.

## Wave 4 - Optional accelerators

Expand L09-L10 as independent modules:

- Optional document RAG, workspace selection, query, and sync.
- token-miser/FastContext exploration, citations, caching, and failure modes.

Each lesson begins and ends with the reminder that Cairnkeep works without the
optional component.

**Exit gate:** disabling either integration returns the learner to a healthy
standalone Cairnkeep workflow.

## Wave 5 - Evidence governance and measurement

Expand L14-L17 in dependency order:

1. L14 typed nodes, hard filters, logical note addresses, and import replay.
2. L15 capability precedence, omission, restart boundaries, and value-free
   callbacks.
3. L16 offline two-pass fixtures, one-capability ablation, report reading,
   missingness, uncertainty, retention, and claim boundaries.
4. L17 current-versus-design-only ownership and approval boundaries.

The first L16 lab must use only the committed deterministic fixture. A separate
live-evaluation course artifact may be introduced only after its provenance and
claim anchors pass the repository's runtime-evidence verifier.

**Exit gate:** the learner can inspect effective state and retained evidence,
execute the fixture safely, and state exactly why it does not prove a quality or
efficiency gain.

## Wave 6 - Operators and platform teams

Expand L11-L12:

- Rootless containers, persistent volumes, authenticated HTTP, and isolation.
- Overlay manifests, private package delivery, bootstrap policy, fleet updates,
  rollback, and release gates.

**Exit gate:** the operator can explain every host mount, network boundary,
credential source, storage destination, and rollback action.

## Wave 7 - Publication and maintenance

1. Publish a landing article linking to the four tracks.
2. Publish videos as a playlist with lesson IDs in every title.
3. Add release compatibility metadata to each completed lesson.
4. Run a command-verification pass for every Cairnkeep minor release.
5. Reconcile `cairn help`, the changelog, and the curriculum coverage map for
   every minor release.
6. Review learner feedback monthly during the pilot, then quarterly.

## How we will work together

For each lesson, follow this loop:

1. **Select:** choose the next lesson from the current wave.
2. **Discover:** collect real learner questions and one convincing use case.
3. **Draft:** complete the lesson using the template.
4. **Verify:** execute every command from a clean starting state.
5. **Script:** derive the video script from the verified lesson.
6. **Rehearse:** read it aloud while performing the demo once without recording.
7. **Record:** capture the short lesson in sections, not one continuous take.
8. **Pilot:** give the written lesson to a learner before publishing the video.
9. **Improve:** incorporate observed failures and publish both formats together.

The immediate next step is an unrecorded L00-L03 rehearsal using
`course-00-app` and `course-01-bootstrap`. Then expand L04-L06 and L13 against
`course-02-memory`, `course-03-quality`, and `course-05-evidence`. Use the
checklist in the [instructor guide](instructor-guide.md) and record questions
rather than polishing video production prematurely.
