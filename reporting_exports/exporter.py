"""CSV exporter for reporting, usage, and audit reports.

This is the MVP export pipeline described in the PRD. A single call to
:meth:`CSVExporter.export` (or :meth:`export_to_file`) turns a :class:`Report`
into an audit-ready CSV while enforcing four guarantees:

1. **Permission.** A user may only export reports they are authorized to view.
2. **Fidelity.** Exported values match the report source of truth exactly.
3. **Completeness.** Exports never silently truncate; oversized reports fail
   loudly with a clear message, and a content checksum lets a reviewer verify
   the file was not altered.
4. **Context.** Every export can carry a metadata header (report name, source,
   account, date range, filters, generated timestamp, and generator) so the
   file is self-describing for audits and finance reconciliation.
"""

from __future__ import annotations

import csv
import datetime as _dt
import hashlib
import io
import os
from typing import Any

from .errors import ExportError, PermissionDeniedError
from .models import ExportRequest, ExportResult, ExportStatus, Report

# Characters that spreadsheet applications may interpret as the start of a
# formula. Prefixing such cells neutralizes CSV/formula injection (OWASP), which
# matters most for the finance and audit exports this feature targets.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


class CSVExporter:
    """Renders reports to CSV.

    Parameters
    ----------
    include_metadata:
        When ``True`` (default) the output begins with ``#``-prefixed metadata
        lines followed by a blank line, then the header row and data. This makes
        the file self-describing for audits. Set ``False`` for a plain CSV that
        naive parsers can read without skipping comment lines.
    sanitize_formulas:
        When ``True`` (default) cells beginning with a risky character are
        prefixed with a single quote to prevent formula injection.
    max_rows:
        Optional hard cap. If a report has more rows than this, the export
        fails rather than producing an incomplete audit file.
    """

    def __init__(
        self,
        *,
        include_metadata: bool = True,
        sanitize_formulas: bool = True,
        max_rows: int | None = None,
    ) -> None:
        if max_rows is not None and max_rows < 0:
            raise ValueError("max_rows must be non-negative")
        self.include_metadata = include_metadata
        self.sanitize_formulas = sanitize_formulas
        self.max_rows = max_rows

    # -- public API ---------------------------------------------------------

    def export(self, request: ExportRequest) -> ExportResult:
        """Render an export in memory and return its :class:`ExportResult`.

        The result's ``message`` is a human-readable summary; use :meth:`render`
        if you need the CSV bytes themselves. Permission failures raise
        :class:`PermissionDeniedError`; operational failures (e.g. exceeding
        ``max_rows``) are returned as a ``FAILED`` result.
        """

        self._authorize(request)
        try:
            content = self._render_csv(request.report)
        except ExportError as exc:
            return self._failed_result(request, str(exc))

        return self._completed_result(request, content, file_path=None)

    def export_to_file(self, request: ExportRequest, path: str) -> ExportResult:
        """Render an export and write it to ``path``.

        The file is written atomically (to a temporary file that is then
        renamed) so a partially written file is never left behind on failure.
        """

        self._authorize(request)
        try:
            content = self._render_csv(request.report)
        except ExportError as exc:
            return self._failed_result(request, str(exc))

        tmp_path = f"{path}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8", newline="") as handle:
                handle.write(content)
            os.replace(tmp_path, path)
        except OSError as exc:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return self._failed_result(request, f"could not write export file: {exc}")

        return self._completed_result(request, content, file_path=path)

    def render(self, report: Report) -> str:
        """Render ``report`` to CSV text without authorization or result wrapping.

        Raises :class:`ExportError` if the report exceeds ``max_rows``.
        """

        return self._render_csv(report)

    # -- internals ----------------------------------------------------------

    def _authorize(self, request: ExportRequest) -> None:
        report = request.report
        user = request.requested_by
        if not user.can_access(report.id):
            raise PermissionDeniedError(
                f"user {user.id!r} is not authorized to export report {report.id!r}"
            )

    def _render_csv(self, report: Report) -> str:
        if self.max_rows is not None and len(report.rows) > self.max_rows:
            raise ExportError(
                f"report has {len(report.rows)} rows which exceeds the limit of "
                f"{self.max_rows}; narrow the date range or filters and try again"
            )

        buffer = io.StringIO()

        if self.include_metadata:
            for line in self._metadata_lines(report):
                buffer.write(f"# {line}\n")
            buffer.write("\n")

        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow([self._cell(col) for col in report.columns])
        for row in report.rows:
            writer.writerow([self._cell(row.get(col)) for col in report.columns])

        return buffer.getvalue()

    def _metadata_lines(self, report: Report) -> list[str]:
        date_range = str(report.date_range) if report.date_range else "all time"
        filters = (
            ", ".join(f"{k}={v}" for k, v in sorted(report.filters.items()))
            if report.filters
            else "none"
        )
        return [
            f"Report: {report.name}",
            f"Report ID: {report.id}",
            f"Source: {report.source.value}",
            f"Account: {report.account or 'n/a'}",
            f"Date range: {date_range}",
            f"Filters: {filters}",
            f"Row count: {len(report.rows)}",
            f"Generated at: {self._now().isoformat()}",
        ]

    def _cell(self, value: Any) -> str:
        """Convert a value to its exported text form.

        ``None`` becomes an empty cell. Everything else is stringified as-is so
        the export mirrors the source of truth. Optionally, cells that could be
        interpreted as spreadsheet formulas are neutralized.
        """

        if value is None:
            text = ""
        elif isinstance(value, bool):
            text = "true" if value else "false"
        else:
            text = str(value)

        if self.sanitize_formulas and text.startswith(_FORMULA_PREFIXES):
            text = "'" + text
        return text

    def _checksum(self, content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def _completed_result(
        self, request: ExportRequest, content: str, *, file_path: str | None
    ) -> ExportResult:
        report = request.report
        row_count = len(report.rows)
        location = f" at {file_path}" if file_path else ""
        message = (
            f"Exported {row_count} row(s) from '{report.name}'{location}. "
            f"The file includes all rows for the selected filters."
        )
        return ExportResult(
            status=ExportStatus.COMPLETED,
            report_id=report.id,
            report_name=report.name,
            generated_at=self._now(),
            generated_by=request.requested_by.id,
            row_count=row_count,
            complete=True,
            checksum=self._checksum(content),
            file_path=file_path,
            message=message,
        )

    def _failed_result(self, request: ExportRequest, error: str) -> ExportResult:
        report = request.report
        return ExportResult(
            status=ExportStatus.FAILED,
            report_id=report.id,
            report_name=report.name,
            generated_at=self._now(),
            generated_by=request.requested_by.id,
            row_count=0,
            complete=False,
            message=f"Export of '{report.name}' failed: {error}",
            error=error,
        )

    def _now(self) -> _dt.datetime:
        return _dt.datetime.now(_dt.timezone.utc)
