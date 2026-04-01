from flask import Flask, render_template, request, jsonify, redirect, url_for
from database import init_db, get_db, get_setting, set_setting
from speed_engine import process_transactions

app = Flask(__name__)


@app.before_request
def ensure_db():
    init_db()


# ── Pages ──────────────────────────────────────────────────────────────

@app.route('/')
def dashboard():
    conn = get_db()
    transactions = conn.execute('''
        SELECT * FROM toll_transactions ORDER BY timestamp DESC LIMIT 50
    ''').fetchall()
    total_today = conn.execute('''
        SELECT COUNT(*) as cnt FROM toll_transactions
        WHERE date(timestamp) = date('now')
    ''').fetchone()['cnt']
    violations_today = conn.execute('''
        SELECT COUNT(*) as cnt FROM violations
        WHERE date(created_at) = date('now') AND status = 'issued'
    ''').fetchone()['cnt']
    suppressed_today = conn.execute('''
        SELECT COUNT(*) as cnt FROM violations
        WHERE date(created_at) = date('now') AND status = 'suppressed'
    ''').fetchone()['cnt']
    unprocessed = conn.execute('''
        SELECT COUNT(*) as cnt FROM toll_transactions WHERE processed = 0
    ''').fetchone()['cnt']

    # Top violation corridors
    top_corridors = conn.execute('''
        SELECT entry_booth || ' → ' || exit_booth as corridor, COUNT(*) as cnt
        FROM violations WHERE status = 'issued'
        GROUP BY corridor ORDER BY cnt DESC LIMIT 5
    ''').fetchall()

    conn.close()
    return render_template('dashboard.html',
        transactions=transactions,
        total_today=total_today,
        violations_today=violations_today,
        suppressed_today=suppressed_today,
        unprocessed=unprocessed,
        top_corridors=top_corridors,
        system_enabled=get_setting('system_enabled') == '1'
    )


@app.route('/violations')
def violations():
    conn = get_db()
    status_filter = request.args.get('status', 'all')
    segment_filter = request.args.get('segment', 'all')

    query = 'SELECT v.*, s.booth_a_name, s.booth_b_name FROM violations v JOIN toll_segments s ON v.segment_id = s.id'
    conditions = []
    params = []

    if status_filter != 'all':
        conditions.append('v.status = ?')
        params.append(status_filter)
    if segment_filter != 'all':
        conditions.append('v.segment_id = ?')
        params.append(int(segment_filter))

    if conditions:
        query += ' WHERE ' + ' AND '.join(conditions)
    query += ' ORDER BY v.created_at DESC LIMIT 200'

    violation_list = conn.execute(query, params).fetchall()
    segments = conn.execute('SELECT * FROM toll_segments').fetchall()
    conn.close()

    return render_template('violations.html',
        violations=violation_list,
        segments=segments,
        status_filter=status_filter,
        segment_filter=segment_filter
    )


@app.route('/settings')
def settings():
    conn = get_db()
    segments = conn.execute('SELECT * FROM toll_segments').fetchall()
    conn.close()
    return render_template('settings.html',
        leniency=get_setting('leniency_mph'),
        dedup_window=get_setting('dedup_window_minutes'),
        system_enabled=get_setting('system_enabled') == '1',
        segments=segments
    )


@app.route('/emails')
def emails():
    conn = get_db()
    email_list = conn.execute('''
        SELECT e.*, v.license_plate, v.calculated_speed_mph, v.speed_limit_mph
        FROM email_log e
        JOIN violations v ON e.violation_id = v.id
        ORDER BY e.simulated_sent_at DESC LIMIT 200
    ''').fetchall()
    conn.close()
    return render_template('emails.html', emails=email_list)


@app.route('/officer-citations')
def officer_citations():
    conn = get_db()
    citations = conn.execute('''
        SELECT oc.*, s.booth_a_name, s.booth_b_name, s.speed_limit_mph,
               vo.owner_name, vo.vehicle_make, vo.vehicle_model, vo.vehicle_year
        FROM officer_citations oc
        JOIN toll_segments s ON oc.segment_id = s.id
        LEFT JOIN vehicle_owners vo ON oc.license_plate = vo.license_plate
        ORDER BY oc.citation_time DESC LIMIT 200
    ''').fetchall()
    segments = conn.execute('SELECT * FROM toll_segments').fetchall()
    total = conn.execute('SELECT COUNT(*) as cnt FROM officer_citations').fetchone()['cnt']
    recent_24h = conn.execute('''
        SELECT COUNT(*) as cnt FROM officer_citations
        WHERE citation_time >= datetime('now', '-24 hours')
    ''').fetchone()['cnt']
    suppressed = conn.execute('''
        SELECT COUNT(*) as cnt FROM violations WHERE status = 'suppressed'
    ''').fetchone()['cnt']
    dedup_window = get_setting('dedup_window_minutes')
    conn.close()
    return render_template('officer_citations.html',
        citations=citations, segments=segments,
        total=total, recent_24h=recent_24h, suppressed=suppressed,
        dedup_window=dedup_window
    )


# ── API Endpoints ──────────────────────────────────────────────────────

@app.route('/api/process', methods=['POST'])
def api_process():
    result = process_transactions()
    return jsonify(result)


@app.route('/api/officer-citation', methods=['POST'])
def api_create_officer_citation():
    data = request.get_json()
    conn = get_db()
    conn.execute('''
        INSERT INTO officer_citations
        (license_plate, segment_id, officer_name, officer_badge, citation_time, speed_recorded, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['license_plate'].upper().strip(),
        int(data['segment_id']),
        data.get('officer_name', ''),
        data.get('officer_badge', ''),
        data['citation_time'],
        float(data['speed_recorded']) if data.get('speed_recorded') else None,
        data.get('notes', ''),
    ))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/api/officer-citation/<int:cid>', methods=['DELETE'])
def api_delete_officer_citation(cid):
    conn = get_db()
    conn.execute('DELETE FROM officer_citations WHERE id = ?', (cid,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@app.route('/api/settings', methods=['POST'])
def api_settings():
    data = request.get_json()
    if 'leniency_mph' in data:
        set_setting('leniency_mph', data['leniency_mph'])
    if 'dedup_window_minutes' in data:
        set_setting('dedup_window_minutes', data['dedup_window_minutes'])
    if 'system_enabled' in data:
        set_setting('system_enabled', '1' if data['system_enabled'] else '0')
    return jsonify({'status': 'ok'})


@app.route('/api/violation/<int:vid>')
def api_violation_detail(vid):
    conn = get_db()
    v = conn.execute('SELECT * FROM violations WHERE id = ?', (vid,)).fetchone()
    if not v:
        conn.close()
        return jsonify({'error': 'not found'}), 404
    owner = conn.execute(
        'SELECT * FROM vehicle_owners WHERE license_plate = ?', (v['license_plate'],)
    ).fetchone()
    conn.close()
    return jsonify({
        'violation': dict(v),
        'owner': dict(owner) if owner else None
    })


@app.route('/api/email/<int:eid>')
def api_email_detail(eid):
    conn = get_db()
    e = conn.execute('SELECT * FROM email_log WHERE id = ?', (eid,)).fetchone()
    conn.close()
    if not e:
        return jsonify({'error': 'not found'}), 404
    return jsonify(dict(e))


@app.route('/api/stats')
def api_stats():
    conn = get_db()
    total_violations = conn.execute('SELECT COUNT(*) as cnt FROM violations WHERE status = "issued"').fetchone()['cnt']
    total_suppressed = conn.execute('SELECT COUNT(*) as cnt FROM violations WHERE status = "suppressed"').fetchone()['cnt']
    total_transactions = conn.execute('SELECT COUNT(*) as cnt FROM toll_transactions').fetchone()['cnt']
    total_emails = conn.execute('SELECT COUNT(*) as cnt FROM email_log').fetchone()['cnt']
    conn.close()
    return jsonify({
        'total_violations': total_violations,
        'total_suppressed': total_suppressed,
        'total_transactions': total_transactions,
        'total_emails': total_emails,
    })


if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)
