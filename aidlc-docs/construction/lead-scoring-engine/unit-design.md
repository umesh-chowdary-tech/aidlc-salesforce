# Unit design: lead-scoring-engine

Stories covered: US-2 (score a Lead when it is saved) and US-3 (a badly
configured rule never blocks a save).

Depends on the approved unit `lead-scoring-config`. Names reused from it
exactly: `Lead.Score__c`, `Lead_Scoring_Rule__mdt`, `Lead_Field__c`,
`Operator__c`, `Value__c`, `Points__c`, `Active__c`, and the operator values
`Equals`, `Not Blank`, `Greater Than`.

Every `-meta.xml` in this unit uses API version 68.0, the `sourceApiVersion`
in `sfdx-project.json`.

Assumptions made in automatic mode are in `questions.md` in this folder.

## Data model

No new objects, fields, metadata types or records. This unit reads
`Lead_Scoring_Rule__mdt` and writes `Lead.Score__c`, both from unit 1.

The permission set `Lead_Scoring_User` is not changed: trigger code needs no
Apex class access, and unit 3 adds the access its controller needs.

## Apex classes

Files, all under `force-app/main/default/`:

| File | Kind |
|---|---|
| `triggers/LeadTrigger.trigger` and `-meta.xml` | Trigger |
| `classes/LeadTriggerHandler.cls` and `-meta.xml` | Class |
| `classes/LeadScoringService.cls` and `-meta.xml` | Class |
| `classes/LeadScoringServiceTest.cls` and `-meta.xml` | Test class |
| `classes/LeadTriggerHandlerTest.cls` and `-meta.xml` | Test class |

### `LeadTrigger`

```apex
trigger LeadTrigger on Lead (before insert, before update) {
    LeadTriggerHandler.beforeSave(Trigger.new);
}
```

The only trigger on Lead in this source tree. No logic in the body.

### `LeadTriggerHandler` (`public with sharing`)

```apex
public static void beforeSave(List<Lead> leads)
```

For each Lead in the list, sets `Score__c` to
`LeadScoringService.score(lead).total`. It always overwrites whatever is in
`Score__c`, on insert and on every update (questions 2). No SOQL, no DML: the
records are changed in memory before the save. A null or empty list does
nothing.

### `LeadScoringService` (`public with sharing`)

Public signatures. Unit 3 reuses these exactly.

```apex
public static final Integer MIN_SCORE = 0;
public static final Integer MAX_SCORE = 100;

public class RuleMatch {
    @AuraEnabled public String ruleName;   // DeveloperName of the rule
    @AuraEnabled public String label;      // MasterLabel of the rule
    @AuraEnabled public Integer points;
}

public class ScoreResult {
    @AuraEnabled public Integer total;             // kept between MIN_SCORE and MAX_SCORE
    @AuraEnabled public List<RuleMatch> matches;   // matched rules, in rule-label order; never null
}

// Scores one Lead against the active, well-configured rules.
public static ScoreResult score(Lead lead)

// API names of the Lead fields the active, well-configured rules read.
// Unit 3 uses this to know which fields to query before calling score().
public static Set<String> getScoredFieldNames()
```

Test seam and test-only observation points (`@TestVisible`, private):

```apex
@TestVisible private static void setRulesForTest(List<Lead_Scoring_Rule__mdt> rules)
@TestVisible private static Map<String, String> skippedRules   // DeveloperName -> reason
@TestVisible private static Integer ruleLoadCount              // times rules were loaded this transaction
```

`setRulesForTest` replaces the rules the service would query and clears the
per-transaction cache. Tests build `Lead_Scoring_Rule__mdt` rows in memory and
pass them in; no test relies on the five records shipped in source.
`skippedRules` lets a test assert which rule was skipped and why, since a
test cannot read the debug log.

How it works:

1. **Load once per transaction.** On first use the service runs one query,
   `SELECT DeveloperName, MasterLabel, Lead_Field__c, Operator__c, Value__c,
   Points__c FROM Lead_Scoring_Rule__mdt WHERE Active__c = true ORDER BY
   MasterLabel, DeveloperName`, or takes the rows from the seam (filtering out
   inactive ones itself). The result is kept in a private static variable, so
   a 200-record batch, and a second trigger run in the same transaction,
   cause no further queries.
2. **Check each rule once.** Each row is turned into a private in-memory rule
   holding the `Schema.SObjectField` token for the Lead field (looked up by
   name, ignoring case and surrounding spaces, in
   `Schema.SObjectType.Lead.fields.getMap()`), the operator, the points as an
   Integer, and for Greater Than (and numeric Equals) the Value as a Decimal.
   A row that fails a check is left out, recorded in `skippedRules`, and
   written to the debug log (see "Error handling").
3. **Evaluate per Lead.** For each checked rule, read the Lead's field and
   apply the operator:

   | Operator | Matches when |
   |---|---|
   | `Not Blank` | the field is not null and, as text, is not empty or spaces only. `Value__c` is ignored. |
   | `Equals` | the field is not blank and equals `Value__c`. If the field holds a number and `Value__c` is a number, they are compared as numbers; otherwise as text, ignoring case and surrounding spaces. |
   | `Greater Than` | the field holds a number (Integer, Long, Double or Decimal) strictly greater than `Value__c`. A blank field, or a field that is not a number, never matches. |

4. **Total.** Add the points of the matched rules, then keep the sum between
   `MIN_SCORE` and `MAX_SCORE`. `matches` lists every matched rule with its
   own points, including negative ones, so the lines can add up to more than
   100 or less than 0 while `total` stays in range.

`score(null)` returns total 0 and an empty list.

Sharing: both classes declare `with sharing`. The trigger path reads no
records other than custom metadata and writes only the records being saved.

## LWC components

None in this unit.

## Data flow

1. A user, an import or an API call inserts or updates Leads (up to 200 per
   trigger batch).
2. `LeadTrigger` fires before insert or before update and passes
   `Trigger.new` to `LeadTriggerHandler.beforeSave`.
3. The handler asks `LeadScoringService.score` for each Lead. The first call
   in the transaction loads and checks the active rules (one query); later
   calls use the cached rules.
4. The handler writes `total` into `Score__c` on the in-memory record.
5. The platform saves the Lead with the new score. No DML is issued by this
   unit.

An admin's change to a rule takes effect on the next save of a Lead, in a new
transaction, with no deployment. Existing Leads are not re-scored until they
are saved (inception question 8).

## Error handling

Nothing in this unit calls `addError` or lets an exception escape, so scoring
never blocks a save.

| Failure | What happens | What the admin sees |
|---|---|---|
| Rule's Lead Field is empty | Rule skipped | Debug log, WARN: `Lead scoring: skipped rule <DeveloperName>: Lead Field is empty` |
| Rule's Lead Field is not a field on Lead | Rule skipped | `...: Lead Field "<value>" is not a field on Lead` |
| Rule's Operator is empty or not one of the three | Rule skipped | `...: Operator is empty` or `...: Operator "<value>" is not supported` |
| Rule's Points is empty | Rule skipped | `...: Points is empty` |
| Equals or Greater Than rule with an empty Value | Rule skipped | `...: Value is empty` |
| Greater Than rule whose Value is not a number | Rule skipped | `...: Value "<value>" is not a number` |
| Unexpected exception while evaluating one rule for one Lead (for example the field was not loaded on the record passed in) | That rule adds nothing for that Lead; other rules still apply | `...: <exception message>`, logged once per rule per transaction |
| Every active rule is badly configured, or no rule records exist | Score is 0 | One log line per skipped rule; none if there are no rules |
| Points add up above 100 or below 0 | Score is 100 or 0 | Nothing: this is normal behaviour |
| A rule's Lead field is not a number and the operator is Greater Than | The rule is valid but never matches | Nothing: the rule simply does not match |

Each configuration problem is logged once per transaction, when the rules are
loaded, not once per Lead (question 4). The user saving the Lead sees
nothing; the save succeeds.

Not handled here, on purpose: errors from the org's own validation rules,
required fields or other automation on Lead. Those belong to the org and
still block a save as they did before.

## Guardrail checklist

Tick each rule from `aidlc/salesforce-rules.md` once the built unit obeys it.
If a rule does not apply or is broken on purpose, say why next to it.

- [x] 1. One trigger per object, trigger holds no logic. `LeadTrigger` is the only trigger in `force-app/` and its body is one call.
- [x] 2. Bulk-safe, no SOQL or DML in loops, tested with 200 records. The one query sits in `loadRules`, outside any loop, and runs once per transaction; there is no DML. Three 200-record tests are written (`rulesAreLoadedOncePerTransaction`, `bulkInsertScoresTwoHundredLeads`, `bulkUpdateScoresTwoHundredLeads`) and not yet executed.
- [x] 3. Classes declare `with sharing`. Both `LeadScoringService` and `LeadTriggerHandler` do.
- [x] 4. CRUD and FLS enforced for user-facing data access. Does not apply: this unit returns no data to a user. It only computes a value on the records being saved, which rule 4 allows in system mode. Unit 3's controller does the user-mode read. The rule query says `WITH SYSTEM_MODE` explicitly (see "Changes from the approved design").
- [x] 5. Configuration in custom metadata, no hard-coded values or IDs. **Set aside for two values, accepted at the design gate:** the limits 0 and 100 are constants `MIN_SCORE` and `MAX_SCORE` in `LeadScoringService`, not metadata. Reason: the intent defines the score as 0 to 100 and `Score__c` is three digits wide, so they are part of the feature's definition, not something an admin tunes (question 1). Everything else (fields, operators, values, points, on/off) comes from `Lead_Scoring_Rule__mdt`. The three operator names appear in code because they are the picklist's API values. No IDs.
- [x] 6. Tests assert, include a bulk test, target 90% coverage. Every test asserts with `Assert`, creates its own data and rules, and none uses `SeeAllData`. **Coverage is not measured:** the tests are written and not executed, so 90% is a target that Operations has to confirm, not a result.
- [x] 7. LWC handles errors and has Jest tests. Does not apply: no LWC.
- [x] 8. Access granted by permission set. Nothing new to grant: no new field, object or tab, and trigger code runs without class access. No profile is touched.
- [x] 9. Source-format metadata only, manual steps written in README. This unit adds no manual step.

## Local verification
<!-- Filled in after the build: each command run and its result. State plainly
     anything that could not be run locally (Apex tests need an org). -->

Built on 2026-11-12. Files created, all under `force-app/main/default/`:
`triggers/LeadTrigger.trigger`, `classes/LeadTriggerHandler.cls`,
`classes/LeadScoringService.cls`, `classes/LeadScoringServiceTest.cls`,
`classes/LeadTriggerHandlerTest.cls`, each with its `-meta.xml`.

| Check | Command | Result |
|---|---|---|
| Jest | `npm run test:unit` | Exit 0, output `No tests found, exiting with code 0`. There is no LWC in the project yet, so this shows only that nothing broke. |
| Lint | `npm run lint` | Exit 0, no output. It lints LWC JavaScript only; there is none. |
| Code Analyzer | `sf code-analyzer run --workspace force-app --rule-selector Recommended` | Plugin 5.16.0 was installed by the CLI on first use. Final run: 0 critical, 0 high, 5 moderate, 61 low, 1 info. Detail below. |
| Source converts | `sf project convert source --root-dir force-app --output-dir <temp dir>` | Succeeded. The manifest lists `ApexTrigger` `LeadTrigger` and the four `ApexClass` entries, next to unit 1's components. |
| API version | search of the five new `-meta.xml` files | All carry `<apiVersion>68.0</apiVersion>`. |
| Apex syntax | `npx prettier --check` on the classes and trigger | Passes. The Apex parser read all five files, which shows they are syntactically valid. It is not a compile: types, method names and field names are not checked until an org compiles them. |

**Not run: the Apex tests.** 37 test methods are written (27 in
`LeadScoringServiceTest`, 10 in `LeadTriggerHandlerTest`) and none has been
executed. Apex compiles and runs only in an org. Until Operations nothing is
known about whether they compile, pass, or reach 90% coverage.

Code Analyzer detail:

- The first run reported one **high** violation, `pmd:ApexCRUDViolation`, on
  the rule query in `LeadScoringService`. Fixed by adding `WITH SYSTEM_MODE`
  to the query (see below). The re-run reports no high or critical violation.
- Four moderate `FieldDeclarationsShouldBeAtStart` findings were fixed by
  moving the static fields above the inner classes.
- Left as they are, 5 moderate: class cognitive complexity 105 and cyclomatic
  complexity 48 for `LeadScoringService`; cyclomatic complexity 12 for
  `checkRule` (one branch per configuration problem in the error table); and
  a five-parameter test helper `rule(...)` in each test class.
- Left as they are, 61 low: missing ApexDoc tags, one `AvoidDebugStatements`
  on the WARN line this design requires, and `ApexUnitTestClassShouldHaveRunAs`
  on each test method. 1 info: the two test classes share the same
  rule-building helper, because the design has no shared test utility class.

### Changes from the approved design

Each is a detail of the build, listed so the reviewer can reject it:

1. **The rule query adds `WITH SYSTEM_MODE` and selects `Active__c`.** The
   design gave the query without an access mode. Code Analyzer rates a query
   with no stated mode as high severity. System mode is what the design
   already intended (guardrail 4: trigger logic that only computes values may
   run in system mode). User mode would be wrong here: a user without read
   access to the rule type would have their Lead save fail. `Active__c` is
   selected so that rows from the query and rows from the test seam go
   through the same active check.
2. **Rules are sorted in Apex as well as by `ORDER BY`.** Rows from the test
   seam arrive unsorted, so the checked rules are sorted by label, then
   DeveloperName, ignoring case, in one place for both paths.
3. **A rule that fails while evaluating one Lead stays in use.** It is
   recorded in `skippedRules` and logged once, as designed, but it is still
   evaluated for other Leads and still listed by `getScoredFieldNames`. Only
   rules that fail a configuration check are left out.
4. **`LeadTriggerHandler.beforeSave` also ignores a null entry in the list.**
   The design named only a null or empty list.
5. **Indentation is two spaces**, as prettier formats Apex with the
   project's `.prettierrc`. The design's snippets show four.

### Known risks that only an org can settle

- The tests build `Lead_Scoring_Rule__mdt` rows in memory with
  `DeveloperName` and `MasterLabel` set in the constructor. This is the
  usual pattern, but it is unverified here.
- The `Long` and `Double` branches of `toNumber` are not reached by any
  test, because Lead number fields return Integer or Decimal.
- An org with required fields, validation rules or duplicate rules on Lead
  may reject the test inserts (see the test plan).
