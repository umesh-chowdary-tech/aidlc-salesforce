# AI-DLC for Salesforce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code AI-DLC kit for Salesforce and prove it by running a lead-scoring feature through Inception, Construction and Operations into a real org.

**Architecture:** The kit is markdown: `CLAUDE.md` core rules, three slash commands in `.claude/commands/`, templates and guardrails in `aidlc/`. Each run writes artifacts to `aidlc-docs/` and stops at human approval gates. The demo is SFDX source in `force-app/`, produced by following the kit's own commands.

**Tech Stack:** Salesforce CLI (`sf`), SFDX source format, Apex, Lightning Web Components, `@salesforce/sfdx-lwc-jest`, ESLint (`@salesforce/eslint-config-lwc`), Node 22.

**Spec:** `docs/superpowers/specs/2026-11-12-aidlc-salesforce-design.md`

## Global Constraints

- Target tool is Claude Code only.
- A phase's artifacts are written to `aidlc-docs/`, the human approves, and only then does the next step start; approvals are appended to `aidlc-docs/audit.md` with a timestamp.
- Missing information becomes multiple-choice questions in the phase's `questions.md`; never guess.
- All design and code obey `aidlc/salesforce-rules.md` (one logic-free trigger per object, bulk-safe for 200 records, `with sharing`, user-mode data access, config in custom metadata, permission sets not profiles, source-format metadata only).
- Apex coverage target 90%, never below 75%.
- Score range is 0 to 100.
- Demo artifacts in `aidlc-docs/` come from running the phase commands, not from hand-writing. A kit defect found during the demo is fixed in the kit, in its own commit.
- Tasks 3 to 7 contain human gates. The executor stops at each gate and waits; a subagent must return to the controller at a gate instead of approving on the human's behalf.
- Slash commands added mid-session may not be registered. If `/aidlc-*` is not available, read the command file and follow it exactly.
- API version: whatever `sf project generate` writes into `sfdx-project.json`; use it for every `-meta.xml`.

## Review Focus

1. A rule's field is null on the Lead (for example `NumberOfEmployees` empty with `greater than`): the rule does not match and nothing throws.
2. Rules with negative points: the total never goes below 0.
3. `equals` on text is case-insensitive (`technology` matches `Technology`).
4. Session resumes mid-phase: a command run with `state.md` showing an unapproved gate refuses to continue and says which gate is pending.
5. Breakdown requested for a Lead the user cannot read, or an Id that is not a Lead: the controller throws `AuraHandledException` with a readable message and the LWC shows its error state.

---

### Task 1: Project scaffold

**Files:**
- Create: `sfdx-project.json`, `.forceignore`, `.gitignore`, `package.json`, `jest.config.js`, `eslint.config.js`, `force-app/main/default/` (via generator)

**Interfaces:**
- Produces: npm scripts `test:unit` (`sfdx-lwc-jest --passWithNoTests`), `lint` (`eslint force-app/**/lwc/**/*.js`), `check:kit` (`node scripts/check-kit.js`, script added in Task 2). `sf` available on PATH.

- [ ] **Step 1:** Install the CLI: `npm install --global @salesforce/cli`. Verify: `sf --version` prints a version.
- [ ] **Step 2:** In a temp directory run `sf project generate --name aidlc-salesforce --template standard`, then copy its contents into the repo root without overwriting `docs/` or `.git/`. Delete generated sample files that are not needed (`scripts/apex`, `scripts/soql`, `.husky`, `.vscode`).
- [ ] **Step 3:** Trim `package.json` to the three scripts above plus dev dependencies `@salesforce/sfdx-lwc-jest`, `@salesforce/eslint-config-lwc`, `eslint`, `prettier`, `prettier-plugin-apex`. Run `npm install`.
- [ ] **Step 4:** Verify: `npm run test:unit` exits 0 with "No tests found"; `npm run lint` exits 0.
- [ ] **Step 5:** Try `sf code-analyzer --help` (install plugin with `sf plugins install code-analyzer` if missing). Record in the commit message whether it is available; if not, guardrails are checked by review per the spec.
- [ ] **Step 6:** Commit: `chore: scaffold SFDX project and tooling`.

### Task 2: The kit

**Files:**
- Create: `CLAUDE.md`, `README.md`, `aidlc/salesforce-rules.md`
- Create: `aidlc/templates/{intent,questions,user-stories,units-of-work,unit-design,test-plan,deployment-record}.md`
- Create: `.claude/commands/{aidlc-inception,aidlc-construction,aidlc-operations}.md`
- Create: `aidlc-docs/state.md`, `aidlc-docs/audit.md`
- Test: `scripts/check-kit.js`

**Interfaces:**
- Produces:
  - `aidlc-docs/state.md` format, exactly these keys, one per line: `phase:` (`not-started` | `inception` | `construction` | `operations` | `done`), `unit:` (unit slug or `-`), `pending_gate:` (`none` | `inception-approval` | `design-approval` | `unit-approval` | `deploy-approval`), `next_step:` (free text).
  - `aidlc-docs/audit.md` entry format: `## <ISO timestamp> <event>` followed by the human's words verbatim.
  - Artifact paths: `aidlc-docs/inception/{intent,questions,user-stories,units-of-work}.md`, `aidlc-docs/construction/<unit-slug>/{unit-design,test-plan,questions}.md`, `aidlc-docs/operations/deployment-record.md`.
  - Commands: `/aidlc-inception <intent>`, `/aidlc-construction <unit-slug>`, `/aidlc-operations`.

- [ ] **Step 1: Write the failing test** `scripts/check-kit.js` (plain Node, exits 1 with a list of failures). It asserts:
  - every file listed under **Files** above exists and is non-empty;
  - each command file has frontmatter with `description`, mentions `aidlc-docs/state.md`, `aidlc-docs/audit.md` and `aidlc/salesforce-rules.md`, and names every template it uses by path, and each such path exists;
  - each command file contains the literal heading `## Gate` and the literal sentence `Stop and wait for the human.`;
  - `aidlc-construction.md` contains two gates, identified by the strings `design-approval` and `unit-approval`;
  - `CLAUDE.md` mentions all three command names and `aidlc/salesforce-rules.md`;
  - `aidlc/salesforce-rules.md` contains each of: `one trigger per object`, `200`, `with sharing`, `USER_MODE`, `custom metadata`, `permission set`, `90%`, `75%` (case-insensitive);
  - `aidlc-docs/state.md` has the four keys with initial values `not-started`, `-`, `none`.
- [ ] **Step 2:** Run `npm run check:kit`. Expected: FAIL listing missing files.
- [ ] **Step 3: Write `aidlc/salesforce-rules.md`** with the nine guardrails from the spec section "Salesforce guardrails", each with a one-line reason and a short right/wrong example where code is involved.
- [ ] **Step 4: Write the seven templates.** Headings each must contain:
  - `intent.md`: Intent, Who it is for, Success looks like, Out of scope.
  - `questions.md`: numbered questions, each with lettered options and an `Answer:` line left blank.
  - `user-stories.md`: per story: ID, As a / I want / So that, Acceptance criteria (Given/When/Then).
  - `units-of-work.md`: per unit: slug, Purpose, Stories covered, Salesforce components (objects, fields, Apex, LWC, metadata), Depends on, Build order.
  - `unit-design.md`: Data model, Apex classes with public signatures, LWC components with public properties, Data flow, Error handling, Guardrail checklist (one checkbox per rule in `salesforce-rules.md`).
  - `test-plan.md`: table of test name, type (Apex/Jest/manual), what it proves; must include a bulk row.
  - `deployment-record.md`: Target org alias, Validate result, Deploy ID and result, Apex test summary (pass/fail counts, coverage per class), Permission set assignment, Manual check result.
- [ ] **Step 5: Write the three commands.** Each: read `state.md`; if `pending_gate` is not `none` or the phase order is wrong, say which gate is pending and stop (Review Focus 4); do the steps in the spec's phase table; write artifacts from templates; set `pending_gate`; print a summary of what to review; end with `Stop and wait for the human.` On approval: append to `audit.md`, set `pending_gate: none`, update `phase`/`unit`/`next_step`.
  - Inception: write `intent.md`; write `questions.md` and wait for answers in the file if anything is unclear; then stories and units; gate `inception-approval`.
  - Construction: argument must be a slug in `units-of-work.md` whose dependencies are approved; write `unit-design.md` and `test-plan.md`; gate `design-approval`; after approval write tests first, then code, run `npm run test:unit`, `npm run lint` and the code analyzer if available, tick the guardrail checklist; gate `unit-approval`.
  - Operations: requires every unit approved; ask for the org alias; `sf project deploy validate --source-dir force-app --test-level RunLocalTests --target-org <alias>`; write results; gate `deploy-approval`; after approval `sf project deploy start` with the same flags, `sf apex run test --code-coverage --result-format human --wait 20`, `sf org assign permset` for each permission set in `force-app`, fill `deployment-record.md`, set `phase: done`.
- [ ] **Step 6: Write `CLAUDE.md`** (under 80 lines): the three phases and order, the gate rule, the question rule, the mandatory guardrails pointer, the read-and-update-`state.md` rule. Write `README.md`: what AI-DLC is in three sentences, prerequisites, how to run the three commands, how to copy the kit into another project (`CLAUDE.md`, `.claude/commands/`, `aidlc/`). Write initial `state.md` and an `audit.md` containing only a title.
- [ ] **Step 7:** Run `npm run check:kit`. Expected: PASS, exit 0.
- [ ] **Step 8:** Commit: `feat: add AI-DLC kit for Salesforce`.

### Task 3: Demo Inception run

**Files:**
- Create (by running the command): `aidlc-docs/inception/{intent,questions,user-stories,units-of-work}.md`
- Modify: `aidlc-docs/state.md`, `aidlc-docs/audit.md`

**Interfaces:**
- Consumes: `/aidlc-inception` from Task 2.
- Produces: approved units with slugs `scoring-engine`, `score-breakdown`, `access-and-page`, in that build order. If the human's answers change the units, later tasks follow the approved `units-of-work.md` and this plan's names are adjusted to match.

- [ ] **Step 1:** Run `/aidlc-inception Score each Lead from 0 to 100 using configurable rules, and show sales reps why a Lead has its score.`
- [ ] **Step 2:** If `questions.md` has open questions, stop and ask the human to answer them in the file; rerun once answered.
- [ ] **Step 3:** Verify: four artifacts exist; `state.md` shows `phase: inception`, `pending_gate: inception-approval`.
- [ ] **Step 4:** Negative check for Review Focus 4: run `/aidlc-construction scoring-engine` now. Expected: it refuses and names `inception-approval`. If it does not, fix the command file and commit `fix(kit): enforce pending gate`.
- [ ] **Step 5: GATE.** Present stories and units to the human. Wait. On approval the command records it in `audit.md`.
- [ ] **Step 6:** Commit: `docs(demo): inception artifacts for lead scoring`.

### Task 4: Construction, unit `scoring-engine`

**Files:**
- Create: `aidlc-docs/construction/scoring-engine/{unit-design,test-plan}.md`
- Create: `force-app/main/default/objects/Lead/fields/Score__c.field-meta.xml`
- Create: `force-app/main/default/objects/Lead_Scoring_Rule__mdt/` (object meta plus fields `Field_API_Name__c` Text 80, `Operator__c` Picklist, `Value__c` Text 255, `Points__c` Number 3,0, `Active__c` Checkbox default true)
- Create: `force-app/main/default/customMetadata/Lead_Scoring_Rule.<Name>.md-meta.xml`, five records
- Create: `force-app/main/default/triggers/LeadTrigger.trigger`
- Create: `force-app/main/default/classes/{LeadTriggerHandler,LeadScoringService,LeadScoringServiceTest}.cls` with `-meta.xml`

**Interfaces:**
- Consumes: `/aidlc-construction`.
- Produces:
  - `Lead.Score__c`: Number(3,0).
  - `Operator__c` values, exact: `equals`, `not blank`, `greater than`.
  - Sample rules: `Email` not blank +20; `Phone` not blank +10; `Industry` equals `Technology` +25; `NumberOfEmployees` greater than `100` +30; `Company` not blank +15.
  - `public with sharing class LeadScoringService`
    - `public class RuleResult { @AuraEnabled public String label; @AuraEnabled public Integer points; @AuraEnabled public Boolean matched; @AuraEnabled public Boolean invalid; }`
    - `public static void score(List<Lead> leads)` sets `Score__c` in memory, no DML.
    - `public static List<RuleResult> getBreakdown(Lead lead)`; one entry per active rule; `label` is the rule's `MasterLabel`.
    - `@TestVisible private static List<Lead_Scoring_Rule__mdt> rulesOverride;` when non-null it replaces the metadata query. Tests always set it, because custom metadata cannot be inserted in tests and tests must not depend on the shipped sample rules.
  - `LeadTriggerHandler.beforeSave(List<Lead> newLeads)` called by `LeadTrigger` on `before insert, before update`.
  - Scoring: sum points of matched, valid, active rules; clamp to 0..100. Invalid rule (unknown field, unknown operator, non-numeric value for `greater than`) is skipped with `invalid = true`, `matched = false`. Null field value never matches. `equals` compares case-insensitively as strings.

- [ ] **Step 1:** Run `/aidlc-construction scoring-engine`. It writes `unit-design.md` and `test-plan.md`. Verify the design uses the names in **Interfaces** above; correct the design if not.
- [ ] **Step 2: GATE `design-approval`.** Wait for the human.
- [ ] **Step 3: Write `LeadScoringServiceTest`** with these methods, each setting `rulesOverride` and asserting with `Assert.areEqual`:
  - `equalsOperatorMatches`: rule Industry equals Technology 25; Lead Industry `Technology` → 25.
  - `equalsIsCaseInsensitive`: same rule; Industry `technology` → 25.
  - `notBlankOperatorMatches`: Email not blank 20; with email → 20, without → 0.
  - `greaterThanOperatorMatches`: NumberOfEmployees greater than 100, 30; 101 → 30, 100 → 0.
  - `nullFieldDoesNotMatchGreaterThan`: same rule; NumberOfEmployees null → 0, no exception.
  - `scoreIsCappedAt100`: three matching rules of 50 → 100.
  - `scoreNeverBelowZero`: one matching rule of -40 → 0.
  - `inactiveRulesIgnored`: `Active__c = false` → 0 and absent from breakdown.
  - `noActiveRulesGivesZero`: empty list → 0.
  - `invalidFieldIsSkippedAndFlagged`: field `Nope__c` → score from other rules only; breakdown entry `invalid == true`.
  - `unknownOperatorIsSkippedAndFlagged`: operator `contains` → same.
  - `nonNumericGreaterThanValueIsInvalid`: value `abc` → same.
  - `bulkInsertScores200Leads`: `rulesOverride` set, insert 200 Leads, requery, all `Score__c` equal expected; assert `Limits.getQueries()` inside the service path did not scale (at most 1 rule query).
  - `updateRescoresLead`: insert without email (0), update with email → 20.
- [ ] **Step 4:** Write metadata (field, CMDT type, five records), trigger, handler and service to the signatures above. Field access by name uses `lead.get(fieldName)` guarded by `Schema.SObjectType.Lead.fields.getMap().containsKey(...)`.
- [ ] **Step 5:** Local verification: `npm run lint`; code analyzer on `force-app/main/default/classes` if available, zero high-severity violations; tick the guardrail checklist in `unit-design.md`. Apex tests are not run until Task 7; state that in the unit summary.
- [ ] **Step 6: GATE `unit-approval`.** Wait for the human.
- [ ] **Step 7:** Commit: `feat(demo): lead scoring engine`.

### Task 5: Construction, unit `score-breakdown`

**Files:**
- Create: `aidlc-docs/construction/score-breakdown/{unit-design,test-plan}.md`
- Create: `force-app/main/default/classes/{LeadScoreController,LeadScoreControllerTest}.cls` with `-meta.xml`
- Create: `force-app/main/default/lwc/leadScoreBreakdown/{leadScoreBreakdown.html,leadScoreBreakdown.js,leadScoreBreakdown.js-meta.xml}`
- Test: `force-app/main/default/lwc/leadScoreBreakdown/__tests__/leadScoreBreakdown.test.js`

**Interfaces:**
- Consumes: `LeadScoringService.getBreakdown(Lead)`, `LeadScoringService.RuleResult`, `rulesOverride`.
- Produces:
  - `public with sharing class LeadScoreController`
    - `public class Breakdown { @AuraEnabled public Integer total; @AuraEnabled public List<LeadScoringService.RuleResult> rules; }`
    - `@AuraEnabled(cacheable=true) public static Breakdown getBreakdown(Id leadId)`. Queries the Lead `WITH USER_MODE`, selecting `Score__c` plus every valid field named by active rules (dynamic SOQL with field names validated against the Lead field map). `total` is the clamped sum. Throws `AuraHandledException('Lead not found or not accessible.')` when the Id is not a Lead or no row is returned.
  - LWC `c-lead-score-breakdown`: `@api recordId`; targets `lightning__RecordPage` for object `Lead`. Renders total in an element with `data-id="total"`, one `li[data-id="rule"]` per rule with label and points (matched rules show `+<points>`, unmatched show `0`, invalid show the text `invalid rule`), `[data-id="empty"]` with text `No scoring rules are active.` when rules is empty, `[data-id="error"]` with the error message on failure.

- [ ] **Step 1:** Run `/aidlc-construction score-breakdown`; verify the design against **Interfaces**.
- [ ] **Step 2: GATE `design-approval`.**
- [ ] **Step 3: Write Jest tests** mocking `@salesforce/apex/LeadScoreController.getBreakdown` with `createApexTestWireAdapter` (or a jest mock if called imperatively; pick wire):
  - `renders total and one row per rule`: emit `{ total: 45, rules: [{label:'Has email',points:20,matched:true,invalid:false},{label:'Tech industry',points:25,matched:true,invalid:false},{label:'Big company',points:30,matched:false,invalid:false}] }` → total text `45`, three `li[data-id="rule"]`, third shows `0`.
  - `flags invalid rules`: one rule with `invalid:true` → row contains `invalid rule`.
  - `shows empty state`: `{ total: 0, rules: [] }` → `[data-id="empty"]` present, no rule rows.
  - `shows error state`: adapter `.error({ body: { message: 'Lead not found or not accessible.' } })` → `[data-id="error"]` contains that message.
- [ ] **Step 4:** Run `npm run test:unit`. Expected: FAIL (component missing).
- [ ] **Step 5: Write `LeadScoreControllerTest`**: `returnsBreakdownForLead` (override two rules, insert Lead matching one, assert `total` and `rules.size() == 2`); `throwsForNonLeadId` (pass an Account Id, expect `AuraHandledException`); `throwsForDeletedLead` (insert, delete, call, expect exception).
- [ ] **Step 6:** Implement controller and component.
- [ ] **Step 7:** Run `npm run test:unit` → 4 passing. Run `npm run lint` → clean. Code analyzer if available. Tick the guardrail checklist.
- [ ] **Step 8: GATE `unit-approval`.**
- [ ] **Step 9:** Commit: `feat(demo): lead score breakdown component`.

### Task 6: Construction, unit `access-and-page`

**Files:**
- Create: `aidlc-docs/construction/access-and-page/{unit-design,test-plan}.md`
- Create: `force-app/main/default/permissionsets/Lead_Scoring_User.permissionset-meta.xml`
- Create: `force-app/main/default/flexipages/Lead_Record_Page_Scoring.flexipage-meta.xml`

**Interfaces:**
- Consumes: `Lead.Score__c`, `LeadScoreController`, `c-lead-score-breakdown`.
- Produces: permission set API name `Lead_Scoring_User` (field permission `Lead.Score__c` readable, not editable; class access `LeadScoreController`); FlexiPage `Lead_Record_Page_Scoring` with the component in the right-hand region.

- [ ] **Step 1:** Run `/aidlc-construction access-and-page`; verify design.
- [ ] **Step 2: GATE `design-approval`.**
- [ ] **Step 3:** Write the permission set. For the FlexiPage, hand-written XML is fragile: write it, and if `deploy validate` in Task 7 rejects it, remove the FlexiPage from source and replace it with a manual step in `README.md` ("Edit Lead page in Lightning App Builder, drag Lead Score Breakdown onto the page, activate"). Record which path was taken in `unit-design.md`.
- [ ] **Step 4:** Verify: `sf project convert source --root-dir force-app --output-dir /tmp/mdapi-check` exits 0 (proves the source tree is structurally valid without an org).
- [ ] **Step 5: GATE `unit-approval`.**
- [ ] **Step 6:** Commit: `feat(demo): permission set and Lead page`.

### Task 7: Operations run

**Files:**
- Create: `aidlc-docs/operations/deployment-record.md`
- Modify: `aidlc-docs/state.md`, `aidlc-docs/audit.md`

**Interfaces:**
- Consumes: `/aidlc-operations`; an authorised org alias `aidlc-demo`.

- [ ] **Step 1: Org access (human needed).** The environment must allow `login.salesforce.com` and the org's `*.my.salesforce.com` host. The human authorises with an SFDX auth URL stored outside the repo: on their machine `sf org display --verbose --target-org <their alias>` shows it; here `sf org login sfdx-url --sfdx-url-file <file outside repo> --alias aidlc-demo`. Never commit or echo the URL. Verify: `sf org display --target-org aidlc-demo` shows Connected. **If access cannot be set up:** run the command as far as it goes, write the exact commands into `deployment-record.md` under "To run on your machine", leave `pending_gate: deploy-approval`, and stop; Task 8 then reports Operations as not run.
- [ ] **Step 2:** Run `/aidlc-operations` with alias `aidlc-demo`. It runs `deploy validate` with `RunLocalTests`.
- [ ] **Step 3:** If validation fails: fix the source (failing Apex test, bad metadata), commit `fix(demo): ...`, rerun. If the cause is a kit instruction, fix the kit in its own commit.
- [ ] **Step 4: GATE `deploy-approval`.** Show the validation result. Wait for the human.
- [ ] **Step 5:** The command deploys, runs Apex tests with coverage, assigns `Lead_Scoring_User`. Expected: all tests pass; coverage of `LeadScoringService`, `LeadTriggerHandler`, `LeadScoreController`, `LeadTrigger` each at least 90%.
- [ ] **Step 6:** Manual check via CLI: `sf data create record --sobject Lead --values "LastName='Demo' Company='Acme' Email='demo@example.com' Industry='Technology' NumberOfEmployees=250" --target-org aidlc-demo`, then query `Score__c`. Expected with the sample rules: 20 + 25 + 30 + 15 = 90. Record the value. Ask the human to open the Lead and confirm the breakdown shows.
- [ ] **Step 7:** Verify `deployment-record.md` is complete and `state.md` shows `phase: done`.
- [ ] **Step 8:** Commit: `docs(demo): operations record`.

### Task 8: README wrap-up

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Add a "Demo run" section: the intent, a link to each artifact under `aidlc-docs/`, the gates that were passed (from `audit.md`), test and coverage numbers copied from `deployment-record.md`, kit defects found and fixed during the run (from `git log --grep 'fix(kit)'`), and anything that was not run, stated plainly.
- [ ] **Step 2:** Run `npm run check:kit`, `npm run test:unit`, `npm run lint`. Expected: all pass.
- [ ] **Step 3:** Commit: `docs: record demo run in README`.
