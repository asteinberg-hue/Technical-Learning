# Reporting Exports (MVP)

A small, well-tested pipeline for exporting **dashboard**, **usage**, and
**audit** reports to audit-ready CSV. It is the first concrete slice of the
["Reporting Exports for Executive Reporting, Audits, and Reconciliation" PRD][prd]:
customers cannot reliably export reporting/usage data, forcing manual retyping
and blocking finance and compliance workflows.

This MVP focuses on the single clearest requirement in that PRD — reliable
CSV/raw export — and deliberately leaves the still-open discovery questions
(scheduled delivery, Slack delivery, inline comments, extra formats) out of
scope.

## What it does

- **Permission-aware.** A user can only export reports they are authorized to
  view; unauthorized attempts raise `PermissionDeniedError`.
- **Faithful.** Exported values mirror the report source of truth exactly.
- **Complete.** Exports never silently truncate. Oversized reports fail loudly,
  and every export carries a SHA-256 checksum so a reviewer can verify integrity.
- **Self-describing.** Each file can begin with a metadata header (report name,
  source, account, date range, filters, row count, and generated timestamp) so
  it is suitable as audit evidence.
- **Safe.** Cells that could be read as spreadsheet formulas are neutralized to
  prevent CSV/formula injection.

## Usage

```python
import datetime as dt
from reporting_exports import (
    CSVExporter, DateRange, ExportRequest, Report, ReportSource, User,
)

report = Report(
    id="rep_usage_july",
    name="July Usage",
    source=ReportSource.USAGE,
    columns=["date", "account", "seats"],
    rows=[{"date": "2026-07-01", "account": "WareEx", "seats": 120}],
    account="WareEx Logistics",
    filters={"plan": "enterprise"},
    date_range=DateRange(dt.date(2026, 7, 1), dt.date(2026, 7, 31)),
)

user = User(id="u_1", authorized_report_ids=frozenset({"rep_usage_july"}))
result = CSVExporter().export_to_file(
    ExportRequest(report=report, requested_by=user), "july_usage.csv"
)

print(result.status, result.row_count, result.checksum)
```

## Development

```bash
python -m pytest
```

[prd]: https://app.dev.notion.com/p/40533c3833b54125ad192da0a374379b
