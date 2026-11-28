-- 010_airport_city.sql
-- Add nullable column city to airport table and populate for existing airports

ALTER TABLE airport ADD COLUMN IF NOT EXISTS city VARCHAR(100);

UPDATE airport SET city = 'Delhi' WHERE code = 'DEL';
UPDATE airport SET city = 'Mumbai' WHERE code = 'BOM';
UPDATE airport SET city = 'Bengaluru' WHERE code = 'BLR';
