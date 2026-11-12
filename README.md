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

## Using the kit

Open the project in Claude Code and run the phases in order.

| Step | Command | You approve |
|---|---|---|
| 1 | `/aidlc-inception <one-paragraph intent>` | User stories and units of work |
| 2 | `/aidlc-construction <unit-slug>`, once per unit | The unit design, then the built unit |
| 3 | `/aidlc-operations <org alias>` | The deployment, after a validation run |

At each gate Claude stops and tells you which files to review. Reply with
your approval or the changes you want. If Claude needs information it writes
questions to a `questions.md` file; answer them in the file.

`aidlc-docs/state.md` always shows the current phase, the pending gate and
the next step, so you can stop and resume in a later session.

## What is in the kit

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Core rules: phases, gates, questions, honest reporting |
| `.claude/commands/` | The three phase commands |
| `aidlc/salesforce-rules.md` | Nine Salesforce guardrails every design and class must follow |
| `aidlc/templates/` | Templates for each artifact |
| `scripts/check-kit.js` | Structural check of the kit: `npm run check:kit` |

## Using the kit in another project

Copy `CLAUDE.md`, `.claude/commands/` and `aidlc/` into an SFDX project, and
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
