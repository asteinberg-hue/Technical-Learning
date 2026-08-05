"""Data models for the reporting-exports MVP.

These types describe *what* is being exported (a :class:`Report`), *who* is
asking (a :class:`User`), the request envelope (:class:`ExportRequest`), and the
audit-ready outcome (:class:`ExportResult`).

They are intentionally plain dataclasses with no I/O so they are trivial to
construct in tests and to serialize across service boundaries.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Sequence

# A single exported row is a mapping of column name -> value. Values may be any
# type; the exporter is responsible for turning them into text.
Row = Mapping[str, Any]


class ReportSource(str, Enum):
    """Where a report's data comes from.

    The PRD calls out three distinct export "jobs to be done" that share a
    pipeline but differ in audience: executive dashboards, raw usage data for
    finance reconciliation, and audit-evidence reports.
    """

    DASHBOARD = "dashboard"
    USAGE = "usage"
    AUDIT = "audit"


class ExportStatus(str, Enum):
    """Lifecycle status of an export, surfaced to customers and support."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True)
class User:
    """A caller requesting an export.

    ``authorized_report_ids`` is the set of report ids the user may export. The
    wildcard ``"*"`` grants access to every report (e.g. for an admin). The
    permission check is deliberately explicit rather than implicit so that the
    security boundary is easy to audit and test.
    """

    id: str
    name: str = ""
    authorized_report_ids: frozenset[str] = field(default_factory=frozenset)

    def can_access(self, report_id: str) -> bool:
        return "*" in self.authorized_report_ids or report_id in self.authorized_report_ids


@dataclass(frozen=True)
class DateRange:
    """Inclusive reporting window carried into export metadata."""

    start: _dt.date
    end: _dt.date

    def __str__(self) -> str:
        return f"{self.start.isoformat()}..{self.end.isoformat()}"


@dataclass(frozen=True)
class Report:
    """A tabular report to be exported.

    ``columns`` defines both the schema and the output order. ``rows`` are the
    values; any column missing from a row is exported as an empty cell, and keys
    not present in ``columns`` are ignored (``columns`` is the source of truth
    for the export shape).
    """

    id: str
    name: str
    source: ReportSource
    columns: Sequence[str]
    rows: Sequence[Row]
    account: str = ""
    filters: Mapping[str, Any] = field(default_factory=dict)
    date_range: DateRange | None = None


@dataclass(frozen=True)
class ExportRequest:
    """Envelope pairing a report with the user asking to export it."""

    report: Report
    requested_by: User


@dataclass
class ExportResult:
    """Audit-ready outcome of an export attempt.

    Besides the status, this carries the context needed for audit evidence and
    customer support: the row count actually written, a content checksum for
    integrity/completeness verification, when and by whom it was generated, a
    human-readable ``message``, and (for file exports) the ``file_path``.
    """

    status: ExportStatus
    report_id: str
    report_name: str
    generated_at: _dt.datetime
    generated_by: str
    row_count: int = 0
    complete: bool = False
    checksum: str | None = None
    file_path: str | None = None
    message: str = ""
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status is ExportStatus.COMPLETED
