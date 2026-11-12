// Shared fixtures for the runner and UI tests: a temporary project and a
// fake Claude CLI that only moves aidlc-docs/state.md the way the real
// commands would. No AI, no org.
const fs = require('fs');
const os = require('os');
const path = require('path');

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
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: stateFile } }] } }));
if (process.env.FAKE_STUCK) process.exit(0);
if (rejected) {
  fs.writeFileSync(path.join(root, 'checks-ok'), '1');
} else if (cmd === 'aidlc-inception' && !approved) {
  fs.mkdirSync(path.join(root, 'aidlc-docs/inception'), { recursive: true });
  fs.writeFileSync(path.join(root, 'aidlc-docs/inception/intent.md'),
    '# Intent\\n\\n## Intent\\n\\n> ' + arg + '\\n\\n## Who it is for\\n\\nSales reps.\\n');
  const qFile = path.join(root, 'aidlc-docs/inception/questions.md');
  if (process.env.FAKE_QUESTIONS && !fs.existsSync(qFile)) {
    fs.writeFileSync(qFile, '# Questions\\n\\n## 1. Who uses it?\\n\\n- A. Sales reps (Recommended)\\n- B. Admins\\n\\nAnswer:\\n');
    set('phase', 'inception');
    fs.writeFileSync(stateFile, s);
    process.exit(0);
  }
  if (fs.existsSync(qFile) && /^Answer:\\s*$/m.test(fs.readFileSync(qFile, 'utf8'))) process.exit(0);
  fs.writeFileSync(path.join(root, 'aidlc-docs/inception/units-of-work.md'),
    '# Units\\n\\n## 1. unit-a\\n\\n- x\\n\\n## 2. unit-b\\n\\n- y\\n');
  fs.writeFileSync(path.join(root, 'aidlc-docs/inception/user-stories.md'),
    '# User stories\\n\\n## US-1: See a score on each Lead\\n\\nAs a sales rep\\nI want a score on every Lead\\nSo that I call the best Leads first\\n\\nAcceptance criteria:\\n\\n- Given a Lead with an email, when I save it, then it has a score.\\n');
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
  fs.mkdirSync(path.join(root, 'aidlc-docs/operations'), { recursive: true });
  fs.writeFileSync(path.join(root, 'aidlc-docs/operations/deployment-record.md'),
    '# Deployment record\\n\\n## Validate result\\n\\nPassed: 12 components, 43 Apex tests, 0 failures.\\n');
  set('phase', 'operations'); set('pending_gate', 'deploy-approval');
} else if (cmd === 'aidlc-operations') {
  fs.mkdirSync(path.join(root, 'aidlc-docs/operations'), { recursive: true });
  fs.writeFileSync(path.join(root, 'aidlc-docs/operations/acceptance-checklist.md'),
    '# Acceptance checklist\\n\\n- [ ] Open a Lead -> you see a score\\n- [ ] Save it -> the score updates\\n');
  set('phase', 'done'); set('pending_gate', 'none');
} else if (cmd === 'aidlc-fix') {
  set('phase', 'operations'); set('pending_gate', 'none');
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


module.exports = { FAKE, makeProject };
