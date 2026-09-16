# Conference Countdown

A single static page with giant live countdowns to the conference deadlines and
conference dates the lab cares about. No build step, no dependencies: it runs on
GitHub Pages and straight from `file://`.

Live site: `https://<org>.github.io/conference-countdown/`

## Adding a conference

Everything lives in `conferences.json`. Either edit it by hand:

```json
{
  "id": "neurips-2027",
  "name": "NeurIPS 2027",
  "url": "https://neurips.cc",
  "location": "TBA",
  "note": "Optional free text shown under the name.",
  "events": [
    { "label": "Abstract deadline", "start": "2027-05-10T23:59:00-12:00", "kind": "deadline" },
    { "label": "Conference", "start": "2027-12-06T09:00:00-08:00", "end": "2027-12-12T18:00:00-08:00", "kind": "conference" }
  ]
}
```

or use the script, which validates, appends, and keeps the inline copy in
`index.html` in sync:

```sh
python3 scripts/add_conference.py --id neurips-2027 --name "NeurIPS 2027" \
  --url https://neurips.cc --location "TBA" \
  --event "Abstract deadline|2027-05-10T23:59-12:00|deadline" \
  --event "Conference|2027-12-06T09:00-08:00|2027-12-12T18:00-08:00|conference"

# later, when more dates are announced
python3 scripts/add_conference.py --add-event neurips-2027 \
  --event "Full paper deadline|2027-05-17T23:59-12:00|deadline"
```

Fields: `id` (lowercase slug, unique), `name`, `url`, `location` (or `"TBA"`),
optional `note`, and `events`. Each event has `label`, `start`, optional `end`
(multi-day conferences), and `kind` (`deadline` or `conference`). An empty
`events` list is fine and shows "Dates not announced yet".

**Anywhere on Earth.** Write AoE deadlines with the `-12:00` offset, e.g.
`2026-09-18T23:59:00-12:00`. The page labels that offset "AoE" and also shows
the moment in the viewer's local time zone. Every date needs an explicit offset.

After editing by hand, run `python3 scripts/validate.py --fix` (or
`scripts/sync_fallback.py`) to refresh the inline copy of the data inside
`index.html`; CI runs `scripts/validate.py` and fails if they differ.

## Focus mode (wall display)

- `?conf=iclr-2027` shows one conference full-screen.
- `?conf=iclr-2027&event=1` shows only that conference's event with index 1
  (position in its `events` array, starting at 0).

The "Focus" button next to each conference links there; "All conferences"
links back.

## Running locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

Opening `index.html` directly from disk also works (it uses the inline copy).

## Deploying

`.github/workflows/pages.yml` validates on every push and pull request and, on
pushes to `main`, publishes the repository root to GitHub Pages. Set the
repository's Pages source to "GitHub Actions" once if the first run does not
enable it automatically.

## License

MIT, see `LICENSE`.
