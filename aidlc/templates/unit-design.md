# Unit design: <unit-slug>

## Data model
<!-- Objects, fields (API name, type, length), custom metadata types and records. -->

## Apex classes
<!-- Each class: sharing declaration and every public signature. -->

## LWC components
<!-- Each component: targets, public properties, what it renders in each state. -->

## Data flow
<!-- From the user action or save event to the final result. -->

## Error handling
<!-- Each failure and what the user or admin sees. -->

## Guardrail checklist

Tick each rule from `aidlc/salesforce-rules.md` once the built unit obeys it.
If a rule does not apply or is broken on purpose, say why next to it.

- [ ] 1. One trigger per object, trigger holds no logic
- [ ] 2. Bulk-safe, no SOQL or DML in loops, tested with 200 records
- [ ] 3. Classes declare `with sharing`
- [ ] 4. CRUD and FLS enforced for user-facing data access
- [ ] 5. Configuration in custom metadata, no hard-coded values or IDs
- [ ] 6. Tests assert, include a bulk test, target 90% coverage
- [ ] 7. LWC handles errors and has Jest tests
- [ ] 8. Access granted by permission set
- [ ] 9. Source-format metadata only, manual steps written in README

## Local verification
<!-- Filled in after the build: each command run and its result. State plainly
     anything that could not be run locally (Apex tests need an org). -->
