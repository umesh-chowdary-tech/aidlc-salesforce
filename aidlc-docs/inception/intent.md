# Intent

## Intent

In the requester's words:

> Score each Lead from 0 to 100 using configurable rules, and show sales reps
> why a Lead has its score. Keep it simple: rules are custom metadata records
> (Lead field, operator equals / not blank / greater than, value, points,
> active), the score is the sum of matching rules kept between 0 and 100 and
> is set by a before-save trigger, a badly configured rule must never block a
> save, and a Lightning web component on the Lead page shows the total and the
> per-rule breakdown. Ship five sample rules and one permission set.

## Who it is for

- **Sales reps** work Leads on the Lead record page. *Assumption:* today they
  have no score and decide which Lead to call first by reading each record.
- **Salesforce admins** maintain the scoring rules. *Assumption:* they edit
  custom metadata records in Setup and do not want a deployment to change
  points or add a rule.

## Success looks like

Stated by the requester:

- Saving a Lead (insert or update) sets its score to the sum of the points of
  every active rule the Lead matches, never below 0 and never above 100.
- A rule is a custom metadata record with a Lead field, an operator (equals,
  not blank, greater than), a value, points, and an active flag. Changing a
  record changes scoring on the next save, with no deployment.
- A rule that is badly configured (for example an unknown field name, an
  unknown operator, or a non-numeric value for greater than) does not stop a
  Lead from saving.
- A Lightning web component on the Lead record page shows the Lead's total
  score and one line per rule that contributed, with its points.
- Five sample rules and one permission set are in source and deploy with the
  code.

Inferred (assumptions, recorded in `questions.md`):

- The score is stored in a new custom field, `Lead.Score__c`.
- A badly configured rule is skipped and counts as 0 points; the other rules
  still apply.
- The permission set grants read access to the score field and access to the
  component's Apex; a rep without it sees a readable message, not a broken
  component.

## Out of scope

All of these are assumptions; the requester said only "keep it simple".

- Re-scoring existing Leads in bulk when a rule changes. A Lead is re-scored
  the next time it is saved.
- Operators beyond equals, not blank and greater than; AND/OR grouping of
  conditions; rules that read fields on related records.
- Storing score history or the breakdown on the record. The breakdown is
  worked out when the component loads.
- A custom screen for editing rules. Admins use the standard custom metadata
  pages in Setup.
- Scoring any object other than Lead.
- Reports, dashboards, list views, assignment or routing based on the score.
