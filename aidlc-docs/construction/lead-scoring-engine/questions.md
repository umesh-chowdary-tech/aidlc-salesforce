# Questions

Answer each question by writing a letter (or your own text) after `Answer:`.
Work stops until every question has an answer.

This run is in automatic mode (`--auto`). No person answered these questions.
Each answer below is the simplest reasonable assumption, chosen by the AI.

## 1. Where do the score limits 0 and 100 live?

- A. As two named constants in `LeadScoringService`. They are part of what the feature is (the intent says "a score from 0 to 100", and `Score__c` holds three digits), not something an admin tunes.
- B. In custom metadata, as a new settings type an admin can change.

Answer: Assumed (auto mode): A. A second metadata type for two numbers the intent fixes is more than the stories ask for. This sets guardrail 5 aside for these two values only; the reason is written in the unit design's guardrail checklist for acceptance at the design gate.

## 2. Is a Lead re-scored on every update, or only when a scored field changed?

- A. Every update. The score is recalculated each time the Lead is saved.
- B. Only when a field named by a rule has changed.

Answer: Assumed (auto mode): A. US-2 requires that a save after an admin changes a rule's points uses the new points, and that a typed-in Score is replaced. Both need a recalculation on every save. The calculation does no queries per record, so the cost is small.

## 3. How does "Equals" compare a number field, such as NumberOfEmployees equals 100?

- A. When the Lead field holds a number and the rule's Value is a number, they are compared as numbers (so 100 equals 100.0). Otherwise as text, ignoring case and surrounding spaces, as inception question 4 says.
- B. Always as text.

Answer: Assumed (auto mode): A. As text, a currency field holding 1000000.00 would never equal a rule value of 1000000, which an admin would read as a bug. Text and picklist fields behave exactly as inception question 4 describes.

## 4. How often is a badly configured rule written to the debug log?

- A. Once per transaction, when the rules are loaded, naming the rule and the reason. A failure that only shows up while evaluating one Lead is logged once per rule per transaction as well.
- B. Once per Lead saved.

Answer: Assumed (auto mode): A. A 200-record load with one bad rule should produce one line, not 200. US-3 asks only that the log names the rule and the reason.
