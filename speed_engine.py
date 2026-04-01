from datetime import datetime, timedelta
from database import get_db, get_setting


def process_transactions():
    """Scan unprocessed toll transactions, detect speed violations, and issue tickets."""
    conn = get_db()

    system_enabled = get_setting('system_enabled')
    if system_enabled != '1':
        conn.close()
        return {'status': 'disabled', 'message': 'System is currently disabled', 'violations_created': 0, 'suppressed': 0}

    leniency = int(get_setting('leniency_mph') or 10)
    dedup_minutes = int(get_setting('dedup_window_minutes') or 60)

    segments = conn.execute('SELECT * FROM toll_segments').fetchall()
    segment_lookup = {}
    for seg in segments:
        segment_lookup[(seg['booth_a_name'], seg['booth_b_name'])] = seg
        segment_lookup[(seg['booth_b_name'], seg['booth_a_name'])] = seg

    # Get all unprocessed transactions ordered by plate then time
    unprocessed = conn.execute('''
        SELECT * FROM toll_transactions
        WHERE processed = 0
        ORDER BY license_plate, timestamp
    ''').fetchall()

    # Group by license plate
    plate_transactions = {}
    for txn in unprocessed:
        plate = txn['license_plate']
        if plate not in plate_transactions:
            plate_transactions[plate] = []
        plate_transactions[plate].append(txn)

    violations_created = 0
    suppressed = 0

    for plate, txns in plate_transactions.items():
        # Try to pair consecutive transactions at different booths
        for i in range(len(txns) - 1):
            entry = txns[i]
            exit_txn = txns[i + 1]

            if entry['booth_name'] == exit_txn['booth_name']:
                continue

            pair = (entry['booth_name'], exit_txn['booth_name'])
            segment = segment_lookup.get(pair)
            if not segment:
                continue

            entry_time = datetime.fromisoformat(entry['timestamp'])
            exit_time = datetime.fromisoformat(exit_txn['timestamp'])
            time_diff_hours = (exit_time - entry_time).total_seconds() / 3600

            if time_diff_hours <= 0:
                continue

            avg_speed = segment['distance_miles'] / time_diff_hours
            threshold = segment['speed_limit_mph'] + leniency
            over_limit = avg_speed - segment['speed_limit_mph']

            if avg_speed <= threshold:
                continue

            # Check if an officer already pulled them over on this same
            # segment within the dedup window. If so, suppress the automated
            # ticket — they've already been cited between these two points.
            # Citations on OTHER segments are unaffected.
            dedup_cutoff = (exit_time - timedelta(minutes=dedup_minutes)).isoformat()
            recent = conn.execute('''
                SELECT id, officer_name, officer_badge FROM officer_citations
                WHERE license_plate = ? AND segment_id = ? AND citation_time >= ?
            ''', (plate, segment['id'], dedup_cutoff)).fetchone()

            owner = conn.execute(
                'SELECT * FROM vehicle_owners WHERE license_plate = ?', (plate,)
            ).fetchone()

            owner_name = owner['owner_name'] if owner else 'Unknown'
            owner_email = owner['owner_email'] if owner else 'Unknown'

            if recent:
                conn.execute('''
                    INSERT INTO violations
                    (license_plate, segment_id, entry_booth, exit_booth, entry_time, exit_time,
                     calculated_speed_mph, speed_limit_mph, leniency_mph, over_limit_mph,
                     owner_name, owner_email, status, suppression_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suppressed', ?)
                ''', (
                    plate, segment['id'], entry['booth_name'], exit_txn['booth_name'],
                    entry['timestamp'], exit_txn['timestamp'],
                    round(avg_speed, 1), segment['speed_limit_mph'], leniency,
                    round(over_limit, 1), owner_name, owner_email,
                    f'Officer citation #{recent["id"]} by {recent["officer_name"] or "Unknown"} (Badge: {recent["officer_badge"] or "N/A"}) on same segment within {dedup_minutes} min'
                ))
                suppressed += 1
            else:
                cursor = conn.execute('''
                    INSERT INTO violations
                    (license_plate, segment_id, entry_booth, exit_booth, entry_time, exit_time,
                     calculated_speed_mph, speed_limit_mph, leniency_mph, over_limit_mph,
                     owner_name, owner_email, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')
                ''', (
                    plate, segment['id'], entry['booth_name'], exit_txn['booth_name'],
                    entry['timestamp'], exit_txn['timestamp'],
                    round(avg_speed, 1), segment['speed_limit_mph'], leniency,
                    round(over_limit, 1), owner_name, owner_email
                ))
                violation_id = cursor.lastrowid

                # Generate simulated email
                subject = f'Speed Violation Notice — {plate}'
                body = _build_ticket_email(
                    owner_name, plate, entry['booth_name'], exit_txn['booth_name'],
                    entry['timestamp'], exit_txn['timestamp'],
                    round(avg_speed, 1), segment['speed_limit_mph'], round(over_limit, 1)
                )
                conn.execute('''
                    INSERT INTO email_log (violation_id, recipient_email, recipient_name, subject, body)
                    VALUES (?, ?, ?, ?, ?)
                ''', (violation_id, owner_email, owner_name, subject, body))

                violations_created += 1

    # Mark all as processed
    txn_ids = [t['id'] for t in unprocessed]
    if txn_ids:
        placeholders = ','.join('?' * len(txn_ids))
        conn.execute(f'UPDATE toll_transactions SET processed = 1 WHERE id IN ({placeholders})', txn_ids)

    conn.commit()
    conn.close()

    return {
        'status': 'ok',
        'violations_created': violations_created,
        'suppressed': suppressed,
        'transactions_processed': len(unprocessed),
    }


def _build_ticket_email(name, plate, entry_booth, exit_booth, entry_time, exit_time, speed, limit, over):
    return f"""STATE DEPARTMENT OF TRANSPORTATION
AUTOMATED SPEED ENFORCEMENT NOTICE

Dear {name},

This notice is to inform you that the vehicle registered to license plate {plate} was detected traveling at an average speed of {speed} MPH in a {limit} MPH zone.

VIOLATION DETAILS:
  Entry Point:     {entry_booth}
  Entry Time:      {entry_time}
  Exit Point:      {exit_booth}
  Exit Time:       {exit_time}
  Average Speed:   {speed} MPH
  Posted Limit:    {limit} MPH
  Over Limit By:   {over} MPH

This citation has been recorded in the state enforcement system. You may contest this citation within 30 days by contacting the Department of Transportation.

Fine Amount: ${_calculate_fine(over):.2f}

This is an automated notification generated by the State Toll-Based Speed Enforcement System.

DO NOT REPLY TO THIS EMAIL.
"""


def _calculate_fine(over_limit):
    if over_limit <= 10:
        return 75.00
    elif over_limit <= 20:
        return 150.00
    elif over_limit <= 30:
        return 300.00
    else:
        return 500.00
