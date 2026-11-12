// Reads and writes the AI-DLC artifacts under aidlc-docs/. Shared by the
// runner (scripts/aidlc-run.js) and the guided UI (scripts/aidlc-ui/).
const fs = require('fs');
const path = require('path');

const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

function readState(root) {
    const text = readIf(path.join(root, 'aidlc-docs', 'state.md'));
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

function readUnits(root) {
    const text = readIf(path.join(root, 'aidlc-docs', 'inception', 'units-of-work.md'));
    return (text.match(/^## +\d+\.\s+(\S+)/gm) || []).map((l) =>
        l.replace(/^## +\d+\.\s+/, '').trim()
    );
}

// Every questions.md under aidlc-docs/, newest phase last.
function questionFiles(root) {
    const files = [];
    const inception = path.join(root, 'aidlc-docs', 'inception', 'questions.md');
    if (fs.existsSync(inception)) files.push(inception);
    const construction = path.join(root, 'aidlc-docs', 'construction');
    if (fs.existsSync(construction)) {
        for (const unit of fs.readdirSync(construction).sort()) {
            const f = path.join(construction, unit, 'questions.md');
            if (fs.existsSync(f)) files.push(f);
        }
    }
    const operations = path.join(root, 'aidlc-docs', 'operations', 'questions.md');
    if (fs.existsSync(operations)) files.push(operations);
    return files;
}

// Parses the questions template format:
//   ## 1. <question>
//   (optional explanation lines)
//   - A. <option>
//   Answer: <answer>
function parseQuestions(text) {
    const questions = [];
    let current = null;
    for (const line of text.split('\n')) {
        const heading = line.match(/^##\s+(\d+)\.\s+(.*)$/);
        if (heading) {
            current = {
                number: Number(heading[1]),
                text: heading[2].trim(),
                details: [],
                options: [],
                answer: null
            };
            questions.push(current);
            continue;
        }
        if (!current) continue;
        const option = line.match(/^-\s+([A-Z])\.\s+(.*)$/);
        if (option) {
            const label = option[2].trim();
            current.options.push({
                letter: option[1],
                text: label.replace(/\s*\(Recommended\)\s*$/i, ''),
                recommended: /\(Recommended\)\s*$/i.test(label)
            });
            continue;
        }
        const answer = line.match(/^Answer:\s*(.*)$/);
        if (answer) {
            current.answer = answer[1].trim();
            continue;
        }
        if (line.trim() && current.options.length === 0) current.details.push(line.trim());
        else if (/^\s{2,}\S/.test(line) && current.options.length) {
            // Continuation of the previous option.
            const last = current.options[current.options.length - 1];
            last.text += ' ' + line.trim();
        }
    }
    return questions;
}

// Questions whose Answer: line is empty, grouped by file.
function pendingQuestions(root) {
    const pending = [];
    for (const file of questionFiles(root)) {
        const open = parseQuestions(fs.readFileSync(file, 'utf8')).filter(
            (q) => q.answer !== null && q.answer === ''
        );
        if (open.length) pending.push({ file: path.relative(root, file), questions: open });
    }
    return pending;
}

// Writes answers ({ [number]: text }) onto the empty Answer: lines of a
// questions file. Answers to questions that already have one are ignored.
function writeAnswers(root, relFile, answers) {
    const file = path.join(root, relFile);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let number = null;
    for (let i = 0; i < lines.length; i++) {
        const heading = lines[i].match(/^##\s+(\d+)\.\s+/);
        if (heading) number = Number(heading[1]);
        const answer = lines[i].match(/^Answer:\s*(.*)$/);
        if (answer && number !== null && answer[1].trim() === '') {
            const given = answers[number];
            if (given !== undefined && String(given).trim() !== '') {
                lines[i] = `Answer: ${String(given).replace(/\s*\n\s*/g, ' ').trim()}`;
            }
        }
    }
    fs.writeFileSync(file, lines.join('\n'));
}

// The acceptance checklist written in Operations:
//   - [ ] <what to do> -> <what you should see>
function readChecklist(root) {
    const text = readIf(path.join(root, 'aidlc-docs', 'operations', 'acceptance-checklist.md'));
    return (text.match(/^- \[[ xX]\] .+$/gm) || []).map((l) => l.replace(/^- \[[ xX]\] /, '').trim());
}

// The requirement in the requester's words, from the Intent section of
// aidlc-docs/inception/intent.md: its quoted lines if it has any, otherwise
// its first paragraph. Empty when there is no intent yet.
function readRequirement(root) {
    const text = readIf(path.join(root, 'aidlc-docs', 'inception', 'intent.md'));
    const section = (text.split(/^## Intent\s*$/m)[1] || '').split(/^## /m)[0].replace(/<!--[\s\S]*?-->/g, '');
    const quoted = section
        .split('\n')
        .filter((l) => /^>\s?/.test(l))
        .map((l) => l.replace(/^>\s?/, '').trim());
    if (quoted.length) return quoted.join(' ').replace(/\s+/g, ' ').trim();
    const paragraph = section.trim().split(/\n\s*\n/)[0] || '';
    return paragraph.replace(/\s+/g, ' ').trim();
}

// Sets keys in aidlc-docs/state.md ({ phase, unit, pending_gate, next_step })
// and optionally adds a unit under "Approved units".
function updateState(root, fields, approveUnit) {
    const file = path.join(root, 'aidlc-docs', 'state.md');
    let text = fs.readFileSync(file, 'utf8');
    for (const [key, value] of Object.entries(fields)) {
        const re = new RegExp(`^${key}:.*$`, 'm');
        text = re.test(text) ? text.replace(re, `${key}: ${value}`) : text;
    }
    if (approveUnit && !readState(root).approved.includes(approveUnit)) {
        text = `${text.replace(/\s*$/, '')}\n- ${approveUnit}\n`;
    }
    fs.writeFileSync(file, text);
}

// Appends one agent session's token use to aidlc-docs/usage.md.
function appendUsage(root, label, u) {
    const file = path.join(root, 'aidlc-docs', 'usage.md');
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            '# Agent usage\n\nOne row per Claude session the runner started. "Cache read" tokens are\n' +
                're-used context and cost far less than new input. Cost is what the Claude\n' +
                'CLI reports at API prices; on a subscription it counts toward your limits\n' +
                'instead of being billed.\n\n' +
                '| Time | Step | Turns | Input | Cache write | Cache read | Output | Cost (USD) |\n' +
                '|---|---|---|---|---|---|---|---|\n'
        );
    }
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const n = (v) => (Number.isFinite(v) ? v : 0);
    fs.appendFileSync(
        file,
        `| ${stamp} | ${label.replace(/\|/g, '/')} | ${n(u.turns)} | ${n(u.input)} | ${n(u.cacheWrite)} | ${n(u.cacheRead)} | ${n(u.output)} | ${n(u.cost).toFixed(4)} |\n`
    );
}

function appendAudit(root, event, words) {
    const file = path.join(root, 'aidlc-docs', 'audit.md');
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.appendFileSync(file, `\n## ${stamp} ${event}\n\n${words.trim()}\n`);
}

module.exports = {
    readIf,
    readState,
    readUnits,
    questionFiles,
    parseQuestions,
    pendingQuestions,
    writeAnswers,
    readChecklist,
    readRequirement,
    updateState,
    appendUsage,
    appendAudit
};
