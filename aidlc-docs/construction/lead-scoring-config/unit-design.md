# Unit design: lead-scoring-config

Stories covered: US-1, US-5 (the permission set and the README step; unit 3
adds Apex class access and the Lightning App Builder step).

This unit is metadata only. It contains no Apex and no LWC. All metadata
files use API version 68.0, the `sourceApiVersion` in `sfdx-project.json`.

## Data model

### Field on Lead

| API name | Label | Type | Details |
|---|---|---|---|
| `Lead.Score__c` | Score | Number | precision 3, scale 0, not required, not unique, not an external ID, no default value |

- Description: "Lead score from 0 to 100. Calculated from the active Lead
  Scoring Rule records each time the Lead is saved. Do not edit by hand."
- Help text: "Calculated from the lead scoring rules each time the Lead is
  saved."
- No default value, so a Lead that existed before deployment has an empty
  Score until it is next saved (inception question 8: existing Leads are not
  re-scored).
- File: `force-app/main/default/objects/Lead/fields/Score__c.field-meta.xml`

### Custom metadata type `Lead_Scoring_Rule__mdt`

- Label "Lead Scoring Rule", plural label "Lead Scoring Rules",
  visibility Public.
- File: `force-app/main/default/objects/Lead_Scoring_Rule__mdt/Lead_Scoring_Rule__mdt.object-meta.xml`

| API name | Label | Type | Details |
|---|---|---|---|
| `Lead_Field__c` | Lead Field | Text | length 80, not required |
| `Operator__c` | Operator | Picklist | restricted; values `Equals`, `Not Blank`, `Greater Than` (API name and label are the same text); not required; no default |
| `Value__c` | Value | Text | length 255, not required |
| `Points__c` | Points | Number | precision 3, scale 0, not required; negative values allowed |
| `Active__c` | Active | Checkbox | default `true` |

- Every field: `fieldManageability` is `DeveloperControlled` (the platform
  default). The source is deployed unpackaged, so admins can edit every field
  of every record in Setup.
- Each field carries help text saying what to enter, for example Lead Field:
  "API name of a field on Lead, for example Industry or NumberOfEmployees."
- Files: `force-app/main/default/objects/Lead_Scoring_Rule__mdt/fields/<Field>.field-meta.xml`

Names unit 2 and unit 3 must reuse exactly: `Lead_Scoring_Rule__mdt`,
`Lead_Field__c`, `Operator__c`, `Value__c`, `Points__c`, `Active__c`,
`Lead.Score__c`, and the operator values `Equals`, `Not Blank`,
`Greater Than`. The record `Label` (`MasterLabel`) is the text unit 3 shows
on each breakdown line.

### Custom metadata records

Files: `force-app/main/default/customMetadata/Lead_Scoring_Rule.<DeveloperName>.md-meta.xml`

| DeveloperName | Label | Lead_Field__c | Operator__c | Value__c | Points__c | Active__c |
|---|---|---|---|---|---|---|
| `Email_Not_Blank` | Email not blank | `Email` | Not Blank | (empty) | 10 | true |
| `Phone_Not_Blank` | Phone not blank | `Phone` | Not Blank | (empty) | 10 | true |
| `Industry_Equals_Technology` | Industry equals Technology | `Industry` | Equals | `Technology` | 20 | true |
| `Employees_Greater_Than_100` | Employees greater than 100 | `NumberOfEmployees` | Greater Than | `100` | 25 | true |
| `Revenue_Greater_Than_1000000` | Annual revenue greater than 1,000,000 | `AnnualRevenue` | Greater Than | `1000000` | 25 | true |

All five use standard Lead fields. Records are not marked protected.

### Permission set `Lead_Scoring_User`

- Label "Lead Scoring User". Description: "Access a sales rep needs for lead
  scoring: read the Lead Score field."
- One `fieldPermissions` entry: `Lead.Score__c`, `readable` true,
  `editable` false.
- No object permissions, no license restriction, no Apex class access (unit 3
  adds `LeadScoreController` to this same file).
- File: `force-app/main/default/permissionsets/Lead_Scoring_User.permissionset-meta.xml`

### README

Add a section "Lead scoring demo: setup after deployment" to `README.md`
with one manual step: assign the `Lead_Scoring_User` permission set to each
sales rep, in Setup (Users > Permission Sets > Lead Scoring User > Manage
Assignments) or with `sf org assign permset --name Lead_Scoring_User`.
Unit 3 adds the Lightning App Builder step to the same section.

## Apex classes

None in this unit.

## LWC components

None in this unit.

## Data flow

Nothing runs in this unit. It supplies what the later units read and write:

1. An admin edits `Lead_Scoring_Rule__mdt` records in Setup > Custom Metadata
   Types > Lead Scoring Rule > Manage Records. No deployment is needed.
2. Unit 2's `LeadScoringService` reads the records where `Active__c` is true
   and writes the result to `Lead.Score__c` on save.
3. A user with `Lead_Scoring_User` can read `Lead.Score__c`; a user without
   it cannot see the field. Nobody is granted edit access by this feature.

## Error handling

| Failure | What the admin or user sees |
|---|---|
| Admin picks an operator outside the three | Not possible: the picklist is restricted, so Setup offers only Equals, Not Blank and Greater Than. |
| Admin leaves Lead Field, Operator, Points or Value empty, or types a field name that does not exist | The record saves. The type deliberately has no required fields and no validation, so the rule is skipped at scoring time by unit 2 (US-3) rather than rejected here. See `questions.md` question 1. |
| Admin enters points beyond three digits | Setup rejects the value with the standard number-length message. |
| User without the permission set opens a Lead | The Score field is not shown (standard field-level security). |
| Deployment to an org that already has `Lead.Score__c` with a different type | The deployment fails at validation in Operations with the platform's message; nothing is changed. |

## Guardrail checklist

Tick each rule from `aidlc/salesforce-rules.md` once the built unit obeys it.
If a rule does not apply or is broken on purpose, say why next to it.

- [ ] 1. One trigger per object, trigger holds no logic. Does not apply: this unit has no trigger.
- [ ] 2. Bulk-safe, no SOQL or DML in loops, tested with 200 records. Does not apply: this unit has no Apex. The 200-record test belongs to unit 2.
- [ ] 3. Classes declare `with sharing`. Does not apply: no classes.
- [ ] 4. CRUD and FLS enforced for user-facing data access. Does not apply: no code reads data. Field-level security on `Score__c` is granted only by the permission set.
- [ ] 5. Configuration in custom metadata, no hard-coded values or IDs
- [ ] 6. Tests assert, include a bulk test, target 90% coverage. Does not apply: no Apex to test or cover. The unit is checked by the structural conversion and by the manual checks in the test plan.
- [ ] 7. LWC handles errors and has Jest tests. Does not apply: no LWC.
- [ ] 8. Access granted by permission set
- [ ] 9. Source-format metadata only, manual steps written in README

No guardrail is set aside in this unit.

## Local verification
<!-- Filled in after the build: each command run and its result. State plainly
     anything that could not be run locally (Apex tests need an org). -->

Not yet built. To be filled in after the design is approved.
