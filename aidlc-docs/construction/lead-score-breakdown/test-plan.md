# Test plan: lead-score-breakdown

Apex tests supply their own rules through `LeadScoringService.setRulesForTest`
and create their own Leads. None depends on the rule records shipped in
source, and none uses `SeeAllData`.

| Test name | Type | What it proves |
|---|---|---|
| `returnsStoredTotalAndMatchedRules` | Apex | A Lead scored 40 by Email, Phone and Industry rules returns total 40 and three matches with the right labels and points, in label order (US-4) |
| `returnsZeroAndNoMatchesWhenNothingMatches` | Apex | A Lead that matches no rule returns total 0 and an empty, non-null list |
| `listsNegativePointsAndKeepsTotalInRange` | Apex | Matches carry their own points, including negative ones, while the total stays the stored 0 to 100 value |
| `badlyConfiguredRuleIsNotListed` | Apex | With one bad active rule the call succeeds and only the good rules are listed |
| `totalIsStoredScoreWhenRulesChangedAfterSave` | Apex | After the rules change, the total is still the stored Score and the matches follow the current rules |
| `toResultUsesCalculatedTotalWhenStoredScoreIsEmpty` | Apex | A Lead with no stored Score gets the calculated total (question 1) |
| `ruleOnScoreFieldDoesNotBreakTheQuery` | Apex | A rule that reads `Score__c` does not cause a duplicate-field query error |
| `deletedLeadThrowsReadableError` | Apex | No visible row: `AuraHandledException` with the "not available" message, no data |
| `nullIdThrowsReadableError` | Apex | Same message for an empty id |
| `userWithoutPermissionSetGetsReadableError` | Apex | Run as a Standard User without `Lead_Scoring_User`: the user-mode query is refused and the "could not be read" message is thrown (FLS enforced) |
| `userWithPermissionSetGetsBreakdown` | Apex | Run as a Standard User who has `Lead_Scoring_User` and owns the Lead: the breakdown is returned |
| `breakdownAfterBulkInsertUsesOneQuery` | Apex | 200 Leads inserted in one operation; one controller call then uses exactly one SOQL query and returns the right breakdown (bulk) |
| `shows a spinner while loading` | Jest | Loading state before data or error arrives |
| `shows the total and one line per matched rule` | Jest | Normal state: total 40, three lines with labels and `+10`, `+10`, `+20` |
| `shows a minus sign for negative points` | Jest | `-5` is rendered for a rule with negative points |
| `shows a message when no rules matched` | Jest | Empty state: total 0, the "no rules matched" text, no list items |
| `shows a readable error with the server message` | Jest | Error state: fixed text plus the server's message; no total, no lines |
| `shows only the fixed error text when the error has no message` | Jest | Error without a body still renders readable text |
| `passes the record id to Apex` | Jest | The wire is called with `{ leadId: recordId }` |
| `refreshes when the record is saved` | Jest | A changed `LastModifiedDate` calls `refreshApex`; the first value does not |
| Component on the page | Manual | After adding the component in Lightning App Builder: a Lead with Email, Phone and Industry = Technology shows 40 and three lines |
| Live update | Manual | Edit NumberOfEmployees to 500 and save: total and lines change with no page refresh |
| No permission set | Manual | A user without `Lead_Scoring_User` sees the readable error, not a blank area |
| Sharing | Manual | In an org with private Lead sharing, a user asking for another user's Lead gets the "not available" message. Not automated: the result depends on the org's sharing settings |

Types: Apex (runs only in an org), Jest (runs locally), Manual.

Known limits of the Apex tests, to be settled in Operations:

- The two run-as tests look up the profile named "Standard User". An org
  with a non-English profile name or without that profile fails them.
- An org with required fields, validation rules or duplicate rules on Lead
  may reject the test inserts.
- Added at the build: every test that reads a saved Lead creates a Standard
  User, not only the two run-as tests (see "Changes from the approved
  design" in the unit design). An org with no free Salesforce user licence
  may refuse to create that user, and an org whose Standard User profile
  cannot create or delete Leads fails those tests.
- `userWithoutPermissionSetGetsReadableError` assumes the Standard User
  profile has no read access to `Lead.Score__c` of its own. An org where an
  admin has granted the field on that profile fails this test.
