# Questions

Answer each question by writing a letter (or your own text) after `Answer:`.
Work stops until every question has an answer.

This run is in automatic mode (`--auto`). No person answered these questions.
Each answer below is the simplest reasonable assumption, chosen by the AI.

## 1. Where is the score stored?

- A. A new custom number field on Lead, `Score__c` (0 decimal places).
- B. The standard `Rating` picklist (Hot / Warm / Cold), mapped from the number.
- C. Both: a number field and the Rating picklist.

Answer: Assumed (auto mode): A. The intent asks for a number from 0 to 100, and a single custom field is the simplest thing that holds it.

## 2. What happens to a badly configured rule?

- A. It is skipped and counts as 0 points. Other rules still apply, the save succeeds, and the problem is written to the debug log.
- B. As A, and the Lead component also shows reps a warning naming the broken rule.
- C. As A, and an admin is notified by email.

Answer: Assumed (auto mode): A. The intent only requires that the save is never blocked. Showing the warning in the component (B) is a small addition if the reviewer wants it.

## 3. What counts as "badly configured"?

- A. The Lead field does not exist, the operator is not one of the three, points is empty, or the value is empty or not a number for "greater than". Also any unexpected error while evaluating that one rule.
- B. Only an unknown field name.

Answer: Assumed (auto mode): A. "Must never block a save" is safest when every per-rule failure is contained.

## 4. How do the operators compare values?

- A. "equals" compares as text, ignoring case and surrounding spaces. "greater than" compares as numbers and only matches when the Lead's field holds a number. "not blank" ignores the rule's value. A blank Lead field never matches "equals" or "greater than".
- B. "equals" is case-sensitive.
- C. "greater than" also compares dates and text.

Answer: Assumed (auto mode): A. It matches how admins expect picklist and text values to behave and keeps "greater than" to one meaning.

## 5. Can a rule have negative points?

- A. Yes. Points may be negative; the total is still kept between 0 and 100.
- B. No. Points must be 0 or more.

Answer: Assumed (auto mode): A. The intent says the sum is "kept between 0 and 100", and a lower bound only matters if points can be negative.

## 6. What does the breakdown show?

- A. Only the active rules the Lead matches, each with its label and points, plus the total. If no rule matches, a message saying so.
- B. Every active rule, marked matched or not matched.

Answer: Assumed (auto mode): A. Reps asked "why does this Lead have its score"; the rules that contributed answer that with the least noise.

## 7. Is the breakdown stored or worked out on view?

- A. Worked out when the component loads, from the Lead's current field values and the current rules. The total shown is the stored `Score__c`.
- B. Stored on the Lead at save time (for example as JSON in a long text field).

Answer: Assumed (auto mode): A. Nothing extra to store. Known consequence: if an admin changes a rule after a Lead was last saved, the breakdown lines may not add up to the stored total until the Lead is saved again. The unit design must say how the component handles that.

## 8. Are existing Leads re-scored when rules change?

- A. No. A Lead is re-scored the next time it is saved.
- B. Yes, by a batch job an admin can run.

Answer: Assumed (auto mode): A. The intent names only a before-save trigger.

## 9. What does the one permission set grant?

- A. Read access to `Lead.Score__c` and access to the Apex class behind the component. It is meant for sales reps. The score field is read-only for them; only the trigger writes it.
- B. As A, plus edit access to the score field.

Answer: Assumed (auto mode): A. A score a rep can type over is not a score. Admins already manage custom metadata through their own permissions.

## 10. Which five sample rules ship?

- A. Standard Lead fields only, so they work in any org:
  Email not blank (+10); Phone not blank (+10); Industry equals "Technology" (+20); NumberOfEmployees greater than 100 (+25); AnnualRevenue greater than 1000000 (+25).
- B. The requester supplies their own five.

Answer: Assumed (auto mode): A. The sample covers all three operators and needs no org-specific fields. The points are placeholders for an admin to tune.

## 11. How does the component get onto the Lead page?

- A. The component is made available to Lead record pages; an admin drags it onto the page in Lightning App Builder. The step is written in the README as a manual step.
- B. A Lead record page (FlexiPage) with the component ships in source and is activated by hand.

Answer: Assumed (auto mode): A. Shipping a page layout would overwrite or compete with whatever Lead page the org already uses.
