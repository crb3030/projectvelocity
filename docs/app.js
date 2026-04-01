/* ── Data Store ───────────────────────────────────────────────────── */
let DATA = {};

async function loadData() {
    const res = await fetch('data.json');
    DATA = await res.json();
    return DATA;
}

/* ── Toast ────────────────────────────────────────────────────────── */
function showToast(message, type) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast ' + (type || '');
    setTimeout(() => { toast.className = 'toast hidden'; }, 3500);
}

/* ── Modal ────────────────────────────────────────────────────────── */
function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
});

document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'modal-overlay') closeModal();
});

/* ── Helpers ──────────────────────────────────────────────────────── */
function row(label, value) {
    return '<div class="detail-label">' + label + '</div><div class="detail-value">' + value + '</div>';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(iso) {
    if (!iso) return '—';
    return iso.replace('T', ' ').substring(0, 16);
}

function badgeHtml(status) {
    return '<span class="badge badge-' + status + '">' + status + '</span>';
}

/* ── Dashboard ───────────────────────────────────────────────────── */
function renderDashboard() {
    const s = DATA.stats;
    document.getElementById('stat-transactions').textContent = s.total_today;
    document.getElementById('stat-violations').textContent = s.violations_today;
    document.getElementById('stat-suppressed').textContent = s.suppressed_today;
    document.getElementById('stat-unprocessed').textContent = s.unprocessed;

    // Corridors
    const corridorBody = document.getElementById('corridor-body');
    if (corridorBody && s.corridors) {
        corridorBody.innerHTML = s.corridors.map(c =>
            `<tr><td>${c.corridor}</td><td><strong>${c.cnt}</strong></td></tr>`
        ).join('');
    }

    // Transactions table
    const txnBody = document.getElementById('txn-body');
    if (txnBody) {
        txnBody.innerHTML = DATA.transactions.map(t =>
            `<tr>
                <td><strong>${t.license_plate}</strong></td>
                <td>${t.vehicle_class}</td>
                <td>${t.booth_name}</td>
                <td>${formatDate(t.timestamp)}</td>
                <td>${t.transponder_id || '—'}</td>
                <td>${t.payment_method}</td>
                <td>$${t.amount_charged.toFixed(2)}</td>
                <td>${t.processed ? badgeHtml('issued') : badgeHtml('pending')}</td>
            </tr>`
        ).join('');
    }
}

function simulateProcess() {
    showToast('Demo mode: Processed 409 transactions — 31 violations issued, 41 suppressed', 'success');
}

/* ── Violations ──────────────────────────────────────────────────── */
function renderViolations(statusFilter, segmentFilter) {
    let list = DATA.violations;
    if (statusFilter && statusFilter !== 'all') {
        list = list.filter(v => v.status === statusFilter);
    }
    if (segmentFilter && segmentFilter !== 'all') {
        list = list.filter(v => v.segment_id === parseInt(segmentFilter));
    }

    document.getElementById('violation-count').textContent =
        list.length + ' Violation' + (list.length !== 1 ? 's' : '');

    const tbody = document.getElementById('violation-body');
    tbody.innerHTML = list.map(v =>
        `<tr class="clickable" onclick="showViolation(${v.id})">
            <td>#${v.id}</td>
            <td><strong>${v.license_plate}</strong></td>
            <td>${v.entry_booth} &rarr; ${v.exit_booth}</td>
            <td class="speed-over">${v.calculated_speed_mph} mph</td>
            <td>${v.speed_limit_mph} mph</td>
            <td class="speed-over">+${v.over_limit_mph} mph</td>
            <td>${v.owner_name || '—'}</td>
            <td>${badgeHtml(v.status)}</td>
            <td class="text-sm text-muted">${formatDate(v.created_at)}</td>
            <td><button class="btn btn-secondary btn-sm">Details</button></td>
        </tr>`
    ).join('');

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><p>No violations found matching your filters.</p></td></tr>';
    }
}

function showViolation(id) {
    const v = DATA.violations.find(x => x.id === id);
    if (!v) return;
    const o = DATA.owners[v.license_plate];

    let html = '<div class="detail-grid">';
    html += row('Violation ID', '#' + v.id);
    html += row('Status', badgeHtml(v.status));
    html += row('License Plate', v.license_plate);
    html += row('Entry Booth', v.entry_booth);
    html += row('Entry Time', formatDate(v.entry_time));
    html += row('Exit Booth', v.exit_booth);
    html += row('Exit Time', formatDate(v.exit_time));
    html += row('Avg Speed', '<span class="speed-over">' + v.calculated_speed_mph + ' mph</span>');
    html += row('Speed Limit', v.speed_limit_mph + ' mph');
    html += row('Leniency', '+' + v.leniency_mph + ' mph');
    html += row('Over Limit By', '<span class="speed-over">+' + v.over_limit_mph + ' mph</span>');

    if (v.suppression_reason) {
        html += row('Suppression', v.suppression_reason);
    }
    if (o) {
        html += row('Owner', o.owner_name);
        html += row('Email', o.owner_email);
        html += row('Address', o.address);
        html += row('Vehicle', o.vehicle_year + ' ' + o.vehicle_make + ' ' + o.vehicle_model);
        html += row('Transponder', o.transponder_id || '—');
    }
    html += row('Created', formatDate(v.created_at));
    html += '</div>';

    openModal('Violation #' + v.id, html);
}

function initViolationFilters() {
    // Populate segment filter
    const segSelect = document.getElementById('segment-filter');
    if (segSelect && DATA.segments) {
        DATA.segments.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.booth_a_name + ' → ' + s.booth_b_name;
            segSelect.appendChild(opt);
        });
    }

    const statusSelect = document.getElementById('status-filter');
    const applyFilters = () => {
        renderViolations(statusSelect?.value, segSelect?.value);
    };
    statusSelect?.addEventListener('change', applyFilters);
    segSelect?.addEventListener('change', applyFilters);

    renderViolations('all', 'all');
}

/* ── Emails ──────────────────────────────────────────────────────── */
function renderEmails() {
    const count = document.getElementById('email-count');
    if (count) count.textContent = DATA.emails.length + ' Email' + (DATA.emails.length !== 1 ? 's' : '');

    const tbody = document.getElementById('email-body');
    if (!tbody) return;
    tbody.innerHTML = DATA.emails.map(e =>
        `<tr>
            <td>#${e.id}</td>
            <td><strong>${e.recipient_name}</strong></td>
            <td>${e.recipient_email}</td>
            <td>${e.subject}</td>
            <td>${e.license_plate}</td>
            <td class="speed-over">${e.calculated_speed_mph} mph</td>
            <td>${e.speed_limit_mph} mph</td>
            <td class="text-sm text-muted">${formatDate(e.simulated_sent_at)}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="showEmail(${e.id})">View</button></td>
        </tr>`
    ).join('');
}

function showEmail(id) {
    const e = DATA.emails.find(x => x.id === id);
    if (!e) return;

    let html = '<div class="detail-grid mb-4">';
    html += row('To', e.recipient_name + ' &lt;' + e.recipient_email + '&gt;');
    html += row('Subject', e.subject);
    html += row('Sent At', formatDate(e.simulated_sent_at));
    html += '</div>';
    html += '<pre>' + escapeHtml(e.body) + '</pre>';

    openModal('Email #' + e.id, html);
}

/* ── Officer Citations ───────────────────────────────────────────── */
function renderOfficerCitations() {
    const list = DATA.officer_citations;

    document.getElementById('oc-total').textContent = list.length;
    document.getElementById('oc-recent').textContent = list.length;
    document.getElementById('oc-suppressed').textContent = DATA.stats.officer_suppressed;

    const tbody = document.getElementById('oc-body');
    if (!tbody) return;
    tbody.innerHTML = list.map(c =>
        `<tr class="clickable" onclick="showOfficerDetail(${c.id})">
            <td><span class="citation-id">#${c.id}</span></td>
            <td><strong class="plate-tag">${c.license_plate}</strong></td>
            <td>
                ${c.owner_name ? `<div>${c.owner_name}</div><div class="text-sm text-muted">${c.vehicle_year} ${c.vehicle_make} ${c.vehicle_model}</div>` : '<span class="text-muted">Not on file</span>'}
            </td>
            <td>
                <div class="segment-label">${c.booth_a_name}</div>
                <div class="segment-arrow">&darr;</div>
                <div class="segment-label">${c.booth_b_name}</div>
                <div class="text-sm text-muted">${c.speed_limit_mph} mph zone</div>
            </td>
            <td>
                <div>${c.officer_name || '—'}</div>
                ${c.officer_badge ? `<div class="text-sm text-muted">Badge ${c.officer_badge}</div>` : ''}
            </td>
            <td>
                ${c.speed_recorded ? `<span class="speed-over">${c.speed_recorded} mph</span><div class="text-sm text-muted">+${c.speed_recorded - c.speed_limit_mph} over</div>` : '<span class="text-muted">—</span>'}
            </td>
            <td>
                <div>${c.citation_time.substring(0, 10)}</div>
                <div class="text-sm text-muted">${c.citation_time.substring(11, 16)}</div>
            </td>
            <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); showOfficerDetail(${c.id})">Details</button></td>
        </tr>`
    ).join('');
}

function showOfficerDetail(id) {
    const c = DATA.officer_citations.find(x => x.id === id);
    if (!c) return;

    let html = '<div class="detail-grid">';
    html += row('Citation ID', '#' + c.id);
    html += row('License Plate', '<strong class="plate-tag">' + c.license_plate + '</strong>');
    if (c.owner_name) {
        html += row('Owner', c.owner_name);
        html += row('Vehicle', c.vehicle_year + ' ' + c.vehicle_make + ' ' + c.vehicle_model);
    }
    html += row('Segment', c.booth_a_name + ' → ' + c.booth_b_name);
    html += row('Speed Zone', c.speed_limit_mph + ' mph');
    html += row('Officer', c.officer_name || '—');
    html += row('Badge', c.officer_badge || 'N/A');
    html += row('Recorded Speed', c.speed_recorded ? '<span class="speed-over">' + c.speed_recorded + ' mph</span> (+' + (c.speed_recorded - c.speed_limit_mph) + ' over)' : '—');
    html += row('Citation Time', formatDate(c.citation_time));
    if (c.notes) html += row('Notes', c.notes);
    html += row('Logged At', formatDate(c.created_at));
    html += '</div>';

    openModal('Officer Citation #' + c.id, html);
}

function openAddCitationDemo() {
    const segments = DATA.segments;
    let segmentOptions = segments.map(s =>
        `<option value="${s.id}">${s.booth_a_name} → ${s.booth_b_name} (${s.speed_limit_mph} mph zone)</option>`
    ).join('');

    const now = new Date();
    const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    const html = `
        <form onsubmit="event.preventDefault(); showToast('Demo mode: Citation would be saved', 'success'); closeModal();">
            <div class="form-group">
                <label class="form-label">License Plate <span class="required">*</span></label>
                <input type="text" class="form-input" placeholder="ABC-1234"
                       style="text-transform:uppercase; max-width:200px; font-weight:600; letter-spacing:0.05em;" required>
                <div class="form-hint">Enter exactly as it appears on the plate</div>
            </div>
            <div class="form-group">
                <label class="form-label">Toll Segment <span class="required">*</span></label>
                <select class="form-select" required>${segmentOptions}</select>
                <div class="form-hint">The corridor between two toll points where the stop occurred</div>
            </div>
            <div class="form-divider"></div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Officer Name</label>
                    <input type="text" class="form-input" placeholder="Ofc. J. Smith">
                </div>
                <div class="form-group">
                    <label class="form-label">Badge Number</label>
                    <input type="text" class="form-input" placeholder="B-4521">
                </div>
            </div>
            <div class="form-divider"></div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Citation Date/Time <span class="required">*</span></label>
                    <input type="datetime-local" class="form-input" value="${localISO}" required>
                    <div class="form-hint">When the officer issued the citation</div>
                </div>
                <div class="form-group">
                    <label class="form-label">Radar Speed (mph)</label>
                    <input type="number" class="form-input" placeholder="87" min="1" max="200" style="max-width:140px;">
                    <div class="form-hint">Officer-recorded vehicle speed</div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-input" rows="2" placeholder="e.g., Radar confirmed, pulled over on shoulder at mile 34"></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Citation</button>
            </div>
        </form>
    `;

    openModal('Log Officer Citation', html);
}

/* ── Settings ────────────────────────────────────────────────────── */
function updateLeniencyDisplay() {
    const leniency = parseInt(document.getElementById('leniency')?.value || 10);
    document.querySelectorAll('.leniency-threshold').forEach(el => {
        const r = el.closest('tr');
        const limitCell = r?.querySelectorAll('td')[4];
        if (limitCell) {
            const limit = parseInt(limitCell.textContent);
            if (!isNaN(limit)) el.textContent = (limit + leniency) + ' mph';
        }
    });
}

function saveSettingsDemo() {
    const enabled = document.getElementById('system-enabled')?.checked;
    const statusText = document.getElementById('system-status-text');
    if (statusText) {
        statusText.textContent = enabled
            ? 'Active — Processing violations'
            : 'Disabled — No tickets will be issued';
    }
    updateLeniencyDisplay();
    showToast('Demo mode: Settings would be saved', 'success');
}
