# Test plan: lead-scoring-engine

Every Apex test supplies its own rules through
`LeadScoringService.rulesOverride` and creates its own Leads. None uses
`SeeAllData=true` or depends on the shipped sample rules, except
`realRulesKeepScoreInRange`, which only checks the range.

## `LeadScoringServiceTest` (Apex, in-memory unless noted)

| Test name | Type | What it proves |
|---|---|---|
| sampleRulesScoreEmailPhoneAndTechnologyAs40 | Apex | US-2: Email + Phone + Industry Technology = 40 with the five sample rules. |
| addingEmployeesRaisesScoreTo65 | Apex | US-2: adding NumberOfEmployees 500 gives 65. |
| noMatchingRuleScoresZero | Apex | US-2: a Lead matching nothing scores 0. |
| scoreIsCappedAt100 | Apex | US-2: matched points over 100 give 100. |
| scoreNeverGoesBelowZero | Apex | US-2: matched negative points give 0. |
| negativePointsSubtract | Apex | Negative points reduce the total. |
| inactiveRuleAddsNothing | Apex | US-2: `Active__c` false is ignored and not in the breakdown. |
| equalsIgnoresCaseAndSpaces | Apex | Equals compares text ignoring case and surrounding spaces. |
| equalsNeverMatchesBlankField | Apex | A blank field does not match Equals. |
| notBlankIgnoresWhitespaceOnlyValues | Apex | Not Blank treats spaces as blank. |
| greaterThanIsStrict | Apex | 100 does not match "> 100"; 101 does. |
| greaterThanWorksOnCurrencyField | Apex | AnnualRevenue 2,000,000 matches "> 1000000". |
| greaterThanNeverMatchesTextField | Apex | A text field does not match Greater Than and the rule is not reported as skipped. |
| fieldNameIsCaseInsensitive | Apex | `industry` works like `Industry`; `getRuleFieldNames` returns `Industry`. |
| unknownFieldIsSkippedAndLogged | Apex | US-3: unknown field skipped, reason recorded, other rules still count. |
| emptyLeadFieldIsSkipped | Apex | US-3. |
| emptyOperatorIsSkipped | Apex | US-3. |
| unsupportedOperatorIsSkipped | Apex | Operator outside the three is skipped. |
| emptyPointsIsSkipped | Apex | US-3. |
| emptyValueIsSkippedForEqualsAndGreaterThan | Apex | US-3. |
| nonNumericGreaterThanValueIsSkipped | Apex | US-3. |
| everyRuleBadScoresZero | Apex | US-3. |
| noRulesScoresZero | Apex | US-3: no rule records at all gives 0. |
| evaluateReturnsMatchedRulesSortedByLabel | Apex | Breakdown lines carry name, label and points, sorted by label. |
| evaluateWithFieldSubsetUsesOnlyThoseFields | Apex | The overload unit 3 uses leaves out other fields' rules. |
| errorWhileMatchingIsContained | Apex (inserts one Lead) | A rule that throws while reading a Lead is logged and skipped, not thrown. |
| scoringUsesNoQueries | Apex (bulk) | 200 Leads scored with zero SOQL queries. |
| realRulesKeepScoreInRange | Apex | The real `getAll()` path runs and returns a score in 0..100. |

## `LeadTriggerHandlerTest` (Apex, inserts and updates Leads)

| Test name | Type | What it proves |
|---|---|---|
| insertSetsScore | Apex | US-2: the trigger scores a new Lead (40). |
| updateRescoresLead | Apex | US-2: 40 becomes 65 when NumberOfEmployees is set to 500. |
| typedScoreIsReplaced | Apex | US-2: a typed Score is replaced by the calculated one. |
| changedRuleAppliesOnNextSave | Apex | US-2: new points apply on the next save. |
| badRulesNeverBlockSave | Apex | US-3: a save with bad rules succeeds with the good rules' total. |
| bulkInsertAndUpdateScore200Leads | Apex (bulk) | US-2: 200 Leads inserted and then updated in one DML each, all scored correctly, no limit error. |

## Manual

| Check | Type | What to look at in the org |
|---|---|---|
| One trigger on Lead | Manual | Setup > Object Manager > Lead > Triggers lists only `LeadTrigger`. |
| Create a sample Lead | Manual | A Lead with Email, Phone and Industry Technology shows Score 40. |
| Rule change without deploy | Manual | Change a rule's Points in Setup, save the Lead again, the Score changes. Restore the value. |
| Debug log names a skipped rule | Manual | With a debug log on, set a rule's Lead Field to `Nope__c`, save a Lead: the log has "Lead scoring skipped rule ... is not a field on Lead". Restore the rule. |

Types: Apex (runs only in an org), Jest (runs locally), Manual.
