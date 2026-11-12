# Unit design: lead-scoring-engine

Stories covered: US-2, US-3.

This unit calculates `Lead.Score__c` on every insert and update from the
active `Lead_Scoring_Rule__mdt` records built in unit 1. It reuses unit 1's
names exactly: `Lead_Scoring_Rule__mdt`, `Lead_Field__c`, `Operator__c`,
`Value__c`, `Points__c`, `Active__c`, `Lead.Score__c`, and the operator values
`Equals`, `Not Blank`, `Greater Than`. Every `-meta.xml` uses API version 68.0.

## Data model

No new objects, fields or records. The unit writes `Lead.Score__c` (unit 1)
and reads `Lead_Scoring_Rule__mdt` (unit 1).

## Apex classes

### `LeadTrigger` (trigger on Lead)

```apex
trigger LeadTrigger on Lead (before insert, before update) {
    LeadTriggerHandler.beforeSave(Trigger.new);
}
```

The only trigger this source puts on Lead. One statement, no logic.

### `public with sharing class LeadTriggerHandler`

- `public static void beforeSave(List<Lead> newLeads)`: passes the records to
  `LeadScoringService.score`. Before-save, so no DML is needed.

### `public with sharing class LeadScoringService`

Public API (unit 3 calls the last three):

| Member | Purpose |
|---|---|
| `public static final String OP_EQUALS = 'Equals'`, `OP_NOT_BLANK = 'Not Blank'`, `OP_GREATER_THAN = 'Greater Than'` | The three operator values. |
| `public static final Integer MIN_SCORE = 0`, `MAX_SCORE = 100` | The score range. |
| `public class RuleResult { @AuraEnabled public String ruleName; @AuraEnabled public String label; @AuraEnabled public Integer points; }` | One matched rule. `ruleName` is the DeveloperName, `label` the record's Label (MasterLabel). |
| `public class ScoreResult { public Integer total; public List<RuleResult> matchedRules; }` | `total` is the sum of matched points kept between 0 and 100. `matchedRules` is sorted by label. |
| `public static void score(List<Lead> leads)` | Sets `Score__c` on each Lead in memory. No SOQL, no DML. |
| `public static ScoreResult evaluate(Lead lead)` | Score and matched rules for one Lead, using every valid active rule. |
| `public static ScoreResult evaluate(Lead lead, Set<String> fieldNames)` | As above, using only rules whose Lead field is in `fieldNames` (canonical API names). Unit 3 uses this to leave out fields the user cannot read. |
| `public static Set<String> getRuleFieldNames()` | Canonical API names of the Lead fields read by valid active rules. |

Test seams:

- `@TestVisible private static List<Lead_Scoring_Rule__mdt> rulesOverride`:
  when not null it replaces the custom metadata records. Custom metadata
  cannot be inserted in a test, and tests must not depend on the shipped
  sample rules (guardrail 5).
- `@TestVisible private static Map<String, String> skippedRules`: rule name to
  the reason it was skipped, so tests can assert the logged reason (US-3).

### How a score is calculated

1. **Load rules.** `Lead_Scoring_Rule__mdt.getAll().values()` (or
   `rulesOverride`). `getAll()` is served from the platform cache and does not
   count as a SOQL query, so a save of any size uses no queries for rules, and
   a rule edited in Setup is used on the next save with no deployment.
2. **Keep active rules only** (`Active__c` is true).
3. **Validate each rule once per call.** A rule is skipped, never thrown, when:
   - Lead Field is empty, or is not a field on Lead;
   - Operator is empty, or not one of the three values;
   - Points is empty;
   - Value is empty for Equals or Greater Than;
   - Value is not a number for Greater Than.

   Each skip writes a `WARN` debug line naming the rule's DeveloperName and the
   reason, and records it in `skippedRules`.
4. **Match each Lead against each valid rule**, inside a per-rule `try/catch`
   so an unexpected error is logged and the rule counts as not matched:
   - **Not Blank:** the field value is not null and not only spaces. The rule's
     Value is ignored.
   - **Equals:** text comparison, ignoring case and surrounding spaces. A blank
     field never matches.
   - **Greater Than:** numeric, strictly greater. Only matches when the field
     holds a number (Integer, Long, Double, Decimal or Currency); a text field
     never matches, even if its text looks like a number. A blank field never
     matches.
5. **Total** = sum of matched points (may be negative), then kept between 0
   and 100. Written to `Score__c`, replacing any value a user typed (US-2).

Field names are matched case-insensitively against the Lead field describe
map and stored in their canonical form, so `industry` and `Industry` both
work.

## LWC components

None in this unit.

## Data flow

1. A user, integration or Data Loader inserts or updates Leads (1 to 200 per
   trigger batch).
2. `LeadTrigger` (before insert / before update) calls
   `LeadTriggerHandler.beforeSave(Trigger.new)`.
3. `LeadScoringService.score` loads and validates the active rules once for the
   batch, then evaluates each Lead in memory and sets `Score__c`.
4. The platform saves the records with the new score. No extra DML.

## Error handling

| Failure | What happens |
|---|---|
| Rule names a field that does not exist | Rule skipped; WARN debug line "Lead scoring skipped rule `<name>`: Lead Field "X" is not a field on Lead."; other rules apply; save succeeds. |
| Operator, Points or (for Equals / Greater Than) Value empty | Rule skipped with the reason logged; save succeeds. |
| Greater Than with a non-numeric Value | Rule skipped with the reason logged; save succeeds. |
| Unexpected exception while matching one rule against one Lead | Caught; logged with the message; that rule adds nothing for that Lead; save succeeds. |
| Every rule bad, or no rule records at all | Score is 0; save succeeds. |
| Another trigger on Lead already exists in the target org | Not detectable from source. Both run in no guaranteed order; Operations validation will not catch it. Written as a check in the test plan. |

## Guardrail checklist

- [x] 1. One trigger per object, trigger holds no logic. `LeadTrigger` is the only trigger on Lead in source and makes one call.
- [x] 2. Bulk-safe, no SOQL or DML in loops, tested with 200 records. Rules come from `getAll()` (no SOQL) once per batch; no DML. `LeadTriggerHandlerTest.bulkInsertAndUpdateScore200Leads` inserts and updates 200 Leads; `LeadScoringServiceTest.scoringUsesNoQueries` asserts zero queries for 200 Leads.
- [x] 3. Classes declare `with sharing`. Both classes.
- [x] 4. CRUD and FLS enforced for user-facing data access. Does not apply to this unit's code: it only computes a value on the records being saved, which the rules allow in system mode. It returns no data to a user. Unit 3's controller enforces user mode.
- [x] 5. Configuration in custom metadata, no hard-coded values or IDs. Fields, operators, values, points and on/off all come from `Lead_Scoring_Rule__mdt`. The only constants are the three operator names and the 0 to 100 range, both fixed by the intent. Tests supply rules through `rulesOverride` and never read the shipped records.
- [x] 6. Tests assert, include a bulk test, target 90% coverage. Every test asserts with `Assert`; bulk tests as in rule 2; every branch of the validation and matching code has a test (see the test plan). Coverage is measured only in Operations.
- [x] 7. LWC handles errors and has Jest tests. Does not apply: no LWC in this unit.
- [x] 8. Access granted by permission set. Nothing new to grant: trigger code runs regardless of class access, and reps get read on `Score__c` from `Lead_Scoring_User` (unit 1).
- [x] 9. Source-format metadata only, manual steps written in README. No manual steps for this unit.

No guardrail is set aside.

## Local verification

Built on 2026-11-12 after the design-approval gate.

| Check | Command or method | Result |
|---|---|---|
| Jest | `npm run test:unit` | Passed. No LWC in this unit; see unit 3 for the run that includes Jest tests. |
| Lint | `npm run lint` | Passed, no output. |
| Apex syntax | `npx prettier --check "force-app/**/*.{cls,trigger}"` (prettier-plugin-apex parses each file) | Passed after `--write` formatting: all four classes and the trigger parse. This checks syntax only, not compilation against the org schema. |
| Code Analyzer | `sf code-analyzer run ...` | Not run: the Salesforce CLI is not installed in this environment. The guardrails were checked by reading the code. |
| Source converts | `sf project convert source ...` | Not run: no Salesforce CLI here. Each new file was checked by hand against the SFDX layout (`classes/*.cls` + `.cls-meta.xml`, `triggers/*.trigger` + `.trigger-meta.xml`, API version 68.0). |
| Apex tests | none locally | **Written, not executed.** Apex tests run only in an org, during Operations. |
