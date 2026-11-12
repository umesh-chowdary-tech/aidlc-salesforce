# Test plan: lead-scoring-config

This unit has no Apex and no LWC, so it has no Apex or Jest tests, and no
bulk test: nothing in it runs on record save. The 200-record test is in
unit 2's plan. The unit is checked by local structural checks during the
build and by manual checks in the org during Operations.

| Test name | Type | What it proves |
|---|---|---|
| Source converts | Local | `sf project convert source --root-dir force-app --output-dir <temp dir>` succeeds, so every file is in a valid place and the XML is well formed. |
| Converted manifest lists the expected components | Local | The generated `package.xml` names `Lead.Score__c`, `Lead_Scoring_Rule__mdt`, its five fields, the five `Lead_Scoring_Rule.*` records and `Lead_Scoring_User`, and nothing else. |
| API version matches | Local | Every `-meta.xml` that carries an `apiVersion` uses 68.0; a search of `force-app/` finds no other version. |
| No profile metadata | Local | A search of `force-app/` finds no `*.profile-meta.xml` file (US-5). |
| Existing suite still green | Jest | `npm run test:unit` and `npm run lint` pass. There are no components yet, so this only shows the unit broke nothing. |
| Rule type exists | Manual | Setup > Custom Metadata Types shows "Lead Scoring Rule" with fields Lead Field, Operator, Value, Points and Active (US-1). |
| Operator choices | Manual | Editing a rule, the Operator field offers only Equals, Not Blank and Greater Than (US-1). |
| Five sample rules | Manual | Manage Records lists five rules, all active, with the fields, values and points in the unit design (US-1). |
| Rule editable without deployment | Manual | Changing Points on a sample rule in Setup saves (US-1). Restore the value afterwards. |
| Negative points accepted | Manual | Setting Points to -10 on a rule saves. Restore the value afterwards. |
| Score field exists | Manual | Object Manager > Lead > Fields shows Score (`Score__c`), Number(3, 0) (US-1). |
| One permission set | Manual | Setup > Permission Sets lists "Lead Scoring User" and no other lead-scoring permission set (US-5). |
| Score hidden without the permission set | Manual | A standard sales user without the permission set does not see Score on a Lead (US-5). Needs Score on the page layout or a look at the user's field access. |
| Score read-only with the permission set | Manual | After assignment, the same user sees Score and cannot edit it (US-5). |
| README step | Manual | The README setup section tells the admin to assign `Lead_Scoring_User` (US-5). |

Types: Apex (runs only in an org), Jest (runs locally), Local (a command or
search run on the source tree during the build), Manual (looked at in the
org, during Operations).
