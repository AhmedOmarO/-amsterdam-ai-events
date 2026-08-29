# Amsterdam AI Events

A curated calendar of data science, machine learning, agentic AI, and geospatial events in Amsterdam, Utrecht, and online.

## Run locally

Start the server:

```bash
npm start
```

Then open `http://localhost:8000`.

## Dynamic calendar feed

The public `calendar.ics` endpoint is generated from the Google Sheet source of truth at request time. To make it work, publish the sheet so the CSV export URL is reachable, then set:

- `SHEET_ID`
- `SHEET_GID`
- or `SHEET_CSV_URL`

Optional:
- `CALENDAR_TZ` for the calendar timezone

## Google Sheet

The editable source of truth is the Google Sheet created for this project. Update events there and subscribers can refresh the same `calendar.ics` URL.
