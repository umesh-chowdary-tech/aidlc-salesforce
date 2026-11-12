#!/usr/bin/env node
// AI-DLC runner: drives Inception -> Construction -> Operations with the
// Claude CLI in headless mode. State lives in aidlc-docs/state.md, so the
// runner can be stopped and started again at any point.
//
//   node scripts/aidlc-run.js [--auto] [--org <alias>] [--reset] "<intent>"
//
//   --auto   approve every gate automatically (recorded as automatic in the
//            audit log). Without it the runner asks you at each gate.
//   --org    Salesforce org alias to deploy to. Without it the run stops
//            after Construction.
//   --reset  discard a previous run's artifacts and generated source first.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.env.AIDLC_ROOT || path.resolve(__dirname, '..');
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const MAX_STEPS = 40;
const MAX_FIX_ROUNDS = 2;

const AUTO_APPROVAL =
    'Auto-approved by the runner (--auto). The human chose automatic approval when starting this run.';
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

function parseArgs(argv) {
    const opts = { auto: false, org: null, reset: false, intent: '' };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--auto') opts.auto = true;
        else if (a === '--reset') opts.reset = true;
        else if (a === '--org') opts.org = argv[++i];
        else if (a === '-h' || a === '--help') opts.help = true;
        else rest.push(a);
    }
    opts.intent = rest.join(' ').trim();
    return opts;
}

const p = (...parts) => path.join(root, ...parts);
const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

function readState() {
    const text = readIf(p('aidlc-docs', 'state.md'));
    const get = (key) => {
        const m = text.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
        return m ? m[1].trim() : '';
    };
    const approvedBlock = text.split(/^## Approved units\s*$/m)[1] || '';
    const approved = (approvedBlock.match(/^- +(\S+)/gm) || []).map((l) =>
        l.replace(/^- +/, '').trim()
    );
    return {
        phase: get('phase') || 'not-started',
        unit: get('unit') || '-',
        gate: get('pending_gate') || 'none',
        nextStep: get('next_step'),
        approved
    };
}

function readUnits() {
    const text = readIf(p('aidlc-docs', 'inception', 'units-of-work.md'));
    return (text.match(/^## +\d+\.\s+(\S+)/gm) || []).map((l) =>
        l.replace(/^## +\d+\.\s+/, '').trim()
    );
}

function reset() {
    for (const dir of ['inception', 'construction', 'operations']) {
        fs.rmSync(p('aidlc-docs', dir), { recursive: true, force: true });
    }
    const defaultDir = p('force-app', 'main', 'default');
    fs.rmSync(defaultDir, { recursive: true, force: true });
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(p('aidlc-docs', 'state.md'), INITIAL_STATE);
    fs.writeFileSync(p('aidlc-docs', 'audit.md'), INITIAL_AUDIT);
}

function log(msg) {
    console.log(`\n\x1b[1m[aidlc]\x1b[0m ${msg}`);
}

function claude(prompt, opts) {
    const system = opts.auto
        ? 'This run is in automatic mode, started by the human with --auto. ' +
          'Do not stop to ask questions: choose the simplest reasonable answer, ' +
          'write it on the Answer line of the questions file prefixed ' +
          '"Assumed (auto mode):", and continue. Still stop at every gate ' +
          'exactly as the command says; the runner supplies the approval.'
        : 'This run is driven by the AI-DLC runner. Stop at every gate exactly ' +
          'as the command says; the runner collects the human approval.';
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
    const res = spawnSync(CLAUDE, args, { cwd: root, stdio: 'inherit' });
    if (res.error) throw res.error;
    if (res.status !== 0) {
        throw new Error(`claude exited with status ${res.status}`);
    }
}

function ask(question) {
    process.stdout.write(`${question}\n> `);
    const buf = Buffer.alloc(4096);
    let n = 0;
    try {
        n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
        n = 0;
    }
    return buf.toString('utf8', 0, n).trim();
}

// Checks the runner performs itself, independent of what the AI reports.
function localChecks() {
    const failures = [];
    for (const script of ['test:unit', 'lint']) {
        const res = spawnSync('npm', ['run', '--silent', script], {
            cwd: root,
            encoding: 'utf8'
        });
        if (res.status !== 0) {
            const out = `${res.stdout || ''}${res.stderr || ''}`;
            failures.push(`npm run ${script} failed:\n${out.slice(-3000)}`);
        }
    }
    return failures;
}

const COMMAND_FOR_GATE = {
    'inception-approval': 'aidlc-inception',
    'design-approval': 'aidlc-construction',
    'unit-approval': 'aidlc-construction',
    'deploy-approval': 'aidlc-operations'
};

function commandPrompt(command, argument, extra) {
    return (
        `Read .claude/commands/${command}.md and follow it exactly. ` +
        `Treat this as the command's argument: ${argument || '(none)'}\n\n` +
        (extra || '')
    );
}

function respondToGate(state, opts, fixRounds) {
    const command = COMMAND_FOR_GATE[state.gate];
    const unitNote = state.unit !== '-' ? ` for unit ${state.unit}` : '';
    const argument =
        command === 'aidlc-construction'
            ? state.unit
            : command === 'aidlc-operations'
              ? opts.org
              : opts.intent;

    if (state.gate === 'unit-approval') {
        const failures = localChecks();
        if (failures.length) {
            const key = state.unit;
            fixRounds[key] = (fixRounds[key] || 0) + 1;
            if (fixRounds[key] > MAX_FIX_ROUNDS) {
                throw new Error(
                    `Local checks still fail for ${state.unit} after ${MAX_FIX_ROUNDS} fix rounds:\n${failures.join('\n')}`
                );
            }
            log(`Local checks failed${unitNote}; sending back for fixes (round ${fixRounds[key]}).`);
            claude(
                commandPrompt(
                    command,
                    argument,
                    `The ${state.gate} gate${unitNote} is NOT approved. The runner's own checks failed. ` +
                        `Fix the code (never weaken a test) and return to the gate.\n\n${failures.join('\n\n')}`
                ),
                opts
            );
            return 'fix';
        }
        log(`Runner checks passed${unitNote}: npm run test:unit, npm run lint.`);
    }

    let words;
    let auto = false;
    if (opts.auto) {
        words = AUTO_APPROVAL;
        auto = true;
    } else {
        log(`Gate pending: ${state.gate}${unitNote}. ${state.nextStep}`);
        words = ask('Type your approval (for example "approved") or the changes you want:');
        if (!words) throw new Error('No response at the gate; stopping. Run again to resume.');
    }
    claude(
        commandPrompt(
            command,
            argument,
            `The ${state.gate} gate${unitNote} is pending. The response to it, verbatim:\n"${words}"\n\n` +
                (auto
                    ? `This is an automatic approval. Record it in aidlc-docs/audit.md with the event name "${state.gate}${unitNote ? ' ' + state.unit : ''} (auto)" and these words. `
                    : 'If it is an approval, record it in aidlc-docs/audit.md with these exact words. If it asks for changes, make them and return to the gate. ') +
                'After an approval, do the "On approval" steps of the command and keep going until the next gate.'
        ),
        opts
    );
}

function step(opts, fixRounds) {
    const state = readState();
    if (state.phase === 'done') return 'done';

    if (state.gate !== 'none') {
        if (!COMMAND_FOR_GATE[state.gate]) {
            throw new Error(`Unknown pending_gate in state.md: ${state.gate}`);
        }
        if (state.gate === 'deploy-approval' && !opts.org) {
            log('Deploy approval is pending. Run again with --org <alias> to continue.');
            return 'stopped';
        }
        return respondToGate(state, opts, fixRounds) || 'continue';
    }

    if (state.phase === 'not-started' || state.phase === 'inception') {
        if (!opts.intent) throw new Error('An intent is required to start. Pass it as the last argument.');
        log('Inception: turning the intent into stories and units of work.');
        claude(commandPrompt('aidlc-inception', opts.intent), opts);
        return 'continue';
    }

    if (state.phase === 'construction') {
        const units = readUnits();
        if (!units.length) throw new Error('No units found in aidlc-docs/inception/units-of-work.md.');
        const next = units.find((u) => !state.approved.includes(u));
        if (next) {
            log(`Construction: designing and building unit "${next}".`);
            claude(commandPrompt('aidlc-construction', next), opts);
            return 'continue';
        }
        if (!opts.org) {
            log('All units are built and approved. Run again with --org <alias> to deploy.');
            return 'stopped';
        }
        log(`Operations: validating against org "${opts.org}".`);
        claude(commandPrompt('aidlc-operations', opts.org), opts);
        return 'continue';
    }

    if (state.phase === 'operations') {
        if (!opts.org) {
            log('Operations is in progress. Run again with --org <alias> to continue.');
            return 'stopped';
        }
        log(`Operations: continuing against org "${opts.org}".`);
        claude(commandPrompt('aidlc-operations', opts.org), opts);
        return 'continue';
    }

    throw new Error(`Unknown phase in state.md: ${state.phase}`);
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(
            'Usage: node scripts/aidlc-run.js [--auto] [--org <alias>] [--reset] "<intent>"'
        );
        return 0;
    }
    if (opts.reset) {
        log('Resetting artifacts and generated source.');
        reset();
    }
    const fixRounds = {};
    let stalls = 0;
    for (let i = 0; i < MAX_STEPS; i++) {
        const before = JSON.stringify(readState());
        const result = step(opts, fixRounds);
        if (result === 'done') {
            log('Complete. See aidlc-docs/operations/deployment-record.md.');
            return 0;
        }
        if (result === 'stopped') return 0;
        const after = JSON.stringify(readState());
        // A fix round legitimately leaves state unchanged; it has its own cap.
        if (result === 'fix') continue;
        stalls = before === after ? stalls + 1 : 0;
        if (stalls >= 2) {
            throw new Error(
                `No progress after two steps (state: ${after}). See aidlc-docs/state.md and any questions.md file.`
            );
        }
    }
    throw new Error(`Stopped after ${MAX_STEPS} steps without finishing.`);
}

if (require.main === module) {
    try {
        process.exit(main());
    } catch (e) {
        console.error(`\n[aidlc] FAILED: ${e.message}`);
        process.exit(1);
    }
}

module.exports = { parseArgs, readState, readUnits };
