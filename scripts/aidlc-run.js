#!/usr/bin/env node
// AI-DLC runner: drives Inception -> Construction -> Operations with the
// Claude CLI in headless mode. State lives in aidlc-docs/state.md, so the
// runner can be stopped and started again at any point.
//
//   node scripts/aidlc-run.js [--auto | --guided] [--org <alias>] [--model <m>] [--reset] "<intent>"
//
//   --auto    approve every gate automatically (recorded as automatic in the
//             audit log). Without it the runner asks you at each gate.
//   --guided  the person approves only what they can judge: the user stories,
//             the deploy, and the result in the org. Design and unit gates are
//             approved automatically once the runner's own checks pass.
//   --org     Salesforce org alias to deploy to. Without it the run stops
//             after Construction.
//   --reset   discard a previous run's artifacts and generated source first.
//   --model   Claude model for every agent session (or set AIDLC_MODEL), for
//             example "sonnet". Without it the Claude CLI's default is used.
//
// Each agent session's token use is appended to aidlc-docs/usage.md.
//
// The guided UI (npm run aidlc:ui) uses run() from this module with its own
// responder instead of the terminal.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const docs = require('./aidlc-docs');

const DEFAULT_ROOT = process.env.AIDLC_ROOT || path.resolve(__dirname, '..');
const claudeBin = () => process.env.CLAUDE_BIN || 'claude';
const MAX_STEPS = 60;
const MAX_FIX_ROUNDS = 2;
const MAX_ACCEPTANCE_ROUNDS = 3;

const AUTO_APPROVAL =
    'Auto-approved by the runner (--auto). The human chose automatic approval when starting this run.';
const GUIDED_APPROVAL = {
    'design-approval':
        'Auto-approved by the runner (guided mode). Design gates are technical; the built unit must still pass the runner\'s checks before unit approval.',
    'unit-approval':
        'Auto-approved by the runner (guided mode). The runner\'s own checks passed: npm run test:unit and npm run lint.'
};
const INITIAL_STATE = `# AI-DLC state

phase: not-started
unit: -
pending_gate: none
next_step: Run /aidlc-inception with a one-paragraph intent.

## Approved units

<!-- One line per unit whose unit-approval gate has passed, as "- <slug>". -->
`;
const INITIAL_AUDIT = `# AI-DLC audit log

Append-only. Each entry is \`## <ISO timestamp> <event>\` followed by the
human's words, verbatim. Entries marked (auto) were approved by the runner in
automatic mode, not by a person.
`;

const COMMAND_FOR_GATE = {
    'inception-approval': 'aidlc-inception',
    'design-approval': 'aidlc-construction',
    'unit-approval': 'aidlc-construction',
    'deploy-approval': 'aidlc-operations'
};

// Who approves each gate in each mode.
function approvalPolicy(mode) {
    if (mode === 'auto') {
        return { 'inception-approval': 'auto', 'design-approval': 'auto', 'unit-approval': 'auto', 'deploy-approval': 'auto' };
    }
    if (mode === 'guided') {
        return { 'inception-approval': 'human', 'design-approval': 'auto', 'unit-approval': 'auto', 'deploy-approval': 'human' };
    }
    return { 'inception-approval': 'human', 'design-approval': 'human', 'unit-approval': 'human', 'deploy-approval': 'human' };
}

function parseArgs(argv) {
    const opts = { mode: 'human', org: null, reset: false, intent: '', model: process.env.AIDLC_MODEL || null };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--auto') opts.mode = 'auto';
        else if (a === '--guided') opts.mode = 'guided';
        else if (a === '--reset') opts.reset = true;
        else if (a === '--org') opts.org = argv[++i];
        else if (a === '--model') opts.model = argv[++i];
        else if (a === '-h' || a === '--help') opts.help = true;
        else rest.push(a);
    }
    opts.auto = opts.mode === 'auto';
    opts.intent = rest.join(' ').trim();
    return opts;
}

function reset(root) {
    for (const dir of ['inception', 'construction', 'operations']) {
        fs.rmSync(path.join(root, 'aidlc-docs', dir), { recursive: true, force: true });
    }
    const defaultDir = path.join(root, 'force-app', 'main', 'default');
    fs.rmSync(defaultDir, { recursive: true, force: true });
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'aidlc-docs', 'state.md'), INITIAL_STATE);
    fs.writeFileSync(path.join(root, 'aidlc-docs', 'audit.md'), INITIAL_AUDIT);
}

// Starts a new requirement without touching force-app/: the previous run's
// artifacts move to aidlc-docs/archive/<timestamp>/, the audit log is kept and
// gets an entry, and state.md starts again.
function startNewRequirement(root) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archive = path.join(root, 'aidlc-docs', 'archive', stamp);
    let moved = false;
    for (const dir of ['inception', 'construction', 'operations']) {
        const from = path.join(root, 'aidlc-docs', dir);
        if (fs.existsSync(from)) {
            fs.mkdirSync(archive, { recursive: true });
            fs.renameSync(from, path.join(archive, dir));
            moved = true;
        }
    }
    const statePath = path.join(root, 'aidlc-docs', 'state.md');
    if (fs.existsSync(statePath)) {
        fs.mkdirSync(archive, { recursive: true });
        fs.copyFileSync(statePath, path.join(archive, 'state.md'));
        moved = true;
    }
    fs.writeFileSync(statePath, INITIAL_STATE);
    if (!fs.existsSync(path.join(root, 'aidlc-docs', 'audit.md'))) {
        fs.writeFileSync(path.join(root, 'aidlc-docs', 'audit.md'), INITIAL_AUDIT);
    }
    docs.appendAudit(
        root,
        'new-requirement',
        moved
            ? `The previous run's artifacts were archived to aidlc-docs/archive/${stamp}/.`
            : 'Started from an empty project.'
    );
}

// Turns one line of `claude --output-format stream-json` into a short
// readable progress line, or null to skip it.
function describeEvent(line, root) {
    let event;
    try {
        event = JSON.parse(line);
    } catch (e) {
        return line.trim() || null;
    }
    const rel = (p) => (p ? path.relative(root, path.resolve(root, String(p))) : '');
    if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
        const out = [];
        for (const block of event.message.content) {
            if (block.type === 'text' && block.text && block.text.trim()) {
                out.push(block.text.trim());
            } else if (block.type === 'tool_use') {
                const input = block.input || {};
                if (block.name === 'Write') out.push(`Writing ${rel(input.file_path)}`);
                else if (block.name === 'Edit') out.push(`Editing ${rel(input.file_path)}`);
                else if (block.name === 'Read') out.push(`Reading ${rel(input.file_path)}`);
                else if (block.name === 'Bash') out.push(`Running: ${String(input.command || '').split('\n')[0].slice(0, 160)}`);
                else if (block.name === 'Glob' || block.name === 'Grep') out.push(`Searching the project`);
                else out.push(`Using ${block.name}`);
            }
        }
        return out.length ? out.join('\n') : null;
    }
    if (event.type === 'result' && event.is_error) {
        return `The agent reported an error: ${event.result || event.subtype || 'unknown'}`;
    }
    return null;
}

function runClaude(prompt, opts) {
    const system =
        opts.mode === 'auto'
            ? 'This run is in automatic mode, started by the human with --auto. ' +
              'Do not stop to ask questions: choose the simplest reasonable answer, ' +
              'write it on the Answer line of the questions file prefixed ' +
              '"Assumed (auto mode):", and continue. Still stop at every gate ' +
              'exactly as the command says; the runner supplies the approval.'
            : opts.mode === 'guided'
              ? 'This run is in guided mode for a requester who is not a developer. ' +
                'Write questions, user stories and summaries in plain language. When ' +
                'something is unclear, write questions.md and stop: the runner shows ' +
                'the questions to the requester and writes their answers into the file. ' +
                'Stop at every gate exactly as the command says; the runner supplies ' +
                'the approval.'
              : 'This run is driven by the AI-DLC runner. Stop at every gate exactly ' +
                'as the command says; the runner collects the human approval. When ' +
                'something is unclear, write questions.md and stop: the runner asks ' +
                'the human and writes the answers into the file.';
    const args = [
        '-p',
        prompt,
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Read,Write,Edit,Glob,Grep,Bash(npm run:*),Bash(npx:*),Bash(sf:*),Bash(mkdir:*),Bash(ls:*),Bash(date:*),Bash(mktemp:*)',
        '--append-system-prompt',
        system
    ];
    if (opts.model) args.push('--model', opts.model);
    args.push('--output-format', 'stream-json', '--verbose');
    const onOutput = opts.onOutput || ((text) => console.log(text));
    return new Promise((resolve, reject) => {
        const child = spawn(claudeBin(), args, { cwd: opts.root, stdio: ['ignore', 'pipe', 'pipe'] });
        if (opts.onChild) opts.onChild(child);
        let usage = null;
        const out = readline.createInterface({ input: child.stdout });
        out.on('line', (line) => {
            const u = readUsage(line);
            if (u) usage = u;
            const text = describeEvent(line, opts.root);
            if (text) onOutput(text);
        });
        const err = readline.createInterface({ input: child.stderr });
        err.on('line', (line) => line.trim() && onOutput(line));
        child.on('error', reject);
        child.on('close', (status) => {
            if (opts.onChild) opts.onChild(null);
            if (status === 0) resolve(usage);
            else reject(new Error(`claude exited with status ${status}`));
        });
    });
}

// Token use from the final "result" event of a stream-json session.
function readUsage(line) {
    let event;
    try {
        event = JSON.parse(line);
    } catch (e) {
        return null;
    }
    if (!event || event.type !== 'result') return null;
    const u = event.usage || {};
    return {
        turns: event.num_turns || 0,
        input: u.input_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        output: u.output_tokens || 0,
        cost: event.total_cost_usd || 0
    };
}

function formatTokens(n) {
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}

function runCommand(cmd, args, cwd) {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('error', (e) => resolve({ status: 1, out: String(e.message) }));
        child.on('close', (status) => resolve({ status, out }));
    });
}

// Checks the runner performs itself, independent of what the AI reports.
async function localChecks(root) {
    const failures = [];
    for (const script of ['test:unit', 'lint']) {
        const res = await runCommand('npm', ['run', '--silent', script], root);
        if (res.status !== 0) failures.push(`npm run ${script} failed:\n${res.out.slice(-3000)}`);
    }
    return failures;
}

function commandPrompt(command, argument, extra) {
    return (
        `Read .claude/commands/${command}.md and follow it exactly. ` +
        `Treat this as the command's argument: ${argument || '(none)'}\n\n` +
        (extra || '')
    );
}

// --- Terminal responder ----------------------------------------------------

function lineReader(input) {
    const rl = readline.createInterface({ input, terminal: false });
    const lines = [];
    const waiters = [];
    let closed = false;
    rl.on('line', (l) => (waiters.length ? waiters.shift()(l) : lines.push(l)));
    rl.on('close', () => {
        closed = true;
        while (waiters.length) waiters.shift()(null);
    });
    return {
        next() {
            if (lines.length) return Promise.resolve(lines.shift());
            if (closed) return Promise.resolve(null);
            return new Promise((r) => waiters.push(r));
        },
        close: () => rl.close()
    };
}

function terminalResponder() {
    let reader = null;
    const ask = async (question) => {
        process.stdout.write(`${question}\n> `);
        if (!reader) reader = lineReader(process.stdin);
        const line = await reader.next();
        return (line || '').trim();
    };
    const respond = async (request) => {
        if (request.kind === 'gate') {
            log(`Gate pending: ${request.gate}${request.unit !== '-' ? ` for unit ${request.unit}` : ''}. ${request.nextStep}`);
            const words = await ask('Type your approval (for example "approved") or the changes you want:');
            // A bare approval needs no interpretation; anything else goes to the agent verbatim.
            if (/^(approved?|yes|y|ok|okay|lgtm|looks good)[.!]?$/i.test(words)) return { approved: true, words };
            return words;
        }
        if (request.kind === 'questions') {
            log(`Questions in ${request.file}:`);
            const answers = {};
            for (const q of request.questions) {
                const options = q.options.map((o) => `  ${o.letter}. ${o.text}${o.recommended ? ' (recommended)' : ''}`).join('\n');
                answers[q.number] = await ask(`\n${q.number}. ${q.text}\n${options}`);
            }
            return { answers };
        }
        if (request.kind === 'acceptance') {
            const results = [];
            for (const item of request.items) {
                const reply = await ask(`\nCheck in the org: ${item}\nDid it work? Type "yes", or "no: <what you saw>"`);
                const ok = /^y/i.test(reply);
                results.push({ item, ok, note: ok ? '' : reply.replace(/^no:?\s*/i, '') });
            }
            return { results };
        }
        throw new Error(`Unknown request: ${request.kind}`);
    };
    respond.close = () => reader && reader.close();
    return respond;
}

// --- The run loop ----------------------------------------------------------

function log(msg) {
    console.log(`\n\x1b[1m[aidlc]\x1b[0m ${msg}`);
}

function acceptanceResult(root) {
    const text = docs.readIf(path.join(root, 'aidlc-docs', 'operations', 'acceptance.md'));
    const m = text.match(/^Result:\s*(.*)$/m);
    return m ? m[1].trim() : null;
}

function writeAcceptance(root, org, results) {
    const accepted = results.every((r) => r.ok);
    const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const rows = results.map((r) => `| ${cell(r.item)} | ${r.ok ? 'Yes' : 'No'} | ${cell(r.note)} |`).join('\n');
    fs.writeFileSync(
        path.join(root, 'aidlc-docs', 'operations', 'acceptance.md'),
        `# Acceptance\n\nResult: ${accepted ? 'accepted' : 'changes requested'}\n\n` +
            `Checked by the requester in the org \`${org || 'unknown'}\` on ${new Date().toISOString()}.\n\n` +
            `| Check | Worked? | What the requester saw |\n|---|---|---|\n${rows}\n`
    );
    const words = results
        .map((r) => `- ${r.ok ? 'Yes' : 'No'}: ${r.item}${r.note ? ` (${r.note})` : ''}`)
        .join('\n');
    docs.appendAudit(root, `acceptance${accepted ? '' : ' (changes requested)'}`, words);
    return accepted;
}

async function respondToGate(ctx, state) {
    const { opts, root } = ctx;
    const command = COMMAND_FOR_GATE[state.gate];
    const unitNote = state.unit !== '-' ? ` for unit ${state.unit}` : '';
    const argument =
        command === 'aidlc-construction' ? state.unit : command === 'aidlc-operations' ? opts.org : opts.intent;

    if (state.gate === 'unit-approval') {
        ctx.status(`Running the project's own checks${unitNote}`);
        const failures = await localChecks(root);
        if (failures.length) {
            const key = state.unit;
            ctx.fixRounds[key] = (ctx.fixRounds[key] || 0) + 1;
            if (ctx.fixRounds[key] > MAX_FIX_ROUNDS) {
                throw new Error(
                    `Local checks still fail for ${state.unit} after ${MAX_FIX_ROUNDS} fix rounds:\n${failures.join('\n')}`
                );
            }
            ctx.status(`Local checks failed${unitNote}; sending back for fixes (round ${ctx.fixRounds[key]}).`);
            await ctx.claude(
                `fix after failed checks${unitNote}`,
                commandPrompt(
                    command,
                    argument,
                    `The ${state.gate} gate${unitNote} is NOT approved. The runner's own checks failed. ` +
                        `Fix the code (never weaken a test) and return to the gate.\n\n${failures.join('\n\n')}`
                )
            );
            return 'fix';
        }
        ctx.status(`Runner checks passed${unitNote}: npm run test:unit, npm run lint.`);
    }

    const who = ctx.policy[state.gate];
    let words;
    let approved = false; // true only when the approval is certain, not free text
    let comment = '';
    if (who === 'auto') {
        words = opts.mode === 'auto' ? AUTO_APPROVAL : GUIDED_APPROVAL[state.gate];
        approved = true;
        ctx.status(`Approved automatically: ${state.gate}${unitNote}.`);
    } else {
        const reply = await ctx.respond({ kind: 'gate', gate: state.gate, unit: state.unit, nextStep: state.nextStep });
        if (reply && typeof reply === 'object') {
            words = reply.words;
            approved = reply.approved === true;
            comment = String(reply.comment || '').trim();
        } else {
            words = reply;
        }
        if (!words) throw new Error('No response at the gate; stopping. Run again to resume.');
    }
    const auto = who === 'auto';
    const event = `${state.gate}${unitNote ? ' ' + state.unit : ''}${auto ? ' (auto)' : ''}`;

    // A plain approval of a gate whose "On approval" steps are only
    // bookkeeping is recorded by the runner: no agent session needed.
    if (approved && !comment && (state.gate === 'inception-approval' || state.gate === 'unit-approval')) {
        docs.appendAudit(root, event, words);
        if (state.gate === 'inception-approval') {
            const first = docs.readUnits(root)[0];
            docs.updateState(root, {
                phase: 'construction',
                unit: '-',
                pending_gate: 'none',
                next_step: first ? `Run /aidlc-construction ${first}.` : 'Run /aidlc-construction <first unit slug>.'
            });
        } else {
            const approvedUnits = [...docs.readState(root).approved, state.unit];
            const next = docs.readUnits(root).find((u) => !approvedUnits.includes(u));
            docs.updateState(
                root,
                { unit: '-', pending_gate: 'none', next_step: next ? `Run /aidlc-construction ${next}.` : 'Run /aidlc-operations.' },
                state.unit
            );
        }
        ctx.status(`Recorded ${event} in the audit log.`);
        return 'continue';
    }

    ctx.status(auto ? `Continuing after ${state.gate}${unitNote}.` : `Passing your response to the agent (${state.gate}).`);
    await ctx.claude(
        `${state.gate}${unitNote}`,
        commandPrompt(
            command,
            argument,
            `The ${state.gate} gate${unitNote} is pending. The response to it, verbatim:\n"${words}"\n\n` +
                (auto
                    ? `This is an automatic approval. Record it in aidlc-docs/audit.md with the event name "${event}" and these words. `
                    : approved
                      ? 'This is an approval. Record it in aidlc-docs/audit.md with these exact words, and take the comment in it into account. '
                      : 'If it is an approval, record it in aidlc-docs/audit.md with these exact words. If it asks for changes, make them and return to the gate. ') +
                'After an approval, do the "On approval" steps of the command and keep going until the next gate.'
        )
    );
    return 'continue';
}

// When the design gate is approved automatically, the agent designs and
// builds a unit in one session instead of stopping and starting again.
function designAndBuildNote(ctx, unit) {
    if (ctx.policy['design-approval'] !== 'auto') return '';
    const words = ctx.opts.mode === 'auto' ? AUTO_APPROVAL : GUIDED_APPROVAL['design-approval'];
    return (
        'In this run the design-approval gate is approved automatically, so do not stop there. ' +
        'After writing the unit design and test plan, append to aidlc-docs/audit.md the event ' +
        `"design-approval ${unit} (auto)" with these words:\n"${words}"\n` +
        'Then do the "On design approval" steps in the same session and stop at the unit-approval gate. ' +
        'Questions that need the human still stop the work as the command says.'
    );
}

async function step(ctx) {
    const { opts, root } = ctx;
    const state = docs.readState(root);

    if (state.phase === 'done') {
        if (!ctx.acceptance) return 'done';
        const result = acceptanceResult(root);
        if (result === 'accepted') return 'done';
        ctx.acceptanceRounds += 1;
        if (ctx.acceptanceRounds > MAX_ACCEPTANCE_ROUNDS) {
            throw new Error('The result was not accepted after several fix rounds. A developer should take a look.');
        }
        const items = docs.readChecklist(root);
        const reply = await ctx.respond({
            kind: 'acceptance',
            items: items.length ? items : ['Open the org and check that the feature works as you asked.']
        });
        if (!reply || !Array.isArray(reply.results)) throw new Error('No response to the checks; stopping. Run again to resume.');
        if (writeAcceptance(root, opts.org, reply.results)) {
            ctx.status('Accepted. The feature is done.');
            return 'done';
        }
        const failed = reply.results.filter((r) => !r.ok);
        ctx.status('Sending what did not work back to the agent.');
        await ctx.claude(
            'fix after acceptance',
            commandPrompt(
                'aidlc-fix',
                opts.org,
                'The requester checked the deployed feature in the org. These checks did not work:\n' +
                    failed.map((r) => `- ${r.item}\n  What they saw: ${r.note || '(no note)'}`).join('\n')
            )
        );
        return 'continue';
    }

    if (state.gate !== 'none') {
        if (!COMMAND_FOR_GATE[state.gate]) throw new Error(`Unknown pending_gate in state.md: ${state.gate}`);
        if (state.gate === 'deploy-approval' && !opts.org) {
            ctx.status('Deploy approval is pending. Run again with --org <alias> to continue.');
            return 'stopped';
        }
        return respondToGate(ctx, state);
    }

    // Open questions are answered before any more work, except in --auto
    // mode where the agent answers them itself.
    if (opts.mode !== 'auto') {
        const pending = docs.pendingQuestions(root);
        if (pending.length) {
            for (const group of pending) {
                const reply = await ctx.respond({ kind: 'questions', file: group.file, questions: group.questions });
                const answers = (reply && reply.answers) || {};
                const missing = group.questions.filter((q) => !String(answers[q.number] || '').trim());
                if (missing.length) {
                    throw new Error(`No answer to question ${missing.map((q) => q.number).join(', ')}; stopping. Run again to resume.`);
                }
                docs.writeAnswers(root, group.file, answers);
                docs.appendAudit(
                    root,
                    `answers ${group.file}`,
                    group.questions.map((q) => `${q.number}. ${String(answers[q.number]).trim()}`).join('\n')
                );
            }
            ctx.status('Answers saved. The agent continues.');
            return 'answered';
        }
    }

    if (state.phase === 'not-started' || state.phase === 'inception') {
        if (!opts.intent && state.phase === 'not-started') {
            throw new Error('An intent is required to start. Pass it as the last argument.');
        }
        ctx.status('Inception: turning the requirement into user stories and units of work.');
        await ctx.claude('inception', commandPrompt('aidlc-inception', opts.intent || '(continue the intent in aidlc-docs/inception/intent.md)'));
        return 'continue';
    }

    if (state.phase === 'construction') {
        const units = docs.readUnits(root);
        if (!units.length) throw new Error('No units found in aidlc-docs/inception/units-of-work.md.');
        const next = units.find((u) => !state.approved.includes(u));
        if (next) {
            ctx.status(`Construction: designing and building "${next}" (unit ${units.indexOf(next) + 1} of ${units.length}).`);
            await ctx.claude(`construction ${next}`, commandPrompt('aidlc-construction', next, designAndBuildNote(ctx, next)));
            return 'continue';
        }
        if (!opts.org) {
            ctx.status('All units are built and approved. Run again with --org <alias> to deploy.');
            return 'stopped';
        }
        ctx.status(`Operations: checking the deployment against org "${opts.org}".`);
        await ctx.claude('operations: validate', commandPrompt('aidlc-operations', opts.org));
        return 'continue';
    }

    if (state.phase === 'operations') {
        if (!opts.org) {
            ctx.status('Operations is in progress. Run again with --org <alias> to continue.');
            return 'stopped';
        }
        ctx.status(`Operations: continuing against org "${opts.org}".`);
        await ctx.claude('operations', commandPrompt('aidlc-operations', opts.org));
        return 'continue';
    }

    throw new Error(`Unknown phase in state.md: ${state.phase}`);
}

// Runs the loop until the work is done, stopped, or fails.
//   opts.root      project root (default: this repository)
//   opts.mode      'human' | 'guided' | 'auto'
//   opts.respond   async (request) => reply, for gates, questions, acceptance
//   opts.onStatus  (text) => void, for the runner's own progress lines
//   opts.onOutput  (text) => void, for the agent's progress (stream-json)
//   opts.onChild   (child | null) => void, to allow cancelling
//   opts.onUsage   (totals) => void, after each agent session
//   opts.model     Claude model for every agent session
// Resolves to 'done' or 'stopped'.
async function run(options) {
    const opts = { mode: 'human', intent: '', org: null, ...options };
    opts.auto = opts.mode === 'auto';
    const root = opts.root || DEFAULT_ROOT;
    const ctx = {
        opts,
        root,
        policy: approvalPolicy(opts.mode),
        acceptance: opts.mode === 'guided' && Boolean(opts.org),
        acceptanceRounds: 0,
        fixRounds: {},
        respond: opts.respond,
        status: opts.onStatus || log,
        usage: { sessions: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 },
        claude: async (label, prompt) => {
            const u = await runClaude(prompt, { ...opts, root });
            ctx.usage.sessions += 1;
            if (u) {
                for (const k of ['input', 'cacheWrite', 'cacheRead', 'output', 'cost']) ctx.usage[k] += u[k];
                docs.appendUsage(root, label, u);
                const fresh = u.input + u.cacheWrite;
                ctx.status(
                    `Agent session "${label}": ${u.turns} turns, ${formatTokens(fresh)} new input tokens, ` +
                        `${formatTokens(u.cacheRead)} re-used from cache, ${formatTokens(u.output)} output` +
                        (u.cost ? ` (about $${u.cost.toFixed(2)} at API prices).` : '.')
                );
            }
            if (opts.onUsage) opts.onUsage({ ...ctx.usage });
        }
    };
    if (opts.reset) {
        ctx.status('Resetting artifacts and generated source.');
        reset(root);
    }
    let stalls = 0;
    for (let i = 0; i < MAX_STEPS; i++) {
        if (opts.signal && opts.signal.aborted) throw new Error('Stopped.');
        const before = JSON.stringify(docs.readState(root));
        const result = await step(ctx);
        if (result === 'done' || result === 'stopped') {
            const u = ctx.usage;
            if (u.sessions) {
                ctx.status(
                    `This run used ${u.sessions} agent session(s): ${formatTokens(u.input + u.cacheWrite)} new input tokens, ` +
                        `${formatTokens(u.cacheRead)} re-used from cache, ${formatTokens(u.output)} output` +
                        (u.cost ? `, about $${u.cost.toFixed(2)} at API prices` : '') +
                        '. Per-session detail: aidlc-docs/usage.md.'
                );
            }
            if (result === 'done') ctx.status('Complete. See aidlc-docs/operations/deployment-record.md.');
            return result;
        }
        // A fix round or saved answers legitimately leave state unchanged.
        if (result === 'fix' || result === 'answered') continue;
        const after = JSON.stringify(docs.readState(root));
        const waitingOnQuestions = opts.mode !== 'auto' && docs.pendingQuestions(root).length > 0;
        stalls = before === after && !waitingOnQuestions ? stalls + 1 : 0;
        if (stalls >= 2) {
            throw new Error(
                `No progress after two steps (state: ${after}). See aidlc-docs/state.md and any questions.md file.`
            );
        }
    }
    throw new Error(`Stopped after ${MAX_STEPS} steps without finishing.`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log('Usage: node scripts/aidlc-run.js [--auto | --guided] [--org <alias>] [--model <model>] [--reset] "<intent>"');
        return 0;
    }
    const respond = terminalResponder();
    try {
        await run({ ...opts, respond });
    } finally {
        respond.close();
    }
    return 0;
}

if (require.main === module) {
    main().then(
        (code) => process.exit(code),
        (e) => {
            console.error(`\n[aidlc] FAILED: ${e.message}`);
            process.exit(1);
        }
    );
}

module.exports = {
    parseArgs,
    approvalPolicy,
    describeEvent,
    run,
    reset,
    startNewRequirement,
    readState: (root) => docs.readState(root || DEFAULT_ROOT),
    readUnits: (root) => docs.readUnits(root || DEFAULT_ROOT)
};
