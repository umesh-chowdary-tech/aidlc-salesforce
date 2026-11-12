#!/usr/bin/env node
// End-to-end test of the guided UI: starts the server against a temporary
// project with a fake Claude CLI and a fake Salesforce CLI, checks the API's
// protections, then (if Playwright is installed) walks through a whole run in
// a real browser the way a requester would.
//
//   npm run test:ui
//   AIDLC_UI_SCREENSHOTS=<dir> npm run test:ui   (also saves screenshots)
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const { makeProject } = require('./test-fixtures');

const FAKE_SF = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const root = process.cwd();
fs.appendFileSync(path.join(root, 'sf-calls.log'), args.join(' ') + '\\n');
const ok = (result) => { console.log(JSON.stringify({ status: 0, result })); process.exit(0); };
const target = args[args.indexOf('--target-org') + 1];
if (args[0] === 'org' && args[1] === 'list') {
  ok({ sandboxes: [{ alias: 'acme-dev', username: 'rep@acme.com.dev', connectedStatus: 'Connected' }], nonScratchOrgs: [], scratchOrgs: [] });
}
if (args[0] === 'data' && args[1] === 'query') {
  const prod = fs.existsSync(path.join(root, 'prod-org'));
  ok({ records: [{ Name: prod ? 'Acme Inc' : 'Acme Dev Sandbox', IsSandbox: !prod, OrganizationType: 'Enterprise Edition', TrialExpirationDate: null }] });
}
if (args[0] === 'org' && args[1] === 'display') {
  ok({ alias: target, username: 'rep@acme.com.dev', instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com' });
}
if (args[0] === 'org' && (args[1] === 'open' || args[1] === 'login')) ok({});
console.log(JSON.stringify({ status: 1, message: 'fake sf: unknown command ' + args.join(' ') }));
process.exit(1);
`;

function startServer(project, port) {
    const sfBin = path.join(project.dir, 'fake-sf.js');
    fs.writeFileSync(sfBin, FAKE_SF, { mode: 0o755 });
    const child = spawn(process.execPath, [path.join(__dirname, 'aidlc-ui', 'server.js'), '--port', String(port), '--no-open'], {
        env: {
            ...process.env,
            AIDLC_ROOT: project.dir,
            CLAUDE_BIN: project.fake,
            SF_BIN: sfBin,
            FAKE_QUESTIONS: '1',
            NODE_PATH: path.join(__dirname, '..', 'node_modules')
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return new Promise((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (d) => {
            out += d;
            const m = out.match(/running at (http:\/\/127\.0\.0\.1:\d+\/)/);
            if (m) resolve({ child, url: m[1] });
        });
        child.stderr.on('data', (d) => process.stderr.write(d));
        child.on('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
    });
}

function request(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method, headers }, (res) => {
            let data = '';
            res.on('data', (d) => (data += d));
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function apiChecks(url) {
    const page = await request(url);
    assert.strictEqual(page.status, 200);
    const token = page.body.match(/name="aidlc-token" content="([0-9a-f]+)"/)[1];
    assert.ok(token.length >= 32, 'page carries a token');

    const noToken = await request(`${url}api/status`);
    assert.strictEqual(noToken.status, 403, 'API refuses calls without the token');

    const u = new URL(url);
    const badHost = await request(`${url}api/status`, { headers: { Host: `evil.example:${u.port}`, 'X-AIDLC-Token': token } });
    assert.strictEqual(badHost.status, 403, 'API refuses a foreign Host header');

    const ok = await request(`${url}api/status`, { headers: { 'X-AIDLC-Token': token } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(JSON.parse(ok.body).state.phase, 'not-started');
    return token;
}

async function productionIsRefused(url, token, project) {
    fs.writeFileSync(path.join(project.dir, 'prod-org'), '1');
    const res = await request(`${url}api/orgs/use`, {
        method: 'POST',
        headers: { 'X-AIDLC-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'acme-prod' })
    });
    fs.rmSync(path.join(project.dir, 'prod-org'));
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ok, false);
    assert.match(data.error, /production org/);
}

async function browserFlow(url, project, shots) {
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch (e) {
        console.log('  skip browser walk-through (Playwright is not installed)');
        return;
    }
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: shots ? 2 : 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    let n = 0;
    const shot = async (name) => {
        if (shots) await page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true });
    };
    const heading = (text) => page.getByRole('heading', { level: 1, name: text }).waitFor({ timeout: 20000 });

    try {
        await page.goto(url);
        await heading('Connect your Salesforce org');
        await page.locator('#org-select').waitFor();
        await shot('connect');
        await page.getByRole('button', { name: 'Use this org' }).click();

        await heading('What do you need?');
        await page.getByLabel('Describe what you need').fill('Score each Lead from 0 to 100 and show reps why.');
        await shot('describe');
        await page.getByRole('button', { name: 'Start' }).click();

        await heading('A few questions');
        assert.match(await page.locator('#requirement-text').textContent(), /Score each Lead/, 'requirement shown while working');
        assert.ok(await page.locator('.badge', { hasText: 'Recommended' }).isVisible(), 'recommended option is marked');
        await shot('questions');
        await page.getByRole('button', { name: 'Send answers' }).click();

        await heading('Is this what you want?');
        await page.getByText('See a score on each Lead').waitFor();
        await shot('plan');
        await page.getByRole('button', { name: 'Approve the plan' }).click();

        await heading('Ready to install');
        assert.match(await page.locator('#usage').textContent(), /This run so far: \d+ agent sessions?, /, 'token use is shown');
        await shot('install');
        await page.getByRole('button', { name: 'Install it' }).click();

        await heading('Try it in Salesforce');
        const checks = page.locator('.check');
        assert.strictEqual(await checks.count(), 2);
        await checks.nth(0).getByRole('button', { name: 'It worked' }).click();
        await checks.nth(1).getByRole('button', { name: 'It did not work' }).click();
        await checks.nth(1).getByRole('textbox').fill('The score stayed at 40 after I saved.');
        await shot('check-failed');
        await page.getByRole('button', { name: 'Send my results' }).click();

        // The agent fixes it, validates again, and asks to install again.
        await heading('Ready to install');
        await page.getByRole('button', { name: 'Install it' }).click();
        await heading('Try it in Salesforce');
        for (const b of await page.getByRole('button', { name: 'It worked' }).all()) await b.click();
        await page.getByRole('button', { name: 'Send my results' }).click();

        await heading('Done');
        await page.getByRole('button', { name: 'View the audit trail' }).click();
        await page.locator('#doc-body').getByText('acceptance (changes requested)').waitFor();
        await shot('done-audit');
        await page.getByRole('button', { name: 'Close' }).click();

        // Starting over: the old requirement is archived and the box is back.
        page.once('dialog', (d) => d.accept());
        await page.getByRole('button', { name: 'Start a new requirement' }).click();
        await heading('What do you need?');
        assert.ok(await page.locator('#requirement').isHidden(), 'no requirement shown for a fresh start');
        assert.deepStrictEqual(errors, [], 'no browser errors');
    } finally {
        await browser.close();
    }

    const audit = fs.readFileSync(path.join(project.dir, 'aidlc-docs/audit.md'), 'utf8');
    assert.match(audit, /answers aidlc-docs\/inception\/questions\.md\n\n1\. A\. Sales reps/);
    assert.match(audit, /\(changes requested\)\n\n- Yes: Open a Lead[^\n]*\n- No: Save it -> the score updates \(The score stayed at 40 after I saved\.\)/);
    // "Start a new requirement" archived the finished run.
    const archives = fs.readdirSync(path.join(project.dir, 'aidlc-docs/archive'));
    assert.strictEqual(archives.length, 1);
    const archived = path.join(project.dir, 'aidlc-docs/archive', archives[0]);
    assert.match(fs.readFileSync(path.join(archived, 'operations/acceptance.md'), 'utf8'), /^Result: accepted$/m);
    assert.ok(!fs.existsSync(path.join(project.dir, 'aidlc-docs/inception')), 'inception docs moved to the archive');
    assert.match(fs.readFileSync(path.join(project.dir, 'aidlc-docs/state.md'), 'utf8'), /^phase: not-started$/m);
    assert.match(audit, /new-requirement\n\nThe previous run's artifacts were archived/);
    const calls = fs.readFileSync(path.join(project.dir, 'calls.log'), 'utf8');
    assert.match(calls, /aidlc-operations\|acme-dev\|deploy-approval\|approve\|human/);
    assert.match(calls, /aidlc-fix\|acme-dev\|/);
    console.log('  ok  browser walk-through: connect, describe, questions, plan, install, failed check, fix, install, accept, start a new requirement');
}

(async () => {
    const project = makeProject();
    const port = 46000 + Math.floor(Math.random() * 1000);
    const shots = process.env.AIDLC_UI_SCREENSHOTS;
    if (shots) fs.mkdirSync(shots, { recursive: true });
    const { child, url } = await startServer(project, port);
    let failed = false;
    try {
        const token = await apiChecks(url);
        console.log('  ok  API refuses calls without the token or from a foreign host');
        await productionIsRefused(url, token, project);
        console.log('  ok  a production org is refused');
        await browserFlow(url, project, shots);
    } catch (e) {
        failed = true;
        console.log(`  FAIL ${e.stack || e.message}`);
    } finally {
        child.kill();
    }
    console.log(failed ? '\nUI test failed' : '\nUI test passed');
    process.exit(failed ? 1 : 0);
})();
