#!/usr/bin/env node
// Tests the runner's control flow against a fake Claude CLI that only moves
// aidlc-docs/state.md the way the real commands would. No AI, no org.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const runner = path.resolve(__dirname, 'aidlc-run.js');
const docs = require('./aidlc-docs');

const { makeProject } = require('./test-fixtures');

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

// In-process runs of run() with a scripted responder, as the guided UI uses it.
async function runGuided(project, { org = 'demo', intent = 'Score leads', replies = {}, env = {} } = {}) {
    const { run } = require('./aidlc-run');
    const requests = [];
    const saved = {};
    Object.assign(process.env, { CLAUDE_BIN: project.fake, ...env });
    for (const k of Object.keys(env)) saved[k] = true;
    const counts = {};
    const respond = async (request) => {
        requests.push(request);
        const key = request.kind === 'gate' ? request.gate : request.kind;
        counts[key] = (counts[key] || 0) + 1;
        const reply = replies[key];
        return typeof reply === 'function' ? reply(request, counts[key]) : reply;
    };
    try {
        const result = await run({ root: project.dir, mode: 'guided', org, intent, respond, onStatus: () => {}, onOutput: () => {} });
        return { result, requests };
    } finally {
        for (const k of Object.keys(saved)) delete process.env[k];
    }
}
const allYes = (req) => ({ results: req.items.map((item) => ({ item, ok: true, note: '' })) });

Object.assign(tests, {
    async 'guided mode asks the person only for the stories, the deploy and the result'() {
        const pr = makeProject();
        const { result, requests } = await runGuided(pr, {
            replies: { 'inception-approval': 'Looks right', 'deploy-approval': 'Go ahead', acceptance: allYes }
        });
        assert.strictEqual(result, 'done');
        assert.deepStrictEqual(
            requests.map((r) => (r.kind === 'gate' ? r.gate : r.kind)),
            ['inception-approval', 'deploy-approval', 'acceptance']
        );
        assert.deepStrictEqual(requests[2].items, ['Open a Lead -> you see a score', 'Save it -> the score updates']);
        const c = calls(pr);
        assert.ok(c.includes('aidlc-construction|unit-a|design-approval|approve|auto'));
        assert.ok(c.includes('aidlc-construction|unit-b|unit-approval|approve|auto'));
        assert.ok(c.includes('aidlc-inception|Score leads|inception-approval|approve|human'));
        assert.ok(c.includes('aidlc-operations|demo|deploy-approval|approve|human'));
        const acceptance = fs.readFileSync(path.join(pr.dir, 'aidlc-docs/operations/acceptance.md'), 'utf8');
        assert.match(acceptance, /^Result: accepted$/m);
        assert.match(fs.readFileSync(path.join(pr.dir, 'aidlc-docs/audit.md'), 'utf8'), /acceptance\n\n- Yes: Open a Lead/);
    },
    async 'open questions are put to the person and answered before work continues'() {
        const pr = makeProject();
        const { requests } = await runGuided(pr, {
            org: null,
            env: { FAKE_QUESTIONS: '1' },
            replies: {
                questions: (req) => {
                    assert.strictEqual(req.questions[0].text, 'Who uses it?');
                    assert.ok(req.questions[0].options[0].recommended);
                    return { answers: { 1: 'A' } };
                },
                'inception-approval': 'Approved'
            }
        });
        assert.strictEqual(requests[0].kind, 'questions');
        assert.strictEqual(requests[1].gate, 'inception-approval');
        const q = fs.readFileSync(path.join(pr.dir, 'aidlc-docs/inception/questions.md'), 'utf8');
        assert.match(q, /^Answer: A$/m);
        assert.match(fs.readFileSync(path.join(pr.dir, 'aidlc-docs/audit.md'), 'utf8'), /answers aidlc-docs\/inception\/questions\.md\n\n1\. A/);
    },
    async 'a result that does not work goes back to the agent and is checked again'() {
        const pr = makeProject();
        const { result, requests } = await runGuided(pr, {
            replies: {
                'inception-approval': 'Approved',
                'deploy-approval': 'Approved',
                acceptance: (req, n) =>
                    n === 1
                        ? { results: [{ item: req.items[0], ok: true }, { item: req.items[1], ok: false, note: 'Score stayed at 40' }] }
                        : allYes(req)
            }
        });
        assert.strictEqual(result, 'done');
        assert.strictEqual(requests.filter((r) => r.kind === 'acceptance').length, 2);
        assert.strictEqual(requests.filter((r) => r.gate === 'deploy-approval').length, 2);
        assert.ok(calls(pr).some((c) => c.startsWith('aidlc-fix|demo|')));
        const audit = fs.readFileSync(path.join(pr.dir, 'aidlc-docs/audit.md'), 'utf8');
        assert.match(audit, /acceptance \(changes requested\)\n\n- Yes: Open a Lead[^\n]*\n- No: Save it -> the score updates \(Score stayed at 40\)/);
    },
    async 'guided mode without an org stops after construction and asks nothing more'() {
        const pr = makeProject();
        const { result, requests } = await runGuided(pr, { org: null, replies: { 'inception-approval': 'Approved' } });
        assert.strictEqual(result, 'stopped');
        assert.deepStrictEqual(requests.map((r) => r.gate), ['inception-approval']);
    },
    'questions parser reads options, recommendations and answers'() {
        const qs = docs.parseQuestions(
            '# Questions\n\n## 1. Where is it stored?\n\nSome context.\n\n- A. A field (Recommended)\n- B. Two fields,\n  one per year\n\nAnswer:\n\n## 2. Done?\n\n- A. Yes\n\nAnswer: A\n'
        );
        assert.strictEqual(qs.length, 2);
        assert.deepStrictEqual(qs[0].details, ['Some context.']);
        assert.deepStrictEqual(qs[0].options, [
            { letter: 'A', text: 'A field', recommended: true },
            { letter: 'B', text: 'Two fields, one per year', recommended: false }
        ]);
        assert.strictEqual(qs[0].answer, '');
        assert.strictEqual(qs[1].answer, 'A');
    },
    'the requirement is read from the intent in the requester\'s words'() {
        const pr = makeProject();
        fs.mkdirSync(path.join(pr.dir, 'aidlc-docs/inception'), { recursive: true });
        fs.writeFileSync(
            path.join(pr.dir, 'aidlc-docs/inception/intent.md'),
            '# Intent\n\n## Intent\n\nIn the requester\'s words:\n\n> Score each Lead\n> from 0 to 100.\n\n## Who it is for\n\nReps.\n'
        );
        assert.strictEqual(docs.readRequirement(pr.dir), 'Score each Lead from 0 to 100.');
        assert.strictEqual(docs.readRequirement(makeProject().dir), '');
    },
    'agent stream events become readable progress lines'() {
        const { describeEvent } = require('./aidlc-run');
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/p/force-app/x.cls' } }] }
        });
        assert.strictEqual(describeEvent(line, '/p'), 'Writing force-app/x.cls');
        assert.strictEqual(describeEvent(JSON.stringify({ type: 'system' }), '/p'), null);
        assert.strictEqual(describeEvent('plain text', '/p'), 'plain text');
    }
});

(async () => {
    let failed = 0;
    for (const [name, fn] of Object.entries(tests)) {
        try {
            await fn();
            console.log(`  ok  ${name}`);
        } catch (e) {
            failed++;
            console.log(`  FAIL ${name}\n       ${String(e.stack || e.message).split('\n').join('\n       ')}`);
        }
    }
    console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} passed`);
    process.exit(failed ? 1 : 0);
})();
