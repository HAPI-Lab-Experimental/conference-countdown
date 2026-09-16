#!/usr/bin/env python3
"""Add a conference (or events) to conferences.json and sync the inline fallback in index.html.

Add a new conference:
    python3 scripts/add_conference.py --id neurips-2027 --name "NeurIPS 2027" \
        --url https://neurips.cc --location "TBA" \
        --event "Abstract deadline|2027-05-10T23:59-12:00|deadline" \
        --event "Conference|2027-12-06T09:00-08:00|2027-12-12T18:00-08:00|conference"

Add events to an existing conference:
    python3 scripts/add_conference.py --add-event aied-2027 \
        --event "Abstract deadline|2027-01-25T23:59-12:00|deadline"

Event format:  "label|start|kind"  or  "label|start|end|kind"
Dates are ISO-8601 with an explicit offset; use -12:00 for Anywhere-on-Earth deadlines.
Standard library only.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate  # noqa: E402


def parse_event(spec):
    parts = [p.strip() for p in spec.split("|")]
    if len(parts) == 3:
        label, start, kind = parts
        end = None
    elif len(parts) == 4:
        label, start, end, kind = parts
    else:
        raise ValueError("event %r must be 'label|start|kind' or 'label|start|end|kind'" % spec)
    if not label:
        raise ValueError("event %r has an empty label" % spec)
    if kind not in validate.KINDS:
        raise ValueError("event %r: kind must be one of %s" % (spec, ", ".join(validate.KINDS)))
    try:
        start_dt = validate.parse_iso(start)
    except ValueError as exc:
        raise ValueError("event %r: start %s" % (spec, exc)) from None
    ev = {"label": label, "start": start_dt.isoformat()}
    if end:
        try:
            end_dt = validate.parse_iso(end)
        except ValueError as exc:
            raise ValueError("event %r: end %s" % (spec, exc)) from None
        if end_dt < start_dt:
            raise ValueError("event %r: end is before start" % spec)
        ev["end"] = end_dt.isoformat()
    ev["kind"] = kind
    return ev


def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        epilog=__doc__.split("\n", 1)[1],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--id", help="slug for the new conference, e.g. neurips-2027")
    ap.add_argument("--name", help='display name, e.g. "NeurIPS 2027"')
    ap.add_argument("--url", help="conference web page")
    ap.add_argument("--location", default="TBA", help='city / venue, or "TBA" (default)')
    ap.add_argument("--note", help="optional free-text note shown under the name")
    ap.add_argument("--event", action="append", default=[], metavar="SPEC",
                    help='"label|start|kind" or "label|start|end|kind"; repeatable')
    ap.add_argument("--add-event", metavar="ID", help="append --event entries to this existing conference")
    ap.add_argument("--json", type=Path, default=validate.JSON_PATH, help="path to conferences.json")
    ap.add_argument("--index", type=Path, default=validate.INDEX_PATH, help="path to index.html")
    args = ap.parse_args(argv)

    try:
        data = validate.load_json(args.json)
    except (OSError, ValueError) as exc:
        print("error: cannot read %s: %s" % (args.json, exc), file=sys.stderr)
        return 1
    if not isinstance(data, list):
        print("error: %s must contain an array" % args.json, file=sys.stderr)
        return 1

    try:
        events = [parse_event(spec) for spec in args.event]
    except ValueError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 1

    ids = {c.get("id") for c in data if isinstance(c, dict)}

    if args.add_event:
        if args.id or args.name or args.url:
            print("error: --add-event takes only --event options, not --id/--name/--url", file=sys.stderr)
            return 1
        if not events:
            print("error: --add-event needs at least one --event", file=sys.stderr)
            return 1
        target = next((c for c in data if isinstance(c, dict) and c.get("id") == args.add_event), None)
        if target is None:
            print("error: no conference with id %r (have: %s)" % (args.add_event, ", ".join(sorted(ids))), file=sys.stderr)
            return 1
        target.setdefault("events", []).extend(events)
        what = "added %d event(s) to %s" % (len(events), args.add_event)
    else:
        missing = [k for k in ("id", "name", "url") if not getattr(args, k)]
        if missing:
            print("error: missing %s (or use --add-event ID)" % ", ".join("--" + m for m in missing), file=sys.stderr)
            return 1
        if args.id in ids:
            print("error: a conference with id %r already exists; use --add-event %s to extend it" % (args.id, args.id), file=sys.stderr)
            return 1
        conf = {"id": args.id, "name": args.name, "url": args.url, "location": args.location}
        if args.note:
            conf["note"] = args.note
        conf["events"] = events
        data.append(conf)
        what = "added %s with %d event(s)" % (args.id, len(events))

    errors = validate.validate_data(data)
    if errors:
        for err in errors:
            print("error: " + err, file=sys.stderr)
        print("nothing written", file=sys.stderr)
        return 1

    try:
        validate.write_all(data, args.json, args.index)
    except (OSError, ValueError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 1
    print("%s; wrote %s and synced %s" % (what, args.json.name, args.index.name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
