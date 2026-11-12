# Unit design: lead-score-breakdown

Stories covered: US-4 (see why a Lead has its score) and US-5 (one permission
set; this unit adds the class access and the second README step).

Depends on the approved units `lead-scoring-config` and
`lead-scoring-engine`. Names reused from them exactly: `Lead.Score__c`, the
permission set `Lead_Scoring_User`, and from `LeadScoringService`:
`ScoreResult` (`total`, `matches`), `RuleMatch` (`ruleName`, `label`,
`points`), `score(Lead)`, `getScoredFieldNames()` and the test seam
`setRulesForTest`.

Every `-meta.xml` in this unit uses API version 68.0, the `sourceApiVersion`
in `sfdx-project.json`.

Assumptions made in automatic mode are in `questions.md` in this folder.

## Data model

No new objects, fields, metadata types or records.

Changed: `permissionsets/Lead_Scoring_User.permissionset-meta.xml` gains

```xml
<classAccesses>
    <apexClass>LeadScoreController</apexClass>
    <enabled>true</enabled>
</classAccesses>
```

and its description becomes "Access a sales rep needs for lead scoring: read
the Lead Score field and load the score breakdown." Nothing else in the file
changes. No access to `LeadScoringService` is granted: only the class with
the `@AuraEnabled` entry point needs it.

## Apex classes

Files, under `force-app/main/default/classes/`: `LeadScoreController.cls`,
`LeadScoreControllerTest.cls`, each with its `-meta.xml`.

### `LeadScoreController` (`public with sharing`)

```apex
@AuraEnabled(cacheable=true)
public static LeadScoringService.ScoreResult getScoreBreakdown(Id leadId)
```

Private, `@TestVisible`, so the empty-Score case can be tested without a
saved record (the trigger never leaves Score empty):

```apex
@TestVisible
private static LeadScoringService.ScoreResult toResult(Lead record)
```

How `getScoreBreakdown` works:

1. A null `leadId` throws the "not available" error below.
2. Build the field list: `Id`, `Score__c`, and each name from
   `LeadScoringService.getScoredFieldNames()` that the running user may read
   (`Schema.SObjectField.getDescribe().isAccessible()`). The list is a set,
   so a rule on `Score__c` or `Id` does not select a field twice. The names
   come from the schema describe, never from user input.
3. Run one query in user mode with a bind variable:
   `Database.queryWithBinds('SELECT <fields> FROM Lead WHERE Id = :leadId',
   binds, AccessLevel.USER_MODE)`. User mode enforces object permission,
   field-level security and sharing.
4. No row (deleted, not shared with the user, or not a Lead Id) throws the
   "not available" error. Nothing about the Lead is returned.
5. `toResult(record)`: call `LeadScoringService.score(record)`, then replace
   `total` with the stored `Score__c` when it is not empty. When it is empty
   the calculated total stays (question 1). `matches` is what the service
   returned: the rules that match now, in rule-label order.

A rule whose field was left out in step 2 cannot be read from the record;
the service already treats that as "adds nothing" and never lets it escape
(engine design, "Error handling"), so the rule is not listed (question 2).

The total is the stored value and the lines are worked out from the current
rules. They disagree only when an admin changed a rule after the Lead was
last saved, or when a rule's field is hidden from the user; saving the Lead
brings the total up to date.

One SOQL query per call (the Lead), plus the rule query inside the service
the first time in a transaction. No DML. No loop contains a query.

## LWC components

### `leadScoreBreakdown`

Files, under `force-app/main/default/lwc/leadScoreBreakdown/`:
`leadScoreBreakdown.html`, `.js`, `.js-meta.xml`, and
`__tests__/leadScoreBreakdown.test.js`.

- **Targets:** `lightning__RecordPage`, limited to the `Lead` object.
  `isExposed` true, `masterLabel` "Lead Score Breakdown".
- **Public property:** `@api recordId` (set by the record page).
- **Data:**
  - `@wire(getScoreBreakdown, { leadId: '$recordId' })` for the breakdown.
  - `@wire(getRecord, { recordId: '$recordId', fields: [LASTMODIFIED_FIELD] })`
    with `@salesforce/schema/Lead.LastModifiedDate`, used only to notice a
    save. When the value differs from the one seen before, the component
    calls `refreshApex` on the breakdown. The first value it receives only
    sets the baseline, so the page load does not call Apex twice.
    `LastModifiedDate` is a system field every user who can open the Lead
    can read, and it changes on every save, including saves that leave the
    total unchanged but change the lines.

What it renders, inside a `lightning-card` titled "Lead Score":

| State | Rendered |
|---|---|
| Loading (no data and no error yet) | `lightning-spinner` with alternative text "Loading score" |
| Loaded, rules matched | The total as a large number (`data-id="total"`), then a list with one line per matched rule (`data-id="rule"`): the rule's label and its points with a sign, `+10` or `-5` |
| Loaded, no rules matched | The total, then the text "No scoring rules matched this Lead." (`data-id="empty"`). No empty list |
| Error | "The score breakdown could not be loaded." (`data-id="error"`) and, when the server sent one, its message on a second line (`data-id="error-detail"`). No total, no lines, no stack trace |

All text is written in the component (question 3).

## Data flow

1. A rep opens a Lead. The record page gives the component `recordId`.
2. The Apex wire calls `LeadScoreController.getScoreBreakdown`. The platform
   checks class access (from the permission set), then the controller reads
   the Lead in user mode and returns the stored total and the matched rules.
3. The component shows the total and the lines, or the empty message.
4. The rep edits a scored field and saves. `LeadTrigger` (unit 2) re-scores
   the Lead. Lightning Data Service sees the new `LastModifiedDate` and the
   `getRecord` wire emits again.
5. The component calls `refreshApex`; the Apex wire fetches again from the
   server and the total and lines update without a page refresh.

A save made outside the rep's browser session (another user, an import) is
picked up when Lightning Data Service next reloads the record, not instantly.

## Error handling

| Failure | What the rep sees |
|---|---|
| User lacks the permission set (no class access) | The platform refuses the call. Component: "The score breakdown could not be loaded." plus the platform's own message |
| User has class access but may not read `Lead.Score__c` or the Lead object | The user-mode query fails; the controller throws `AuraHandledException`: "The Lead score could not be read. Ask your admin to check that you have the Lead Scoring User permission set." Shown as the detail line |
| Lead deleted, not shared with the user, or `leadId` empty | `AuraHandledException`: "This Lead is not available. It may have been deleted, or you may not have access to it." No data about the Lead is returned |
| User may not read a field a rule uses | That rule is not listed; the rest of the breakdown loads |
| Badly configured active rule | Not listed; the component loads (the service skips it and logs it, unit 2) |
| No rule matches, or no rules exist | Total and "No scoring rules matched this Lead." |
| The `getRecord` wire fails | Ignored: it is only the refresh signal. The breakdown already shown stays |
| Error with no readable message (network failure) | Only "The score breakdown could not be loaded." |

The controller catches `QueryException` only. Each `AuraHandledException` is
built with `setMessage`, so the message reaches the component and a test can
assert it.

## Guardrail checklist

Tick each rule from `aidlc/salesforce-rules.md` once the built unit obeys it.
If a rule does not apply or is broken on purpose, say why next to it.

Ticked after the build, from reading the built code and the local checks
below. The text of each line is the position accepted at the design gate.

- [x] 1. One trigger per object, trigger holds no logic. Does not apply: no trigger is added or changed.
- [x] 2. Bulk-safe, no SOQL or DML in loops, tested with 200 records. **Partly set aside, for acceptance at this gate:** the controller reads one Lead per call by design (one record page, one Lead), so there is no 200-record path through it; calling it 200 times in one transaction would pass the 100-query limit and is not something the page does. The planned test inserts 200 Leads through the trigger and then asserts one controller call uses exactly one query and returns the right breakdown. No query or DML sits in a loop.
- [x] 3. Classes declare `with sharing`. `LeadScoreController` does.
- [x] 4. CRUD and FLS enforced for user-facing data access. The only read of user data is the `AccessLevel.USER_MODE` query. Fields the user may not read are not selected and their rules are not listed. The rule metadata is read by `LeadScoringService` in system mode, as approved in unit 2: it is configuration, and the rule labels and points are what this feature exists to show.
- [x] 5. Configuration in custom metadata, no hard-coded values or IDs. The controller holds no thresholds, points or field names other than `Id` and `Score__c`. No IDs. User-facing text is in code, not custom labels (question 3).
- [ ] 6. Tests assert, include a bulk test, target 90% coverage. **Not ticked: unproven until Operations.** The 12 Apex tests are written, every one asserts, one inserts 200 Leads and none uses `SeeAllData`, but none has been executed, and coverage can only be measured in an org. The 8 Jest tests ran and pass.
- [x] 7. LWC handles errors and has Jest tests. Error state built as designed; Jest tests for normal, empty, error, loading and refresh pass.
- [x] 8. Access granted by permission set. Class access is added to `Lead_Scoring_User`. No profile, no second permission set.
- [x] 9. Source-format metadata only, manual steps written in README. Adds the README step: add "Lead Score Breakdown" to the Lead record page in Lightning App Builder and activate the page.

## Local verification
<!-- Filled in after the build: each command run and its result. State plainly
     anything that could not be run locally (Apex tests need an org). -->

Built on 2026-11-12. Files created, all under `force-app/main/default/`:
`classes/LeadScoreController.cls` and `classes/LeadScoreControllerTest.cls`,
each with its `-meta.xml`; `lwc/leadScoreBreakdown/leadScoreBreakdown.html`,
`.js`, `.js-meta.xml` and `__tests__/leadScoreBreakdown.test.js`. Files
changed: `permissionsets/Lead_Scoring_User.permissionset-meta.xml` (class
access and description) and `README.md` (setup step 2).

| Check | Command | Result |
|---|---|---|
| Jest, before the component existed | `npm run test:unit` | Failed as expected: `Cannot find module 'c/leadScoreBreakdown'`, 1 suite failed. |
| Jest, after the build | `npm run test:unit` | Passes: 1 suite, 8 tests passed, 0 failed. |
| Lint | `npm run lint` | Exit 0, no findings. |
| Code Analyzer | `sf code-analyzer run --workspace force-app --rule-selector Recommended` | Plugin 5.16.0. Whole project: 0 critical, 0 high, 10 moderate, 76 low, 2 info. This unit's files: 0 critical, 0 high, 5 moderate, 15 low. Detail below. |
| Source converts | `sf project convert source --root-dir force-app --output-dir <temp dir>` | Succeeded. The manifest lists `ApexClass` `LeadScoreController` and `LeadScoreControllerTest`, `LightningComponentBundle` `leadScoreBreakdown` and `PermissionSet` `Lead_Scoring_User`, next to the earlier units' components. |
| API version | search of the three new `-meta.xml` files | All carry `<apiVersion>68.0</apiVersion>`. |
| Apex syntax | `npx prettier --check` on the two classes and the component | Passes. The Apex parser read both classes, which shows they are syntactically valid. It is not a compile: types, method names and field names are not checked until an org compiles them. |

**Not run: the Apex tests.** 12 test methods are written in
`LeadScoreControllerTest` and none has been executed. Apex compiles and runs
only in an org. Until Operations nothing is known about whether they compile,
pass, or reach 90% coverage.

**Not run: the manual tests** in the test plan (component on the page, live
update, no permission set, sharing). They need the component deployed and
placed on a Lead record page.

**Not verified locally: the live refresh in a browser.** The Jest test shows
that a changed `LastModifiedDate` calls `refreshApex`, with Lightning Data
Service mocked. Whether the real record page re-emits the record after a
save is only seen in an org (manual test "Live update").

Code Analyzer detail for this unit's files:

- No critical or high violation, on the first run and the last.
- Left as they are, 5 moderate: the five-parameter test helper `rule(...)`
  in `LeadScoreControllerTest`, the same helper the two earlier test classes
  have; and four `no-unexpected-wire-adapter-usages` on `getRecord.emit` and
  `getRecord.error` in the Jest test. The project's `eslint.config.js` turns
  that rule off for test files and `npm run lint` is clean; Code Analyzer
  reports them because it does not apply the project's ESLint configuration.
- Left as they are, 15 low: missing ApexDoc `@param`/`@return` tags, and
  `ApexUnitTestClassShouldHaveRunAs` on the two tests that need no user
  (`nullIdThrowsReadableError`,
  `toResultUsesCalculatedTotalWhenStoredScoreIsEmpty`).

### Changes from the approved design

- **Every Apex test that reads a saved Lead runs as a Standard User created
  in the test**, not only the two run-as tests in the test plan. The
  controller queries in user mode, and a custom field deployed from source
  is readable only where a permission set or profile grants it, so a test
  run as the deploying user could fail when that user does not hold
  `Lead_Scoring_User`. Ten tests run as a user with the permission set and
  one as a user without it. No test was removed or weakened; the names and
  what each proves are as in the test plan.
- `ruleOnScoreFieldDoesNotBreakTheQuery` also supplies a rule on `Id`, since
  the design says neither `Score__c` nor `Id` may be selected twice.
- `refreshes when the record is saved` (Jest) also checks that a repeated
  identical `LastModifiedDate` does not refresh and that an error on the
  record wire leaves the breakdown as shown, both from the design's tables.
- The Jest test declares its own mocks for the Apex method (as a test wire
  adapter) and for `refreshApex`. The installed `sfdx-lwc-jest` does not
  supply them in a form the tests can drive. Test code only.
- The component adds `role="alert"` to the error block and a `standard:lead`
  icon to the card. Neither is in the design's table; neither changes text
  or behaviour.
- Points of exactly 0 are shown as `+0`. The design gave only `+10` and `-5`.
- The two error messages are `@TestVisible` constants in the controller so
  the tests assert the exact text.

Nothing else differs from the design: signatures, names, messages, the
permission set change and the README step are as approved.
