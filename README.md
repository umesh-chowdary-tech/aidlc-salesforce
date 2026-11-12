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

## Guided mode: build from the browser, no terminal

For someone who is not a developer. They describe what they need, answer the
agent's questions, approve the plan, and check the result in Salesforce, all
on one page in the browser.

```bash
npm run aidlc:ui
```

A page opens at `http://127.0.0.1:4545`. It walks through six steps:

| Step | What the person does |
|---|---|
| Connect | Picks a sandbox or Developer Edition org and logs in on the normal Salesforce page. Production orgs are refused. |
| Describe | Types the requirement in their own words. |
| Agree the plan | Answers any questions (multiple choice, recommended answer pre-selected), then reads the user stories and clicks **Approve the plan** or **Ask for changes**. |
| Build | Waits. The agent designs, builds and tests each part; the runner checks the tests and lint itself and approves the technical gates automatically. |
| Install | Reads a plain summary of the trial installation and clicks **Install it**. |
| Check it | Opens Salesforce from the page, tries each check, and clicks **It worked** or **It did not work** with what they saw. Anything that did not work goes back to the agent, which fixes it, reinstalls, and asks again. |

Every answer, approval and check result goes into `aidlc-docs/audit.md`, and
the technical approvals are marked `(auto)`. A developer should still review
the code before it goes to a production org: the person can confirm the
feature behaves as asked, not that the code is sound.

### One-time setup (for a technical person)

On the computer that will run it (macOS or Linux; on Windows use WSL):

1. Install Node.js 20 or later.
2. Install the Claude CLI and log in once: `claude` in a terminal.
3. Install the Salesforce CLI: `npm install --global @salesforce/cli`.
4. Clone this repository and run `npm install` in it.

After that, the person only runs `npm run aidlc:ui` (or a desktop shortcut to
it). To allow production orgs, which is not recommended, start it with
`AIDLC_ALLOW_PRODUCTION=1`.

The page is served on `127.0.0.1` only and every request needs a token that
is embedded in the page, so other web sites cannot use it.

## Token use

Each step of a run is a separate Claude session, and each session reads the
kit's rules, the current documents and the relevant source before it works.
That reading is most of the tokens. To keep it down, the runner:

- records plain approvals itself (the user stories, each built unit) instead
  of starting a session to write one line in the audit log;
- has the agent design and build a unit in one session when the design gate
  is approved automatically (`--auto` and the guided page);
- logs every session to `aidlc-docs/usage.md` (turns, new input, cache
  writes, cache reads, output, cost at API prices), shows a running total on
  the guided page, and prints a summary at the end in the terminal.

A three-unit feature takes about five sessions in guided or automatic mode:
one for Inception, one per unit, and two for Operations. Fix rounds and
change requests add one each. "Cache read" tokens are context re-used from
the previous turn and cost far less than new input.

To use a cheaper model for every session, pass `--model` or set
`AIDLC_MODEL`, for example:

```bash
AIDLC_MODEL=sonnet npm run aidlc:ui
```

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
| `--model <model>` | Claude model for every session, for example `sonnet`. Same as setting `AIDLC_MODEL`. |

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
2. Add the Lead Score Breakdown component to the Lead record page:
   1. Open any Lead, click the gear icon, then **Edit Page**.
   2. In Lightning App Builder, find **Lead Score Breakdown** under Custom
      components and drag it onto the page (the right-hand column works well).
   3. Click **Save**. If the page is not yet active, click **Activation** and
      assign it as the org default (or to the apps and profiles you want).

## What is in the kit

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Core rules: phases, gates, questions, honest reporting |
| `.claude/commands/` | The three phase commands, plus `aidlc-fix` for problems found when checking the result |
| `aidlc/salesforce-rules.md` | Nine Salesforce guardrails every design and class must follow |
| `aidlc/templates/` | Templates for each artifact |
| `scripts/aidlc-run.js` | The runner behind `npm run aidlc` (`--auto`, `--guided`, or a gate-by-gate default) |
| `scripts/aidlc-ui/` | The guided browser page behind `npm run aidlc:ui` |
| `scripts/aidlc-docs.js` | Reads and writes state, questions, the checklist and the audit log |
| `scripts/check-kit.js` | Structural check of the kit: `npm run check:kit` |
| `scripts/test-runner.js` | Runner control-flow tests with a fake CLI: `npm run test:runner` |
| `scripts/test-ui.js` | Browser walk-through of the guided page with fake Claude and Salesforce CLIs: `npm run test:ui` |

## Using the kit in another project

Copy `CLAUDE.md`, `.claude/commands/`, `aidlc/` and `scripts/` (except the
`test-*.js` files if you do not want them) into an SFDX project, add the
`aidlc` and `aidlc:ui` scripts and the `marked` dependency to its
`package.json`, and
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

```bash
npm run test:runner && npm run test:ui
```
