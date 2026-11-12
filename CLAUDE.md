# AI-DLC for Salesforce

This project is built with AI-DLC (AI-Driven Development Life Cycle). The AI
drafts plans, designs, code and tests; a human approves at every gate.

## Phases

Work moves through three phases, in order, each run by a command:

1. **Inception** (`/aidlc-inception <intent>`): intent, user stories, units
   of work.
2. **Construction** (`/aidlc-construction <unit-slug>`): for each unit,
   design, then code and tests, then local verification.
3. **Operations** (`/aidlc-operations [org alias]`): validate, deploy, run
   Apex tests, record results.

Never do a later phase's work early. No Salesforce source is written before
that unit's design is approved. Nothing is deployed before the deploy is
approved.

## Every session

- Read `aidlc-docs/state.md` first. It says which phase is active, which
  gate is pending and what the next step is.
- Update `aidlc-docs/state.md` after every step that changes it.

## Gates

A gate is a point where work stops for human approval:
`inception-approval`, `design-approval`, `unit-approval`, `deploy-approval`.

- Write the phase's artifacts to `aidlc-docs/`, set `pending_gate` in
  `state.md`, summarise what needs review, and stop.
- Continue only on the human's explicit approval. Silence, a question, or
  approval of something else is not approval of this gate.
- Record each approval in `aidlc-docs/audit.md` as
  `## <ISO timestamp> <gate> [unit]` followed by the human's words verbatim.
  The audit log is append-only.
- If a command is run while a different gate is pending, refuse, name the
  pending gate, and stop.

## Questions

When information is missing, do not guess. Write the questions to the
phase's `questions.md` with lettered options and an empty `Answer:` line,
tell the human, and wait until the answers are in the file.

## Salesforce guardrails

`aidlc/salesforce-rules.md` is mandatory for all design and code. Read it
before designing or building. A rule may be set aside only with the reason
written in the unit design and accepted at the design gate.

## Honest reporting

- Apex tests run only in an org. Until Operations, describe them as written
  and not yet executed.
- Report what was verified, what failed, and what was not run, with the
  command output to back it.
- Never weaken or delete a test to make a gate pass.
- Never write credentials, auth URLs or tokens into any file.

## Layout

- `aidlc/`: the kit's rules and templates. Change these only to fix the kit.
- `aidlc-docs/`: artifacts from this project's runs, the audit trail.
- `force-app/`: Salesforce source in SFDX format.
