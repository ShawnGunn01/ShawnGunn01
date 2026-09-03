const state = { owners: [], users: [], currentUserId: null, queueScope: { asOwner: null, backupReason: null } };

// ---------- access control (see src/access.js — not real auth) ----------
// A plain "who are you" selector, not a login. Persisted per-browser in
// localStorage so it doesn't reset every page load. Every API call below
// goes through apiFetch so the X-User-Id header is never accidentally
// left off one endpoint — the server is the actual enforcement point
// (this only drives which buttons render), but it's still one place, not
// scattered fetch() calls each remembering the header themselves.

function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.currentUserId) headers['X-User-Id'] = state.currentUserId;
  return fetch(url, { ...options, headers });
}

function currentUser() {
  return state.users.find((u) => u.id === state.currentUserId) || null;
}

function applyRoleVisibility() {
  const user = currentUser();
  const isAdmin = user && user.role === 'admin';
  document.querySelectorAll('.admin-only').forEach((el) => (el.hidden = !isAdmin));
  document.querySelectorAll('.viewer-only').forEach((el) => (el.hidden = isAdmin));
  const badge = document.getElementById('role-badge');
  if (user) {
    badge.textContent = user.role;
    badge.className = `badge ${user.role}`;
  }
}

async function initUserSwitcher() {
  state.users = await apiFetch('/api/users').then((r) => r.json());
  const sel = document.getElementById('user-select');
  sel.innerHTML = state.users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('');

  const saved = localStorage.getItem('winback-user-id');
  state.currentUserId = state.users.find((u) => u.id === saved) ? saved : state.users[0].id;
  sel.value = state.currentUserId;
  applyRoleVisibility();

  sel.addEventListener('change', () => {
    state.currentUserId = sel.value;
    localStorage.setItem('winback-user-id', state.currentUserId);
    applyRoleVisibility();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    showTab(activeTab || 'dashboard');
  });
}

// ---------- tabs ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

function showTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'queue') loadQueue();
  if (tab === 'accounts') loadAccounts();
  if (tab === 'owners') loadOwners();
}

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function labelize(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------- dashboard ----------
// Layout matches the validated spec exactly: top row = 4 KPI tiles: Active
// Accounts in Cohort, Repeat-Purchase Rate YoY, Reply Rate (30d), Rebooked
// Revenue (QTD). Below-left = Cohort Funnel. Below-right = Recent Activity
// then Proposal Outcomes. Every number below reads directly off the
// dashboard.js calculation it's named after — nothing here is computed or
// estimated client-side. Target/kill reference lines come from
// stats.thresholds (src/thresholds.js), not hardcoded in this file — see
// docs/adding-a-metric.md for why that split matters.

const STATUS_LABEL = { on_track: 'On track', watch: 'Watch', below_kill: 'Below kill threshold', not_applicable: 'N/A' };

// t: { value, kill, killUpper, target, unit, status, note }. Renders a
// thin bar with the current value filled and kill/target reference marks
// — the "so anyone can see at a glance" requirement, not just a number.
function renderThresholdMeter(t) {
  const fmt = (v) => (t.unit === '$' ? money(v) : `${v}${t.unit || ''}`);

  if (t.status === 'not_applicable' || t.value === null || t.value === undefined) {
    return `<div class="threshold-status not_applicable"><span class="dot"></span>${STATUS_LABEL.not_applicable}</div>${t.note ? `<div class="threshold-note">${escapeHtml(t.note)}</div>` : ''}`;
  }

  const candidates = [t.value, t.target, t.killUpper, t.kill].filter((v) => v !== undefined && v !== null);
  const scaleMax = Math.max(...candidates, 1) * 1.25;
  const pct = (v) => Math.max(0, Math.min(100, (v / scaleMax) * 100));

  const markers = [];
  if (t.kill !== undefined) markers.push(`<div class="marker" style="left:${pct(t.kill)}%" data-label="Kill ${fmt(t.kill)}"></div>`);
  if (t.killUpper !== undefined) markers.push(`<div class="marker" style="left:${pct(t.killUpper)}%" data-label="${fmt(t.killUpper)}"></div>`);
  if (t.target !== undefined) markers.push(`<div class="marker" style="left:${pct(t.target)}%" data-label="Target ${fmt(t.target)}"></div>`);

  return `
    <div class="threshold-meter">
      <div class="track">
        <div class="fill ${t.status}" style="width:${pct(t.value)}%"></div>
        ${markers.join('')}
      </div>
      <div class="threshold-status ${t.status}"><span class="dot"></span>${STATUS_LABEL[t.status]}</div>
      ${t.note ? `<div class="threshold-note">${escapeHtml(t.note)}</div>` : ''}
    </div>`;
}

function kpiTile(label, valueDisplay, thresholdData) {
  return `<div class="kpi-tile">
    <div class="value">${valueDisplay}</div>
    <div class="label">${label}</div>
    ${thresholdData ? renderThresholdMeter(thresholdData) : ''}
  </div>`;
}

async function loadDashboard() {
  loadCheckpoints();
  loadReviewPanel();
  const res = await apiFetch('/api/dashboard');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    document.getElementById('kpi-grid').innerHTML = `<div class="card">${escapeHtml(err.error || 'Could not load dashboard.')}</div>`;
    return;
  }
  const stats = await res.json();
  const th = stats.thresholds;

  const banner = document.getElementById('sync-banner');
  if (stats.syncStale) {
    banner.hidden = false;
    banner.textContent = `Sync may be stale — last account sync was ${Math.round(stats.hoursSinceLastSync)}h ago (threshold: 36h). Check Make.com's scenario history.`;
  } else {
    banner.hidden = true;
  }

  // ---- top row: the 4 validated KPI tiles ----
  document.getElementById('kpi-grid').innerHTML = [
    kpiTile('Active Accounts in Cohort', stats.activeAccountsInCohort, th.activeAccountsInCohort),
    kpiTile('Repeat-Purchase Rate (YoY)', `${stats.repeatPurchaseRateYoY}%`, th.repeatPurchaseRateYoY),
    kpiTile('Reply Rate (30d)', `${stats.replyRateLast30}%`, th.replyRateLast30),
    kpiTile('Rebooked Revenue (QTD)', money(stats.rebookedRevenueQTD), th.recoveredRevenueQTD),
  ].join('');

  // ---- below-left: Cohort Funnel ----
  const f = stats.cohortFunnel;
  document.getElementById('cohort-funnel').innerHTML = [
    ['Dormant', f.dormant],
    ['Warm-Up Sent', f.warmUpSent],
    ['Soft Ask Replied', f.softAskReplied],
    ['Incentive Sent', f.incentiveSent],
    ['Rebooked', f.rebooked],
  ]
    .map(([label, value]) => `<div class="funnel-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join('')
    + (f.passThrough.softAskToIncentive !== null
      ? `<div class="card-meta" style="margin-top:8px">Pass-through: Warm-Up→Soft Ask ${f.passThrough.warmUpToSoftAsk ?? '—'}% · Soft Ask→Incentive ${f.passThrough.softAskToIncentive ?? '—'}% · Incentive→Escalation ${f.passThrough.incentiveToEscalation ?? '—'}%</div>`
      : '');

  document.getElementById('funnel-thresholds').innerHTML = `
    <div class="threshold-row">
      <div class="threshold-row-label">Win-Back Conversion Rate (target ≥12%)</div>
      ${renderThresholdMeter(th.winBackConversion)}
    </div>
    <div class="threshold-row">
      <div class="threshold-row-label">Incentive Lift — is the 5% outperforming the free ask?</div>
      <div class="threshold-status ${th.incentiveLift.status}"><span class="dot"></span>${STATUS_LABEL[th.incentiveLift.status]}${th.incentiveLift.status !== 'not_applicable' ? ` — Soft Ask ${th.incentiveLift.softAskReplyRate}% vs. Incentive ${th.incentiveLift.incentiveReplyRate}%` : ''}</div>
      <div class="threshold-note">${escapeHtml(th.incentiveLift.note)}</div>
    </div>`;

  // ---- below-right: Recent Activity, then Proposal Outcomes ----
  document.getElementById('activity-feed').innerHTML =
    stats.recentActivity
      .map((a) => `<div class="activity-row"><span>${escapeHtml(a.summary)}</span><span class="when">${timeAgo(a.at)}</span></div>`)
      .join('') || '<div class="card-meta">No activity yet.</div>';

  const p = stats.proposalOutcomes;
  document.getElementById('proposal-outcomes').innerHTML = [
    ['Open (unresolved)', p.openCount],
    ['Full-Service', p.fullService],
    ['DIY', p.diy],
    ['Lost', p.lost],
    ['Expired, No Response', p.expiredNoResponse],
  ]
    .map(([label, value]) => `<div class="funnel-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join('');

  document.getElementById('proposal-thresholds').innerHTML = `
    <div class="threshold-row-label">Conversion Rate of Resolved (target ≥25%)</div>
    ${renderThresholdMeter(th.proposalConversion)}`;

  // ---- secondary: sync/engine health, not part of the validated layout but operationally necessary ----
  const ab = stats.activeAccountsBreakdown;
  const rev = stats.recoveredRevenueQTD;
  document.getElementById('run-health').innerHTML = [
    ['Active by funnel', `${ab.winBack} Win-Back · ${ab.proposalFollowUp} Proposal Follow-Up · ${ab.nurture} Nurture`],
    ['Recovered revenue split', `${money(rev.winBack)} Win-Back · ${money(rev.proposalFollowUp)} Proposal Follow-Up`],
    ['Pending review / at-risk', `${stats.pendingReviewCount} pending · ${stats.atRiskCount} at-risk (Escalation)`],
    ['Last sync run', stats.lastSyncRun ? `${stats.lastSyncRun.status} · ${timeAgo(stats.lastSyncRun.at)} · +${stats.lastSyncRun.createdCount}/${stats.lastSyncRun.updatedCount} · ${stats.lastSyncRun.skippedCount} skipped` : 'none yet'],
    ['Last engine run', stats.lastEngineRun ? `${stats.lastEngineRun.status} · ${timeAgo(stats.lastEngineRun.at)} · ${stats.lastEngineRun.touchesCreated} drafted · ${stats.lastEngineRun.draftsBlocked || 0} blocked` : 'none yet'],
  ]
    .map(([label, value]) => `<div class="run-row"><span>${label}</span><span>${value}</span></div>`)
    .join('');
}

document.getElementById('btn-run-engine').addEventListener('click', async () => {
  const result = await apiFetch('/api/engine/run', { method: 'POST' }).then((r) => r.json());
  document.getElementById('engine-result').textContent = `Drafted ${result.touchesCreated} touch(es), advanced ${result.accountsAdvanced} account(s)${result.draftsBlocked ? `, ${result.draftsBlocked} blocked by guardrails` : ''}.`;
  loadDashboard();
});

document.getElementById('btn-seed').addEventListener('click', async () => {
  const result = await apiFetch('/api/dev/seed', { method: 'POST' }).then((r) => r.json());
  document.getElementById('engine-result').textContent = `Loaded sample accounts: ${result.created} created, ${result.updated} updated.`;
  loadDashboard();
});

document.getElementById('btn-snapshot').addEventListener('click', async () => {
  await apiFetch('/api/dev/snapshot-metrics', { method: 'POST' });
  document.getElementById('engine-result').textContent = 'Metrics snapshot recorded.';
});

// ---------- pilot checkpoint mode (Prompt 9 Item 3) ----------

document.getElementById('checkpoint-mode-toggle').addEventListener('change', async (e) => {
  await apiFetch('/api/settings/checkpoint-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: e.target.checked }),
  });
  loadCheckpoints();
});

async function loadCheckpoints() {
  const user = currentUser();
  if (!user || user.role !== 'admin') return;

  const settings = await apiFetch('/api/settings').then((r) => r.json());
  document.getElementById('checkpoint-mode-toggle').checked = settings.checkpointMode;

  const pending = await apiFetch('/api/checkpoints?status=pending').then((r) => r.json());
  const card = document.getElementById('checkpoints-card');
  const list = document.getElementById('checkpoints-list');

  if (!settings.checkpointMode && pending.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  list.innerHTML = pending.length
    ? pending
        .map(
          (c) => `<div class="card-row" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div>
              <strong>${escapeHtml(c.account ? c.account.name : c.accountId)}</strong>
              <span class="card-meta">${labelize(c.funnel)} · ${labelize(c.stage)} · proposed ${timeAgo(c.createdAt)}</span>
            </div>
            <div class="actions">
              <button data-approve-checkpoint="${c.id}">Approve</button>
              <button class="secondary" data-reject-checkpoint="${c.id}">Reject</button>
            </div>
          </div>`
        )
        .join('')
    : '<div class="card-meta">Nothing awaiting approval right now.</div>';

  list.querySelectorAll('[data-approve-checkpoint]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/api/checkpoints/${btn.dataset.approveCheckpoint}/approve`, { method: 'POST' });
      loadCheckpoints();
      loadDashboard();
    });
  });
  list.querySelectorAll('[data-reject-checkpoint]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const reason = prompt('Reason for rejecting this transition (logged):', '');
      if (reason === null) return;
      await apiFetch(`/api/checkpoints/${btn.dataset.rejectCheckpoint}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      loadCheckpoints();
    });
  });
}

// ---------- monthly operating review (Prompt 10) ----------

async function loadReviewPanel() {
  const user = currentUser();
  if (!user || user.role !== 'admin') return;

  const settings = await apiFetch('/api/settings').then((r) => r.json());
  const toolbar = document.getElementById('review-toolbar');
  toolbar.innerHTML = [
    settings.rolloutDate
      ? `<span class="hint">Full rollout marked: ${settings.rolloutDate}</span>`
      : `<button class="secondary" id="btn-mark-rollout">Mark Full Rollout</button>`,
    `<button class="secondary" id="btn-generate-review">Generate Review Now</button>`,
  ].join(' ');

  document.getElementById('btn-mark-rollout')?.addEventListener('click', async () => {
    if (!confirm('Mark full rollout as starting today? This is what the 30-day monthly review cadence counts from.')) return;
    await apiFetch('/api/settings/mark-rollout', { method: 'POST' });
    loadReviewPanel();
  });
  document.getElementById('btn-generate-review').addEventListener('click', async () => {
    await apiFetch('/api/reviews/monthly/generate', { method: 'POST' });
    loadReviewPanel();
  });

  const reviewsList = await apiFetch('/api/reviews/monthly?limit=1').then((r) => r.json());
  const panel = document.getElementById('review-panel');
  if (reviewsList.length === 0) {
    panel.innerHTML = '<div class="card-meta">No review generated yet.</div>';
    return;
  }
  const r = reviewsList[0];

  const escalationsHtml = r.escalations.length
    ? `<div class="threshold-status below_kill" style="margin-top:8px"><span class="dot"></span>${r.escalations.length} metric(s) missed target two reviews running: ${r.escalations.map((e) => labelize(e.metric)).join(', ')} — escalate per the operating cadence doc.</div>`
    : `<div class="threshold-status on_track" style="margin-top:8px"><span class="dot"></span>No metric has missed target two reviews running.</div>`;

  panel.innerHTML = `
    <div class="card-meta">Period: ${r.periodLabel} · generated ${timeAgo(r.generatedAt)}</div>
    <div class="run-row"><span>Draft edit rate</span><span>${r.draftEditRate.rate === null ? 'no sends yet' : `${r.draftEditRate.rate}% (${r.draftEditRate.editedSends}/${r.draftEditRate.totalSends} sends edited before send)`}</span></div>
    <div class="run-row"><span>Opt-outs, last 30 days</span><span>${r.optOutTrend.newOptOutsLast30d} new · ${r.optOutTrend.cumulativeRate === null ? 'n/a' : `${r.optOutTrend.cumulativeRate}%`} cumulative of ${r.optOutTrend.totalEverSynced} ever synced</span></div>
    <div class="run-row"><span>Flagged drafts</span><span>${r.feedbackSummary.totalFlags} total${r.feedbackSummary.totalFlags ? ' — ' + Object.entries(r.feedbackSummary.byCategory).map(([k, v]) => `${labelize(k)}: ${v}`).join(', ') : ''}</span></div>
    ${escalationsHtml}`;
}

// ---------- review queue (per-owner; Prompt 8) ----------
// Default: a viewer's queue is scoped to their OWN drafts server-side
// (src/access.js resolveQueueScope) — this file just reflects that scope
// in the UI and offers the one documented door into someone else's queue:
// backup coverage, which requires a reason and is logged server-side.

function queueUrl(base) {
  const params = new URLSearchParams();
  const user = currentUser();
  if (user && user.role === 'admin') {
    const adminFilter = document.getElementById('queue-owner-filter-admin')?.value;
    if (adminFilter) params.set('ownerId', adminFilter);
  } else if (state.queueScope.asOwner) {
    params.set('asOwner', state.queueScope.asOwner);
    params.set('backupReason', state.queueScope.backupReason || '');
  }
  const qs = params.toString();
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;
}

async function renderQueueScopeBar() {
  const user = currentUser();
  const label = document.getElementById('queue-scope-label');
  const adminOnlyEl = document.querySelector('#queue-scope-bar .admin-only');
  const backupEl = document.getElementById('backup-access-control');

  if (user && user.role === 'admin') {
    adminOnlyEl.hidden = false;
    backupEl.innerHTML = '';
    const sel = document.getElementById('queue-owner-filter-admin');
    if (sel.options.length <= 1) {
      sel.innerHTML = '<option value="">All</option>' + state.owners.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
      sel.addEventListener('change', loadQueue);
    }
    label.textContent = 'Admin view — full visibility, no backup flag needed.';
    return;
  }

  adminOnlyEl.hidden = true;

  if (state.queueScope.asOwner) {
    const target = state.owners.find((o) => o.id === state.queueScope.asOwner);
    label.textContent = `Viewing ${target ? target.name : state.queueScope.asOwner}'s queue — backup coverage ("${state.queueScope.backupReason}")`;
    backupEl.innerHTML = `<button class="secondary" id="btn-return-own-queue">Return to my queue</button>`;
    document.getElementById('btn-return-own-queue').addEventListener('click', () => {
      state.queueScope = { asOwner: null, backupReason: null };
      loadQueue();
    });
    return;
  }

  label.textContent = 'Viewing your own queue.';
  // Backup coverage only offered if the Owners tab has THIS user's own
  // record naming who they cover (store.js DEFAULT_OWNERS backupFor —
  // "[this owner] is backup for [backupFor]") — not self-declared.
  const myOwnerRecord = state.owners.find((o) => o.id === user.id);
  const covers = myOwnerRecord && myOwnerRecord.backupFor ? state.owners.find((o) => o.id === myOwnerRecord.backupFor) : null;
  if (covers) {
    backupEl.innerHTML = `<button class="secondary" id="btn-cover-queue">Cover ${escapeHtml(covers.name)}'s queue (backup)</button>`;
    document.getElementById('btn-cover-queue').addEventListener('click', () => {
      const reason = prompt(`Reason for viewing ${covers.name}'s queue (logged for audit):`, '');
      if (!reason || !reason.trim()) return;
      state.queueScope = { asOwner: covers.id, backupReason: reason.trim() };
      loadQueue();
    });
  } else {
    backupEl.innerHTML = '';
  }
}

function queueCard(t, { pending }) {
  const owner = state.owners.find((o) => o.id === t.ownerId);
  const kindBadge = t.kind === 'call_flag' ? '<span class="badge call_flag">Call / Text — At Risk</span>' : '';
  const editedBadge = t.wasEditedAtSend ? '<span class="badge sent">Edited before send</span>' : '';

  const body = pending
    ? t.kind === 'call_flag'
      ? `<div class="card-meta">${escapeHtml(t.body)}</div>`
      : `<input class="subject" data-field="subject" value="${escapeHtml(t.subject)}" />
         <textarea rows="6" data-field="body">${escapeHtml(t.body)}</textarea>`
    : `<div class="card-meta">${escapeHtml(t.subject || '')}</div>`;

  const actions = pending
    ? t.kind === 'call_flag'
      ? `<div class="actions">
          <button data-handled="${t.id}">Mark Handled (Called/Texted)</button>
          <button class="secondary" data-status="skipped" data-id="${t.id}">Skip</button>
        </div>`
      : `<div class="actions">
          <button class="secondary" data-save="${t.id}">Save Draft</button>
          <button data-send="${t.id}">Approve &amp; Send</button>
          <button class="secondary" data-status="skipped" data-id="${t.id}">Skip</button>
          <button class="secondary" data-flag="${t.id}" title="Report this specific draft as bad, with a reason — feeds the monthly review">Flag Draft</button>
        </div>
        <div class="hint send-error" id="send-error-${t.id}"></div>`
    : `<div class="actions">
        <button data-status="replied" data-id="${t.id}">Mark Replied</button>
        <button class="secondary" data-status="out_of_office" data-id="${t.id}" title="Auto-reply or OOO — not a real reply, excluded from the reply-rate metric">Out of Office</button>
        <button class="secondary" data-flag="${t.id}" title="Report this specific draft as bad, with a reason — feeds the monthly review">Flag Draft</button>
      </div>`;

  return `<div class="card queue-card" data-touch="${t.id}">
    <div class="card-row">
      <div>
        <h3>${escapeHtml(t.account ? t.account.name : t.accountId)}</h3>
        <div class="card-meta">${labelize(t.funnel)} · ${labelize(t.stage)} · owner: ${escapeHtml(owner ? owner.name : t.ownerId)} ${kindBadge} ${editedBadge}</div>
      </div>
    </div>
    ${body}
    ${actions}
  </div>`;
}

async function loadQueue() {
  if (state.owners.length === 0) {
    state.owners = await apiFetch('/api/owners').then((r) => r.json());
  }
  await renderQueueScopeBar();

  const [pendingTouches, sentTouches] = await Promise.all([
    apiFetch(queueUrl('/api/touches?status=pending_review')).then((r) => r.json()),
    apiFetch(queueUrl('/api/touches?status=sent')).then((r) => r.json()),
  ]);

  const list = document.getElementById('queue-list');
  list.innerHTML = pendingTouches.length
    ? pendingTouches.map((t) => queueCard(t, { pending: true })).join('')
    : '<div class="card">Nothing waiting on review. Run the cohort engine from the Dashboard tab to draft due touches.</div>';

  const sentList = document.getElementById('sent-list');
  sentList.innerHTML = sentTouches.length
    ? sentTouches.map((t) => queueCard(t, { pending: false })).join('')
    : '<div class="card">Nothing sent yet awaiting a reply.</div>';

  list.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await saveDraftEdits(btn.closest('.queue-card'), btn.dataset.save);
      btn.textContent = 'Saved';
      setTimeout(() => (btn.textContent = 'Save Draft'), 1200);
    });
  });

  list.querySelectorAll('[data-send]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.send;
      const card = btn.closest('.queue-card');
      const errEl = document.getElementById(`send-error-${id}`);
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Sending…';

      // Save whatever's currently in the fields first — Approve & Send
      // always sends the CURRENT edited content, never stale server state.
      await saveDraftEdits(card, id);

      const backupReason = state.queueScope.asOwner ? state.queueScope.backupReason : undefined;
      const res = await apiFetch(`/api/touches/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupReason ? { backupReason } : {}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Send failed.' }));
        errEl.textContent = err.details ? `${err.error} ${err.details.join('; ')}` : err.error;
        btn.disabled = false;
        btn.textContent = 'Approve & Send';
        return;
      }
      loadQueue();
    });
  });

  list.querySelectorAll('[data-handled]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/api/touches/${btn.dataset.handled}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent' }),
      });
      loadQueue();
    });
  });

  document.querySelectorAll('#queue-list [data-flag], #sent-list [data-flag]').forEach((btn) => {
    btn.addEventListener('click', () => flagDraft(btn.dataset.flag));
  });

  document.querySelectorAll('#queue-list [data-status], #sent-list [data-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/api/touches/${btn.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.status }),
      });
      loadQueue();
    });
  });
}

async function saveDraftEdits(card, id) {
  const subjectEl = card.querySelector('[data-field="subject"]');
  const bodyEl = card.querySelector('[data-field="body"]');
  if (!subjectEl && !bodyEl) return;
  const patch = {};
  if (subjectEl) patch.subject = subjectEl.value;
  if (bodyEl) patch.body = bodyEl.value;
  await apiFetch(`/api/touches/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

// ---------- flag a bad draft (Prompt 10 Item 3) ----------

const FLAG_CATEGORIES = ['tone', 'factual_accuracy', 'wrong_cta', 'links', 'other'];

async function flagDraft(touchId) {
  const category = prompt(`Flag category — one of: ${FLAG_CATEGORIES.join(', ')}`, 'tone');
  if (!category) return;
  if (!FLAG_CATEGORIES.includes(category.trim())) {
    alert(`Category must be one of: ${FLAG_CATEGORIES.join(', ')}`);
    return;
  }
  const reason = prompt('Reason — be specific, this feeds future prompt tuning for the drafting engine:', '');
  if (!reason || !reason.trim()) return;

  const res = await apiFetch(`/api/touches/${touchId}/flag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: category.trim(), reason: reason.trim() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Could not flag this draft.' }));
    alert(err.error);
    return;
  }
  alert('Flagged. This rolls up into the monthly review.');
}

// ---------- accounts ----------

async function loadAccounts() {
  const accounts = await apiFetch('/api/accounts').then((r) => r.json());
  const tbody = document.querySelector('#accounts-table tbody');
  tbody.innerHTML = accounts
    .map((a) => {
      const funnel = a.optedOut ? 'opted_out' : a.funnel || 'none';
      return `<tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.ownerId)}</td>
        <td><span class="badge ${funnel}">${a.optedOut ? 'Opted Out' : labelize(a.funnel || 'none')}</span></td>
        <td>${labelize(a.stage) || '—'}</td>
        <td>${a.lastPurchaseDate || '—'}</td>
        <td>${a.lastTouchDate || '—'}</td>
        <td>
          ${
            a.funnel === 'win_back'
              ? `<button class="secondary" data-rebook="${a.id}">Mark Rebooked</button>`
              : ''
          }
          ${
            a.funnel === 'proposal_follow_up'
              ? `<button class="secondary" data-outcome="${a.id}">Record Outcome</button>`
              : ''
          }
          ${!a.optedOut ? `<button class="secondary" data-optout="${a.id}">Opt Out</button>` : ''}
        </td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('[data-rebook]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const amount = prompt('Rebooked revenue amount ($):', '0');
      if (amount === null) return;
      await apiFetch(`/api/accounts/${btn.dataset.rebook}/rebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount) || 0 }),
      });
      loadAccounts();
    });
  });

  tbody.querySelectorAll('[data-outcome]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const outcome = prompt('Outcome — full_service, diy, or lost:', 'full_service');
      if (!outcome) return;
      const body = { outcome };
      if (outcome === 'full_service' || outcome === 'diy') {
        body.amount = Number(prompt('Deal amount ($):', '4500') || 0);
      } else if (outcome === 'lost') {
        body.lostReason = prompt('Reason (required) — declined, competitor, budget, went dormant, other:', 'declined');
        if (!body.lostReason) return;
      }
      const res = await apiFetch(`/api/accounts/${btn.dataset.outcome}/proposal/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error);
        return;
      }
      loadAccounts();
    });
  });

  tbody.querySelectorAll('[data-optout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Opt this account out of all automated touches?')) return;
      await apiFetch(`/api/accounts/${btn.dataset.optout}/opt-out`, { method: 'POST' });
      loadAccounts();
    });
  });
}

// ---------- owners ----------

async function loadOwners() {
  const owners = await apiFetch('/api/owners').then((r) => r.json());
  state.owners = owners; // keep the queue's copy in sync too
  const list = document.getElementById('owners-list');
  list.innerHTML = owners
    .map((o) => {
      const gmailStatus = o.gmailTokens && o.gmailTokens.email
        ? `<span class="threshold-status on_track"><span class="dot"></span>Connected as ${escapeHtml(o.gmailTokens.email)}</span>`
        : `<span class="threshold-status below_kill"><span class="dot"></span>Not connected — sends for ${escapeHtml(o.name)} are blocked until this is done</span>`;
      return `<div class="card">
        <h3>${escapeHtml(o.name)}</h3>
        <label>Email</label><input data-owner="${o.id}" data-field="email" value="${escapeHtml(o.email)}" />
        <label>Calendly Link</label><input data-owner="${o.id}" data-field="calendlyLink" value="${escapeHtml(o.calendlyLink)}" />
        <div class="card-meta" style="margin-top:8px">Backup for: ${escapeHtml(o.backupFor || '—')}</div>
        <div class="threshold-note" style="margin-top:10px">${gmailStatus}</div>
        <div class="actions" style="margin-top:10px">
          <button data-save-owner="${o.id}">Save</button>
          ${o.gmailTokens && o.gmailTokens.email
            ? `<button class="secondary" data-gmail-disconnect="${o.id}">Disconnect Gmail</button>`
            : `<button class="secondary" data-gmail-connect="${o.id}">Connect Gmail</button>`}
        </div>
      </div>`;
    })
    .join('');

  list.querySelectorAll('[data-save-owner]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      const patch = {};
      card.querySelectorAll('[data-field]').forEach((input) => {
        patch[input.dataset.field] = input.value;
      });
      await apiFetch(`/api/owners/${btn.dataset.saveOwner}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      btn.textContent = 'Saved';
      setTimeout(() => (btn.textContent = 'Save'), 1200);
    });
  });

  list.querySelectorAll('[data-gmail-connect]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await apiFetch(`/api/owners/${btn.dataset.gmailConnect}/gmail/connect`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Gmail connect is not available.' }));
        alert(err.error);
        return;
      }
      const { authUrl } = await res.json();
      window.open(authUrl, '_blank', 'noopener');
    });
  });

  list.querySelectorAll('[data-gmail-disconnect]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Disconnect this Gmail account? Sends for this owner will be blocked until reconnected.')) return;
      await apiFetch(`/api/owners/${btn.dataset.gmailDisconnect}/gmail/disconnect`, { method: 'POST' });
      loadOwners();
    });
  });
}

// ---------- init ----------

initUserSwitcher().then(loadDashboard);
