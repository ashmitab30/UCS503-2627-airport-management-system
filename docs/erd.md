# Entity-Relationship Diagram

This renders automatically on GitHub (Mermaid support). If viewing elsewhere,
paste the block into https://mermaid.live.

Split into two diagrams for readability: **Core + Booking/Ops** and
**Tier-2 modules**. Both hang off the same core tables (`Flight`, `User`,
`Booking`, `Employee`), which is the point — one shared operational layer,
not twelve silos.

## Diagram 1 — Core, Ops, Booking, Delay, Connections, Emergency, Chatbot

```mermaid
erDiagram
    AIRPORT ||--o{ GATE : has
    AIRPORT ||--o{ RESOURCE : has
    AIRCRAFT_TYPE ||--o{ FLIGHT : "flies as"
    AIRPORT ||--o{ FLIGHT : "origin/dest"
    GATE ||--o{ FLIGHT : assigned
    FLIGHT ||--o{ SEAT : has
    FLIGHT ||--o{ DELAY_LOG : logs
    FLIGHT ||--o{ TURNAROUND_CHECKLIST : has
    FLIGHT ||--o{ RESOURCE_ASSIGNMENT : uses
    RESOURCE ||--o{ RESOURCE_ASSIGNMENT : "assigned to"

    USER ||--o{ BOOKING : makes
    FLIGHT ||--o{ BOOKING : "booked on"
    SEAT ||--o| BOOKING : "held by"
    BOOKING ||--o| PAYMENT : "paid via"
    BOOKING ||--o{ ASSISTANCE_REQUEST : requests
    BOOKING ||--o{ BAGGAGE : checks_in

    FLIGHT ||--o{ CONNECTION : "inbound leg"
    FLIGHT ||--o{ CONNECTION : "outbound leg"
    USER ||--o{ CONNECTION : "passenger of"

    FLIGHT ||--o{ EMERGENCY_EVENT : "declared against"
    GATE ||--o{ EMERGENCY_EVENT : "declared against"
    EMERGENCY_EVENT ||--o{ EMERGENCY_ALERT : triggers

    USER ||--o{ CHAT_SESSION : starts
    CHAT_SESSION ||--o{ CHAT_MESSAGE : contains

    USER ||--o{ DELAY_LOG : logs
    FLIGHT ||--o{ DELAY_PREDICTION : predicts
    AIRPORT ||--o{ CONGESTION_FORECAST : forecasts
```

## Diagram 2 — Staff, Parking, Facilities, Security (Tier 2)

```mermaid
erDiagram
    USER ||--o| EMPLOYEE : "is a"
    EMPLOYEE ||--o{ SHIFT : works
    EMPLOYEE ||--o{ ATTENDANCE : clocks
    SHIFT ||--o{ ATTENDANCE : covers
    EMPLOYEE ||--o{ RESTRICTED_ZONE_ACCESS : logs

    AIRPORT ||--o{ PARKING_LOT : has
    PARKING_LOT ||--o{ PARKING_SLOT : contains
    USER ||--o{ PARKING_BOOKING : books
    PARKING_SLOT ||--o| PARKING_BOOKING : "reserved by"

    AIRPORT ||--o{ FACILITY : has

    AIRPORT ||--o{ SECURITY_CHECKPOINT : has
    SECURITY_CHECKPOINT ||--o{ SCREENING_LOG : logs
    USER ||--o{ SCREENING_LOG : screened
    USER ||--o{ SECURITY_INCIDENT : reports
```

## Notes for the report

- `User` is the auth/identity table (JWT, roles). `Employee` and `Passenger`
  are role-specific profile extensions of `User` — this avoids duplicating
  auth logic per role, which is worth a sentence in the architecture section
  of the report.
- `Flight` is the busiest table in the schema by relationship count — it's
  touched by Ops Core, Booking, Delay, Connections, Emergency, and
  Predictive Analytics. That fan-out is exactly the "one shared core, many
  views" claim from the architecture doc, and it's visible directly in the
  diagram, which makes it an easy thing to point to when a grader asks how
  the modules integrate.
