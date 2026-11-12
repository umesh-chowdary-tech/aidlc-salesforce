# Questions

Answer each question by writing a letter (or your own text) after `Answer:`.
Work stops until every question has an answer.

This run is in automatic mode (`--auto`). No person answered these questions.
Each answer below is the simplest reasonable assumption, chosen by the AI.

## 1. Should the rule type reject incomplete rules when the admin saves them?

- A. No. No field is required and there are no validation rules. An incomplete rule saves and is skipped at scoring time by unit 2.
- B. Yes. Make Lead Field, Operator and Points required, so Setup refuses an incomplete rule.

Answer: Assumed (auto mode): A. US-3 describes rules with an empty Operator, Points or Value as something that can exist and must be survived. Required fields would not catch an unknown field name or a non-numeric value anyway, so unit 2 needs the skipping logic either way.

## 2. What do the sample rules' labels say?

- A. Plain descriptions of the rule: "Email not blank", "Phone not blank", "Industry equals Technology", "Employees greater than 100", "Annual revenue greater than 1,000,000".
- B. Rep-friendly wording, for example "Has an email address", "Works in Technology".

Answer: Assumed (auto mode): A. These match the wording in US-1. The label is what the breakdown component shows; an admin can reword it in Setup without a deployment.

## 3. Does the permission set also grant access to the Lead object?

- A. No. It grants only read on `Lead.Score__c`. Reps already get Lead access from their profile or other permission sets.
- B. Yes. Add read on Lead.

Answer: Assumed (auto mode): A. The units of work list only read on the score field, and widening record access is not this feature's job.
