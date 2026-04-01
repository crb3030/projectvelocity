/* ── Toast notifications ──────────────────────────────────────────── */
function showToast(message, type) {
    const toast = document.getElementById('toast');
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

document.getElementById('modal-overlay')?.addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});

/* ── Process Transactions ────────────────────────────────────────── */
async function processTransactions() {
    const btn = document.getElementById('process-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Processing...';
    }

    try {
        const res = await fetch('/api/process', { method: 'POST' });
        const data = await res.json();

        if (data.status === 'disabled') {
            showToast('System is disabled. Enable it in Settings.', 'error');
        } else {
            const msg = `Processed ${data.transactions_processed} transactions: ${data.violations_created} violations issued, ${data.suppressed} suppressed`;
            showToast(msg, 'success');
            setTimeout(() => location.reload(), 1500);
        }
    } catch (err) {
        showToast('Error processing transactions', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Process New Transactions';
        }
    }
}

/* ── Save Settings ───────────────────────────────────────────────── */
async function saveSettings() {
    const enabled = document.getElementById('system-enabled')?.checked;
    const leniency = document.getElementById('leniency')?.value;
    const dedupWindow = document.getElementById('dedup-window')?.value;

    // Update status text
    const statusText = document.getElementById('system-status-text');
    if (statusText) {
        statusText.textContent = enabled
            ? 'Active — Processing violations'
            : 'Disabled — No tickets will be issued';
    }

    // Update leniency thresholds in the segments table
    if (leniency) {
        document.querySelectorAll('.leniency-threshold').forEach(el => {
            const row = el.closest('tr');
            const limitCell = row?.querySelectorAll('td')[4];
            if (limitCell) {
                const limit = parseInt(limitCell.textContent);
                if (!isNaN(limit)) {
                    el.textContent = (limit + parseInt(leniency)) + ' mph';
                }
            }
        });
    }

    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_enabled: enabled,
                leniency_mph: leniency,
                dedup_window_minutes: dedupWindow
            })
        });
        showToast('Settings saved', 'success');
    } catch (err) {
        showToast('Failed to save settings', 'error');
    }
}

/* ── Violation Detail Modal ──────────────────────────────────────── */
async function showViolation(id) {
    try {
        const res = await fetch('/api/violation/' + id);
        const data = await res.json();
        const v = data.violation;
        const o = data.owner;

        let html = '<div class="detail-grid">';
        html += row('Violation ID', '#' + v.id);
        html += row('Status', '<span class="badge badge-' + v.status + '">' + v.status + '</span>');
        html += row('License Plate', v.license_plate);
        html += row('Entry Booth', v.entry_booth);
        html += row('Entry Time', v.entry_time);
        html += row('Exit Booth', v.exit_booth);
        html += row('Exit Time', v.exit_time);
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

        html += row('Created', v.created_at);
        html += '</div>';

        openModal('Violation #' + v.id, html);
    } catch (err) {
        showToast('Failed to load violation details', 'error');
    }
}

/* ── Email Detail Modal ──────────────────────────────────────────── */
async function showEmail(id) {
    try {
        const res = await fetch('/api/email/' + id);
        const data = await res.json();

        let html = '<div class="detail-grid mb-4">';
        html += row('To', data.recipient_name + ' &lt;' + data.recipient_email + '&gt;');
        html += row('Subject', data.subject);
        html += row('Sent At', data.simulated_sent_at);
        html += '</div>';
        html += '<pre>' + escapeHtml(data.body) + '</pre>';

        openModal('Email #' + data.id, html);
    } catch (err) {
        showToast('Failed to load email details', 'error');
    }
}

/* ── Helpers ──────────────────────────────────────────────────────── */
function row(label, value) {
    return '<div class="detail-label">' + label + '</div><div class="detail-value">' + value + '</div>';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
