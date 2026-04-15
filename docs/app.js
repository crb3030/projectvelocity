/* ── Data Store ───────────────────────────────────────────────────── */
let DATA = {};

async function loadData() {
    // Check if we have processed data in sessionStorage (persists across page navigation)
    const cached = sessionStorage.getItem('tollEnforcementData');
    if (cached) {
        DATA = JSON.parse(cached);
        return DATA;
    }
    const res = await fetch('data.json');
    DATA = await res.json();
    return DATA;
}

function saveData() {
    sessionStorage.setItem('tollEnforcementData', JSON.stringify(DATA));
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

    // Update process button with real count
    const processBtn = document.getElementById('process-btn');
    if (processBtn) {
        processBtn.textContent = 'Process New Transactions (' + s.unprocessed + ')';
    }

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
    const LENIENCY = 10; // mph over limit before issuing violation

    // Build segment lookup dynamically from DATA.segments
    // Map booth names to IDs (booths appear in order across segments)
    const boothNameToId = {};
    let nextId = 1;
    DATA.segments.forEach(s => {
        if (!(s.booth_a_name in boothNameToId)) boothNameToId[s.booth_a_name] = nextId++;
        if (!(s.booth_b_name in boothNameToId)) boothNameToId[s.booth_b_name] = nextId++;
    });

    const segLookup = {};
    DATA.segments.forEach(s => {
        const aId = boothNameToId[s.booth_a_name];
        const bId = boothNameToId[s.booth_b_name];
        const entry = {
            a: aId, b: bId, seg_id: s.id,
            dist: s.distance_miles, limit: s.speed_limit_mph,
            a_name: s.booth_a_name, b_name: s.booth_b_name
        };
        segLookup[aId + '_' + bId] = entry;
        segLookup[bId + '_' + aId] = entry; // direction doesn't matter for avg speed
    });

    // Gather unprocessed transactions from ALL transactions (not just display 30)
    const allTxns = DATA.allTransactions || DATA.transactions;
    const unprocessed = allTxns.filter(t => !t.processed);
    if (unprocessed.length === 0) {
        showToast('No unprocessed transactions to process.', '');
        return;
    }

    const byPlate = {};
    unprocessed.forEach(t => {
        if (!byPlate[t.license_plate]) byPlate[t.license_plate] = [];
        byPlate[t.license_plate].push(t);
    });

    let violationId = (DATA.violations.length > 0) ? Math.max(...DATA.violations.map(v => v.id)) + 1 : 1001;
    let emailId = (DATA.emails.length > 0) ? Math.max(...DATA.emails.map(e => e.id)) + 1 : 5001;
    let newViolations = 0;
    let newSuppressed = 0;
    const corridorCounts = {};
    const issuedPlates = {}; // track plates we've already issued on a segment for dedup

    // For each plate, sort by timestamp and find consecutive booth pairs
    Object.keys(byPlate).forEach(plate => {
        const txns = byPlate[plate].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        for (let i = 0; i < txns.length - 1; i++) {
            const entry = txns[i];
            const exit = txns[i + 1];

            // Check if these two booths form a known segment
            const key = entry.booth_id + '_' + exit.booth_id;
            const seg = segLookup[key];
            if (!seg) continue;

            // Calculate average speed
            const entryTime = new Date(entry.timestamp);
            const exitTime = new Date(exit.timestamp);
            const hours = (exitTime - entryTime) / (1000 * 60 * 60);
            if (hours <= 0) continue;

            const avgSpeed = Math.round(seg.dist / hours);
            const overLimit = avgSpeed - seg.limit;

            if (overLimit <= 0) continue; // not speeding

            // Dedup: only one violation per plate per segment per processing run
            const dedupKey = plate + '_' + seg.seg_id;
            if (issuedPlates[dedupKey]) {
                newSuppressed++;
                continue;
            }

            if (overLimit <= LENIENCY) {
                // Within leniency — suppress
                newSuppressed++;
                continue;
            }

            const owner = DATA.owners[plate];
            const entryBooth = entry.booth_id < exit.booth_id ? seg.a_name : seg.b_name;
            const exitBooth = entry.booth_id < exit.booth_id ? seg.b_name : seg.a_name;

            // Check for officer citation dedup — if an officer already cited
            // this plate on the same segment within the dedup window, suppress
            // the automated ticket to prevent double-ticketing
            const DEDUP_MINUTES = 60;
            const dedupCutoff = new Date(exitTime.getTime() - DEDUP_MINUTES * 60 * 1000);
            const officerCitation = DATA.officer_citations.find(oc =>
                oc.license_plate === plate &&
                oc.segment_id === seg.seg_id &&
                new Date(oc.citation_time) >= dedupCutoff
            );

            if (officerCitation) {
                // Suppressed — officer already cited this driver on this segment
                const suppReason = 'Officer citation #' + officerCitation.id
                    + ' by ' + (officerCitation.officer_name || 'Unknown')
                    + ' (Badge: ' + (officerCitation.officer_badge || 'N/A') + ')'
                    + ' on same segment within ' + DEDUP_MINUTES + ' min';

                const suppViolation = {
                    id: violationId++,
                    license_plate: plate,
                    segment_id: seg.seg_id,
                    entry_booth: entryBooth,
                    exit_booth: exitBooth,
                    entry_time: entry.timestamp,
                    exit_time: exit.timestamp,
                    calculated_speed_mph: avgSpeed,
                    speed_limit_mph: seg.limit,
                    leniency_mph: LENIENCY,
                    over_limit_mph: overLimit,
                    status: 'suppressed',
                    owner_name: owner ? owner.owner_name : null,
                    suppression_reason: suppReason,
                    created_at: new Date().toISOString()
                };
                DATA.violations.push(suppViolation);
                issuedPlates[dedupKey] = true;
                newSuppressed++;
                continue;
            }

            // Issue violation — no officer citation found
            issuedPlates[dedupKey] = true;

            const violation = {
                id: violationId++,
                license_plate: plate,
                segment_id: seg.seg_id,
                entry_booth: entryBooth,
                exit_booth: exitBooth,
                entry_time: entry.timestamp,
                exit_time: exit.timestamp,
                calculated_speed_mph: avgSpeed,
                speed_limit_mph: seg.limit,
                leniency_mph: LENIENCY,
                over_limit_mph: overLimit,
                status: 'issued',
                owner_name: owner ? owner.owner_name : null,
                suppression_reason: null,
                created_at: new Date().toISOString()
            };
            DATA.violations.push(violation);
            newViolations++;

            // Track corridor counts
            const corridorLabel = entryBooth + ' → ' + exitBooth;
            corridorCounts[corridorLabel] = (corridorCounts[corridorLabel] || 0) + 1;

            // Generate notification email if owner is on file
            if (owner) {
                const email = {
                    id: emailId++,
                    violation_id: violation.id,
                    recipient_name: owner.owner_name,
                    recipient_email: owner.owner_email,
                    license_plate: plate,
                    calculated_speed_mph: avgSpeed,
                    speed_limit_mph: seg.limit,
                    subject: 'Speed Violation Notice — ' + plate + ' (' + avgSpeed + ' mph in ' + seg.limit + ' mph zone)',
                    body: 'Dear ' + owner.owner_name + ',\n\n'
                        + 'This notice is to inform you that a speed violation has been recorded for vehicle '
                        + plate + ' (' + (owner.vehicle_year + ' ' + owner.vehicle_make + ' ' + owner.vehicle_model) + ').\n\n'
                        + 'Violation Details:\n'
                        + '  Corridor: ' + entryBooth + ' → ' + exitBooth + '\n'
                        + '  Entry Time: ' + entry.timestamp.replace('T', ' ') + '\n'
                        + '  Exit Time: ' + exit.timestamp.replace('T', ' ') + '\n'
                        + '  Calculated Avg Speed: ' + avgSpeed + ' mph\n'
                        + '  Posted Speed Limit: ' + seg.limit + ' mph\n'
                        + '  Amount Over Limit: +' + overLimit + ' mph\n\n'
                        + 'You may contest this violation within 30 days by contacting the State Department of Transportation.\n\n'
                        + 'Sincerely,\nState DOT — Toll-Based Speed Enforcement Division',
                    simulated_sent_at: new Date().toISOString()
                };
                DATA.emails.push(email);
            }
        }
    });

    // Mark all transactions as processed
    allTxns.forEach(t => { t.processed = 1; });
    DATA.transactions.forEach(t => { t.processed = 1; });

    // Update stats
    DATA.stats.violations_today += newViolations;
    DATA.stats.suppressed_today += newSuppressed;
    DATA.stats.unprocessed = 0;
    DATA.stats.officer_suppressed = DATA.violations.filter(v => v.status === 'suppressed' && v.suppression_reason && v.suppression_reason.indexOf('Officer citation') === 0).length;

    // Update corridor stats
    const corridorArr = Object.keys(corridorCounts).map(c => ({corridor: c, cnt: corridorCounts[c]}));
    corridorArr.sort((a, b) => b.cnt - a.cnt);
    DATA.stats.corridors = corridorArr;

    // Persist to sessionStorage so other pages see the results
    saveData();

    // Re-render the dashboard
    renderDashboard();

    const officerSuppCount = DATA.violations.filter(v => v.status === 'suppressed' && v.suppression_reason && v.suppression_reason.indexOf('Officer citation') === 0).length;
    let msg = 'Processed ' + unprocessed.length + ' transactions — ' + newViolations + ' violations issued, ' + newSuppressed + ' suppressed';
    if (officerSuppCount > 0) msg += ' (' + officerSuppCount + ' by officer dedup)';
    showToast(msg, 'success');
}

/* ── Reset Demo ─────────────────────────────────────────────────── */
function resetDemo() {
    // Clear any cached processed state
    sessionStorage.removeItem('tollEnforcementData');

    // Random helpers
    function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    function randChoice(arr) { return arr[randInt(0, arr.length - 1)]; }
    function randPlate() {
        const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        return L[randInt(0,25)] + L[randInt(0,25)] + L[randInt(0,25)] + '-' + randInt(1000,9999);
    }

    const FIRST = ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Thomas','Sarah','Charles','Karen','Daniel','Lisa','Matthew','Nancy','Anthony','Emily','Joshua','Donna','Kevin','Carol','Brian','Amanda','George','Melissa'];
    const LAST = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Thompson','White','Harris','Clark','Lewis','Robinson'];
    const MAKES = [['Toyota','Camry'],['Honda','Accord'],['Ford','F-150'],['Chevrolet','Silverado'],['Toyota','RAV4'],['Honda','CR-V'],['Ford','Explorer'],['Tesla','Model 3'],['Tesla','Model Y'],['BMW','3 Series'],['Jeep','Grand Cherokee'],['Dodge','Ram 1500'],['Nissan','Altima'],['Hyundai','Tucson'],['Kia','Sorento'],['Subaru','Outback']];
    const CLASSES = ['Sedan','SUV','Truck','Sedan','SUV','Sedan','Motorcycle','Van'];
    const PAYMENTS = ['E-ZPass','E-ZPass','E-ZPass','SunPass','Cash','License Plate Toll'];

    // Build booth name-to-id map from segments
    const boothNameToId = {};
    let bid = 1;
    DATA.segments.forEach(s => {
        if (!(s.booth_a_name in boothNameToId)) boothNameToId[s.booth_a_name] = bid++;
        if (!(s.booth_b_name in boothNameToId)) boothNameToId[s.booth_b_name] = bid++;
    });
    const allBoothNames = Object.keys(boothNameToId);

    // Generate 50 fresh vehicles
    const owners = {};
    const vehicles = [];
    for (let i = 0; i < 50; i++) {
        const plate = randPlate();
        const first = randChoice(FIRST);
        const last = randChoice(LAST);
        const mm = randChoice(MAKES);
        const year = randInt(2015, 2026);
        const transponder = Math.random() < 0.7 ? 'EZP-' + randInt(100000, 999999) : null;
        vehicles.push({ plate, transponder, vclass: randChoice(CLASSES) });
        owners[plate] = {
            license_plate: plate, transponder_id: transponder,
            owner_name: first + ' ' + last,
            owner_email: first.toLowerCase() + '.' + last.toLowerCase() + '@email.com',
            address: randInt(100,9999) + ' ' + randChoice(['Oak St','Maple Ave','Cedar Ln','Pine Rd','Elm Dr','Main St','Park Ave','Lake Dr']) + ', ' + randChoice(['Charlotte, NC 28201','Raleigh, NC 27601','Nashville, TN 37201','Richmond, VA 23219','Columbus, OH 43215']),
            vehicle_make: mm[0], vehicle_model: mm[1], vehicle_year: year,
        };
    }

    // Generate ~450 transactions
    const now = new Date();
    const allTxns = [];
    let txnId = 1;

    // Trip-based transactions (consecutive booths)
    for (let t = 0; t < 130; t++) {
        const v = randChoice(vehicles);
        const startIdx = randInt(0, DATA.segments.length - 1);
        const numSegs = randInt(1, Math.min(4, DATA.segments.length - startIdx));
        let tripTime = new Date(now.getTime() - randInt(1800000, 172800000)); // 0.5-48 hrs ago
        const isSpeeder = Math.random() < 0.35;
        const speedFactor = isSpeeder ? 1.1 + Math.random() * 0.35 : 0.8 + Math.random() * 0.25;

        for (let s = 0; s <= numSegs; s++) {
            const si = startIdx + s;
            if (si >= DATA.segments.length) break;
            const boothName = (s === 0) ? DATA.segments[si].booth_a_name : DATA.segments[startIdx + s].booth_a_name;
            const boothId = boothNameToId[boothName];
            let pay = randChoice(PAYMENTS);
            if (!v.transponder && (pay === 'E-ZPass' || pay === 'SunPass')) pay = 'License Plate Toll';

            allTxns.push({
                id: txnId++, license_plate: v.plate, vehicle_class: v.vclass,
                transponder_id: v.transponder, booth_id: boothId, booth_name: boothName,
                timestamp: tripTime.toISOString().substring(0, 19),
                amount_charged: Math.round((1.5 + Math.random() * 5) * 100) / 100,
                payment_method: pay, image_url: '/images/capture_' + v.plate + '_' + boothId + '.jpg',
                processed: 0,
            });

            if (s < numSegs && (startIdx + s) < DATA.segments.length) {
                const seg = DATA.segments[startIdx + s];
                const speed = seg.speed_limit_mph * speedFactor;
                const hours = seg.distance_miles / speed * (0.95 + Math.random() * 0.1);
                tripTime = new Date(tripTime.getTime() + hours * 3600000);
            }
        }
    }

    // Standalone transactions
    for (let t = 0; t < 90; t++) {
        const v = randChoice(vehicles);
        const boothName = randChoice(allBoothNames);
        const boothId = boothNameToId[boothName];
        const ts = new Date(now.getTime() - randInt(1800000, 172800000));
        let pay = randChoice(PAYMENTS);
        if (!v.transponder && (pay === 'E-ZPass' || pay === 'SunPass')) pay = 'License Plate Toll';

        allTxns.push({
            id: txnId++, license_plate: v.plate, vehicle_class: v.vclass,
            transponder_id: v.transponder, booth_id: boothId, booth_name: boothName,
            timestamp: ts.toISOString().substring(0, 19),
            amount_charged: Math.round((1.5 + Math.random() * 5) * 100) / 100,
            payment_method: pay, image_url: '/images/capture_' + v.plate + '_' + boothId + '.jpg',
            processed: 0,
        });
    }

    allTxns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const todayStr = now.toISOString().substring(0, 10);
    const todayCount = allTxns.filter(t => t.timestamp.substring(0, 10) === todayStr).length;

    // Generate fresh officer citations
    const OFFICERS = [['Ofc. M. Rodriguez','B-1142'],['Ofc. T. Williams','B-2287'],['Ofc. J. Chen','B-3391'],['Ofc. R. Patel','B-4456'],['Sgt. K. Davis','B-5501']];
    const citations = [];
    for (let i = 0; i < 12; i++) {
        const v = randChoice(vehicles);
        const seg = randChoice(DATA.segments);
        const ofc = randChoice(OFFICERS);
        const ct = new Date(now.getTime() - randInt(360000, 28800000));
        const o = owners[v.plate] || {};
        citations.push({
            id: i + 1, license_plate: v.plate, segment_id: seg.id,
            booth_a_name: seg.booth_a_name, booth_b_name: seg.booth_b_name,
            speed_limit_mph: seg.speed_limit_mph,
            officer_name: ofc[0], officer_badge: ofc[1],
            citation_time: ct.toISOString().substring(0, 19),
            speed_recorded: seg.speed_limit_mph + randInt(12, 35),
            notes: 'Radar confirmed — pulled over on shoulder',
            created_at: ct.toISOString().substring(0, 19),
            owner_name: o.owner_name || null, vehicle_make: o.vehicle_make || null,
            vehicle_model: o.vehicle_model || null, vehicle_year: o.vehicle_year || null,
        });
    }

    // Update DATA in place
    DATA.allTransactions = allTxns;
    DATA.transactions = allTxns.slice(0, 30);
    DATA.violations = [];
    DATA.emails = [];
    DATA.officer_citations = citations;
    DATA.owners = owners;
    DATA.stats = {
        total_today: todayCount,
        violations_today: 0,
        suppressed_today: 0,
        unprocessed: allTxns.length,
        total_officer: citations.length,
        officer_suppressed: 0,
        corridors: [],
    };

    saveData();
    renderDashboard();
    showToast('Demo reset — ' + allTxns.length + ' new transactions generated with ' + Object.keys(owners).length + ' vehicles', 'success');
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
