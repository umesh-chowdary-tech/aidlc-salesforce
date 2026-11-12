# AI-DLC for Salesforce

A small kit for running Salesforce development through AI-DLC (AI-Driven
Development Life Cycle) with Claude Code, plus a lead-scoring demo built with
it.

AI-DLC splits work into three phases: Inception (what to build), Construction
(design and build it, one unit at a time) and Operations (deploy and verify).
The AI drafts every artifact; a human approves at each gate before work
continues. Every artifact and approval is kept in the repository, so there is
a written trail from the original intent to the deployed feature.

## Prerequisites

- [Claude Code](https://claude.com/claude-code)
- Node.js 20 or later, then `npm install`
- Salesforce CLI: `npm install --global @salesforce/cli`
- Optional: `sf plugins install code-analyzer` (needs Java 11 or later)
- For Operations: a Salesforce org you are allowed to deploy to, authorised
  in the CLI (`sf org login web --alias my-org`)

## Quick start: one command

Authorise an org once, then give the runner an intent:

```bash
sf org login web --alias my-org
```

```bash
npm run aidlc -- --auto --org my-org "Score each Lead from 0 to 100 using configurable rules, and show sales reps why a Lead has its score."
```

The runner calls the Claude CLI for each phase: it writes the stories and
units, designs and builds each unit with tests, runs the Jest tests and lint
itself, then validates, deploys and runs the Apex tests in the org. Every
artifact lands in `aidlc-docs/`.

| Option | Effect |
|---|---|
| `--auto` | Approve every gate automatically. The audit log marks these `(auto)`. Leave it out and the runner asks you at each gate. |
| `--org <alias>` | Deploy to this org. Leave it out and the run stops after Construction; run again with `--org` to deploy. |
| `--reset` | Delete the previous run's artifacts and everything under `force-app/main/default` first. |

The run can be stopped at any time. Run the command again and it resumes
from `aidlc-docs/state.md`.

## Step by step in Claude Code

You can also run the phases yourself inside Claude Code.

| Step | Command | You approve |
|---|---|---|
| 1 | `/aidlc-inception <one-paragraph intent>` | User stories and units of work |
| 2 | `/aidlc-construction <unit-slug>`, once per unit | The unit design, then the built unit |
| 3 | `/aidlc-operations <org alias>` | The deployment, after a validation run |

At each gate Claude stops and tells you which files to review. Reply with
your approval or the changes you want.

## Lead scoring demo: setup after deployment

These steps cannot be deployed from source. Do them once in each org after
the deployment.

1. Assign the `Lead_Scoring_User` permission set to each sales rep. Without
   it a rep cannot see the Score field on a Lead. Either:
   - in Setup, go to Users > Permission Sets > Lead Scoring User > Manage
     Assignments and add the users; or
   - run `sf org assign permset --name Lead_Scoring_User --target-org my-org`
     (add `--on-behalf-of <username>` to assign it to someone else).

## What is in the kit

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Core rules: phases, gates, questions, honest reporting |
| `.claude/commands/` | The three phase commands |
| `aidlc/salesforce-rules.md` | Nine Salesforce guardrails every design and class must follow |
| `aidlc/templates/` | Templates for each artifact |
| `scripts/aidlc-run.js` | The runner behind `npm run aidlc` |
| `scripts/check-kit.js` | Structural check of the kit: `npm run check:kit` |
| `scripts/test-runner.js` | Runner control-flow tests with a fake CLI: `npm run test:runner` |

## Using the kit in another project

Copy `CLAUDE.md`, `.claude/commands/`, `aidlc/` and `scripts/aidlc-run.js` into an SFDX project, and
create `aidlc-docs/state.md` and `aidlc-docs/audit.md` from the copies here
(reset `state.md` to `phase: not-started`). `aidlc-docs/` and `force-app/`
belong to each project.

## Local checks

```bash
npm run check:kit
```

```bash
npm run test:unit
```

```bash
npm run lint
```
