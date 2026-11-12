#!/usr/bin/env node
// Tests the runner's control flow against a fake Claude CLI that only moves
// aidlc-docs/state.md the way the real commands would. No AI, no org.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const runner = path.resolve(__dirname, 'aidlc-run.js');

// The fake CLI: reads the prompt, applies the matching state transition,
// and logs each call to calls.log.
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const prompt = process.argv[process.argv.indexOf('-p') + 1];
const stateFile = path.join(root, 'aidlc-docs/state.md');
let s = fs.readFileSync(stateFile, 'utf8');
const set = (k, v) => { s = s.replace(new RegExp('^' + k + ':.*$', 'm'), k + ': ' + v); };
const get = (k) => s.match(new RegExp('^' + k + ':\\\\s*(.*)$', 'm'))[1].trim();
const cmd = prompt.match(/commands\\/(aidlc-[a-z]+)\\.md/)[1];
const arg = prompt.match(/argument: (.*)/)[1].trim();
const gate = get('pending_gate');
const approved = /gate.*is pending\\. The response/.test(prompt);
const rejected = /is NOT approved/.test(prompt);
fs.appendFileSync(path.join(root, 'calls.log'),
  cmd + '|' + arg + '|' + gate + '|' + (approved ? 'approve' : rejected ? 'reject' : 'run') +
  '|' + (/\\(auto\\)/.test(prompt) ? 'auto' : 'human') + '\\n');
if (process.env.FAKE_STUCK) process.exit(0);
if (rejected) {
  fs.writeFileSync(path.join(root, 'checks-ok'), '1');
} else if (cmd === 'aidlc-inception' && !approved) {
  fs.mkdirSync(path.join(root, 'aidlc-docs/inception'), { recursive: true });
  fs.writeFileSync(path.join(root, 'aidlc-docs/inception/units-of-work.md'),
    '# Units\\n\\n## 1. unit-a\\n\\n- x\\n\\n## 2. unit-b\\n\\n- y\\n');
  set('phase', 'inception'); set('pending_gate', 'inception-approval');
} else if (cmd === 'aidlc-inception') {
  set('phase', 'construction'); set('pending_gate', 'none');
} else if (cmd === 'aidlc-construction' && !approved) {
  set('unit', arg); set('pending_gate', 'design-approval');
} else if (cmd === 'aidlc-construction' && gate === 'design-approval') {
  set('pending_gate', 'unit-approval');
} else if (cmd === 'aidlc-construction' && gate === 'unit-approval') {
  s = s.trimEnd() + '\\n- ' + get('unit') + '\\n';
  set('unit', '-'); set('pending_gate', 'none');
} else if (cmd === 'aidlc-operations' && !approved) {
  set('phase', 'operations'); set('pending_gate', 'deploy-approval');
} else if (cmd === 'aidlc-operations') {
  set('phase', 'done'); set('pending_gate', 'none');
}
fs.writeFileSync(stateFile, s);
`;

function makeProject({ failChecksOnce = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-runner-'));
    fs.mkdirSync(path.join(dir, 'aidlc-docs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'force-app/main/default'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'aidlc-docs/state.md'),
        '# AI-DLC state\n\nphase: not-started\nunit: -\npending_gate: none\nnext_step: start\n\n## Approved units\n\n'
    );
    fs.writeFileSync(path.join(dir, 'aidlc-docs/audit.md'), '# audit\n');
    const check = failChecksOnce
        ? `node -e "process.exit(require('fs').existsSync('checks-ok')?0:1)"`
        : 'node -e "process.exit(0)"';
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ scripts: { 'test:unit': check, lint: 'node -e "process.exit(0)"' } })
    );
    const fake = path.join(dir, 'fake-claude.js');
    fs.writeFileSync(fake, FAKE, { mode: 0o755 });
    return { dir, fake };
}

function run(project, args, { input = '', env = {} } = {}) {
    return spawnSync('node', [runner, ...args], {
        encoding: 'utf8',
        input,
        env: { ...process.env, AIDLC_ROOT: project.dir, CLAUDE_BIN: project.fake, ...env }
    });
}
const calls = (project) =>
    fs.readFileSync(path.join(project.dir, 'calls.log'), 'utf8').trim().split('\n');
const state = (project) => fs.readFileSync(path.join(project.dir, 'aidlc-docs/state.md'), 'utf8');

const tests = {
    'auto run with an org goes through every phase to done'() {
        const pr = makeProject();
        const res = run(pr, ['--auto', '--org', 'demo', 'Score leads']);
        assert.strictEqual(res.status, 0, res.stderr + res.stdout);
        assert.match(state(pr), /^phase: done$/m);
        assert.deepStrictEqual(calls(pr), [
            'aidlc-inception|Score leads|none|run|human',
            'aidlc-inception|Score leads|inception-approval|approve|auto',
            'aidlc-construction|unit-a|none|run|human',
            'aidlc-construction|unit-a|design-approval|approve|auto',
            'aidlc-construction|unit-a|unit-approval|approve|auto',
            'aidlc-construction|unit-b|none|run|human',
            'aidlc-construction|unit-b|design-approval|approve|auto',
            'aidlc-construction|unit-b|unit-approval|approve|auto',
            'aidlc-operations|demo|none|run|human',
            'aidlc-operations|demo|deploy-approval|approve|auto'
        ]);
    },
    'without an org the run stops after construction and never deploys'() {
        const pr = makeProject();
        const res = run(pr, ['--auto', 'Score leads']);
        assert.strictEqual(res.status, 0, res.stderr + res.stdout);
        assert.match(state(pr), /^phase: construction$/m);
        assert.ok(!calls(pr).some((c) => c.startsWith('aidlc-operations')));
        assert.match(res.stdout, /--org <alias> to deploy/);
    },
    'a stopped run resumes from state and finishes when given an org'() {
        const pr = makeProject();
        run(pr, ['--auto', 'Score leads']);
        const res = run(pr, ['--auto', '--org', 'demo']);
        assert.strictEqual(res.status, 0, res.stderr + res.stdout);
        assert.match(state(pr), /^phase: done$/m);
        assert.strictEqual(
            calls(pr).filter((c) => c.startsWith('aidlc-inception')).length,
            2,
            'inception must not run again on resume'
        );
    },
    'without --auto the human response is passed on and not marked auto'() {
        const pr = makeProject();
        const res = run(pr, ['Score leads'], { input: 'looks good, approved\n' });
        // stdin closes after one line, so the second gate gets no response.
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /No response at the gate/);
        assert.strictEqual(calls(pr)[1], 'aidlc-inception|Score leads|inception-approval|approve|human');
        assert.match(state(pr), /^pending_gate: design-approval$/m);
    },
    'failing runner checks block unit approval and send the unit back'() {
        const pr = makeProject({ failChecksOnce: true });
        const res = run(pr, ['--auto', 'Score leads']);
        assert.strictEqual(res.status, 0, res.stderr + res.stdout);
        const c = calls(pr);
        const i = c.indexOf('aidlc-construction|unit-a|unit-approval|reject|human');
        assert.ok(i > 0, 'expected a rejection for unit-a');
        assert.strictEqual(c[i + 1], 'aidlc-construction|unit-a|unit-approval|approve|auto');
    },
    'checks that never pass stop the run with an error'() {
        const pr = makeProject({ failChecksOnce: true });
        // The fake fixes checks by creating checks-ok; make that impossible.
        fs.mkdirSync(path.join(pr.dir, 'checks-ok-blocker'));
        fs.writeFileSync(
            path.join(pr.dir, 'package.json'),
            JSON.stringify({ scripts: { 'test:unit': 'node -e "process.exit(1)"', lint: 'node -e "process.exit(0)"' } })
        );
        const res = run(pr, ['--auto', 'Score leads']);
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /still fail for unit-a after 2 fix rounds/);
        assert.ok(!state(pr).includes('- unit-a'), 'unit must not be approved');
    },
    'a run that makes no progress stops instead of looping'() {
        const pr = makeProject();
        const res = run(pr, ['--auto', 'Score leads'], { env: { FAKE_STUCK: '1' } });
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /No progress after two steps/);
        assert.strictEqual(calls(pr).length, 2);
    },
    'starting without an intent fails with a clear message'() {
        const pr = makeProject();
        const res = run(pr, ['--auto']);
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /An intent is required/);
    },
    '--reset clears previous artifacts, source and state'() {
        const pr = makeProject();
        run(pr, ['--auto', 'Score leads']);
        fs.mkdirSync(path.join(pr.dir, 'force-app/main/default/classes'), { recursive: true });
        fs.writeFileSync(path.join(pr.dir, 'force-app/main/default/classes/Old.cls'), 'x');
        fs.rmSync(path.join(pr.dir, 'calls.log'));
        const res = run(pr, ['--auto', '--reset', 'New intent']);
        assert.strictEqual(res.status, 0, res.stderr + res.stdout);
        assert.ok(!fs.existsSync(path.join(pr.dir, 'force-app/main/default/classes/Old.cls')));
        assert.strictEqual(calls(pr)[0], 'aidlc-inception|New intent|none|run|human');
    }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
    try {
        fn();
        console.log(`  ok  ${name}`);
    } catch (e) {
        failed++;
        console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`);
    }
}
console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
