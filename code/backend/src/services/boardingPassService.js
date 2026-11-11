import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { pool } from '../db/pool.js';

/**
 * Generates an IATA-style QR code payload and returns a Data URL / buffer.
 */
export async function generateQrCode(payloadText) {
  return QRCode.toDataURL(payloadText, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 200,
  });
}

/**
 * Generates a boarding pass PDF and streams it to the Express response.
 */
export async function streamBoardingPassPdf(bookingId, res) {
  const { rows } = await pool.query(
    `SELECT b.id, b.booking_ref, b.status, b.created_at, b.price_cents,
            f.id AS flight_id, f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.status AS flight_status,
            o.code AS origin_code, o.name AS origin_name,
            d.code AS dest_code, d.name AS dest_name,
            g.code AS gate_code,
            s.seat_number, s.class AS seat_class,
            COALESCE(p.name, u.name) AS passenger_name,
            COALESCE(p.email, u.email) AS passenger_email,
            p.passport_number, p.nationality,
            ar.type AS assistance_type, ar.status AS assistance_status
     FROM booking b
     JOIN flight f ON f.id = b.flight_id
     JOIN airport o ON o.id = f.origin_id
     JOIN airport d ON d.id = f.dest_id
     LEFT JOIN gate g ON g.id = f.gate_id
     LEFT JOIN seat s ON s.id = b.seat_id
     LEFT JOIN "user" u ON u.id = b.user_id
     LEFT JOIN passenger p ON p.id = b.passenger_id
     LEFT JOIN assistance_request ar ON ar.booking_id = b.id
     WHERE b.id = $1`,
    [bookingId]
  );

  if (rows.length === 0) {
    throw new Error('Booking not found');
  }

  const b = rows[0];

  const qrPayload = `M1${b.passenger_name.padEnd(20)} E${b.booking_ref} ${b.origin_code}${b.dest_code}${b.flight_number.padEnd(7)} ${b.seat_number} ${b.status.toUpperCase()}`;
  const qrBuffer = await QRCode.toBuffer(qrPayload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 130,
  });

  const doc = new PDFDocument({ size: [600, 320], margin: 20 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="boarding_pass_${b.booking_ref}.pdf"`
  );

  doc.pipe(res);

  // Background card styling
  doc.rect(15, 15, 570, 290).fillAndStroke('#0A192F', '#1D63FF');

  // Header banner
  doc.rect(15, 15, 570, 48).fill('#1D63FF');
  doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold');
  doc.text('MERIDIAN AIR', 30, 28);
  doc.fontSize(10).font('Helvetica');
  doc.text('OFFICIAL BOARDING PASS', 420, 32);

  // Main Route section
  doc.fillColor('#38BDF8').fontSize(26).font('Helvetica-Bold');
  doc.text(b.origin_code, 30, 80);
  doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica');
  doc.text('✈', 100, 86);
  doc.fillColor('#38BDF8').fontSize(26).font('Helvetica-Bold');
  doc.text(b.dest_code, 130, 80);

  // Flight & Gate details
  doc.fillColor('#94A3B8').fontSize(9).font('Helvetica');
  doc.text('FLIGHT', 30, 125);
  doc.text('GATE', 110, 125);
  doc.text('SEAT', 180, 125);
  doc.text('CLASS', 250, 125);

  doc.fillColor('#FFFFFF').fontSize(13).font('Helvetica-Bold');
  doc.text(b.flight_number, 30, 140);
  doc.text(b.gate_code || 'TBD', 110, 140);
  doc.text(b.seat_number || 'TBD', 180, 140);
  doc.text((b.seat_class || 'ECONOMY').toUpperCase(), 250, 140);

  // Passenger & Times
  doc.fillColor('#94A3B8').fontSize(9).font('Helvetica');
  doc.text('PASSENGER NAME', 30, 175);
  doc.text('BOARDING TIME', 180, 175);
  doc.text('DEPARTURE', 270, 175);

  const depDate = new Date(b.scheduled_departure);
  const boardingTime = new Date(depDate.getTime() - 40 * 60_000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const depTimeStr = depDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  doc.fillColor('#FFFFFF').fontSize(12).font('Helvetica-Bold');
  doc.text(b.passenger_name.toUpperCase(), 30, 190);
  doc.text(boardingTime, 180, 190);
  doc.text(depTimeStr, 270, 190);

  // Priority boarding / assistance badge
  if (b.assistance_type) {
    doc.rect(30, 225, 200, 22).fill('#0284C7');
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
    doc.text(`★ PRIORITY BOARDING (${b.assistance_type.toUpperCase()})`, 38, 232);
  }

  // Booking reference and status footer
  doc.fillColor('#64748B').fontSize(8).font('Helvetica');
  doc.text(`BOOKING REF: ${b.booking_ref}  |  STATUS: ${b.status.toUpperCase()}  |  E-TICKET: ETK-${b.id}892`, 30, 275);

  // Perforation line
  doc.dash(4, { space: 4 }).strokeColor('#334155');
  doc.moveTo(380, 15).lineTo(380, 305).stroke();
  doc.undash();

  // Stub section on the right
  doc.fillColor('#38BDF8').fontSize(12).font('Helvetica-Bold');
  doc.text('PASSENGER STUB', 400, 80);

  doc.fillColor('#94A3B8').fontSize(8).font('Helvetica');
  doc.text(`NAME: ${b.passenger_name}`, 400, 105);
  doc.text(`FLIGHT: ${b.flight_number}  |  SEAT: ${b.seat_number || 'TBD'}`, 400, 120);
  doc.text(`ROUTE: ${b.origin_code} - ${b.dest_code}`, 400, 135);

  // Embed QR Code
  doc.image(qrBuffer, 420, 160, { width: 110, height: 110 });

  doc.end();
}

