# Instructor Guide

## Before each lesson

- Confirm the lesson is marked **Ready**, not **Brief**.
- Run every command against the current Cairnkeep release.
- Use a disposable repository and synthetic names, URLs, tokens, and data.
- Hide notifications, shell history, credentials, bookmarks, and unrelated
  repositories before screen recording.
- Increase terminal font size and keep one command per visible line.
- Prepare a clean start snapshot and a known-good completed snapshot.
- Rehearse the failure-recovery section, not only the happy path.

## Recommended recording format

Record each video as independent segments:

1. **Hook:** the concrete problem in 20-40 seconds.
2. **Outcome:** what the learner will be able to verify.
3. **Concept:** only the mental model required for the exercise.
4. **Demo:** commands and observable results.
5. **Boundary:** storage, privacy, or trust implication.
6. **Recap:** result and next lesson.

Aim for 8-15 minutes. If a script exceeds 15 minutes, split the lesson rather
than speaking faster.

## Recording conventions

- Say command intent before typing the command.
- Pause after important output so it can be read.
- Never paste a real token, cookie, endpoint, email, or repository name.
- Describe output rather than claiming every learner will see identical text.
- Keep mistakes that teach a recovery step; remove unrelated typing mistakes.
- Refer to lessons by stable ID, for example “L02”, so links survive title edits.

## Pilot feedback

Ask each pilot learner:

1. Where did you first become uncertain?
2. Which command did you run without understanding its effect?
3. Where do you believe memory is stored?
4. What would prevent you from using this in a real project tomorrow?
5. Which result made the value clear?

Record observations without collecting project content, prompts, credentials,
or memory values.

## Definition of done

A lesson is **Ready** only when:

- prerequisites and cleanup are explicit;
- all commands were executed from the documented starting state;
- verification distinguishes success from partial installation;
- common failures have actionable recovery steps;
- storage and privacy implications are stated;
- the video script matches the verified lesson;
- a learner other than the author completed it without hidden instructions.
