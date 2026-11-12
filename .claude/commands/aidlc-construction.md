---
description: AI-DLC Construction. Design one unit of work, stop for approval, then build and verify it and stop again.
argument-hint: <unit-slug>
---

# AI-DLC Construction

Unit requested: $ARGUMENTS

Construction has two gates per unit: the design is approved before any code
exists, and the built unit is approved after local verification.

## 1. Check state

Read `aidlc-docs/state.md` and `aidlc-docs/inception/units-of-work.md`.

- If `phase` is `not-started` or `inception`, or `pending_gate` is
  `inception-approval`, do not continue. Say that the `inception-approval`
  gate is pending and stop.
- If `pending_gate` is `design-approval` or `unit-approval`:
  - for the same unit, and the human's message approves or requests changes:
    go to the matching "On approval" section, or revise;
  - otherwise say which gate is pending for which unit and stop.
- If `pending_gate` is `deploy-approval`, or `phase` is `operations` or
  `done`, say so and stop.
- The slug must exist in `units-of-work.md`. If it does not, list the valid
  slugs and stop.
- Every unit this one depends on must be listed under "Approved units" in
  `state.md`. If not, name the missing unit and stop.

## 2. Read the rules

Read `aidlc/salesforce-rules.md`. It is mandatory for the design and the
code.

## 3. Design the unit

Read the stories this unit covers and the source already in `force-app/`.
Reuse names and signatures produced by approved units exactly.

Write `aidlc-docs/construction/<unit-slug>/unit-design.md` from
`aidlc/templates/unit-design.md` and
`aidlc-docs/construction/<unit-slug>/test-plan.md` from
`aidlc/templates/test-plan.md`. The test plan includes a bulk test for any
Apex that runs on record save.

If a design decision needs the human, write it to
`aidlc-docs/construction/<unit-slug>/questions.md` from
`aidlc/templates/questions.md`, say so, and stop until it is answered.

## Gate

### Gate 1: design-approval

Update `aidlc-docs/state.md`: `phase: construction`, `unit: <unit-slug>`,
`pending_gate: design-approval`,
`next_step: Human reviews the unit design and test plan.`

Summarise for the human: components to be created, public signatures, the
tests planned, and any guardrail that will not be followed with the reason.

Stop and wait for the human.

### On design approval

Append `## <ISO timestamp> design-approval <unit-slug>` and the human's
words to `aidlc-docs/audit.md`. Set `pending_gate: none`. Then build:

1. Write the tests in the test plan first. For LWC, run `npm run test:unit`
   and confirm the new tests fail because the component does not exist yet.
2. Write the metadata and code to the approved design. Use the API version
   in `sfdx-project.json` for every `-meta.xml`.
3. Verify locally and record each result under "Local verification" in the
   unit design:
   - `npm run test:unit` passes;
   - `npm run lint` is clean;
   - `sf code-analyzer run --workspace force-app --rule-selector Recommended`
     reports no high or critical violations, if the plugin is installed; if
     it is not, check the guardrails by reading the code and say that;
   - `sf project convert source --root-dir force-app --output-dir <temp dir>`
     succeeds, which shows the source tree is structurally valid.
4. Tick the guardrail checklist honestly. Apex tests cannot run without an
   org: say that they are written and unexecuted, never that they pass.

### Gate 2: unit-approval

Update `aidlc-docs/state.md`: `pending_gate: unit-approval`,
`next_step: Human reviews the built unit <unit-slug>.`

Summarise: files created, verification results, what was not run and why.

Stop and wait for the human.

### On unit approval

Append `## <ISO timestamp> unit-approval <unit-slug>` and the human's words
to `aidlc-docs/audit.md`. In `aidlc-docs/state.md`: add the line
`- <unit-slug>` under "Approved units", set `pending_gate: none`, `unit: -`, and `next_step` to
the next unit's command, or to `Run /aidlc-operations.` if every unit is
approved.

If the human asks for changes at either gate, make them and return to that
gate.
