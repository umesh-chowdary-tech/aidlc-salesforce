---
description: AI-DLC Operations. Validate the deployment against an org, stop for approval, then deploy, run Apex tests and record the results.
argument-hint: [org alias]
---

# AI-DLC Operations

Org alias (optional): $ARGUMENTS

## 1. Check state

Read `aidlc-docs/state.md` and `aidlc-docs/inception/units-of-work.md`.

- If `pending_gate` is `inception-approval`, `design-approval` or
  `unit-approval`, do not continue. Say which gate is pending and stop.
- Every unit in `units-of-work.md` must be listed under "Approved units". If
  one is not, name it and stop.
- If `pending_gate` is `deploy-approval` and the human's message approves,
  go to "On approval".
- If `phase` is `done`, say so and stop.

## 2. Read the rules

Read `aidlc/salesforce-rules.md`. Rule 9 applies here: the org changes only
by deployment from `force-app/`.

## 3. Choose the org

Use the alias given. If none was given, run `sf org list` and ask the human
which org to use. Confirm it is reachable with
`sf org display --target-org <alias>`. Never print or store auth URLs,
passwords or access tokens.

If no org is reachable from this environment, write
`aidlc-docs/operations/deployment-record.md` from
`aidlc/templates/deployment-record.md` with the exact commands from steps 4
and "On approval" under "Not run", for the human to run on their own
machine. Set the gate below and stop.

## 4. Validate

Run a check-only deployment that also runs the Apex tests:

```
sf project deploy validate --source-dir force-app --test-level RunLocalTests --target-org <alias> --wait 30
```

Write the result into `aidlc-docs/operations/deployment-record.md` (from
`aidlc/templates/deployment-record.md`) under "Validate result".

If validation fails, report the failures. Fix source defects and validate
again. Do not weaken or delete a test to get a pass.

## Gate

Update `aidlc-docs/state.md`: `phase: operations`, `unit: -`,
`pending_gate: deploy-approval`,
`next_step: Human reviews the validation result and approves the deploy.`

Tell the human: the target org alias, components to be deployed, test
results from validation, and that approving will change the org.

Stop and wait for the human.

## On approval

Only when the human explicitly approves the deploy:

1. Append `## <ISO timestamp> deploy-approval` and their words to
   `aidlc-docs/audit.md`. Set `pending_gate: none`.
2. Deploy:
   `sf project deploy start --source-dir force-app --test-level RunLocalTests --target-org <alias> --wait 30`
3. Run the tests with coverage:
   `sf apex run test --test-level RunLocalTests --code-coverage --result-format human --wait 20 --target-org <alias>`
4. Assign each permission set in `force-app/main/default/permissionsets/`:
   `sf org assign permset --name <PermissionSetName> --target-org <alias>`
5. Do the manual checks listed in the units' test plans, or ask the human to
   and record what they report.
6. Write `aidlc-docs/operations/acceptance-checklist.md` from
   `aidlc/templates/acceptance-checklist.md`: one line per thing the
   requester should try in the org, covering every user story's acceptance
   criteria, in plain language.
7. Complete every section of `deployment-record.md`. Coverage below 90% for
   any class is reported as a shortfall, not hidden.
8. Update `aidlc-docs/state.md`: `phase: done`,
   `next_step: Complete. See aidlc-docs/operations/deployment-record.md.`

If the deploy fails, record the failure, leave `phase: operations`, and
report it. Do not retry with a lower test level.
