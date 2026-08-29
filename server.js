const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8000;
const SHEET_ID = process.env.SHEET_ID || '1d-3nImW8_UpNgSWL0EGYLE3YT20mZYLP3CTNnnnUAP8';
const SHEET_GID = process.env.SHEET_GID || '1835925292';
const SHEET_CSV_URL = process.env.SHEET_CSV_URL || `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const TIME_ZONE = process.env.CALENDAR_TZ || 'Europe/Amsterdam';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function httpGet(url) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    client
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpGet(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Request failed with status ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        value += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (ch === '\r') {
      continue;
    } else {
      value += ch;
    }
  }
  row.push(value);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function parseDateString(value) {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2})\s([A-Za-z]{3})(?:\s(\d{4}))?$/);
  if (!m) return null;
  const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const month = monthMap[m[2]];
  if (month === undefined) return null;
  return { year: m[3] ? Number(m[3]) : new Date().getFullYear(), month, day: Number(m[1]) };
}

function parseTime(value) {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function toIcsDate(dateParts, timeParts) {
  const dt = new Date(Date.UTC(dateParts.year, dateParts.month, dateParts.day, timeParts.hour, timeParts.minute, 0));
  return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function buildIcs(events) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Amsterdam AI Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:${TIME_ZONE}`,
  ];

  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.url) lines.push(`URL:${escapeText(event.url)}`);
    lines.push(`DTSTART:${event.start}`);
    lines.push(`DTEND:${event.end}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

async function loadEventsFromSheet() {
  const csv = await httpGet(SHEET_CSV_URL);
  const rows = parseCsv(csv);
  const headers = rows.shift() || [];
  const index = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));
  const events = [];

  for (const row of rows) {
    const title = row[index['Event Title']]?.trim();
    if (!title) continue;
    const startDate = parseDateString(row[index['Start Date']]);
    const endDate = parseDateString(row[index['End Date']] || row[index['Start Date']]);
    const startTime = parseTime(row[index['Start Time']] || '09:00');
    const endTime = parseTime(row[index['End Time']] || '10:00');
    if (!startDate || !endDate || !startTime || !endTime) continue;

    events.push({
      uid: `${title}-${row[index['Start Date']] || ''}-${row[index['Start Time']] || ''}@amsterdam-ai-events`,
      title,
      start: toIcsDate(startDate, startTime),
      end: toIcsDate(endDate, endTime),
      location: [row[index['Venue']], row[index['Location']]].filter(Boolean).join(' - '),
      url: row[index['Event URL']]?.trim(),
      description: row[index['Category']] || row[index['Notes']] || '',
    });
  }

  return events;
}

function serveLocalCalendar(res) {
  const localPath = path.join(__dirname, 'calendar.ics');
  fs.readFile(localPath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to generate calendar and local fallback is missing.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes['.ics'],
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/calendar.ics') {
    loadEventsFromSheet()
      .then((events) => {
        res.writeHead(200, {
          'Content-Type': mimeTypes['.ics'],
          'Cache-Control': 'no-store',
        });
        res.end(buildIcs(events));
      })
      .catch((err) => {
        console.warn(`Falling back to local calendar.ics: ${err.message}`);
        serveLocalCalendar(res);
      });
    return;
  }

  const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const absPath = path.join(__dirname, filePath);
  if (!absPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(absPath)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer(serveStatic).listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
