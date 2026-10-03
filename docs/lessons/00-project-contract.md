# Lesson 00 — The project contract

## Goal

Before writing code, give every coding assistant the same rules, architecture, and plan so that
work stays consistent across sessions and across assistants (Claude, GPT, or others).

## What we created

| File | Purpose |
| --- | --- |
| `AGENTS.md` | The single project contract: product scope, architecture, 11 implementation rules, report format. |
| `CLAUDE.md` | A two-line pointer to `AGENTS.md` and the state file, so the rules exist in only one place. |
| `docs/project-plan.md` | 36 milestones with scope and acceptance criteria. |
| `docs/project-state.md` | What is actually done and verified, plus the next step. |
| `docs/decisions/` | Architecture decision records, starting with the baseline (ADR 0001). |
| `README.md` | Student-facing walkthrough: why this prompt exists, the steps taken, and the results. |

## Key ideas to teach

1. **Contract over conversation.** Chat history gets lost when you start a new session. Rules in
   the repository persist.
2. **One rule set.** Duplicate instruction files drift apart. Tool-specific files should point to
   the contract instead of copying it.
3. **State is evidence.** `project-state.md` records the checks that were actually run, not what an
   assistant claims. When you resume (prompt R1), reconcile this file with the repository.
4. **Small verified slices.** Each milestone ends with working behavior and a completion report.
   Blocked checks are recorded honestly with the next command to run.
5. **The runtime and the coding assistant are separate.** The application always uses the Claude
   Agent SDK, whichever assistant writes the code.

## Instructor demo

Open a fresh assistant session. Ask it what the next milestone is, and show that it finds the
answer by reading `CLAUDE.md` → `AGENTS.md` → `docs/project-state.md`.

## Student exercise

Find the rule in `AGENTS.md` that forbids trusting a user ID supplied by the model. Explain which
later milestones (07, 17, 25, 29) must enforce it, and how.

## Common mistake

Pasting the whole prompt pack at once. Run one milestone per prompt and verify it before moving on.
