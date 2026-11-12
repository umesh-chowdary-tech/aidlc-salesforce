# Test plan: lead-score-breakdown

## `LeadScoreControllerTest` (Apex)

Each test supplies rules through `LeadScoringService.rulesOverride`, creates
a sales rep user with the Standard User profile and (unless stated) the
`Lead_Scoring_User` permission set, and calls the controller with
`System.runAs(rep)` so user mode is exercised as a real rep.

| Test name | Type | What it proves |
|---|---|---|
| returnsStoredTotalAndMatchedRules | Apex | US-4: total 40 and three lines (label, points) for an Email + Phone + Technology Lead. |
| noMatchReturnsZeroAndNoLines | Apex | US-4: total 0 and an empty list. |
| badRuleIsNotListed | Apex | US-4: a badly configured rule is left out and the call succeeds. |
| outOfDateWhenRulesChangedAfterSave | Apex | Question 7: lines recalculated with new points; `outOfDate` true. |
| nullIdIsRefused | Apex | Readable error, no data. |
| nonLeadIdIsRefused | Apex | An Account Id is refused. |
| deletedLeadIsRefused | Apex | A deleted Lead returns the "not found" message. |
| leadTheRepCannotReadReturnsNothing | Apex | US-4: depends on the org's Lead sharing. If the rep has no read access to an admin-owned Lead, the call is refused; if sharing gives access, it returns data. Both branches assert. |
| repWithoutPermissionSetCannotReadScore | Apex | US-5: without the permission set, if the rep cannot read `Score__c` the call is refused with the permission message; if the org grants it some other way, data is returned. Both branches assert. |

## `leadScoreBreakdown` Jest tests

| Test name | Type | What it proves |
|---|---|---|
| renders the total and one line per matched rule | Jest | Normal state: total, labels, `+10` formatting. |
| formats negative and zero points | Jest | `-5` and `0`. |
| shows a message when no rules matched | Jest | Empty state. |
| shows Not scored and the out-of-date note for a Lead never scored | Jest | Null total. |
| shows the out-of-date note when lines and total disagree | Jest | Question 7. |
| shows the server's error message | Jest | Error state with an `AuraHandledException` body. |
| joins messages from an array error body | Jest | Error state with a list of errors. |
| shows a generic message when the error has no message | Jest | Error state, never blank. |
| shows a spinner while loading | Jest | Loading state. |
| refreshes the breakdown when the record is saved | Jest | US-4: a new `LastModifiedDate` calls `refreshApex`; the first load does not. |

## Manual

| Check | Type | What to look at in the org |
|---|---|---|
| Component on the page | Manual | Lightning App Builder lists "Lead Score Breakdown" for Lead record pages; after adding it, a Lead with Score 40 shows 40 and three lines (+10, +10, +20). |
| Live update | Manual | Set NumberOfEmployees to 500 and save: the card shows 65 and a fourth line without a page refresh. |
| Rep without the permission set | Manual | The card shows a readable error, not a blank area. |

Types: Apex (runs only in an org), Jest (runs locally), Manual.
