-- 006_week6_airport_mcts.sql
-- Sets realistic Minimum Connection Times (MCT) per airport: BOM 45, DEL 60, BLR 40.

BEGIN;

UPDATE airport SET min_connection_minutes = 45 WHERE code = 'BOM';
UPDATE airport SET min_connection_minutes = 60 WHERE code = 'DEL';
UPDATE airport SET min_connection_minutes = 40 WHERE code = 'BLR';

COMMIT;
