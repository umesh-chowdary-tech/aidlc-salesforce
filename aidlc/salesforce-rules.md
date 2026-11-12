# Salesforce guardrails

These rules are mandatory for every design and every line of code produced
under AI-DLC. A design that breaks one must say so and give the reason in its
"Guardrail checklist". Code that breaks one without a written reason is not
done.

## 1. One trigger per object, and triggers hold no logic

Several triggers on one object run in no guaranteed order. Logic in a trigger
cannot be unit tested or reused.

```apex
// Right
trigger LeadTrigger on Lead (before insert, before update) {
    LeadTriggerHandler.beforeSave(Trigger.new);
}
```

Wrong: `if`, loops, SOQL or DML inside the trigger body.

## 2. Bulk-safe: no SOQL or DML inside loops

Triggers receive up to 200 records per batch. A query in a loop hits the
governor limit of 100 SOQL queries at record 101.

```apex
// Right: query once, then loop
Map<Id, Account> accounts = new Map<Id, Account>(
    [SELECT Id, Industry FROM Account WHERE Id IN :accountIds]
);
for (Lead l : leads) { /* use the map */ }
```

Wrong: `for (Lead l : leads) { Account a = [SELECT ... WHERE Id = :l.X]; }`

Every Apex unit has a test that processes 200 records.

## 3. Classes declare `with sharing`

Without it, code may run in system mode and expose records the user cannot
see. Use `without sharing` or `inherited sharing` only with a reason written
in the unit design.

## 4. Enforce CRUD and FLS for user-facing data access

Code that returns data to a user must respect that user's object and field
permissions.

```apex
// Right
List<Lead> rows = [SELECT Id, Score__c FROM Lead WHERE Id = :leadId WITH USER_MODE];
Database.query(soql, AccessLevel.USER_MODE);
```

Wrong: a plain query in an `@AuraEnabled` method. Trigger logic that only
computes values on the records being saved may run in system mode.

## 5. Configuration lives in custom metadata

Thresholds, points, field names and feature switches go in custom metadata
types so an admin can change them without a deployment, and so they deploy
with the code. No hard-coded IDs, ever.

Custom metadata cannot be inserted in a test. Give the class a
`@TestVisible` seam for supplying rows, and never let a test depend on the
records shipped in source.

## 6. Tests assert, cover the bulk case, and reach 90%

Target 90% coverage per class. The platform refuses production deployments
below 75% overall, so 75% is a floor, not a goal. A test without assertions
does not count. Use `Assert.areEqual` and friends, create your own data, and
never use `SeeAllData=true`.

## 7. LWC: handle errors, test with Jest

Read data with wire adapters or imperative Apex. Every component renders a
readable message when its data call fails, and has Jest tests for the normal,
empty and error states.

## 8. Access through a permission set, never profiles

Profiles are hard to deploy and merge. Every new field, class, object and tab
is granted by a permission set that ships in source.

## 9. Source-format metadata only

All changes live in `force-app/` in SFDX source format and reach the org by
deployment. Nothing is changed by hand in the org. If a step can only be done
in Setup, it is written down in the README as a manual step.
