# Units of work

Units are listed in build order. Each unit can be designed, built, tested and
approved on its own.

There is one permission set for the whole feature. Unit 1 creates it; units 2
and 3 add to that same file only if their design needs it (unit 3 adds Apex
class access). No unit creates a second permission set.

## 1. lead-scoring-config

- **Purpose:** Create the data model and configuration that scoring reads: the score field, the rule type, the five sample rules, and the permission set.
- **Stories covered:** US-1, US-5
- **Salesforce components:**
  - Objects and fields:
    - `Lead.Score__c` (Number, 3 digits, 0 decimals)
    - Custom metadata type `Lead_Scoring_Rule__mdt` with fields `Lead_Field__c` (Text), `Operator__c` (Picklist: Equals, Not Blank, Greater Than), `Value__c` (Text), `Points__c` (Number, may be negative), `Active__c` (Checkbox)
  - Apex: none
  - LWC: none
  - Other metadata:
    - Five `Lead_Scoring_Rule` custom metadata records: Email not blank (+10), Phone not blank (+10), Industry equals Technology (+20), NumberOfEmployees greater than 100 (+25), AnnualRevenue greater than 1000000 (+25)
    - Permission set `Lead_Scoring_User`: read on `Lead.Score__c`
    - README: manual step to assign the permission set
- **Depends on:** none

## 2. lead-scoring-engine

- **Purpose:** Calculate each Lead's score from the active rules on every insert and update, bulk-safe, and skip any rule that is badly configured instead of failing the save.
- **Stories covered:** US-2, US-3
- **Salesforce components:**
  - Objects and fields: none (writes `Lead.Score__c` from unit 1)
  - Apex:
    - `LeadTrigger` (before insert, before update; the only trigger on Lead; no logic)
    - `LeadTriggerHandler` (`with sharing`)
    - `LeadScoringService` (`with sharing`): reads active rules once per transaction, evaluates each rule against a Lead, returns the matched rules and the total kept between 0 and 100; has a `@TestVisible` seam for supplying rules
    - `LeadScoringServiceTest`, `LeadTriggerHandlerTest`: own test rules through the seam, every operator, both ends of the 0 to 100 range, inactive rules, each kind of bad rule, and a 200-record insert
  - LWC: none
  - Other metadata: none
- **Depends on:** lead-scoring-config

## 3. lead-score-breakdown

- **Purpose:** Show reps the total score and the per-rule breakdown on the Lead record page, with readable empty and error states.
- **Stories covered:** US-4, US-5
- **Salesforce components:**
  - Objects and fields: none
  - Apex:
    - `LeadScoreController` (`with sharing`): one `@AuraEnabled(cacheable=true)` method that reads the Lead in user mode and returns the stored total and the matched rules, reusing `LeadScoringService`
    - `LeadScoreControllerTest`
  - LWC:
    - `leadScoreBreakdown`: exposed to Lead record pages; shows total, one line per matched rule, a "no rules matched" message, and an error message; refreshes when the record changes; Jest tests for normal, empty and error states
  - Other metadata:
    - Permission set `Lead_Scoring_User`: add Apex class access to `LeadScoreController`
    - README: manual step to add the component to the Lead record page in Lightning App Builder
- **Depends on:** lead-scoring-config, lead-scoring-engine

## Story coverage

| Story | Units |
| --- | --- |
| US-1 | lead-scoring-config |
| US-2 | lead-scoring-engine |
| US-3 | lead-scoring-engine |
| US-4 | lead-score-breakdown |
| US-5 | lead-scoring-config, lead-score-breakdown |
