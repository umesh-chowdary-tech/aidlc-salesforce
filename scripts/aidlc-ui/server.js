#!/usr/bin/env node
// Guided AI-DLC: a browser page that drives the runner in --guided mode, so
// someone who is not a developer can turn a requirement into a deployed
// Salesforce feature by answering questions, approving the plan and the
// deploy, and checking the result in their org.
//
//   npm run aidlc:ui            (opens http://127.0.0.1:4545)
//   npm run aidlc:ui -- --port 5000 --no-open
//
// The server listens on 127.0.0.1 only. Every API call must carry the token
// that is embedded in the page, and the Host header must be the local
// address, so other web sites cannot drive it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const runner = require('../aidlc-run');
const docs = require('../aidlc-docs');

const ROOT = process.env.AIDLC_ROOT || path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(__dirname, 'public');
const TOKEN = crypto.randomBytes(24).toString('hex');
const SF = process.env.SF_BIN || 'sf';
const ALLOW_PRODUCTION = process.env.AIDLC_ALLOW_PRODUCTION === '1';
const MAX_LOG = 800;

const DOCUMENTS = {
    intent: 'aidlc-docs/inception/intent.md',
    stories: 'aidlc-docs/inception/user-stories.md',
    units: 'aidlc-docs/inception/units-of-work.md',
    deployment: 'aidlc-docs/operations/deployment-record.md',
    checklist: 'aidlc-docs/operations/acceptance-checklist.md',
    acceptance: 'aidlc-docs/operations/acceptance.md',
    audit: 'aidlc-docs/audit.md'
};

// --- Shared state ------------------------------------------------------------

const ui = {
    org: null, // { alias, username, name, type, isSandbox, instanceUrl }
    run: null, // { running, startedAt, finishedAt, result, error }
    pending: null, // { id, kind, ...request } waiting for the person
    log: [],
    busy: null // short text while an org action runs
};
let resolvePending = null;
let nextId = 1;
let currentChild = null;
let abort = null;
const clients = new Set();

function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
}

function addLog(kind, text) {
    const entry = { t: new Date().toISOString(), kind, text: String(text) };
    ui.log.push(entry);
    if (ui.log.length > MAX_LOG) ui.log.splice(0, ui.log.length - MAX_LOG);
    broadcast('log', entry);
}

function snapshot() {
    const state = docs.readState(ROOT);
    const units = docs.readUnits(ROOT);
    const available = {};
    for (const [name, rel] of Object.entries(DOCUMENTS)) available[name] = fs.existsSync(path.join(ROOT, rel));
    const pending = ui.pending ? { ...ui.pending } : null;
    return {
        state,
        units,
        org: ui.org,
        run: ui.run,
        busy: ui.busy,
        pending,
        documents: available,
        requirement: docs.readRequirement(ROOT),
        acceptance: acceptanceResult(),
        allowProduction: ALLOW_PRODUCTION
    };
}

function acceptanceResult() {
    const text = docs.readIf(path.join(ROOT, DOCUMENTS.acceptance));
    const m = text.match(/^Result:\s*(.*)$/m);
    return m ? m[1].trim() : null;
}

function changed() {
    broadcast('status', snapshot());
}

// --- Salesforce CLI ----------------------------------------------------------

function sf(args, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(SF, [...args, '--json'], { cwd: ROOT });
        } catch (e) {
            resolve({ ok: false, error: e.message });
            return;
        }
        let out = '';
        let err = '';
        const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('error', (e) => {
            clearTimeout(timer);
            resolve({
                ok: false,
                error: e.code === 'ENOENT' ? 'The Salesforce CLI (sf) is not installed on this computer.' : e.message
            });
        });
        child.on('close', (status) => {
            clearTimeout(timer);
            let json = null;
            try {
                json = JSON.parse(out);
            } catch (e) {
                json = null;
            }
            if (status === 0 && json && json.status === 0) resolve({ ok: true, result: json.result });
            else resolve({ ok: false, error: (json && json.message) || err.trim() || `sf exited with status ${status}` });
        });
    });
}

async function listOrgs() {
    const res = await sf(['org', 'list']);
    if (!res.ok) return res;
    const r = res.result || {};
    const all = [...(r.sandboxes || []), ...(r.nonScratchOrgs || []), ...(r.scratchOrgs || []), ...(r.devHubs || [])];
    const seen = new Set();
    const orgs = [];
    for (const o of all) {
        const key = o.username;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        orgs.push({ alias: o.alias || null, username: o.username, connected: o.connectedStatus === 'Connected' || o.isExpired === false });
    }
    return { ok: true, orgs };
}

// Reads what kind of org this is. Only sandboxes, scratch orgs, trial orgs
// and Developer Edition orgs are allowed unless AIDLC_ALLOW_PRODUCTION=1.
async function inspectOrg(target) {
    const res = await sf([
        'data',
        'query',
        '--query',
        'SELECT Name, IsSandbox, OrganizationType, TrialExpirationDate FROM Organization LIMIT 1',
        '--target-org',
        target
    ]);
    if (!res.ok) return res;
    const rec = (res.result && res.result.records && res.result.records[0]) || {};
    const display = await sf(['org', 'display', '--target-org', target]);
    const info = display.ok ? display.result : {};
    const isSandbox = rec.IsSandbox === true;
    const isTrial = Boolean(rec.TrialExpirationDate);
    const isDeveloper = rec.OrganizationType === 'Developer Edition';
    const type = isSandbox ? 'Sandbox' : isTrial ? 'Scratch or trial org' : isDeveloper ? 'Developer Edition' : 'Production';
    return {
        ok: true,
        org: {
            alias: info.alias || target,
            username: info.username || target,
            instanceUrl: info.instanceUrl || null,
            name: rec.Name || null,
            type,
            isSandbox,
            allowed: type !== 'Production' || ALLOW_PRODUCTION
        }
    };
}

async function useOrg(target) {
    ui.busy = 'Checking the org…';
    changed();
    try {
        const res = await inspectOrg(target);
        if (!res.ok) return { ok: false, error: `Could not reach that org: ${res.error}` };
        if (!res.org.allowed) {
            return {
                ok: false,
                error:
                    `"${res.org.name || target}" is a production org. This tool only builds in sandboxes and ` +
                    'Developer Edition orgs. Ask your Salesforce admin for a sandbox.'
            };
        }
        ui.org = res.org;
        addLog('status', `Using the ${res.org.type} "${res.org.name || res.org.alias}".`);
        return { ok: true, org: res.org };
    } finally {
        ui.busy = null;
        changed();
    }
}

async function connectOrg(kind) {
    const instanceUrl = kind === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
    const alias = `aidlc-${kind === 'sandbox' ? 'sandbox' : 'org'}-${Date.now().toString(36)}`;
    ui.busy = 'Waiting for you to log in to Salesforce in the browser tab that just opened…';
    changed();
    const res = await sf(['org', 'login', 'web', '--alias', alias, '--instance-url', instanceUrl], {
        timeoutMs: 10 * 60 * 1000
    });
    ui.busy = null;
    changed();
    if (!res.ok) return { ok: false, error: `Salesforce login did not finish: ${res.error}` };
    return useOrg(alias);
}

// --- The run -----------------------------------------------------------------

function respond(request) {
    return new Promise((resolve) => {
        ui.pending = { id: nextId++, ...request };
        if (request.kind === 'questions') addLog('status', 'The agent has questions for you.');
        else if (request.kind === 'gate') addLog('status', `Waiting for your approval (${request.gate}).`);
        else if (request.kind === 'acceptance') addLog('status', 'Ready for you to check the result in Salesforce.');
        resolvePending = (reply) => {
            ui.pending = null;
            resolvePending = null;
            changed();
            resolve(reply);
        };
        changed();
    });
}

function startRun(intent) {
    if (ui.run && ui.run.running) return { ok: false, error: 'A run is already in progress.' };
    const state = docs.readState(ROOT);
    if (state.phase === 'not-started' && !String(intent || '').trim()) {
        return { ok: false, error: 'Describe what you need first.' };
    }
    if (!ui.org) return { ok: false, error: 'Connect a Salesforce org first.' };
    abort = new AbortController();
    ui.run = { running: true, startedAt: new Date().toISOString(), result: null, error: null };
    addLog('status', state.phase === 'not-started' ? 'Starting.' : 'Continuing where the work stopped.');
    changed();
    runner
        .run({
            root: ROOT,
            mode: 'guided',
            org: ui.org.alias,
            intent: String(intent || '').trim(),
            respond,
            signal: abort.signal,
            onStatus: (text) => {
                addLog('status', text);
                changed();
            },
            onOutput: (text) => addLog('agent', text),
            onChild: (child) => (currentChild = child)
        })
        .then(
            (result) => {
                ui.run = { ...ui.run, running: false, finishedAt: new Date().toISOString(), result };
                addLog('status', result === 'done' ? 'Finished.' : 'Paused.');
            },
            (e) => {
                ui.run = { ...ui.run, running: false, finishedAt: new Date().toISOString(), error: e.message };
                addLog('error', e.message);
            }
        )
        .finally(() => {
            currentChild = null;
            if (resolvePending) resolvePending(null);
            ui.pending = null;
            changed();
        });
    return { ok: true };
}

function stopRun() {
    if (!ui.run || !ui.run.running) return { ok: false, error: 'Nothing is running.' };
    if (abort) abort.abort();
    if (currentChild) currentChild.kill('SIGTERM');
    if (resolvePending) resolvePending(null);
    addLog('status', 'Stopping…');
    return { ok: true };
}

// Converts the page's structured reply into what the runner expects.
function toRunnerReply(pending, body) {
    if (pending.kind === 'gate') {
        const comment = String(body.comment || '').trim();
        if (body.approve) return comment ? `Approved. ${comment}` : 'Approved.';
        if (!comment) throw new Error('Say what should change.');
        return `Changes requested: ${comment}`;
    }
    if (pending.kind === 'questions') {
        const answers = {};
        for (const q of pending.questions) {
            const a = body.answers && body.answers[q.number];
            if (!a || !String(a).trim()) throw new Error(`Question ${q.number} has no answer yet.`);
            answers[q.number] = String(a).trim();
        }
        return { answers };
    }
    if (pending.kind === 'acceptance') {
        const results = pending.items.map((item, i) => {
            const r = (body.results || [])[i];
            if (!r || typeof r.ok !== 'boolean') throw new Error(`Check ${i + 1} has no answer yet.`);
            if (!r.ok && !String(r.note || '').trim()) throw new Error(`For check ${i + 1}, say what you saw.`);
            return { item, ok: r.ok, note: String(r.note || '').trim() };
        });
        return { results };
    }
    throw new Error('Unknown request.');
}

// --- HTTP ----------------------------------------------------------------------

function send(res, status, body, type = 'application/json') {
    const data = type === 'application/json' ? JSON.stringify(body) : body;
    res.writeHead(status, {
        'Content-Type': type,
        'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
    });
    res.end(data);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (d) => {
            data += d;
            if (data.length > 1e6) req.destroy();
        });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

const STATIC = {
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8']
};

function makeServer(port) {
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    return http.createServer((req, res) => {
        handle(req, res).catch((e) => {
            if (!res.headersSent) send(res, 500, { error: e.message });
            else res.end();
        });
    });

    async function handle(req, res) {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'Forbidden host' });

        if (req.method === 'GET' && url.pathname === '/') {
            const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__AIDLC_TOKEN__', TOKEN);
            return send(res, 200, html, 'text/html; charset=utf-8');
        }
        if (req.method === 'GET' && STATIC[url.pathname]) {
            const [file, type] = STATIC[url.pathname];
            return send(res, 200, fs.readFileSync(path.join(PUBLIC, file)), type);
        }
        if (req.method === 'GET' && url.pathname === '/vendor/marked.js') {
            const file = path.join(path.dirname(require.resolve('marked')), 'marked.umd.js');
            return send(res, 200, fs.readFileSync(file), 'text/javascript; charset=utf-8');
        }
        if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

        const token = req.headers['x-aidlc-token'] || url.searchParams.get('token');
        if (token !== TOKEN) return send(res, 403, { error: 'Missing or wrong token. Reload the page.' });

        try {
            if (req.method === 'GET' && url.pathname === '/api/events') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
                res.write(`event: status\ndata: ${JSON.stringify(snapshot())}\n\n`);
                res.write(`event: history\ndata: ${JSON.stringify(ui.log)}\n\n`);
                clients.add(res);
                req.on('close', () => clients.delete(res));
                return undefined;
            }
            if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, snapshot());
            if (req.method === 'GET' && url.pathname === '/api/document') {
                const rel = DOCUMENTS[url.searchParams.get('name')];
                if (!rel) return send(res, 404, { error: 'Unknown document' });
                return send(res, 200, { name: url.searchParams.get('name'), path: rel, text: docs.readIf(path.join(ROOT, rel)) });
            }
            if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
            const body = await readBody(req);

            switch (url.pathname) {
                case '/api/orgs/list':
                    return send(res, 200, await listOrgs());
                case '/api/orgs/use':
                    return send(res, 200, await useOrg(String(body.target || '')));
                case '/api/orgs/connect':
                    return send(res, 200, await connectOrg(body.kind === 'sandbox' ? 'sandbox' : 'developer'));
                case '/api/orgs/open': {
                    if (!ui.org) return send(res, 200, { ok: false, error: 'No org connected.' });
                    const r = await sf(['org', 'open', '--target-org', ui.org.alias, ...(body.path ? ['--path', String(body.path)] : [])]);
                    return send(res, 200, r.ok ? { ok: true } : { ok: false, error: r.error });
                }
                case '/api/run/start':
                    return send(res, 200, startRun(body.intent));
                case '/api/run/stop':
                    return send(res, 200, stopRun());
                case '/api/respond': {
                    if (!ui.pending || ui.pending.id !== body.id || !resolvePending) {
                        return send(res, 200, { ok: false, error: 'That question is no longer open. The page will refresh.' });
                    }
                    let reply;
                    try {
                        reply = toRunnerReply(ui.pending, body);
                    } catch (e) {
                        return send(res, 200, { ok: false, error: e.message });
                    }
                    resolvePending(reply);
                    return send(res, 200, { ok: true });
                }
                case '/api/new-requirement': {
                    if (ui.run && ui.run.running) return send(res, 200, { ok: false, error: 'Stop the current run first.' });
                    runner.startNewRequirement(ROOT);
                    ui.run = null;
                    ui.log = [];
                    addLog('status', 'Ready for a new requirement. The previous work is archived in aidlc-docs/archive/.');
                    changed();
                    return send(res, 200, { ok: true });
                }
                default:
                    return send(res, 404, { error: 'Not found' });
            }
        } catch (e) {
            return send(res, 500, { error: e.message });
        }
    }
}

function openBrowser(url) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try {
        spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    } catch (e) {
        // The URL is printed anyway.
    }
}

function listen(port, attemptsLeft = 10) {
    return new Promise((resolve, reject) => {
        const server = makeServer(port);
        server.once('error', (e) => {
            if (e.code === 'EADDRINUSE' && attemptsLeft > 0) resolve(listen(port + 1, attemptsLeft - 1));
            else reject(e);
        });
        server.listen(port, '127.0.0.1', () => resolve({ server, port }));
    });
}

async function main() {
    const argv = process.argv.slice(2);
    const portArg = argv.indexOf('--port');
    const port = portArg >= 0 ? Number(argv[portArg + 1]) : Number(process.env.AIDLC_UI_PORT || 4545);
    const { port: actual } = await listen(port);
    const url = `http://127.0.0.1:${actual}/`;
    console.log(`AI-DLC guided mode is running at ${url}`);
    console.log('Keep this window open while you work. Press Ctrl+C to stop.');
    if (!argv.includes('--no-open') && process.env.AIDLC_UI_NO_OPEN !== '1') openBrowser(url);
    const shutdown = () => {
        if (currentChild) currentChild.kill('SIGTERM');
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

if (require.main === module) {
    main().catch((e) => {
        console.error(`Could not start: ${e.message}`);
        process.exit(1);
    });
}

module.exports = { makeServer, listen, TOKEN, ui, toRunnerReply };
