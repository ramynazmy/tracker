#!/usr/bin/env python3
"""
One-time migration: DDC_Architecture_Tracker_v2_fixed.xlsm → the tracker Sheet.

    python3 scripts/migrate-workbook.py DDC_Architecture_Tracker_v2_fixed.xlsm \
        --actor ramy.nazmy@gmail.com --out scripts/out

Writes three TSV files to --out. Paste each into A2 of its tab, in this order:

    lists.tsv     → Lists!A2      (first: everything else references it)
    features.tsv  → Features!A2
    actions.tsv   → Actions!A2

Then run refreshValidation() and protectRanges() in Apps Script.

WHY TSV, NOT CSV
    Pasting into Sheets splits on tabs with no quoting rules to get wrong.
    Values here contain commas, en-dashes and smart quotes; TSV carries them
    through untouched.

WHY READ THE .xlsm DIRECTLY, NOT A CSV EXPORT
    xlsx stores dates as serial numbers natively — the same 1899-12-30 epoch the
    app uses. Reading the file gives the exact numbers to write back, with zero
    conversion and no locale risk. A CSV export formats them first and forces a
    re-parse under whatever locale Excel felt like.

Standard library only. Read-only: the workbook is never modified.
"""

import argparse
import datetime as dt
import os
import re
import sys
import uuid
import zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# The source workbook's own layout. Headers are NOT on row 1 in either sheet.
TRACKER_SHEET = "xl/worksheets/sheet2.xml"
TRACKER_FIRST_DATA_ROW = 3
TRACKER_COLS = {
    "channel": 2,
    "release": 3,  # the workbook calls this "Project"
    "platform": 4,
    "name": 5,
    "status": 6,
    "complexity": 7,
    "asdRequired": 8,
    "asdStatus": 9,
    "owner": 10,
}

ACTIONS_SHEET = "xl/worksheets/sheet3.xml"
ACTIONS_FIRST_DATA_ROW = 5
ACTIONS_COLS = {
    "feature": 2,
    "name": 3,
    "owner": 4,
    "status": 5,
    "raisedOn": 6,
    "dueDate": 7,
    "notes": 8,
}

HOUSEKEEPING = ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "deleted"]
FEATURE_FIELDS = [
    "name", "channel", "release", "platform", "status",
    "complexity", "asdRequired", "asdStatus", "owner", "notes",
]
ACTION_FIELDS = ["featureId", "name", "owner", "status", "raisedOn", "dueDate", "notes"]
LIST_HEADERS = ["kind", "id", "label", "parent", "active", "order"]

# Which workbook column feeds which vocabulary. `release` is handled separately
# because it is scoped to a channel.
UNSCOPED_KINDS = {
    "channel": "channel",
    "platform": "platform",
    "status": "featureStatus",
    "complexity": "complexity",
    "asdRequired": "asdRequired",
    "asdStatus": "asdStatus",
    "owner": "owner",
}

# Display order for the statuses, so the dropdown reads as a workflow rather
# than alphabetically. Anything unlisted sorts after these.
PREFERRED_ORDER = {
    "featureStatus": ["Not Started", "High-Level Sizing", "In Progress", "On Hold", "Done"],
    "actionStatus": ["Open", "In Progress", "Done", "Cancelled"],
    "complexity": ["Low", "Medium", "High"],
    "asdRequired": ["Yes", "No"],
}

# Labels that belong at the end of their list whatever they sort as. "Backlog"
# is alphabetically first among the releases and conceptually last.
SORT_LAST = {"Backlog", "Unassigned", "-"}

# A date typed as text that we know the intent of. Three reviewable lines with
# a name attached beats a date-parsing heuristic guessing at someone's deadline.
DUE_DATE_OVERRIDES = {
    # "1508/2026" is a transposed 15/08/2026 — confirm before trusting this.
    "1508/2026": "2026-08-15",
}

SERIAL_EPOCH = dt.date(1899, 12, 30)


# --------------------------------------------------------------------------
# Reading the workbook
# --------------------------------------------------------------------------

def load_shared_strings(z):
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return [
        "".join(t.text or "" for t in si.iter(f"{NS}t"))
        for si in root.findall(f"{NS}si")
    ]


def cell_ref(ref):
    """'B7' → (2, 7)."""
    m = re.match(r"([A-Z]+)(\d+)", ref)
    col = 0
    for ch in m.group(1):
        col = col * 26 + ord(ch) - 64
    return col, int(m.group(2))


def read_grid(z, path, shared):
    """{row: {col: value}} of literal values. Formula cells are skipped."""
    grid = {}
    for c in ET.fromstring(z.read(path)).iter(f"{NS}c"):
        col, row = cell_ref(c.get("r"))
        # Formula cells are the workbook's own rollups (# and Open Actions).
        # They are recomputed in the app and must not migrate as data.
        if c.find(f"{NS}f") is not None:
            continue
        v = c.find(f"{NS}v")
        if v is None or v.text is None:
            continue
        if c.get("t") == "s":
            value = shared[int(v.text)]
        else:
            value = v.text
        grid.setdefault(row, {})[col] = value
    return grid


def cell(grid, row, col):
    return str(grid.get(row, {}).get(col, "") or "").strip()


# --------------------------------------------------------------------------
# Values
# --------------------------------------------------------------------------

def slug(value):
    """'Platform One – Example (Retired)' → 'platform-one-example-retired'."""
    text = value.strip().lower()
    text = text.replace("–", "-").replace("—", "-")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-") or "value"


def join_key(value):
    """Normalised feature name, used ONLY to resolve actions to features.

    The stored name keeps its original characters; this is a lookup key. Three
    feature names carry smart quotes, and the actions reference them by text.
    """
    text = value.replace("‘", "'").replace("’", "'")
    text = text.replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip().lower()


def serial_to_iso(value):
    """A workbook date serial → ISO. Returns None if it is not a serial."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return (SERIAL_EPOCH + dt.timedelta(days=round(n))).isoformat()


def guard(value):
    """Neutralise formula injection.

    A PASTE into Sheets evaluates a leading =, + , - or @ exactly as
    USER_ENTERED does. This is not optional just because these are feature
    names — see sanitizeText in src/sheets/rows.ts.
    """
    return "'" + value if re.match(r"^[=+\-@]", value) else value


def tsv_safe(value, warnings, where):
    """Tabs and newlines would break the paste into separate cells or rows."""
    text = str(value)
    if "\t" in text or "\n" in text or "\r" in text:
        warnings.append(f"{where}: collapsed embedded tab/newline")
        text = re.sub(r"[\t\r\n]+", " · ", text)
    return text


# --------------------------------------------------------------------------
# Migration
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("workbook")
    ap.add_argument("--actor", required=True, help="email recorded as createdBy/updatedBy")
    ap.add_argument("--out", default="scripts/out")
    args = ap.parse_args()

    if not os.path.exists(args.workbook):
        sys.exit(f"No such workbook: {args.workbook}")

    z = zipfile.ZipFile(args.workbook)
    shared = load_shared_strings(z)
    tracker = read_grid(z, TRACKER_SHEET, shared)
    actions_grid = read_grid(z, ACTIONS_SHEET, shared)

    warnings = []
    stamp = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    # -- vocabularies ------------------------------------------------------
    # Built from the values actually observed, so nothing in the migrated data
    # can point at a missing entry. That is what makes "no unknown chips on day
    # one" a meaningful check.
    vocab = {}          # kind -> {id: (label, parent)}
    def note(kind, label, parent=None):
        if not label:
            return None
        prefix = f"{parent}-" if parent else ""
        vid = prefix + slug(label)
        vocab.setdefault(kind, {}).setdefault(vid, (label, parent))
        return vid

    # -- features ----------------------------------------------------------
    features = []
    by_join_key = {}
    max_row = max(tracker) if tracker else 0

    for row in range(TRACKER_FIRST_DATA_ROW, max_row + 1):
        name = cell(tracker, row, TRACKER_COLS["name"])
        if not name:
            continue

        channel_label = cell(tracker, row, TRACKER_COLS["channel"])
        channel_id = note("channel", channel_label)

        release_label = cell(tracker, row, TRACKER_COLS["release"])
        # Scoped to its channel: the same release name under two channels
        # is two different releases, so each gets its own id.
        release_id = note("release", release_label, parent=channel_id) if channel_id else note("release", release_label)

        values = {
            "name": name,
            "channel": channel_id or "",
            "release": release_id or "",
            "notes": "",
        }
        for column, kind in UNSCOPED_KINDS.items():
            if column == "channel":
                continue
            label = cell(tracker, row, TRACKER_COLS[column])
            values[column] = note(kind, label) or ""

        record_id = str(uuid.uuid4())
        features.append((record_id, values))

        key = join_key(name)
        if key in by_join_key:
            warnings.append(f"Features row {row}: duplicate feature name {name!r}; actions will attach to the first")
        else:
            by_join_key[key] = record_id

        if any(ord(ch) > 127 for ch in name):
            warnings.append(f"Features row {row}: non-ASCII characters kept verbatim in {name!r}")

    # -- actions -----------------------------------------------------------
    actions = []
    max_action_row = max(actions_grid) if actions_grid else 0

    for row in range(ACTIONS_FIRST_DATA_ROW, max_action_row + 1):
        name = cell(actions_grid, row, ACTIONS_COLS["name"])
        feature_name = cell(actions_grid, row, ACTIONS_COLS["feature"])
        if not name and not feature_name:
            continue

        feature_id = by_join_key.get(join_key(feature_name), "")
        if feature_name and not feature_id:
            warnings.append(f"Actions row {row}: no feature matches {feature_name!r}; left unlinked")
        if not name:
            warnings.append(f"Actions row {row}: has a feature but no action text; skipped")
            continue

        notes = cell(actions_grid, row, ACTIONS_COLS["notes"])
        dates = {}
        for column in ("raisedOn", "dueDate"):
            raw = cell(actions_grid, row, ACTIONS_COLS[column])
            if not raw:
                dates[column] = ""
                continue
            iso = serial_to_iso(raw)
            if iso:
                dates[column] = iso
            elif raw in DUE_DATE_OVERRIDES:
                dates[column] = DUE_DATE_OVERRIDES[raw]
                warnings.append(f"Actions row {row}: {column} {raw!r} → {dates[column]} via override table")
            else:
                dates[column] = ""
                notes = (notes + " " if notes else "") + f"[imported {column}: {raw}]"
                warnings.append(f"Actions row {row}: {column} {raw!r} is not a date; blanked, raw value kept in notes")

        actions.append((str(uuid.uuid4()), {
            "featureId": feature_id,
            "name": name,
            "owner": note("owner", cell(actions_grid, row, ACTIONS_COLS["owner"])) or "",
            "status": note("actionStatus", cell(actions_grid, row, ACTIONS_COLS["status"])) or "",
            "raisedOn": dates["raisedOn"],
            "dueDate": dates["dueDate"],
            "notes": notes,
        }))

    # -- write -------------------------------------------------------------
    os.makedirs(args.out, exist_ok=True)

    def housekeeping(record_id):
        return [record_id, stamp, args.actor, stamp, args.actor, "FALSE"]

    def write_tsv(filename, headers, rows):
        path = os.path.join(args.out, filename)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\t".join(headers) + "\n")
            for row in rows:
                fh.write("\t".join(row) + "\n")
        return path

    feature_rows = [
        housekeeping(rid) + [tsv_safe(guard(v[f]), warnings, f"feature {v['name']}") for f in FEATURE_FIELDS]
        for rid, v in features
    ]
    action_rows = [
        housekeeping(rid) + [tsv_safe(guard(v[f]), warnings, f"action {v['name']}") for f in ACTION_FIELDS]
        for rid, v in actions
    ]

    list_rows = []
    for kind in sorted(vocab):
        preferred = PREFERRED_ORDER.get(kind, [])
        def rank(item):
            label = item[1][0]
            return (preferred.index(label) if label in preferred else len(preferred), label)
        for order, (vid, (label, parent)) in enumerate(sorted(vocab[kind].items(), key=rank), start=1):
            list_rows.append([kind, vid, tsv_safe(label, warnings, kind), parent or "", "TRUE", str(order)])

    paths = [
        write_tsv("lists.tsv", LIST_HEADERS, list_rows),
        write_tsv("features.tsv", HOUSEKEEPING + FEATURE_FIELDS, feature_rows),
        write_tsv("actions.tsv", HOUSEKEEPING + ACTION_FIELDS, action_rows),
    ]

    # -- verification ------------------------------------------------------
    linked = sum(1 for _, v in actions if v["featureId"])
    print("\n".join(f"wrote {p}" for p in paths))
    print(f"\n{'='*62}\nVERIFICATION\n{'='*62}")
    print(f"  features         {len(features)}")
    print(f"  actions          {len(actions)}  ({linked} linked, {len(actions) - linked} unlinked)")
    print(f"  vocabularies     {len(vocab)} kinds, {sum(len(v) for v in vocab.values())} values")
    for kind in sorted(vocab):
        print(f"      {kind:<16} {len(vocab[kind])}")

    unresolved = [
        v[field] for _, v in features
        for field in ("channel", "release", "status", "complexity", "asdRequired", "asdStatus", "owner", "platform")
        if v[field] and v[field] not in {i for k in vocab for i in vocab[k]}
    ]
    print(f"\n  references resolving to a Lists entry: {'ALL' if not unresolved else f'{len(unresolved)} MISSING'}")

    print(f"\n  warnings         {len(warnings)}")
    for w in warnings:
        print(f"      - {w}")
    print()

    if unresolved:
        sys.exit("FAILED: some references have no Lists entry")


if __name__ == "__main__":
    main()
