---
description: AI-DLC change request. Fix what the requester found wrong in the org after a deploy, then hand back to Operations to redeploy.
argument-hint: [org alias]
---

# AI-DLC fix after acceptance

Org alias: $ARGUMENTS

The requester checked the deployed feature in the org and some checks did not
work. Their report follows this command, and is also in
`aidlc-docs/operations/acceptance.md`.

## 1. Check state

Read `aidlc-docs/state.md`. Continue only if `phase` is `done` and
`pending_gate` is `none`. Otherwise say what is pending and stop.

## 2. Read the rules

Read `aidlc/salesforce-rules.md`. Every fix obeys it.

## 3. Find the cause

For each failed check, compare what the requester saw with the user stories
in `aidlc-docs/inception/user-stories.md` and the unit designs. Decide which
of these it is:

- **A defect:** the feature does not do what an approved story says. Fix it.
- **A setup step:** the feature works but a manual step in the README was not
  done (for example the component is not on the page, or the permission set
  is not assigned). Do not change source. Explain the step in the reply.
- **A new requirement:** the requester wants something no approved story
  covers. Do not build it. Write it to `aidlc-docs/operations/questions.md`
  as a question whose options include "Start it as a new requirement".

## 4. Fix

For each defect: add or correct a test that fails because of it, then fix the
source in `force-app/`. Never weaken or delete a test. Run `npm run test:unit`
and `npm run lint`. Add a "Fix after acceptance" section to the affected
unit's `unit-design.md` saying what was wrong, what changed, and the result of
each check. Apex tests are written, not executed, until Operations runs them.

## 5. Hand back

Append `## <ISO timestamp> change-request` to `aidlc-docs/audit.md`, followed
by the requester's report verbatim and one line per fix. Then update
`aidlc-docs/state.md`: `phase: operations`, `pending_gate: none`,
`next_step: Run /aidlc-operations to validate and redeploy.`

If nothing needed a source change (only setup steps), still hand back as
above so the requester checks again after doing the steps.
