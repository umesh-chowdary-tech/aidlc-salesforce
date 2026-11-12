/* Guided AI-DLC page. Talks only to the local server that served it. */
(function () {
    'use strict';

    const TOKEN = document.querySelector('meta[name="aidlc-token"]').content;
    const main = document.getElementById('main');
    const activity = document.getElementById('activity');
    const showDetails = document.getElementById('show-details');
    const orgBadge = document.getElementById('org-badge');
    const documentsList = document.getElementById('documents');
    const dialog = document.getElementById('doc-dialog');

    const DOC_LABELS = {
        intent: 'Your requirement',
        stories: 'User stories (the plan)',
        units: 'Technical breakdown',
        deployment: 'Installation record',
        checklist: 'Checks to do in Salesforce',
        acceptance: 'Your check results',
        audit: 'Audit trail (every approval)'
    };
    const EXAMPLES = [
        'Score each Lead from 0 to 100 using rules an admin can change, and show sales reps why a Lead has its score.',
        'When an Opportunity is Closed Won, create a follow-up Task for the account owner due in 7 days.',
        'Stop users from saving a Case as Closed unless a Resolution is filled in.'
    ];

    let status = null;
    let currentView = null;
    let flash = null; // { kind, text } shown on the next render
    let markedReady = false;

    // --- Helpers -------------------------------------------------------------

    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (v === true) el.setAttribute(k, '');
            else el.setAttribute(k, v);
        }
        for (const c of children.flat()) {
            if (c === null || c === undefined || c === false) continue;
            el.append(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return el;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }

    function markdown(text) {
        const div = h('div', { class: 'markdown' });
        const clean = String(text || '').replace(/<!--[\s\S]*?-->/g, '');
        if (window.marked) {
            if (!markedReady) {
                // Raw HTML in a document is shown as text, never rendered.
                window.marked.use({ renderer: { html: (html) => escapeHtml(typeof html === 'string' ? html : html.text) } });
                markedReady = true;
            }
            div.innerHTML = window.marked.parse(clean);
        } else {
            div.textContent = clean;
        }
        return div;
    }

    async function api(pathname, body) {
        const res = await fetch(pathname, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', 'X-AIDLC-Token': TOKEN },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({ ok: false, error: `Server error ${res.status}` }));
        if (!res.ok && !data.error) data.error = `Server error ${res.status}`;
        return data;
    }

    async function getDocument(name) {
        const data = await api(`/api/document?name=${encodeURIComponent(name)}`);
        return data.text || '';
    }

    function setFlash(kind, text) {
        flash = { kind, text };
        render(true);
    }

    async function act(button, pathname, body, onOk) {
        if (button) button.disabled = true;
        const data = await api(pathname, body);
        if (button) button.disabled = false;
        if (data.ok === false || data.error) {
            setFlash('error', data.error || 'Something went wrong.');
            return null;
        }
        if (onOk) onOk(data);
        return data;
    }

    function time(iso) {
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    // --- Activity feed -------------------------------------------------------

    try {
        showDetails.checked = localStorage.getItem('aidlc-details') === '1';
    } catch (e) {
        /* storage unavailable */
    }
    showDetails.addEventListener('change', () => {
        try {
            localStorage.setItem('aidlc-details', showDetails.checked ? '1' : '0');
        } catch (e) {
            /* storage unavailable */
        }
        activity.querySelectorAll('li.agent').forEach((li) => (li.hidden = !showDetails.checked));
    });

    function addActivity(entry) {
        const li = h('li', { class: entry.kind }, h('time', {}, time(entry.t)), entry.text);
        if (entry.kind === 'agent') li.hidden = !showDetails.checked;
        const nearBottom = activity.scrollHeight - activity.scrollTop - activity.clientHeight < 60;
        activity.append(li);
        while (activity.children.length > 600) activity.firstChild.remove();
        if (nearBottom) activity.scrollTop = activity.scrollHeight;
    }

    // --- Progress steps -----------------------------------------------------

    function currentStep(s) {
        if (!s.org) return 'connect';
        const phase = s.state.phase;
        if (phase === 'not-started') return 'describe';
        if (phase === 'inception') return 'plan';
        if (phase === 'construction') return 'build';
        if (phase === 'operations') return 'install';
        if (phase === 'done') return s.acceptance === 'accepted' ? 'finished' : 'check';
        return 'describe';
    }

    function renderSteps(s) {
        const order = ['connect', 'describe', 'plan', 'build', 'install', 'check'];
        const step = currentStep(s);
        const index = step === 'finished' ? order.length : order.indexOf(step);
        document.querySelectorAll('#steps li').forEach((li, i) => {
            li.classList.toggle('done', i < index);
            li.classList.toggle('current', i === index);
            if (i === index) li.setAttribute('aria-current', 'step');
            else li.removeAttribute('aria-current');
        });
    }

    function renderOrgBadge(s) {
        if (!s.org) {
            orgBadge.hidden = true;
            return;
        }
        orgBadge.hidden = false;
        orgBadge.textContent = `${s.org.type}: ${s.org.name || s.org.alias}`;
        orgBadge.title = s.org.username || '';
    }

    function tokens(n) {
        return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
    }

    function renderUsage(s) {
        const el = document.getElementById('usage');
        const u = s.usage;
        el.hidden = !(u && u.sessions);
        if (el.hidden) return;
        el.textContent =
            `This run so far: ${u.sessions} agent session${u.sessions === 1 ? '' : 's'}, ` +
            `${tokens(u.input + u.cacheWrite)} new tokens, ${tokens(u.cacheRead)} re-used, ${tokens(u.output)} written` +
            (u.cost ? `, about $${u.cost.toFixed(2)} at API prices.` : '.');
        el.title = 'Every session is listed in aidlc-docs/usage.md.';
    }

    function renderRequirement(s) {
        const box = document.getElementById('requirement');
        box.hidden = !s.requirement;
        document.getElementById('requirement-text').textContent = s.requirement || '';
    }

    const STEP_TEXT = {
        connect: 'connecting to Salesforce',
        describe: 'describing the requirement',
        plan: 'agreeing the plan: the agent may have questions, then you approve the user stories',
        build: 'building: the agent designs, builds and tests each part',
        install: 'installing: the agent checks the installation in your org, then asks you to approve it',
        check: 'checking: you try the feature in Salesforce and say whether it works',
        finished: 'finished'
    };

    function renderDocuments(s) {
        documentsList.replaceChildren(
            ...Object.entries(DOC_LABELS)
                .filter(([name]) => s.documents && s.documents[name])
                .map(([name, label]) => h('li', {}, h('button', { class: 'link', type: 'button', onclick: () => openDocument(name) }, label)))
        );
        if (!documentsList.children.length) documentsList.append(h('li', { class: 'muted' }, 'None yet.'));
    }

    async function openDocument(name) {
        document.getElementById('doc-title').textContent = DOC_LABELS[name] || name;
        const body = document.getElementById('doc-body');
        body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
        if (!dialog.open) dialog.showModal();
        const text = await getDocument(name);
        body.replaceChildren(markdown(text));
    }
    document.getElementById('doc-close').addEventListener('click', () => dialog.close());

    // --- Views -----------------------------------------------------------------

    function viewKey(s) {
        if (s.busy) return 'busy';
        if (!s.org) return 'connect';
        if (s.pending) return `pending-${s.pending.id}`;
        if (s.run && s.run.running) return 'running';
        if (s.run && s.run.error) return 'error';
        if (s.state.phase === 'done' && s.acceptance === 'accepted') return 'done';
        if (s.state.phase === 'not-started') return 'describe';
        return 'resume';
    }

    function flashNode() {
        if (!flash) return null;
        const node = h('div', { class: `notice ${flash.kind}`, role: flash.kind === 'error' ? 'alert' : 'status' }, flash.text);
        flash = null;
        return node;
    }

    function viewBusy(s) {
        return [h('div', { class: 'working' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('h1', {}, s.busy))];
    }

    function viewConnect() {
        const list = h('div', {}, h('p', { class: 'muted' }, 'Looking for orgs already connected on this computer…'));
        api('/api/orgs/list', {}).then((data) => {
            if (!data.ok) {
                list.replaceChildren(h('div', { class: 'notice warn' }, data.error));
                return;
            }
            if (!data.orgs.length) {
                list.replaceChildren();
                return;
            }
            const select = h(
                'select',
                { id: 'org-select', 'aria-label': 'Connected orgs' },
                data.orgs.map((o) => h('option', { value: o.alias || o.username }, o.alias ? `${o.alias} (${o.username})` : o.username))
            );
            const use = h('button', { class: 'button secondary', type: 'button' }, 'Use this org');
            use.addEventListener('click', () => act(use, '/api/orgs/use', { target: select.value }));
            list.replaceChildren(h('h2', {}, 'Or use an org that is already connected'), select, h('div', { class: 'actions' }, use));
        });
        const choice = (kind, title, text) =>
            h(
                'button',
                {
                    class: 'choice',
                    type: 'button',
                    onclick: (e) => act(e.currentTarget, '/api/orgs/connect', { kind })
                },
                h('strong', {}, title),
                h('span', {}, text)
            );
        return [
            h('h1', {}, 'Connect your Salesforce org'),
            h('p', {}, 'The agent builds and installs your feature in a Salesforce org. Use a sandbox, never your live org.'),
            h(
                'div',
                { class: 'choice-grid' },
                choice('sandbox', 'Connect a sandbox', 'A copy of your company org for testing. Log in at test.salesforce.com.'),
                choice('developer', 'Connect a Developer Edition org', 'A free practice org. Log in at login.salesforce.com.')
            ),
            h('p', { class: 'muted' }, 'A Salesforce login page opens in a new browser tab. Log in there, then come back to this page.'),
            list
        ];
    }

    function viewDescribe() {
        const text = h('textarea', {
            id: 'intent',
            placeholder: 'For example: When a Lead comes in, give it a score from 0 to 100 so sales reps know who to call first.',
            'aria-label': 'Describe what you need'
        });
        const start = h('button', { class: 'button', type: 'button' }, 'Start');
        start.addEventListener('click', () => act(start, '/api/run/start', { intent: text.value }));
        return [
            h('h1', {}, 'What do you need?'),
            h('p', {}, 'Describe it in your own words: who uses it, what should happen, and why. The agent will ask if anything is unclear.'),
            text,
            h('p', { class: 'muted' }, 'Examples:'),
            h('div', { class: 'examples' }, EXAMPLES.map((ex) => h('button', { class: 'example', type: 'button', onclick: () => (text.value = ex) }, ex.slice(0, 60) + '…'))),
            h('div', { class: 'actions' }, start)
        ];
    }

    function runningHeading(s) {
        const phase = s.state.phase;
        if (phase === 'not-started' || phase === 'inception') return 'Understanding your requirement';
        if (phase === 'construction') {
            const i = s.units.indexOf(s.state.unit);
            const done = s.state.approved.length;
            const n = s.units.length;
            return n ? `Building part ${Math.min((i >= 0 ? i : done) + 1, n)} of ${n}` : 'Building';
        }
        if (phase === 'operations') return 'Checking and installing in your org';
        if (phase === 'done') return 'Finishing up';
        return 'Working';
    }

    function viewRunning(s) {
        const stop = h('button', { class: 'button danger', type: 'button' }, 'Stop');
        stop.addEventListener('click', () => {
            if (window.confirm('Stop the agent? You can continue later from where it stopped.')) act(stop, '/api/run/stop', {});
        });
        return [
            h('div', { class: 'working' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('h1', { id: 'running-heading' }, runningHeading(s))),
            h('p', {}, 'The agent is working. This can take a while: building and testing each part takes several minutes.'),
            h('p', { class: 'muted' }, 'You can leave this page open and come back. It will ask you here when it needs you.'),
            h('div', { class: 'actions' }, stop)
        ];
    }

    function viewQuestions(p) {
        const groups = p.questions.map((q) => {
            const name = `q${q.number}`;
            const other = h('input', { type: 'text', class: 'other-text', placeholder: 'Type your own answer', 'aria-label': `Your own answer to question ${q.number}` });
            const radios = q.options.map((o, i) =>
                h(
                    'label',
                    { class: 'option' },
                    h('input', { type: 'radio', name, value: o.letter, checked: o.recommended || (i === 0 && !q.options.some((x) => x.recommended)) ? true : null }),
                    h('span', {}, o.text, o.recommended ? h('span', { class: 'badge' }, 'Recommended') : null)
                )
            );
            const otherRadio = h('input', { type: 'radio', name, value: '__other' });
            other.addEventListener('focus', () => (otherRadio.checked = true));
            return h(
                'fieldset',
                { class: 'question', 'data-number': q.number },
                h('legend', { class: 'visually-hidden' }, `Question ${q.number}`),
                h('h3', {}, `${q.number}. ${q.text}`),
                q.details.length ? h('p', { class: 'details' }, q.details.join(' ')) : null,
                radios,
                h('label', { class: 'option' }, otherRadio, h('span', {}, 'Something else')),
                other
            );
        });
        const submit = h('button', { class: 'button', type: 'button' }, 'Send answers');
        submit.addEventListener('click', () => {
            const answers = {};
            for (const fs of groups) {
                const n = fs.dataset.number;
                const picked = fs.querySelector('input[type="radio"]:checked');
                if (!picked) continue;
                if (picked.value === '__other') answers[n] = fs.querySelector('.other-text').value.trim();
                else {
                    const q = p.questions.find((x) => String(x.number) === n);
                    const o = q.options.find((x) => x.letter === picked.value);
                    answers[n] = `${o.letter}. ${o.text}`;
                }
            }
            act(submit, '/api/respond', { id: p.id, answers });
        });
        return [
            h('h1', {}, 'A few questions'),
            h('p', {}, 'The agent needs these answers before it can continue. The recommended answer is already picked; change it if it is not right.'),
            groups,
            h('div', { class: 'actions' }, submit)
        ];
    }

    function approvalButtons(p, approveLabel, changeLabel) {
        const comment = h('textarea', { placeholder: 'What should change? (Needed if you ask for changes, optional if you approve.)', 'aria-label': 'Your comments' });
        const approve = h('button', { class: 'button', type: 'button' }, approveLabel);
        const change = h('button', { class: 'button secondary', type: 'button' }, changeLabel);
        approve.addEventListener('click', () => act(approve, '/api/respond', { id: p.id, approve: true, comment: comment.value }));
        change.addEventListener('click', () => act(change, '/api/respond', { id: p.id, approve: false, comment: comment.value }));
        return [h('h3', {}, 'Your comments'), comment, h('div', { class: 'actions' }, approve, change)];
    }

    function viewPlanApproval(p) {
        const stories = h('div', { class: 'review' }, h('p', { class: 'muted' }, 'Loading the plan…'));
        const tech = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
        getDocument('stories').then((t) => stories.replaceChildren(markdown(t)));
        getDocument('units').then((t) => tech.replaceChildren(markdown(t)));
        return [
            h('h1', {}, 'Is this what you want?'),
            h('p', {}, 'The agent turned your requirement into the stories below. Each one says who it is for, what they can do, and how you will check it worked. Nothing is built until you approve.'),
            stories,
            h('details', { class: 'tech' }, h('summary', {}, 'Technical breakdown (for developers)'), tech),
            approvalButtons(p, 'Approve the plan', 'Ask for changes')
        ];
    }

    function viewDeployApproval(p, s) {
        const record = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
        getDocument('deployment').then((t) => record.replaceChildren(markdown(t)));
        return [
            h('h1', {}, 'Ready to install'),
            h(
                'p',
                {},
                `Everything is built, and a trial installation in your ${s.org ? s.org.type.toLowerCase() : 'org'} "${(s.org && (s.org.name || s.org.alias)) || ''}" passed, including all the automatic tests. Approving installs it for real in that org.`
            ),
            h('div', { class: 'notice info' }, 'This only changes the org shown at the top of the page.'),
            h('details', { class: 'tech' }, h('summary', {}, 'Trial installation details (for developers)'), record),
            approvalButtons(p, 'Install it', 'Not yet, change something')
        ];
    }

    function viewGenericGate(p) {
        return [h('h1', {}, 'Approval needed'), h('p', {}, p.nextStep || p.gate), approvalButtons(p, 'Approve', 'Ask for changes')];
    }

    function viewAcceptance(p) {
        const answers = p.items.map(() => ({ ok: null, note: '' }));
        const open = h('button', { class: 'button', type: 'button' }, 'Open Salesforce');
        open.addEventListener('click', () => act(open, '/api/orgs/open', {}));
        const checks = p.items.map((item, i) => {
            const [todo, expect] = item.split(/\s*->\s*/);
            const note = h('textarea', { placeholder: 'What did you see instead?', hidden: true, 'aria-label': `What you saw for check ${i + 1}` });
            const box = h('div', { class: 'check' });
            const yes = h('button', { class: 'button secondary', type: 'button' }, 'It worked');
            const no = h('button', { class: 'button ghost', type: 'button' }, 'It did not work');
            yes.addEventListener('click', () => {
                answers[i].ok = true;
                box.className = 'check yes';
                note.hidden = true;
            });
            no.addEventListener('click', () => {
                answers[i].ok = false;
                box.className = 'check no';
                note.hidden = false;
                note.focus();
            });
            note.addEventListener('input', () => (answers[i].note = note.value));
            box.append(
                h('h3', {}, `${i + 1}. ${todo}`),
                expect ? h('p', {}, h('strong', {}, 'You should see: '), expect) : null,
                h('div', { class: 'check-actions' }, yes, no),
                note
            );
            return box;
        });
        const submit = h('button', { class: 'button', type: 'button' }, 'Send my results');
        submit.addEventListener('click', () => {
            const missing = answers.findIndex((a) => a.ok === null);
            if (missing >= 0) return setFlashInline(`Check ${missing + 1} still needs an answer.`);
            act(submit, '/api/respond', { id: p.id, results: answers });
            return undefined;
        });
        const inline = h('div', {});
        function setFlashInline(text) {
            inline.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, text));
        }
        return [
            h('h1', {}, 'Try it in Salesforce'),
            h('p', {}, 'Your feature is installed. Open Salesforce, try each check below, and say whether it worked. If something did not, the agent will fix it and ask you to check again.'),
            h('div', { class: 'actions' }, open),
            checks,
            inline,
            h('div', { class: 'actions' }, submit)
        ];
    }

    function viewError(s) {
        const retry = h('button', { class: 'button', type: 'button' }, 'Try again');
        retry.addEventListener('click', () => act(retry, '/api/run/start', {}));
        return [
            h('h1', {}, 'The agent stopped'),
            h('div', { class: 'notice error' }, s.run.error),
            h('p', {}, 'Your progress is saved. "Try again" continues from where it stopped.'),
            h('p', { class: 'muted' }, 'If it stops again with the same message, share the aidlc-docs folder and this message with a developer.'),
            h('div', { class: 'actions' }, retry, newRequirementButton('ghost'))
        ];
    }

    function viewResume(s) {
        const go = h('button', { class: 'button', type: 'button' }, s.requirement ? 'Continue this requirement' : 'Continue');
        go.addEventListener('click', () => act(go, '/api/run/start', {}));
        return [
            h('h1', {}, 'A requirement is already in progress'),
            s.requirement
                ? [h('p', {}, 'The agent was working on this:'), h('blockquote', { class: 'big' }, s.requirement)]
                : h('p', {}, 'The agent was part-way through a piece of work.'),
            h('p', {}, h('strong', {}, 'Where it stopped: '), STEP_TEXT[currentStep(s)] || currentStep(s), '.'),
            h('p', { class: 'muted' }, 'Continue to finish it, or start a new requirement to describe something else. Starting new keeps everything already built; the documents for this one are archived.'),
            h('div', { class: 'actions' }, go, newRequirementButton('secondary'))
        ];
    }

    function viewDone() {
        const open = h('button', { class: 'button', type: 'button' }, 'Open Salesforce');
        open.addEventListener('click', () => act(open, '/api/orgs/open', {}));
        return [
            h('h1', {}, 'Done'),
            h('div', { class: 'notice ok' }, 'Your feature is built, installed, and you confirmed it works.'),
            h('p', {}, 'Every answer and approval is kept in the audit trail. A developer can review the code before it goes to your live org.'),
            h(
                'div',
                { class: 'actions' },
                open,
                h('button', { class: 'button secondary', type: 'button', onclick: () => openDocument('audit') }, 'View the audit trail'),
                newRequirementButton('ghost')
            )
        ];
    }

    function newRequirementButton(style) {
        const b = h('button', { class: `button ${style}`, type: 'button' }, 'Start a new requirement');
        b.addEventListener('click', () => {
            if (window.confirm('Start a new requirement? The current documents are archived. Built features stay in the project.')) {
                act(b, '/api/new-requirement', {});
            }
        });
        return b;
    }

    function render(force) {
        const s = status;
        if (!s) return;
        renderSteps(s);
        renderOrgBadge(s);
        renderRequirement(s);
        renderUsage(s);
        renderDocuments(s);
        const key = viewKey(s);
        if (!force && key === currentView) {
            const heading = document.getElementById('running-heading');
            if (heading) heading.textContent = runningHeading(s);
            return;
        }
        currentView = key;
        let nodes;
        if (key === 'busy') nodes = viewBusy(s);
        else if (key === 'connect') nodes = viewConnect();
        else if (key === 'describe') nodes = viewDescribe();
        else if (key === 'running') nodes = viewRunning(s);
        else if (key === 'error') nodes = viewError(s);
        else if (key === 'done') nodes = viewDone(s);
        else if (key === 'resume') nodes = viewResume(s);
        else {
            const p = s.pending;
            if (p.kind === 'questions') nodes = viewQuestions(p);
            else if (p.kind === 'acceptance') nodes = viewAcceptance(p);
            else if (p.gate === 'inception-approval') nodes = viewPlanApproval(p);
            else if (p.gate === 'deploy-approval') nodes = viewDeployApproval(p, s);
            else nodes = viewGenericGate(p);
        }
        main.replaceChildren(...[flashNode(), ...nodes].flat().filter(Boolean));
        const firstHeading = main.querySelector('h1');
        if (firstHeading && force !== true) firstHeading.setAttribute('tabindex', '-1');
    }

    // --- Live updates --------------------------------------------------------

    function connect() {
        const events = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
        events.addEventListener('status', (e) => {
            status = JSON.parse(e.data);
            render(false);
        });
        events.addEventListener('history', (e) => {
            activity.replaceChildren();
            JSON.parse(e.data).forEach(addActivity);
        });
        events.addEventListener('log', (e) => addActivity(JSON.parse(e.data)));
        events.onerror = () => {
            if (events.readyState === EventSource.CLOSED) {
                main.replaceChildren(h('div', { class: 'notice error' }, 'Lost the connection to the builder. Is its window still open? Reload this page once it is running.'));
            }
        };
    }

    connect();
})();
