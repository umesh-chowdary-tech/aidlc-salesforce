# Unit design: lead-score-breakdown

Stories covered: US-4, US-5 (Apex class access in the permission set, and the
Lightning App Builder step in the README).

Reuses from approved units, exactly: `Lead.Score__c`, `Lead_Scoring_User`,
`LeadScoringService.evaluate(Lead, Set<String>)`,
`LeadScoringService.getRuleFieldNames()`, `LeadScoringService.RuleResult`
(`ruleName`, `label`, `points`), `LeadScoringService.ScoreResult`
(`total`, `matchedRules`), and `LeadScoringService.rulesOverride` in tests.
All metadata uses API version 68.0.

## Data model

No new objects, fields or records.

## Apex classes

### `public with sharing class LeadScoreController`

```apex
public class Breakdown {
    @AuraEnabled public Integer total;                        // stored Score__c; null if never scored
    @AuraEnabled public List<LeadScoringService.RuleResult> rules; // matched rules, sorted by label
    @AuraEnabled public Boolean outOfDate;                    // true when the lines do not produce the stored total
}

@AuraEnabled(cacheable=true)
public static Breakdown getBreakdown(Id leadId)
```

`getBreakdown`:

1. Refuses a null Id or an Id that is not a Lead with
   `AuraHandledException` "This Lead was not found, or you do not have access
   to it."
2. Refuses with "You do not have access to the lead score. Ask your Salesforce
   admin for the Lead Scoring User permission set." if the user cannot read
   `Lead.Score__c`.
3. Takes the field names of the active, valid rules from
   `LeadScoringService.getRuleFieldNames()` and keeps only those the user can
   read (field describe `isAccessible()`). A rule on a field the user cannot
   read is left out, so the breakdown never reveals a hidden field's value.
4. Queries the Lead with `Database.queryWithBinds(..., AccessLevel.USER_MODE)`
   selecting `Id`, `Score__c` and those fields. User mode enforces sharing,
   object access and field access (guardrail 4). Field names come only from the
   Lead describe map, never from user input, and the Id is a bind variable.
5. No row (deleted, or not shared with the user): the "not found" message.
   A `QueryException` from user mode: the same message. Nothing about the Lead
   is returned (US-4).
6. Calls `LeadScoringService.evaluate(lead, readableFields)`. Returns the
   stored `Score__c` as `total`, the matched rules as `rules`, and
   `outOfDate = (stored total != recalculated total)`.

**Out-of-date breakdown (inception question 7).** The breakdown is worked out
from the current rules; the total is what was stored at the last save. If an
admin changed a rule since, or a rule's field is hidden from this user, the
lines may not add up to the total. The component then shows: "The scoring
rules have changed since this Lead was last saved. Save the Lead to update its
score." A Lead saved before the feature was deployed has no stored score: the
total shows "Not scored", with the same note.

## LWC components

### `leadScoreBreakdown` (`c-lead-score-breakdown`)

- Exposed; master label "Lead Score Breakdown"; target
  `lightning__RecordPage` for object `Lead` only.
- Public property: `@api recordId`.
- Data: `@wire(getBreakdown, { leadId: '$recordId' })`. A second wire,
  `getRecord` on `Lead.LastModifiedDate`, notices when the record is saved
  while open and calls `refreshApex` on the breakdown, so the total and lines
  update without a page refresh (US-4). `LastModifiedDate` is used, not
  `Score__c`, so the refresh works even when the score itself does not change.
- Renders, inside a `lightning-card` titled "Lead Score":

| State | What the user sees | Element |
|---|---|---|
| Loading | A small spinner | `lightning-spinner` |
| Normal | The total in large text, then one line per matched rule: label and points as `+10`, `-5` or `0` | `[data-id="total"]`, `li[data-id="rule"]` |
| No rule matched | Total, then "No scoring rules matched this Lead." | `[data-id="empty"]` |
| Out of date | The note above, under the total | `[data-id="out-of-date"]` |
| Error | The server's message (for example the permission message), or "The lead score could not be loaded." if there is none. Never a stack trace or a blank card. | `[data-id="error"]` |

## Data flow

1. A rep opens a Lead record page with the component on it.
2. The component's wire calls `LeadScoreController.getBreakdown(recordId)`.
3. The controller reads the Lead in user mode and asks `LeadScoringService`
   which active rules it matches.
4. The component renders the stored total and the matched rules.
5. The rep edits and saves the Lead. The trigger (unit 2) rescores it. The
   `getRecord` wire receives the new `LastModifiedDate` and refreshes the
   breakdown.

## Error handling

| Failure | What the user sees |
|---|---|
| User lacks the permission set (no class access) | The platform's "You do not have access to the Apex class" message, shown in the error state. |
| User lacks read on `Score__c` | The permission message from step 2. |
| Lead deleted or not shared with the user | "This Lead was not found, or you do not have access to it." |
| A rule is badly configured | It is not listed; the rest of the breakdown loads (US-4). |
| A rule's field is hidden from the user | That rule is not listed; the out-of-date note may show. |
| Any other server error | The error's message, or the generic message. |

## Permission set and README

- `Lead_Scoring_User` gains `classAccesses` for `LeadScoreController`
  (enabled). The trigger classes need no grant. Its description is updated to
  mention the component. Still the one permission set (US-5).
- README "Lead scoring demo: setup after deployment" gains step 2: add the
  component to the Lead record page in Lightning App Builder and activate the
  page.

## Guardrail checklist

- [x] 1. One trigger per object, trigger holds no logic. Does not apply: no trigger in this unit.
- [x] 2. Bulk-safe, no SOQL or DML in loops, tested with 200 records. One query per call, no DML. Not on record save, so no 200-record test is needed here; unit 2 has it.
- [x] 3. Classes declare `with sharing`. `LeadScoreController`.
- [x] 4. CRUD and FLS enforced for user-facing data access. `AccessLevel.USER_MODE` on the only query, an explicit check on `Score__c`, and rule fields filtered to those the user can read.
- [x] 5. Configuration in custom metadata, no hard-coded values or IDs. Rules come from unit 2's service; no IDs in source. Tests use `rulesOverride`.
- [x] 6. Tests assert, include a bulk test, target 90% coverage. `LeadScoreControllerTest` covers every branch it can reach as a real user; bulk test not applicable (see 2).
- [x] 7. LWC handles errors and has Jest tests. Jest tests for normal, empty, error, out-of-date, not-scored and refresh.
- [x] 8. Access granted by permission set. Class access added to `Lead_Scoring_User`; no profiles.
- [x] 9. Source-format metadata only, manual steps written in README. The Lightning App Builder step is in the README.

No guardrail is set aside.

## Local verification

Built on 2026-11-12 after the design-approval gate. Jest tests were written
first and failed (`Cannot find module 'c/leadScoreBreakdown'`) before the
component existed.

| Check | Command or method | Result |
|---|---|---|
| Jest | `npm run test:unit` | Passed: 1 suite, 10 tests. |
| Lint | `npm run lint` | Passed, no output. |
| Apex and LWC syntax | `npx prettier --check "force-app/**/*.{cls,trigger,js,html}"` | Passed after `--write` formatting. Syntax only; does not compile Apex against the org schema. |
| XML well formed | Python `xml.dom.minidom` parse of all 21 `force-app/**/*.xml` files | Passed. |
| API version | Search for `<apiVersion>` | All 8 files that carry one use 68.0. |
| No profiles | Search for `*.profile-meta.xml` | None. |
| Code Analyzer | `sf code-analyzer run ...` | Not run: the Salesforce CLI is not installed in this environment. Guardrails checked by reading the code. |
| Source converts | `sf project convert source ...` | Not run: no Salesforce CLI here. File layout checked by hand. |
| Apex tests | none locally | **Written, not executed.** `LeadScoreControllerTest` runs only in an org, in Operations. |

Known limits to check in Operations:

- `LeadScoreControllerTest` creates its rep with the profile named
  `Standard User`. In an org whose profile names are translated, the query
  finds nothing and the tests fail with a `QueryException`; change the name in
  `makeRep`.
- Two tests branch on the org's Lead sharing and on whether `Score__c` is
  readable without the permission set. Both branches assert, but only one
  runs in a given org.
