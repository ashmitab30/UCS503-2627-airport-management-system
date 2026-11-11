-- 002_step0_hardening.sql
-- Step 0 database modifications: fares, booking snapshots, passenger table linkage, emergency alert attribution, and seat generation for existing flights.

-- 1. Fares and price snapshots
ALTER TABLE flight ADD COLUMN IF NOT EXISTS base_price_cents INTEGER NOT NULL DEFAULT 5000 CHECK (base_price_cents > 0);
ALTER TABLE booking ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 5000 CHECK (price_cents >= 0);

-- 2. Stitch Passenger Registry fields and booking linkage
ALTER TABLE passenger ADD COLUMN IF NOT EXISTS passport_number VARCHAR(50);
ALTER TABLE passenger ADD COLUMN IF NOT EXISTS nationality VARCHAR(50);
ALTER TABLE passenger ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE passenger ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE booking ADD COLUMN IF NOT EXISTS passenger_id INTEGER REFERENCES passenger(id);
CREATE INDEX IF NOT EXISTS idx_booking_passenger ON booking(passenger_id);

-- 3. Emergency alert attribution
ALTER TABLE emergency_alert ADD COLUMN IF NOT EXISTS acknowledged_by INTEGER REFERENCES "user"(id);

-- 4. Backfill passenger records for any existing bookings
DO $$
DECLARE
    r RECORD;
    new_p_id INTEGER;
BEGIN
    FOR r IN
        SELECT b.id AS booking_id, u.name, u.email
        FROM booking b
        JOIN "user" u ON u.id = b.user_id
        WHERE b.passenger_id IS NULL
    LOOP
        INSERT INTO passenger (name, email)
        VALUES (r.name, r.email)
        RETURNING id INTO new_p_id;

        UPDATE booking SET passenger_id = new_p_id WHERE id = r.booking_id;
    END LOOP;
END $$;

-- 5. Backfill seats for any flights missing a seat map
DO $$
DECLARE
    f RECORD;
    r_letter TEXT;
    row_num INT;
    seat_class VARCHAR(20);
    inserted_count INT;
BEGIN
    FOR f IN
        SELECT fl.id, fl.flight_number, act.model, act.capacity, act.size_class
        FROM flight fl
        JOIN aircraft_type act ON act.id = fl.aircraft_type_id
    LOOP
        SELECT count(*) INTO inserted_count FROM seat WHERE flight_id = f.id;
        IF inserted_count = 0 THEN
            IF f.size_class = 'small' THEN
                -- ATR 72: 20 rows, A-D (row 20 A-B), total 78
                FOR row_num IN 1..20 LOOP
                    FOR r_letter IN SELECT unnest(ARRAY['A','B','C','D']) LOOP
                        IF NOT (row_num = 20 AND (r_letter = 'C' OR r_letter = 'D')) THEN
                            seat_class := CASE WHEN row_num <= 2 THEN 'premium_economy' ELSE 'economy' END;
                            INSERT INTO seat (flight_id, seat_number, class)
                            VALUES (f.id, row_num || r_letter, seat_class)
                            ON CONFLICT (flight_id, seat_number) DO NOTHING;
                        END IF;
                    END LOOP;
                END LOOP;
            ELSIF f.size_class = 'large' OR f.size_class = 'jumbo' THEN
                -- Boeing 777: 44 rows, 9 seats per row (A,B,C, D,E,F, G,H,J) = 396 seats
                FOR row_num IN 1..44 LOOP
                    FOR r_letter IN SELECT unnest(ARRAY['A','B','C','D','E','F','G','H','J']) LOOP
                        seat_class := CASE
                            WHEN row_num <= 4 THEN 'first'
                            WHEN row_num <= 10 THEN 'business'
                            WHEN row_num <= 16 THEN 'premium_economy'
                            ELSE 'economy'
                        END;
                        INSERT INTO seat (flight_id, seat_number, class)
                        VALUES (f.id, row_num || r_letter, seat_class)
                        ON CONFLICT (flight_id, seat_number) DO NOTHING;
                    END LOOP;
                END LOOP;
            ELSE
                -- Airbus A320: 30 rows, 6 seats (A-F) = 180 seats
                FOR row_num IN 1..30 LOOP
                    FOR r_letter IN SELECT unnest(ARRAY['A','B','C','D','E','F']) LOOP
                        seat_class := CASE
                            WHEN row_num <= 3 THEN 'business'
                            WHEN row_num <= 6 THEN 'premium_economy'
                            ELSE 'economy'
                        END;
                        INSERT INTO seat (flight_id, seat_number, class)
                        VALUES (f.id, row_num || r_letter, seat_class)
                        ON CONFLICT (flight_id, seat_number) DO NOTHING;
                    END LOOP;
                END LOOP;
            END IF;
        END IF;
    END LOOP;
END $$;

