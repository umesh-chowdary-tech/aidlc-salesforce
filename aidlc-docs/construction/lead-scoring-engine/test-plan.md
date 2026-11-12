# Test plan: lead-scoring-engine

Every Apex test supplies its own rules through
`LeadScoringService.setRulesForTest` and creates its own Leads. None uses
`SeeAllData`, and none depends on the five rules shipped in source. Every
test asserts with the `Assert` class.

Apex tests run only in an org. Until Operations they are written and not
executed.

## `LeadScoringServiceTest`

Leads are built in memory; nothing is inserted unless the row says so.

| Test name | Type | What it proves |
|---|---|---|
| `notBlankMatchesWhenFieldHasValue` | Apex | A Not Blank rule adds its points when the field has a value, and ignores the rule's Value. |
| `notBlankDoesNotMatchEmptyField` | Apex | A Not Blank rule adds nothing for a null or spaces-only field. |
| `equalsIgnoresCaseAndSpaces` | Apex | Equals matches `Technology` against ` technology ` (inception question 4). |
| `equalsDoesNotMatchDifferentOrBlankField` | Apex | Equals adds nothing for another value or a blank field. |
| `equalsComparesNumbersAsNumbers` | Apex | Equals on `AnnualRevenue` 1000000.00 matches Value `1000000` (question 3). |
| `greaterThanMatchesOnlyWhenLarger` | Apex | Greater Than matches 101 against 100 and does not match 100 or 99. |
| `greaterThanNeverMatchesBlankOrTextField` | Apex | Greater Than adds nothing for a null number field or a text field such as Company. |
| `sampleRulesScoreFortyThenSixtyFive` | Apex | With copies of the five sample rules: Email, Phone and Industry = Technology gives 40; adding NumberOfEmployees 500 gives 65 (US-2). |
| `noMatchingRuleScoresZero` | Apex | A Lead matching no rule gets total 0 and an empty match list. |
| `totalIsCappedAtOneHundred` | Apex | Matching points of 130 give total 100; the match list still shows each rule's own points. |
| `totalIsNeverBelowZero` | Apex | Matching points of -30 give total 0. |
| `negativePointsSubtract` | Apex | +20 and -5 give 15. |
| `inactiveRuleIsIgnored` | Apex | A matching rule with Active unchecked adds nothing and is not in the match list. |
| `unknownFieldRuleIsSkipped` | Apex | A rule naming a field that is not on Lead is skipped with a reason naming the field; other rules still count (US-3). |
| `blankFieldNameRuleIsSkipped` | Apex | A rule with an empty Lead Field is skipped with a reason. |
| `nonNumericGreaterThanValueIsSkipped` | Apex | Greater Than with Value `abc` is skipped with a reason; other rules still count (US-3). |
| `blankOrUnknownOperatorIsSkipped` | Apex | A rule with an empty Operator, and one with an operator outside the three, are skipped with reasons (US-3). |
| `blankPointsRuleIsSkipped` | Apex | A rule with empty Points is skipped with a reason (US-3). |
| `blankValueIsSkippedForEqualsAndGreaterThan` | Apex | Equals and Greater Than rules with an empty Value are skipped; a Not Blank rule with an empty Value is not (US-3). |
| `allRulesBadScoresZero` | Apex | When every active rule is badly configured the total is 0 and no exception is thrown (US-3). |
| `noRulesScoresZero` | Apex | With an empty rule list the total is 0 (US-3). |
| `fieldNotLoadedOnRecordIsContained` | Apex | Scoring a Lead queried without a scored field does not throw; that rule adds nothing and is recorded (inserts one Lead). |
| `nullLeadScoresZero` | Apex | `score(null)` returns total 0 and an empty list. |
| `matchesCarryNameLabelAndPoints` | Apex | Each match has the rule's DeveloperName, label and points, in label order (what unit 3 displays). |
| `scoredFieldNamesListsOnlyUsableRules` | Apex | `getScoredFieldNames` returns the fields of active, well-configured rules and leaves out inactive and skipped ones. |
| `rulesAreLoadedOncePerTransaction` | Apex | Scoring 200 Leads in memory loads the rules once (`ruleLoadCount` is 1). |
| `orgRulesAreReadWithoutTheSeam` | Apex | Without the seam, the service queries the org's own rules and returns a total between 0 and 100. Asserts the range only, so it does not depend on which records the org holds. Covers the query path. |

## `LeadTriggerHandlerTest`

These insert and update real Leads, so they exercise `LeadTrigger`.

| Test name | Type | What it proves |
|---|---|---|
| `insertSetsScore` | Apex | Inserting a Lead with Email, Phone and Industry = Technology stores Score 40 (US-2). |
| `updateRecalculatesScore` | Apex | Setting NumberOfEmployees to 500 on that Lead and saving stores Score 65 (US-2). |
| `updateUsesChangedRules` | Apex | After the rules' points change, the next save stores the new score (US-2, "no deployment in between"). |
| `typedScoreIsOverwrittenOnInsertAndUpdate` | Apex | A Score of 99 supplied on insert, and again on update, is replaced by the calculated value (US-2). |
| `noMatchStoresZero` | Apex | A Lead matching no rule is saved with Score 0, not empty. |
| `badRuleDoesNotBlockSave` | Apex | With one unknown-field rule and one good rule, the insert succeeds and Score is the good rule's points (US-3). |
| `noRulesDoesNotBlockSave` | Apex | With no rules, the insert succeeds and Score is 0 (US-3). |
| `bulkInsertScoresTwoHundredLeads` | Apex | 200 records processed within governor limits (bulk): 200 Leads inserted in one operation all get the correct score, half matching one set of rules and half another, and the rules are loaded once (US-2). |
| `bulkUpdateScoresTwoHundredLeads` | Apex | 200 records processed within governor limits (bulk): 200 Leads updated in one operation all get the recalculated score. |
| `beforeSaveAcceptsNullAndEmptyList` | Apex | `beforeSave(null)` and `beforeSave` with an empty list do nothing and do not throw. |

## Local and manual checks

| Test name | Type | What it proves |
|---|---|---|
| Source converts | Local | `sf project convert source --root-dir force-app --output-dir <temp dir>` succeeds and the manifest adds `ApexTrigger` `LeadTrigger` and the four `ApexClass` entries. |
| API version matches | Local | Every `-meta.xml` in this unit carries `apiVersion` 68.0. |
| Guardrails by reading | Local | If Code Analyzer is not installed: the trigger body is one call, no SOQL or DML sits in a loop, both classes say `with sharing`, no ID is hard-coded. |
| Existing suite still green | Jest | `npm run test:unit` and `npm run lint` pass. There is no LWC yet, so this only shows the unit broke nothing. |
| Apex tests pass with 90% coverage per class | Manual | Operations runs the Apex tests in the org; `LeadScoringService` and `LeadTriggerHandler` reach 90% and `LeadTrigger` is covered. |
| Sample rules score a real Lead | Manual | In the org, a Lead with Email, Phone and Industry = Technology shows Score 40; setting Employees to 500 shows 65 (US-2). |
| Rule change needs no deployment | Manual | Change a sample rule's Points in Setup, save a matching Lead, see the new score. Restore the value afterwards (US-2). |
| Skipped rule is in the debug log | Manual | With a rule pointing at a field that does not exist, save a Lead with a debug log running: the save succeeds and the log has a line naming the rule and the reason. Remove the rule afterwards (US-3). |

Types: Apex (runs only in an org), Jest (runs locally), Local (a command or
search run on the source tree during the build), Manual (looked at in the
org, during Operations).

Known limit of the Apex tests in a real org: `LeadTriggerHandlerTest` inserts
Leads with only LastName, Company and the scored fields. An org with its own
required fields, validation rules or duplicate rules on Lead may reject those
inserts; that would show in the Operations test run and is not something this
unit can see locally.
