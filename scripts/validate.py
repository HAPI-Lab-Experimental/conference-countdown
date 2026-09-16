#!/usr/bin/env python3
"""Validate conferences.json and the inline fallback copy embedded in index.html.

Usage:
    python3 scripts/validate.py          # check, exit 1 on any problem
    python3 scripts/validate.py --fix    # also rewrite the inline fallback in index.html

Standard library only.
"""
import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "conferences.json"
INDEX_PATH = ROOT / "index.html"

KINDS = ("deadline", "conference")
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
OFFSET_RE = re.compile(r"(Z|[+-]\d{2}:\d{2})$")
FALLBACK_RE = re.compile(
    r'(<script type="application/json" id="fallback-data">)(.*?)(</script>)', re.S
)
CONF_KEYS = {"id", "name", "url", "location", "note", "events"}
CONF_REQUIRED = ("id", "name", "url", "location", "events")
EVENT_KEYS = {"label", "start", "end", "kind"}
EVENT_REQUIRED = ("label", "start", "kind")


def parse_iso(value):
    """Return an aware datetime, or raise ValueError with a helpful message."""
    if not isinstance(value, str) or not OFFSET_RE.search(value):
        raise ValueError(
            "must be ISO-8601 with an explicit UTC offset, e.g. 2026-09-18T23:59:00-12:00"
        )
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("is not a valid ISO-8601 date-time (%s)" % exc) from None
    if dt.tzinfo is None:
        raise ValueError("is missing a UTC offset")
    return dt


def validate_event(ev, where):
    errors = []
    if not isinstance(ev, dict):
        return ["%s: event must be an object" % where]
    for key in EVENT_REQUIRED:
        if key not in ev:
            errors.append("%s: missing required field '%s'" % (where, key))
    for key in ev:
        if key not in EVENT_KEYS:
            errors.append("%s: unknown field '%s'" % (where, key))
    if not isinstance(ev.get("label", ""), str) or not ev.get("label", "x").strip():
        errors.append("%s: 'label' must be a non-empty string" % where)
    if ev.get("kind") is not None and ev["kind"] not in KINDS:
        errors.append("%s: 'kind' must be one of %s" % (where, ", ".join(KINDS)))
    start = end = None
    if "start" in ev:
        try:
            start = parse_iso(ev["start"])
        except ValueError as exc:
            errors.append("%s: 'start' %s" % (where, exc))
    if "end" in ev:
        try:
            end = parse_iso(ev["end"])
        except ValueError as exc:
            errors.append("%s: 'end' %s" % (where, exc))
    if start and end and end < start:
        errors.append("%s: 'end' is before 'start'" % where)
    return errors


def validate_conference(conf, where):
    errors = []
    if not isinstance(conf, dict):
        return ["%s: conference must be an object" % where]
    for key in CONF_REQUIRED:
        if key not in conf:
            errors.append("%s: missing required field '%s'" % (where, key))
    for key in conf:
        if key not in CONF_KEYS:
            errors.append("%s: unknown field '%s'" % (where, key))
    cid = conf.get("id")
    if cid is not None and (not isinstance(cid, str) or not ID_RE.match(cid)):
        errors.append("%s: 'id' must be a lowercase slug like 'iclr-2027'" % where)
    for key in ("name", "location"):
        if key in conf and (not isinstance(conf[key], str) or not conf[key].strip()):
            errors.append("%s: '%s' must be a non-empty string" % (where, key))
    url = conf.get("url")
    if url is not None and (not isinstance(url, str) or not re.match(r"^https?://\S+$", url)):
        errors.append("%s: 'url' must start with http:// or https://" % where)
    if "note" in conf and not isinstance(conf["note"], str):
        errors.append("%s: 'note' must be a string" % where)
    events = conf.get("events")
    if events is not None:
        if not isinstance(events, list):
            errors.append("%s: 'events' must be an array" % where)
        else:
            for i, ev in enumerate(events):
                errors.extend(validate_event(ev, "%s.events[%d]" % (where, i)))
    return errors


def validate_data(data):
    """Return a list of error strings (empty when the data is valid)."""
    if not isinstance(data, list):
        return ["top level must be an array of conferences"]
    errors = []
    seen = {}
    for i, conf in enumerate(data):
        where = "conferences[%d]" % i
        if isinstance(conf, dict) and isinstance(conf.get("id"), str):
            where = conf["id"]
            if conf["id"] in seen:
                errors.append("duplicate id '%s' (conferences[%d] and [%d])" % (conf["id"], seen[conf["id"]], i))
            seen.setdefault(conf["id"], i)
        errors.extend(validate_conference(conf, where))
    return errors


def dump_json(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def load_json(path=JSON_PATH):
    return json.loads(path.read_text(encoding="utf-8"))


def fallback_block(json_text):
    return '<script type="application/json" id="fallback-data">\n%s\n</script>' % json_text.strip()


def check_fallback(json_text, index_text):
    """Return an error string, or None when index.html embeds the same JSON."""
    m = FALLBACK_RE.search(index_text)
    if not m:
        return "index.html: no <script type=\"application/json\" id=\"fallback-data\"> block found"
    if m.group(2).strip() != json_text.strip():
        return "index.html: inline fallback differs from conferences.json (run scripts/validate.py --fix)"
    return None


def sync_fallback(json_text, index_text):
    """Return index_text with the inline fallback replaced by json_text."""
    if "</script" in json_text.lower():
        raise ValueError("conferences.json must not contain '</script'")
    if not FALLBACK_RE.search(index_text):
        raise ValueError("index.html has no fallback-data script block")
    return FALLBACK_RE.sub(lambda m: fallback_block(json_text), index_text, count=1)


def write_all(data, json_path=JSON_PATH, index_path=INDEX_PATH):
    """Write conferences.json and sync the inline copy in index.html."""
    json_text = dump_json(data)
    json_path.write_text(json_text, encoding="utf-8")
    index_text = index_path.read_text(encoding="utf-8")
    index_path.write_text(sync_fallback(json_text, index_text), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--fix", action="store_true", help="rewrite the inline fallback in index.html")
    ap.add_argument("--json", type=Path, default=JSON_PATH, help="path to conferences.json")
    ap.add_argument("--index", type=Path, default=INDEX_PATH, help="path to index.html")
    args = ap.parse_args(argv)

    try:
        json_text = args.json.read_text(encoding="utf-8")
        data = json.loads(json_text)
    except (OSError, ValueError) as exc:
        print("FAIL %s: %s" % (args.json, exc))
        return 1

    errors = validate_data(data)
    for err in errors:
        print("FAIL " + err)
    if errors:
        return 1

    canonical = dump_json(data)
    if json_text != canonical:
        if args.fix:
            args.json.write_text(canonical, encoding="utf-8")
            json_text = canonical
            print("fixed %s formatting" % args.json.name)
        else:
            print("WARN %s is not in canonical format (run --fix to reformat)" % args.json.name)

    try:
        index_text = args.index.read_text(encoding="utf-8")
    except OSError as exc:
        print("FAIL %s: %s" % (args.index, exc))
        return 1

    problem = check_fallback(json_text, index_text)
    if problem and args.fix:
        try:
            args.index.write_text(sync_fallback(json_text, index_text), encoding="utf-8")
        except ValueError as exc:
            print("FAIL " + str(exc))
            return 1
        print("fixed inline fallback in %s" % args.index.name)
        problem = None
    if problem:
        print("FAIL " + problem)
        return 1

    n_events = sum(len(c.get("events", [])) for c in data)
    print("OK   %d conference(s), %d event(s); inline fallback in sync" % (len(data), n_events))
    return 0


if __name__ == "__main__":
    sys.exit(main())
