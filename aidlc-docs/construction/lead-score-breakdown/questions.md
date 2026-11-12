# Questions

Answer each question by writing a letter (or your own text) after `Answer:`.
Work stops until every question has an answer.

This run is in automatic mode (`--auto`). No person answered these questions.
Each answer below is the simplest reasonable assumption, chosen by the AI.

## 1. What total is shown for a Lead whose stored Score is empty?

A Lead created before the feature was deployed has no stored Score until it
is next saved (inception question 8).

- A. The total calculated now from the current rules, so the total and the lines agree.
- B. 0, with the matched rules still listed under it.
- C. A message asking the rep to save the Lead to score it.

Answer: Assumed (auto mode): A. It needs no extra state in the component and never shows a total that contradicts the lines. Whenever a Score is stored, the stored value is shown, as the unit of work says. The stored field itself stays empty until the Lead is saved.

## 2. What happens to a rule whose Lead field the rep is not allowed to read?

- A. The rule is left out of the breakdown. The lines may then add up to less than the stored total.
- B. The whole component shows an error.
- C. The rule is listed anyway.

Answer: Assumed (auto mode): A. Listing the rule (C) would tell the rep something about a field they cannot read, which breaks guardrail 4. An error (B) would hide the breakdown from every rep the moment an admin adds a rule on a restricted field. The total still comes from the stored Score, which the permission set lets the rep read.

## 3. Is the component's text in custom labels or written in the component?

- A. Written in the component, in English.
- B. Custom labels, so the text can be translated.

Answer: Assumed (auto mode): A. No story asks for translation, and the rule labels, which are most of what the rep reads, already come from the admin's custom metadata records. Server error messages are written in the Apex class, also in English.
