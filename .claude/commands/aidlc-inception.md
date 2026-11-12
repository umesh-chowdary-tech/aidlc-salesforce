---
description: AI-DLC Inception. Turn a one-paragraph intent into user stories and units of work, then stop for approval.
argument-hint: <one-paragraph intent>
---

# AI-DLC Inception

Intent from the human: $ARGUMENTS

Follow these steps in order. Do not write any Salesforce source in this phase.

## 1. Check state

Read `aidlc-docs/state.md`.

- If `pending_gate` is anything other than `none`, do not continue. Tell the
  human which gate is pending and what they need to review, then stop. The
  one exception: `pending_gate: inception-approval` and the human's message
  approves or requests changes; then go to "On approval" or revise the
  artifacts.
- If `phase` is `construction`, `operations` or `done`, say that Inception
  has already been approved and stop. Starting a new intent needs the human
  to say so explicitly.
- If no intent was given, ask for one and stop.

## 2. Read the rules

Read `aidlc/salesforce-rules.md`. Units of work must be shaped so each can
obey it.

## 3. Capture the intent

Write `aidlc-docs/inception/intent.md` from `aidlc/templates/intent.md`.
Record what the human said in their words. Mark anything you inferred as an
assumption.

## 4. Ask what is missing

If anything needed to write stories is unclear (who the users are, which
objects are involved, what the limits are, what happens on bad data), write
the questions to `aidlc-docs/inception/questions.md` from
`aidlc/templates/questions.md`, each with lettered options. Tell the human
the file is waiting for answers. Stop and wait for the human. Do not guess.

When every `Answer:` line is filled in, continue. If nothing is unclear,
write the file with the single line "No open questions." and continue.

## 5. Write user stories

Write `aidlc-docs/inception/user-stories.md` from
`aidlc/templates/user-stories.md`. Every story has acceptance criteria that
can be checked in an org.

## 6. Split into units of work

Write `aidlc-docs/inception/units-of-work.md` from
`aidlc/templates/units-of-work.md`. Each unit has a lowercase hyphenated
slug, names the Salesforce components it creates, covers at least one story,
and lists its dependencies. Order them so no unit depends on a later one.
Every story is covered by some unit.

## Gate

Update `aidlc-docs/state.md`: `phase: inception`, `unit: -`,
`pending_gate: inception-approval`,
`next_step: Human reviews aidlc-docs/inception/ and approves.`

Tell the human, briefly: the stories (ID and title), the units in build
order, any assumptions you made, and the files to review.

Stop and wait for the human.

## On approval

Only when the human explicitly approves:

1. Append to `aidlc-docs/audit.md`:
   `## <ISO timestamp> inception-approval` followed by their words verbatim.
2. Update `aidlc-docs/state.md`: `phase: construction`, `pending_gate: none`,
   `next_step: Run /aidlc-construction <first unit slug>.`

If they ask for changes, revise the artifacts and return to the gate.
