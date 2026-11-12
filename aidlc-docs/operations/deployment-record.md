# Deployment record

## Target org
<!-- Alias and org type. Never write usernames, passwords or auth URLs here. -->

None yet. No org is reachable from the environment that built this: the
Salesforce CLI is not installed there and no org is authorised. Every step
below is for the human to run on their own machine, in this order.

## Validate result
<!-- Command, job ID, outcome, component and test counts. -->

Not run. Command:

```bash
sf project deploy validate --source-dir force-app --test-level RunLocalTests --target-org <alias> --wait 30
```

Expected: the 31 files in `force-app` validate (Jest tests under `__tests__` are excluded by `.forceignore`). Apex test classes:
`LeadScoringServiceTest` (28 tests), `LeadTriggerHandlerTest` (6),
`LeadScoreControllerTest` (9). These have been written but never executed.

## Deploy
<!-- Command, deploy ID, outcome. -->

Not run. Only after the validation passes and `deploy-approval` is given:

```bash
sf project deploy start --source-dir force-app --test-level RunLocalTests --target-org <alias> --wait 30
```

## Apex test summary
<!-- Passed / failed counts, then coverage per class. -->

Not run. Command:

```bash
sf apex run test --test-level RunLocalTests --code-coverage --result-format human --wait 20 --target-org <alias>
```

| Class | Coverage |
|---|---|
| LeadScoringService | not measured |
| LeadTriggerHandler | not measured |
| LeadScoreController | not measured |
| LeadTrigger | not measured |

## Permission set assignment
<!-- Each permission set and who it was assigned to (alias only). -->

Not run. Command:

```bash
sf org assign permset --name Lead_Scoring_User --target-org <alias>
```

## Manual check
<!-- What was checked in the org and what was seen. -->

Not run. After the deploy, do the "Manual" rows in each unit's
`test-plan.md`. The quickest end-to-end check:

```bash
sf data create record --sobject Lead --values "LastName='Demo' Company='Acme' Email='demo@example.com' Phone='555-0100' Industry='Technology'" --target-org <alias>
```

Expected Score with the sample rules: 40. Then add the component to the Lead
page (README, step 2), open the Lead: total 40 and three lines (+10, +10,
+20). Set NumberOfEmployees to 500 and save: 65 and a fourth line, without a
page refresh.

## Not run
<!-- Anything skipped, and why. Write "Nothing" if all steps ran. -->

Everything in this record: validate, deploy, Apex tests and coverage,
permission set assignment and manual checks. Reason: no Salesforce org or CLI
in the build environment. Before validating, also check in the target org that
Lead has no other trigger (guardrail 1) and that a profile named
`Standard User` exists (used by `LeadScoreControllerTest`).
