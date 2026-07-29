# Learn Cairnkeep

This learning path teaches Cairnkeep through small, verifiable outcomes. The
canonical lesson is written once and can be reused as a guide, blog post,
workshop handout, or video script.

## Start here

Choose the shortest track that matches your goal:

- [Quickstart](tracks/quickstart.md) - prove the core value in about 75 minutes.
- [Practitioner](tracks/practitioner.md) - adopt Cairnkeep in daily project work.
- [Evidence and evaluation](tracks/evidence-and-evaluation.md) - inspect optional
  session evidence, govern capabilities, and measure changes without overstating
  results.
- [Operator](tracks/operator.md) - storage, optional services, containers, and
  managed distributions.

For a single view of every released surface, its default, storage boundary,
restart requirement, and rollback path, use the [feature guide](FEATURE-GUIDE.md).
The public [course labs](https://github.com/cairnkeep/cairnkeep-course-labs)
provide one synthetic project with tagged checkpoints shared by lessons,
articles, workshops, and videos.

Lessons marked **Ready** include a complete exercise and presenter script.
Lessons marked **Brief** define outcomes and acceptance criteria and will be
expanded according to the [production plan](PRODUCTION-PLAN.md).

## Curriculum

| ID | Lesson | Status | Typical time |
|---|---|---|---:|
| L00 | [Why Cairnkeep?](lessons/L00-why-cairnkeep.md) | Ready | 10 min |
| L01 | [Try it safely](lessons/L01-safe-trial.md) | Ready | 15 min |
| L02 | [Install the local workflow](lessons/L02-installation.md) | Ready | 25 min |
| L03 | [Bootstrap the first project](lessons/L03-first-project.md) | Ready | 25 min |
| L04 | [Memory fundamentals](lessons/L04-memory-fundamentals.md) | Brief | 35 min |
| L05 | [The daily workflow](lessons/L05-daily-workflow.md) | Brief | 40 min |
| L06 | [Repository review and security](lessons/L06-repository-quality.md) | Brief | 45 min |
| L07 | [Privacy and storage](lessons/L07-privacy-and-storage.md) | Brief | 30 min |
| L08 | [Multiple machines](lessons/L08-multiple-machines.md) | Brief | 40 min |
| L09 | [Domain knowledge with RAG](lessons/L09-domain-knowledge.md) | Brief | 35 min |
| L10 | [Faster context exploration](lessons/L10-context-exploration.md) | Brief | 30 min |
| L11 | [Containers and isolation](lessons/L11-containers.md) | Brief | 40 min |
| L12 | [Managed overlays](lessons/L12-managed-overlays.md) | Brief | 45 min |
| L13 | [Session evidence and hindsight](lessons/L13-session-evidence.md) | Brief | 45 min |
| L14 | [Typed memory and controlled import](lessons/L14-typed-memory.md) | Brief | 40 min |
| L15 | [Capability governance](lessons/L15-capability-governance.md) | Brief | 35 min |
| L16 | [Evaluation and ablation](lessons/L16-evaluation.md) | Brief | 50 min |
| L17 | [The agent boundary](lessons/L17-agent-boundary.md) | Brief | 25 min |

The [curriculum coverage map](CURRICULUM-MAP.md) records where every public
feature is introduced, practised, and operated. It also marks design-only work
that must not be taught as a released capability.

## Teaching contract

Every complete lesson contains:

1. A practical problem and observable outcome.
2. Prerequisites and a clean starting state.
3. A hands-on exercise using non-sensitive sample data.
4. Verification and recovery steps.
5. A privacy or security boundary.
6. A presenter-ready video script.

The learner should never need optional infrastructure to complete L00-L06.
Remote memory, RAG, routing, containers, structured capture, typed nodes,
capability governance, and evaluation are separate opt-in modules.

## For contributors

Use [the lesson template](templates/lesson-template.md) and
[the video template](templates/video-script-template.md). The
[instructor guide](instructor-guide.md) defines rehearsal, recording, and
publication checks. Commands in finished lessons must be tested against the
current release before publication.
