"""Exceptions raised by the reporting-exports package.

The design separates *security* failures from *operational* failures:

- ``PermissionDeniedError`` is a hard security boundary. It is raised (never
  swallowed into a result object) so that an authorization failure can never be
  mistaken for a merely "failed" export.
- ``ExportError`` covers operational problems (e.g. a report that is too large
  to export completely). Callers that use :meth:`CSVExporter.export` receive
  these as a ``FAILED`` :class:`~reporting_exports.models.ExportResult` rather
  than an exception, so customer-facing surfaces get a clear message.
"""


class ReportingExportError(Exception):
    """Base class for all errors raised by this package."""


class PermissionDeniedError(ReportingExportError):
    """Raised when a user tries to export data they are not authorized to view."""


class ExportError(ReportingExportError):
    """Raised for operational export failures such as exceeding size limits."""
