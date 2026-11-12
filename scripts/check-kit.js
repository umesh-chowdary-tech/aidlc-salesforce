#!/usr/bin/env node
// Structural check of the AI-DLC kit. Exits 1 listing every failure.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
const fail = (msg) => failures.push(msg);
const read = (rel) => {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
};

const templates = [
    'intent',
    'questions',
    'user-stories',
    'units-of-work',
    'unit-design',
    'test-plan',
    'deployment-record',
    'acceptance-checklist'
].map((n) => `aidlc/templates/${n}.md`);
const commands = [
    'aidlc-inception',
    'aidlc-construction',
    'aidlc-operations'
];
const commandFiles = commands.map((n) => `.claude/commands/${n}.md`);
const required = [
    'CLAUDE.md',
    'README.md',
    'aidlc/salesforce-rules.md',
    ...templates,
    ...commandFiles,
    '.claude/commands/aidlc-fix.md',
    'aidlc-docs/state.md',
    'aidlc-docs/audit.md'
];

for (const rel of required) {
    const text = read(rel);
    if (text === null) fail(`missing file: ${rel}`);
    else if (text.trim() === '') fail(`empty file: ${rel}`);
}

for (const rel of commandFiles) {
    const text = read(rel);
    if (!text) continue;
    if (!/^---\n[\s\S]*?description:\s*\S[\s\S]*?\n---/.test(text))
        fail(`${rel}: no frontmatter with description`);
    for (const needle of [
        'aidlc-docs/state.md',
        'aidlc-docs/audit.md',
        'aidlc/salesforce-rules.md'
    ]) {
        if (!text.includes(needle)) fail(`${rel}: does not mention ${needle}`);
    }
    const used = text.match(/aidlc\/templates\/[a-z-]+\.md/g) || [];
    if (used.length === 0) fail(`${rel}: names no template`);
    for (const t of new Set(used)) {
        if (read(t) === null) fail(`${rel}: names missing template ${t}`);
    }
    if (!/^## Gate/m.test(text)) fail(`${rel}: no "## Gate" heading`);
    if (!text.includes('Stop and wait for the human.'))
        fail(`${rel}: missing "Stop and wait for the human."`);
    if (!text.includes('pending_gate'))
        fail(`${rel}: does not check pending_gate`);
}

const construction = read('.claude/commands/aidlc-construction.md');
if (construction) {
    for (const gate of ['design-approval', 'unit-approval']) {
        if (!construction.includes(gate))
            fail(`aidlc-construction.md: missing gate ${gate}`);
    }
}
const inception = read('.claude/commands/aidlc-inception.md');
if (inception && !inception.includes('inception-approval'))
    fail('aidlc-inception.md: missing gate inception-approval');
const operations = read('.claude/commands/aidlc-operations.md');
if (operations && !operations.includes('deploy-approval'))
    fail('aidlc-operations.md: missing gate deploy-approval');

const claudeMd = read('CLAUDE.md');
if (claudeMd) {
    for (const c of commands) {
        if (!claudeMd.includes(`/${c}`))
            fail(`CLAUDE.md: does not mention /${c}`);
    }
    if (!claudeMd.includes('aidlc/salesforce-rules.md'))
        fail('CLAUDE.md: does not mention aidlc/salesforce-rules.md');
    if (claudeMd.split('\n').length > 80)
        fail('CLAUDE.md: longer than 80 lines');
}

const rules = read('aidlc/salesforce-rules.md');
if (rules) {
    const lower = rules.toLowerCase();
    for (const needle of [
        'one trigger per object',
        '200',
        'with sharing',
        'user_mode',
        'custom metadata',
        'permission set',
        '90%',
        '75%'
    ]) {
        if (!lower.includes(needle))
            fail(`salesforce-rules.md: missing "${needle}"`);
    }
}

const design = read('aidlc/templates/unit-design.md');
if (design && !design.includes('- [ ]'))
    fail('unit-design.md: no guardrail checklist checkboxes');
const testPlan = read('aidlc/templates/test-plan.md');
if (testPlan && !/bulk/i.test(testPlan))
    fail('test-plan.md: no bulk row');

const state = read('aidlc-docs/state.md');
if (state) {
    for (const key of ['phase', 'unit', 'pending_gate', 'next_step']) {
        if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(state))
            fail(`state.md: missing key ${key}`);
    }
    const phases = ['not-started', 'inception', 'construction', 'operations', 'done'];
    const gates = [
        'none',
        'inception-approval',
        'design-approval',
        'unit-approval',
        'deploy-approval'
    ];
    const phase = (state.match(/^phase:\s*(\S+)/m) || [])[1];
    const gate = (state.match(/^pending_gate:\s*(\S+)/m) || [])[1];
    if (phase && !phases.includes(phase)) fail(`state.md: unknown phase ${phase}`);
    if (gate && !gates.includes(gate)) fail(`state.md: unknown gate ${gate}`);
}

if (failures.length) {
    console.error(`Kit check FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('Kit check passed.');
