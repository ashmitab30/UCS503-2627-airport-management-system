-- 001_initial_schema.sql
-- Baseline initial schema. Uses IF NOT EXISTS so it safely applies on an existing database.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS airport (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    code        VARCHAR(10) UNIQUE NOT NULL,
    timezone    TEXT NOT NULL DEFAULT 'UTC'
);

CREATE TABLE IF NOT EXISTS gate (
    id          SERIAL PRIMARY KEY,
    airport_id  INTEGER NOT NULL REFERENCES airport(id) ON DELETE CASCADE,
    code        VARCHAR(10) NOT NULL,
    size_class  VARCHAR(20) NOT NULL CHECK (size_class IN ('small','medium','large','jumbo')),
    status      VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance','locked')),
    UNIQUE (airport_id, code)
);

CREATE TABLE IF NOT EXISTS aircraft_type (
    id          SERIAL PRIMARY KEY,
    model       TEXT NOT NULL,
    capacity    INTEGER NOT NULL CHECK (capacity > 0),
    size_class  VARCHAR(20) NOT NULL CHECK (size_class IN ('small','medium','large','jumbo'))
);

CREATE TABLE IF NOT EXISTS "user" (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('passenger','ground_crew','security','medical','ops_manager','admin')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flight (
    id                     SERIAL PRIMARY KEY,
    flight_number          VARCHAR(10) NOT NULL,
    aircraft_type_id       INTEGER NOT NULL REFERENCES aircraft_type(id),
    origin_id              INTEGER NOT NULL REFERENCES airport(id),
    dest_id                INTEGER NOT NULL REFERENCES airport(id),
    scheduled_departure    TIMESTAMPTZ NOT NULL,
    scheduled_arrival      TIMESTAMPTZ NOT NULL,
    actual_departure       TIMESTAMPTZ,
    actual_arrival         TIMESTAMPTZ,
    gate_id                INTEGER REFERENCES gate(id),
    status                 VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                            CHECK (status IN ('scheduled','boarding','departed','in_air','landed','delayed','cancelled','diverted')),
    delay_reason_code      VARCHAR(10),
    CHECK (dest_id <> origin_id),
    CHECK (scheduled_arrival > scheduled_departure)
);

CREATE TABLE IF NOT EXISTS seat (
    id          SERIAL PRIMARY KEY,
    flight_id   INTEGER NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
    seat_number VARCHAR(5) NOT NULL,
    class       VARCHAR(20) NOT NULL CHECK (class IN ('economy','premium_economy','business','first')),
    is_booked   BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (flight_id, seat_number)
);

CREATE TABLE IF NOT EXISTS resource (
    id          SERIAL PRIMARY KEY,
    airport_id  INTEGER NOT NULL REFERENCES airport(id) ON DELETE CASCADE,
    type        VARCHAR(20) NOT NULL CHECK (type IN ('fuel_truck','baggage_cart','crew','catering_truck','pushback_tug')),
    status      VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','in_use','maintenance'))
);

CREATE TABLE IF NOT EXISTS resource_assignment (
    id           SERIAL PRIMARY KEY,
    resource_id  INTEGER NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    flight_id    INTEGER NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
    start_time   TIMESTAMPTZ NOT NULL,
    end_time     TIMESTAMPTZ NOT NULL,
    CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS turnaround_checklist (
    id               SERIAL PRIMARY KEY,
    flight_id        INTEGER NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
    step             VARCHAR(20) NOT NULL CHECK (step IN ('deboard','clean','fuel','catering','board','pushback')),
    status           VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','skipped')),
    assigned_team    TEXT,
    est_duration     INTERVAL,
    actual_duration  INTERVAL
);

CREATE TABLE IF NOT EXISTS delay_log (
    id               SERIAL PRIMARY KEY,
    flight_id        INTEGER NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
    reason_code      VARCHAR(10) NOT NULL,
    minutes          INTEGER NOT NULL CHECK (minutes > 0),
    logged_by        INTEGER REFERENCES "user"(id),
    "timestamp"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS passenger (
    id      SERIAL PRIMARY KEY,
    name    TEXT NOT NULL,
    email   TEXT NOT NULL,
    phone   TEXT
);

CREATE TABLE IF NOT EXISTS booking (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES "user"(id),
    flight_id    INTEGER NOT NULL REFERENCES flight(id),
    seat_id      INTEGER REFERENCES seat(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'held'
                 CHECK (status IN ('held','confirmed','cancelled','checked_in','boarding','boarded','no_show')),
    booking_ref  VARCHAR(10) UNIQUE NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment (
    id          SERIAL PRIMARY KEY,
    booking_id  INTEGER NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
    amount      NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    status      VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','refunded')),
    method      VARCHAR(20) NOT NULL DEFAULT 'mock_card'
);

CREATE TABLE IF NOT EXISTS baggage (
    id                     SERIAL PRIMARY KEY,
    booking_id             INTEGER NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
    tag_number             VARCHAR(20) UNIQUE NOT NULL,
    weight                 NUMERIC(5,2) NOT NULL CHECK (weight > 0),
    status                 VARCHAR(20) NOT NULL DEFAULT 'checked_in'
                           CHECK (status IN ('checked_in','loaded','in_transit','arrived','lost')),
    last_scanned_location  TEXT,
    last_scanned_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connection (
    id                        SERIAL PRIMARY KEY,
    inbound_flight_id         INTEGER NOT NULL REFERENCES flight(id),
    outbound_flight_id        INTEGER NOT NULL REFERENCES flight(id),
    passenger_id              INTEGER NOT NULL REFERENCES "user"(id),
    min_connection_minutes    INTEGER NOT NULL CHECK (min_connection_minutes > 0),
    actual_connection_minutes INTEGER,
    status                    VARCHAR(20) NOT NULL DEFAULT 'on_track' CHECK (status IN ('on_track','at_risk','missed')),
    CHECK (outbound_flight_id <> inbound_flight_id)
);

CREATE TABLE IF NOT EXISTS emergency_event (
    id           SERIAL PRIMARY KEY,
    type         VARCHAR(20) NOT NULL CHECK (type IN ('medical','security','weather','technical','fire')),
    flight_id    INTEGER REFERENCES flight(id),
    gate_id      INTEGER REFERENCES gate(id),
    declared_by  INTEGER NOT NULL REFERENCES "user"(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
    declared_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    notes        TEXT,
    CHECK (flight_id IS NOT NULL OR gate_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS emergency_alert (
    id              SERIAL PRIMARY KEY,
    emergency_id    INTEGER NOT NULL REFERENCES emergency_event(id) ON DELETE CASCADE,
    recipient_role  VARCHAR(20) NOT NULL CHECK (recipient_role IN ('ground_crew','security','medical','ops_manager','admin')),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS assistance_request (
    id                SERIAL PRIMARY KEY,
    booking_id        INTEGER NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
    type              VARCHAR(20) NOT NULL CHECK (type IN ('wheelchair','medical','visual','hearing','elderly_support')),
    status            VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','assigned','in_progress','completed')),
    assigned_staff_id INTEGER REFERENCES "user"(id),
    notes             TEXT
);

CREATE TABLE IF NOT EXISTS employee (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER UNIQUE NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    department     TEXT NOT NULL,
    role_title     TEXT NOT NULL,
    certification  TEXT,
    shift_pattern  TEXT,
    status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave'))
);

CREATE TABLE IF NOT EXISTS shift (
    id             SERIAL PRIMARY KEY,
    employee_id    INTEGER NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    start_time     TIMESTAMPTZ NOT NULL,
    end_time       TIMESTAMPTZ NOT NULL,
    area_assigned  TEXT,
    CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS attendance (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    shift_id    INTEGER NOT NULL REFERENCES shift(id) ON DELETE CASCADE,
    clock_in    TIMESTAMPTZ,
    clock_out   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS parking_lot (
    id           SERIAL PRIMARY KEY,
    airport_id   INTEGER NOT NULL REFERENCES airport(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    total_slots  INTEGER NOT NULL CHECK (total_slots > 0),
    hourly_rate  NUMERIC(6,2) NOT NULL CHECK (hourly_rate >= 0)
);

CREATE TABLE IF NOT EXISTS parking_slot (
    id           SERIAL PRIMARY KEY,
    lot_id       INTEGER NOT NULL REFERENCES parking_lot(id) ON DELETE CASCADE,
    slot_number  VARCHAR(10) NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (status IN ('free','occupied','reserved')),
    UNIQUE (lot_id, slot_number)
);

CREATE TABLE IF NOT EXISTS parking_booking (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES "user"(id),
    slot_id        INTEGER NOT NULL REFERENCES parking_slot(id),
    vehicle_number TEXT NOT NULL,
    entry_time     TIMESTAMPTZ,
    exit_time      TIMESTAMPTZ,
    amount_paid    NUMERIC(8,2)
);

CREATE TABLE IF NOT EXISTS facility (
    id                       SERIAL PRIMARY KEY,
    airport_id               INTEGER NOT NULL REFERENCES airport(id) ON DELETE CASCADE,
    name                     TEXT NOT NULL,
    type                     VARCHAR(20) NOT NULL
                              CHECK (type IN ('lounge','restaurant','shop','restroom','prayer_room','charging_station')),
    location_terminal        TEXT,
    location_gate_proximity  TEXT,
    status                   VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);

CREATE TABLE IF NOT EXISTS security_checkpoint (
    id          SERIAL PRIMARY KEY,
    airport_id  INTEGER NOT NULL REFERENCES airport(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    location    TEXT,
    status      VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','delayed'))
);

CREATE TABLE IF NOT EXISTS screening_log (
    id             SERIAL PRIMARY KEY,
    checkpoint_id  INTEGER NOT NULL REFERENCES security_checkpoint(id) ON DELETE CASCADE,
    passenger_id   INTEGER NOT NULL REFERENCES "user"(id),
    result         VARCHAR(20) NOT NULL CHECK (result IN ('cleared','flagged','secondary_screening')),
    "timestamp"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_incident (
    id           SERIAL PRIMARY KEY,
    location     TEXT NOT NULL,
    type         TEXT NOT NULL,
    reported_by  INTEGER NOT NULL REFERENCES "user"(id),
    severity     VARCHAR(10) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    status       VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','closed')),
    "timestamp"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restricted_zone_access (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    zone            TEXT NOT NULL,
    access_granted  BOOLEAN NOT NULL,
    "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_session (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES "user"(id),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_message (
    id           SERIAL PRIMARY KEY,
    session_id   INTEGER NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
    sender       VARCHAR(10) NOT NULL CHECK (sender IN ('user','bot','agent')),
    text         TEXT NOT NULL,
    intent       TEXT,
    "timestamp"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delay_prediction (
    id                       SERIAL PRIMARY KEY,
    flight_id                INTEGER NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
    predicted_delay_minutes  INTEGER NOT NULL,
    confidence               NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
    model_version            TEXT NOT NULL,
    generated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS congestion_forecast (
    id                SERIAL PRIMARY KEY,
    airport_id        INTEGER NOT NULL REFERENCES airport(id) ON DELETE CASCADE,
    area              VARCHAR(20) NOT NULL CHECK (area IN ('security','gate','parking')),
    forecasted_load   NUMERIC(5,2) NOT NULL,
    time_window       TSTZRANGE NOT NULL,
    generated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flight_status ON flight(status);
CREATE INDEX IF NOT EXISTS idx_flight_departure ON flight(scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_booking_flight ON booking(flight_id);
CREATE INDEX IF NOT EXISTS idx_booking_user ON booking(user_id);
CREATE INDEX IF NOT EXISTS idx_seat_flight ON seat(flight_id) WHERE is_booked = false;
CREATE INDEX IF NOT EXISTS idx_baggage_status ON baggage(status);
CREATE INDEX IF NOT EXISTS idx_connection_status ON connection(status);
CREATE INDEX IF NOT EXISTS idx_resource_assignment_window ON resource_assignment(resource_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_shift_window ON shift(employee_id, start_time, end_time);
