"""Generate realistic dummy data for the Toll-Based Speed Enforcement System."""

import random
import string
from datetime import datetime, timedelta
from database import init_db, get_db

random.seed(42)

# ── Vehicle data pools ───────────────────────────────────────────────
FIRST_NAMES = [
    'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
    'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy',
    'Anthony', 'Betty', 'Mark', 'Margaret', 'Donald', 'Sandra', 'Steven', 'Ashley',
    'Paul', 'Kimberly', 'Andrew', 'Emily', 'Joshua', 'Donna', 'Kenneth', 'Michelle',
    'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Dorothy', 'Timothy', 'Melissa',
]

LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
]

STREETS = [
    'Oak St', 'Maple Ave', 'Cedar Ln', 'Pine Rd', 'Elm Dr', 'Birch Ct',
    'Walnut Blvd', 'Spruce Way', 'Ash Pl', 'Willow Ter', 'Cherry Hill Rd',
    'Main St', 'Park Ave', 'Lake Dr', 'River Rd', 'Valley Ln',
]

CITIES = [
    ('Springfield', 'IL', '62701'), ('Columbus', 'OH', '43215'),
    ('Jacksonville', 'FL', '32099'), ('Indianapolis', 'IN', '46201'),
    ('Charlotte', 'NC', '28201'), ('Nashville', 'TN', '37201'),
    ('Richmond', 'VA', '23219'), ('Hartford', 'CT', '06101'),
    ('Trenton', 'NJ', '08601'), ('Dover', 'DE', '19901'),
]

MAKES_MODELS = [
    ('Toyota', 'Camry'), ('Honda', 'Accord'), ('Ford', 'F-150'), ('Chevrolet', 'Silverado'),
    ('Toyota', 'RAV4'), ('Honda', 'CR-V'), ('Ford', 'Explorer'), ('Chevrolet', 'Equinox'),
    ('Nissan', 'Altima'), ('Hyundai', 'Tucson'), ('Kia', 'Sorento'), ('Subaru', 'Outback'),
    ('BMW', '3 Series'), ('Mercedes', 'C-Class'), ('Tesla', 'Model 3'), ('Tesla', 'Model Y'),
    ('Jeep', 'Grand Cherokee'), ('Dodge', 'Ram 1500'), ('GMC', 'Sierra'), ('Volkswagen', 'Jetta'),
]

VEHICLE_CLASSES = ['Sedan', 'SUV', 'Truck', 'Sedan', 'SUV', 'Sedan', 'Motorcycle', 'Sedan', 'SUV', 'Van']

PAYMENT_METHODS = ['E-ZPass', 'SunPass', 'Cash', 'License Plate Toll', 'E-ZPass', 'E-ZPass']

# ── Toll segments (realistic highway corridor) ──────────────────────
SEGMENTS = [
    {
        'booth_a_name': 'Exit 12 — Riverside',
        'booth_a_location': 'I-95 Mile 12, Riverside County',
        'booth_b_name': 'Exit 28 — Lakewood',
        'booth_b_location': 'I-95 Mile 28, Lakewood Township',
        'distance_miles': 16.0,
        'speed_limit_mph': 65,
    },
    {
        'booth_a_name': 'Exit 28 — Lakewood',
        'booth_a_location': 'I-95 Mile 28, Lakewood Township',
        'booth_b_name': 'Exit 45 — Franklin',
        'booth_b_location': 'I-95 Mile 45, Franklin Borough',
        'distance_miles': 17.0,
        'speed_limit_mph': 70,
    },
    {
        'booth_a_name': 'Exit 45 — Franklin',
        'booth_a_location': 'I-95 Mile 45, Franklin Borough',
        'booth_b_name': 'Exit 63 — Madison',
        'booth_b_location': 'I-95 Mile 63, Madison County',
        'distance_miles': 18.0,
        'speed_limit_mph': 70,
    },
    {
        'booth_a_name': 'Exit 63 — Madison',
        'booth_a_location': 'I-95 Mile 63, Madison County',
        'booth_b_name': 'Exit 78 — Greenville',
        'booth_b_location': 'I-95 Mile 78, Greenville',
        'distance_miles': 15.0,
        'speed_limit_mph': 65,
    },
    {
        'booth_a_name': 'Exit 78 — Greenville',
        'booth_a_location': 'I-95 Mile 78, Greenville',
        'booth_b_name': 'Exit 95 — Capital City',
        'booth_b_location': 'I-95 Mile 95, Capital City',
        'distance_miles': 17.0,
        'speed_limit_mph': 55,
    },
    {
        'booth_a_name': 'Exit 95 — Capital City',
        'booth_a_location': 'I-95 Mile 95, Capital City',
        'booth_b_name': 'Exit 112 — Northport',
        'booth_b_location': 'I-95 Mile 112, Northport',
        'distance_miles': 17.0,
        'speed_limit_mph': 70,
    },
]

# Map booth names to sequential IDs for transaction records
BOOTH_IDS = {}


def generate_plate():
    letters = ''.join(random.choices(string.ascii_uppercase, k=3))
    numbers = ''.join(random.choices(string.digits, k=4))
    return f'{letters}-{numbers}'


def generate_transponder():
    if random.random() < 0.7:  # 70% have transponders
        return f'EZP-{random.randint(100000, 999999)}'
    return None


def seed():
    print('Initializing database...')
    init_db()
    conn = get_db()

    # Clear existing data
    for table in ['email_log', 'violations', 'toll_transactions', 'vehicle_owners', 'toll_segments', 'officer_citations']:
        conn.execute(f'DELETE FROM {table}')

    # ── Insert segments ──────────────────────────────────────────────
    print('Creating toll segments...')
    for seg in SEGMENTS:
        conn.execute('''
            INSERT INTO toll_segments (booth_a_name, booth_a_location, booth_b_name, booth_b_location, distance_miles, speed_limit_mph)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (seg['booth_a_name'], seg['booth_a_location'], seg['booth_b_name'], seg['booth_b_location'],
              seg['distance_miles'], seg['speed_limit_mph']))

    # Build booth ID map
    all_booths = []
    for seg in SEGMENTS:
        if seg['booth_a_name'] not in BOOTH_IDS:
            BOOTH_IDS[seg['booth_a_name']] = len(BOOTH_IDS) + 1
            all_booths.append(seg['booth_a_name'])
        if seg['booth_b_name'] not in BOOTH_IDS:
            BOOTH_IDS[seg['booth_b_name']] = len(BOOTH_IDS) + 1
            all_booths.append(seg['booth_b_name'])

    # ── Generate vehicles & owners ───────────────────────────────────
    print('Generating 50 vehicles...')
    vehicles = []
    for _ in range(50):
        plate = generate_plate()
        transponder = generate_transponder()
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        city, state, zipcode = random.choice(CITIES)
        make, model = random.choice(MAKES_MODELS)
        year = random.randint(2015, 2025)
        address = f'{random.randint(100, 9999)} {random.choice(STREETS)}, {city}, {state} {zipcode}'
        email = f'{first.lower()}.{last.lower()}@email.com'

        vehicles.append({
            'plate': plate,
            'transponder': transponder,
            'name': f'{first} {last}',
            'email': email,
            'address': address,
            'make': make,
            'model': model,
            'year': year,
            'class': random.choice(VEHICLE_CLASSES),
        })

        conn.execute('''
            INSERT INTO vehicle_owners (license_plate, transponder_id, owner_name, owner_email, address, vehicle_make, vehicle_model, vehicle_year)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (plate, transponder, f'{first} {last}', email, address, make, model, year))

    # ── Generate toll transactions ───────────────────────────────────
    print('Generating toll transactions...')
    now = datetime.now()
    transaction_count = 0

    # Create trips: vehicles traveling through consecutive booths
    for _ in range(120):  # 120 trips
        vehicle = random.choice(vehicles)

        # Pick a starting segment index and how many segments they'll traverse
        start_idx = random.randint(0, len(SEGMENTS) - 1)
        num_segments = random.randint(1, min(4, len(SEGMENTS) - start_idx))

        # Random start time in the last 48 hours
        trip_start = now - timedelta(hours=random.uniform(0.5, 48))

        # Decide if this vehicle is speeding
        is_speeder = random.random() < 0.35  # 35% chance of speeding
        speed_factor = random.uniform(1.1, 1.45) if is_speeder else random.uniform(0.8, 1.05)

        current_time = trip_start

        for seg_offset in range(num_segments + 1):
            seg_idx = start_idx + seg_offset
            if seg_idx >= len(SEGMENTS):
                break

            # Entry booth of this segment
            if seg_offset == 0:
                booth_name = SEGMENTS[seg_idx]['booth_a_name']
            else:
                booth_name = SEGMENTS[start_idx + seg_offset]['booth_a_name']

            booth_id = BOOTH_IDS[booth_name]
            toll_amount = round(random.uniform(1.50, 6.50), 2)
            payment = random.choice(PAYMENT_METHODS)
            if not vehicle['transponder'] and payment in ('E-ZPass', 'SunPass'):
                payment = 'License Plate Toll'

            conn.execute('''
                INSERT INTO toll_transactions
                (license_plate, vehicle_class, transponder_id, booth_id, booth_name, timestamp, amount_charged, payment_method, image_url, processed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            ''', (
                vehicle['plate'], vehicle['class'], vehicle['transponder'],
                booth_id, booth_name, current_time.isoformat(timespec='seconds'),
                toll_amount, payment,
                f'/images/capture_{vehicle["plate"]}_{booth_id}.jpg'
            ))
            transaction_count += 1

            # Calculate travel time to next booth
            if seg_offset < num_segments and (start_idx + seg_offset) < len(SEGMENTS):
                seg = SEGMENTS[start_idx + seg_offset]
                actual_speed = seg['speed_limit_mph'] * speed_factor
                travel_hours = seg['distance_miles'] / actual_speed
                # Add some noise
                travel_hours *= random.uniform(0.95, 1.05)
                current_time += timedelta(hours=travel_hours)

    # Add some extra standalone transactions (vehicles at single booths)
    for _ in range(80):
        vehicle = random.choice(vehicles)
        booth_name = random.choice(all_booths)
        booth_id = BOOTH_IDS[booth_name]
        timestamp = now - timedelta(hours=random.uniform(0.5, 48))
        toll_amount = round(random.uniform(1.50, 6.50), 2)
        payment = random.choice(PAYMENT_METHODS)
        if not vehicle['transponder'] and payment in ('E-ZPass', 'SunPass'):
            payment = 'License Plate Toll'

        conn.execute('''
            INSERT INTO toll_transactions
            (license_plate, vehicle_class, transponder_id, booth_id, booth_name, timestamp, amount_charged, payment_method, image_url, processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ''', (
            vehicle['plate'], vehicle['class'], vehicle['transponder'],
            booth_id, booth_name, timestamp.isoformat(timespec='seconds'),
            toll_amount, payment,
            f'/images/capture_{vehicle["plate"]}_{booth_id}.jpg'
        ))
        transaction_count += 1

    # ── Generate some officer citations ────────────────────────────────
    # Simulate officers pulling over a handful of speeders between toll points
    print('Generating officer citations...')
    OFFICER_NAMES = [
        ('Ofc. M. Rodriguez', 'B-1142'), ('Ofc. T. Williams', 'B-2287'),
        ('Ofc. J. Chen', 'B-3391'), ('Ofc. R. Patel', 'B-4456'),
        ('Sgt. K. Davis', 'B-5501'),
    ]
    officer_citation_count = 0
    # Pick some vehicles that are likely speeders and log officer stops
    for _ in range(10):
        vehicle = random.choice(vehicles)
        seg_idx = random.randint(0, len(SEGMENTS) - 1)
        seg = SEGMENTS[seg_idx]
        officer, badge = random.choice(OFFICER_NAMES)
        citation_time = now - timedelta(hours=random.uniform(0.1, 6))
        speed = random.randint(seg['speed_limit_mph'] + 12, seg['speed_limit_mph'] + 35)

        conn.execute('''
            INSERT INTO officer_citations
            (license_plate, segment_id, officer_name, officer_badge, citation_time, speed_recorded, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            vehicle['plate'], seg_idx + 1, officer, badge,
            citation_time.isoformat(timespec='seconds'), speed,
            'Radar confirmed — pulled over on shoulder'
        ))
        officer_citation_count += 1

    conn.commit()
    conn.close()

    print(f'\nSeed complete:')
    print(f'  {len(SEGMENTS)} toll segments')
    print(f'  {len(vehicles)} vehicles/owners')
    print(f'  {transaction_count} toll transactions')
    print(f'  {officer_citation_count} officer citations')
    print(f'\nRun the app with: python app.py')


if __name__ == '__main__':
    seed()
