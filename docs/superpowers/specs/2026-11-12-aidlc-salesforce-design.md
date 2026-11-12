# AI-DLC for Salesforce: kit and lead-scoring demo

Date: 2026-11-12
Status: awaiting review

## Goal

A small repository that does two things:

1. Provides a reusable AI-DLC (AI-Driven Development Life Cycle) kit for
   Salesforce development, driven from Claude Code.
2. Proves the kit by running one small feature, lead scoring, through every
   phase, ending with the feature deployed and tested in a Salesforce org.

Success: someone opens the repo in Claude Code, runs the three phase commands
in order, approves each gate, and ends with a working, tested feature in their
org plus a written trail of how it got there.

## Scope

In scope:

- Kit: core rules, three phase commands, artifact templates, Salesforce
  guardrails.
- Demo: lead scoring (Apex, custom metadata, LWC, permission set, tests).
- Local verification and one org deployment.

Out of scope:

- Support for tools other than Claude Code.
- Team features (multiple reviewers, ticket-system integration).
- CI/CD pipelines, packaging (unlocked or managed packages), multi-org
  promotion.
- Monitoring beyond recording the deployment and test results.

## Approach

Write a lean kit modelled on the phases of the AWS AI-DLC method (Inception,
Construction, Operations) instead of forking the AWS reference workflows, which
are large and built around other tools. A single large `CLAUDE.md` was rejected
because it gives no phase gates and no reusable pieces.

## Repository layout

```
aidlc-salesforce/
  CLAUDE.md                     core rules, loaded every session
  README.md                     how to use the kit in this or another project
  .claude/commands/
    aidlc-inception.md          /aidlc-inception <intent>
    aidlc-construction.md       /aidlc-construction <unit>
    aidlc-operations.md         /aidlc-operations
  aidlc/
    salesforce-rules.md         Salesforce guardrails
    templates/
      intent.md
      questions.md
      user-stories.md
      units-of-work.md
      unit-design.md
      test-plan.md
      deployment-record.md
  aidlc-docs/                   artifacts produced by a run
    state.md                    current phase, gate status, next step
    audit.md                    append-only log of prompts and approvals
    inception/
    construction/<unit>/
    operations/
  force-app/main/default/       SFDX source for the demo
  sfdx-project.json
  package.json                  LWC Jest, ESLint, Prettier
```

To reuse the kit in another SFDX project, copy `CLAUDE.md`, `.claude/commands/`
and `aidlc/`. `aidlc-docs/` and `force-app/` belong to the project.

## Kit components

### CLAUDE.md (core rules)

- Describes the three phases and their order.
- States the gate rule: a phase's artifacts are written to `aidlc-docs/`, the
  human approves them, and only then does the next step start. Approval is
  recorded in `aidlc-docs/audit.md` with a timestamp.
- States the question rule: when information is missing, write questions to
  the phase's `questions.md` with multiple-choice options and wait for answers
  in the file; do not guess.
- Points to `aidlc/salesforce-rules.md` as mandatory for all design and code.
- Requires reading `aidlc-docs/state.md` at the start of a session and
  updating it after each step, so work can resume across sessions.

### Phase commands

Each command reads `state.md`, refuses to run if the previous gate is not
approved, produces its artifacts from the templates, and stops at its gate.

| Command | Input | Steps | Artifacts | Gate |
|---|---|---|---|---|
| `/aidlc-inception` | one-paragraph intent | clarify, write stories, split into units | `intent.md`, `questions.md`, `user-stories.md`, `units-of-work.md` | human approves stories and units |
| `/aidlc-construction` | a unit name | design, test plan, code and tests, local verification | `unit-design.md`, `test-plan.md`, source in `force-app/` | human approves design before code, then approves the verified unit |
| `/aidlc-operations` | none | validate deploy, deploy, run Apex tests, assign permission set | `deployment-record.md` | human approves before the real deploy |

Construction has two gates because design errors are cheap to fix before code
exists and expensive after.

### Salesforce guardrails (`aidlc/salesforce-rules.md`)

- One trigger per object; triggers contain no logic and delegate to a handler.
- All Apex is bulk-safe: no SOQL or DML inside loops; handle 200 records.
- Classes declare `with sharing` unless a reason is written in the design.
- CRUD and FLS are enforced for user-facing data access
  (`WITH USER_MODE` / `AccessLevel.USER_MODE`).
- Configuration lives in custom metadata, not hard-coded values.
- Every Apex class has tests with assertions, including a bulk test; target
  90% coverage, never below the platform minimum of 75%.
- LWCs use wire adapters or imperative Apex with error handling, and have Jest
  tests.
- Access is granted through permission sets, never profiles.
- Metadata is source-format SFDX only; no changes made by hand in the org.

## Demo: lead scoring

Intent given to Inception: "Score each Lead from 0 to 100 using configurable
rules, and show sales reps why a Lead has its score."

Expected units of work (Inception produces the real list):

1. **Scoring engine**
   - `Lead.Score__c` (Number, 0 to 100).
   - `Lead_Scoring_Rule__mdt` custom metadata type: field API name, operator
     (`equals`, `not blank`, `greater than`), comparison value, points, active
     flag. Ships with four or five sample rules (for example: Email not blank,
     Industry equals Technology, NumberOfEmployees greater than 100).
   - `LeadTrigger` (before insert, before update) calling
     `LeadTriggerHandler`, which calls `LeadScoringService`.
   - `LeadScoringService.score(List<Lead>)` loads active rules once, sums
     points for matching rules, and caps the result at 100. It also returns a
     per-rule breakdown for one Lead.
   - Apex tests: each operator, cap at 100, no active rules, 200-record bulk
     insert, inactive rules ignored.

2. **Score breakdown component**
   - `leadScoreBreakdown` LWC for the Lead record page: total score and a list
     of rules showing which matched and the points each contributed.
   - `LeadScoreController.getBreakdown(Id leadId)`, cacheable, user-mode
     access.
   - Jest tests: renders rules, shows empty state, shows error state.
   - Apex test for the controller.

3. **Access and page placement**
   - `Lead_Scoring_User` permission set: read on `Score__c`, access to the
     controller class.
   - Lead record page (FlexiPage) with the component placed on it.

### Data flow

Lead insert or update → `LeadTrigger` → `LeadTriggerHandler` →
`LeadScoringService` reads `Lead_Scoring_Rule__mdt` → sets `Score__c` in the
same transaction (before-save, so no extra DML). Opening the Lead page → LWC
calls `LeadScoreController.getBreakdown` → service returns the per-rule
breakdown → component renders it.

### Error handling

- A rule that names a field that does not exist on Lead, or has an unknown
  operator, is skipped and does not block the save; the breakdown lists it as
  "invalid rule" so an admin can see it.
- A non-numeric comparison value on a `greater than` rule is treated as an
  invalid rule in the same way.
- The LWC shows a readable message when the Apex call fails.

## Verification

Local, run during Construction:

- `npm run test:unit` (LWC Jest).
- `npm run lint` (ESLint for LWC).
- Salesforce Code Analyzer scan of Apex, if it installs in the environment;
  otherwise the guardrails are checked by review and that is recorded.

Org, run during Operations:

- `sf project deploy validate` then `sf project deploy start`.
- `sf apex run test` with code coverage; results copied into
  `deployment-record.md`.
- Permission set assigned to the deploying user.
- Manual demo check: create a Lead, confirm `Score__c` and the breakdown.

Apex tests can only execute in an org, so until Operations they are written
and reviewed but not run.

## Prerequisites and risks

- Salesforce CLI (`sf`) must be installed in the working environment.
- Org access needs the Salesforce login and instance hosts allowed by the
  environment's network policy, and the owner authorising the org. If that is
  not available, Operations stops at its gate with the exact commands for the
  owner to run on their own machine.
- The demo artifacts in `aidlc-docs/` are produced by actually running the
  phase commands, not written by hand, so the demo is an honest test of the
  kit. Any kit defect found during the demo run is fixed in the kit.

## Build order

1. Repo scaffold: SFDX project, `package.json`, git.
2. Kit: `CLAUDE.md`, guardrails, templates, three commands, `README.md`.
3. Demo Inception run, gate.
4. Demo Construction runs for each unit, gates, local verification.
5. Demo Operations run against the org, gate.
6. README updated with what the demo run showed.
