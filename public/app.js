const state = { owners: [] };

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

async function loadDashboard() {
  const stats = await fetch('/api/dashboard').then((r) => r.json());

  const banner = document.getElementById('sync-banner');
  if (stats.syncStale) {
    banner.hidden = false;
    banner.textContent = `Sync may be stale — last account sync was ${Math.round(stats.hoursSinceLastSync)}h ago (threshold: 36h). Check Make.com's scenario history.`;
  } else {
    banner.hidden = true;
  }

  const cards = [
    ['Active Accounts in Cohort', stats.activeAccountsInCohort],
    ['Repeat-Purchase Rate (lifetime, pilot proxy)', `${stats.repeatPurchaseRateYoY}%`],
    ['Reply Rate (30d)', `${stats.replyRateLast30}%`],
    ['Recovered Revenue (QTD)', money(stats.rebookedRevenueQTD)],
    ['Pending Review', stats.pendingReviewCount],
    ['At-Risk (Escalation)', stats.atRiskCount],
  ];
  document.getElementById('stat-grid').innerHTML = cards
    .map(([label, value]) => `<div class="stat-card"><div class="value">${value}</div><div class="label">${label}</div></div>`)
    .join('');

  const ab = stats.activeAccountsBreakdown;
  const rev = stats.recoveredRevenueQTD;
  document.getElementById('run-health').innerHTML = [
    ['Active by funnel', `${ab.winBack} Win-Back · ${ab.proposalFollowUp} Proposal Follow-Up · ${ab.nurture} Nurture`],
    ['Recovered revenue split', `${money(rev.winBack)} Win-Back · ${money(rev.proposalFollowUp)} Proposal Follow-Up`],
    ['Last sync run', stats.lastSyncRun ? `${stats.lastSyncRun.status} · ${timeAgo(stats.lastSyncRun.at)} · +${stats.lastSyncRun.createdCount}/${stats.lastSyncRun.updatedCount} · ${stats.lastSyncRun.skippedCount} skipped` : 'none yet'],
    ['Last engine run', stats.lastEngineRun ? `${stats.lastEngineRun.status} · ${timeAgo(stats.lastEngineRun.at)} · ${stats.lastEngineRun.touchesCreated} drafted` : 'none yet'],
  ]
    .map(([label, value]) => `<div class="run-row"><span>${label}</span><span>${value}</span></div>`)
    .join('');

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

  document.getElementById('activity-feed').innerHTML =
    stats.recentActivity
      .map((a) => `<div class="activity-row"><span>${escapeHtml(a.summary)}</span><span class="when">${timeAgo(a.at)}</span></div>`)
      .join('') || '<div class="card-meta">No activity yet.</div>';
}

document.getElementById('btn-run-engine').addEventListener('click', async () => {
  const result = await fetch('/api/engine/run', { method: 'POST' }).then((r) => r.json());
  document.getElementById('engine-result').textContent = `Drafted ${result.touchesCreated} touch(es), advanced ${result.accountsAdvanced} account(s).`;
  loadDashboard();
});

document.getElementById('btn-seed').addEventListener('click', async () => {
  const result = await fetch('/api/dev/seed', { method: 'POST' }).then((r) => r.json());
  document.getElementById('engine-result').textContent = `Loaded sample accounts: ${result.created} created, ${result.updated} updated.`;
  loadDashboard();
});

// ---------- review queue ----------

async function loadQueue() {
  if (state.owners.length === 0) {
    state.owners = await fetch('/api/owners').then((r) => r.json());
    const sel = document.getElementById('queue-owner-filter');
    sel.innerHTML = '<option value="">All</option>' + state.owners.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
    sel.addEventListener('change', loadQueue);
  }

  const ownerId = document.getElementById('queue-owner-filter').value;
  const url = ownerId ? `/api/touches?status=pending_review&ownerId=${ownerId}` : '/api/touches?status=pending_review';
  const touches = await fetch(url).then((r) => r.json());
  const list = document.getElementById('queue-list');

  if (touches.length === 0) {
    list.innerHTML = '<div class="card">Nothing waiting on review. Run the cohort engine from the Dashboard tab to draft due touches.</div>';
    return;
  }

  list.innerHTML = touches
    .map((t) => {
      const owner = state.owners.find((o) => o.id === t.ownerId);
      const kindBadge = t.kind === 'call_flag' ? '<span class="badge call_flag">Call / Text — At Risk</span>' : '';
      return `<div class="card queue-card" data-touch="${t.id}">
        <div class="card-row">
          <div>
            <h3>${escapeHtml(t.account ? t.account.name : t.accountId)}</h3>
            <div class="card-meta">${labelize(t.funnel)} · ${labelize(t.stage)} · owner: ${escapeHtml(owner ? owner.name : t.ownerId)} ${kindBadge}</div>
          </div>
        </div>
        ${
          t.kind === 'call_flag'
            ? `<div class="card-meta">${escapeHtml(t.body)}</div>`
            : `<input class="subject" data-field="subject" value="${escapeHtml(t.subject)}" />
               <textarea rows="6" data-field="body">${escapeHtml(t.body)}</textarea>`
        }
        <div class="actions">
          <button data-save="${t.id}">Save Edits</button>
          <button data-status="sent" data-id="${t.id}">Mark Sent</button>
          <button class="secondary" data-status="replied" data-id="${t.id}">Mark Replied</button>
          <button class="secondary" data-status="out_of_office" data-id="${t.id}" title="Auto-reply or OOO — not a real reply, excluded from the reply-rate metric">Out of Office</button>
          <button class="secondary" data-status="skipped" data-id="${t.id}">Skip</button>
        </div>
      </div>`;
    })
    .join('');

  list.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.queue-card');
      const body = {};
      const subjectEl = card.querySelector('[data-field="subject"]');
      const bodyEl = card.querySelector('[data-field="body"]');
      if (subjectEl) body.subject = subjectEl.value;
      if (bodyEl) body.body = bodyEl.value;
      await fetch(`/api/touches/${btn.dataset.save}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      btn.textContent = 'Saved';
      setTimeout(() => (btn.textContent = 'Save Edits'), 1200);
    });
  });

  list.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/touches/${btn.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.status }),
      });
      loadQueue();
    });
  });
}

// ---------- accounts ----------

async function loadAccounts() {
  const accounts = await fetch('/api/accounts').then((r) => r.json());
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
      await fetch(`/api/accounts/${btn.dataset.rebook}/rebook`, {
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
      const res = await fetch(`/api/accounts/${btn.dataset.outcome}/proposal/outcome`, {
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
      await fetch(`/api/accounts/${btn.dataset.optout}/opt-out`, { method: 'POST' });
      loadAccounts();
    });
  });
}

// ---------- owners ----------

async function loadOwners() {
  const owners = await fetch('/api/owners').then((r) => r.json());
  const list = document.getElementById('owners-list');
  list.innerHTML = owners
    .map(
      (o) => `<div class="card">
        <h3>${escapeHtml(o.name)}</h3>
        <label>Email</label><input data-owner="${o.id}" data-field="email" value="${escapeHtml(o.email)}" />
        <label>Calendly Link</label><input data-owner="${o.id}" data-field="calendlyLink" value="${escapeHtml(o.calendlyLink)}" />
        <div class="card-meta" style="margin-top:8px">Backup for: ${escapeHtml(o.backupFor || '—')}</div>
        <div class="actions" style="margin-top:10px"><button data-save-owner="${o.id}">Save</button></div>
      </div>`
    )
    .join('');

  list.querySelectorAll('[data-save-owner]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      const patch = {};
      card.querySelectorAll('[data-field]').forEach((input) => {
        patch[input.dataset.field] = input.value;
      });
      await fetch(`/api/owners/${btn.dataset.saveOwner}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      btn.textContent = 'Saved';
      setTimeout(() => (btn.textContent = 'Save'), 1200);
    });
  });
}

// ---------- init ----------

loadDashboard();
