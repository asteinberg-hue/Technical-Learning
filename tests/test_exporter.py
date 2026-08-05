import datetime as dt

import pytest

from reporting_exports import (
    CSVExporter,
    DateRange,
    ExportRequest,
    ExportStatus,
    PermissionDeniedError,
    Report,
    ReportSource,
    User,
)


def make_report(**overrides) -> Report:
    defaults = dict(
        id="rep_usage_july",
        name="July Usage",
        source=ReportSource.USAGE,
        columns=["date", "account", "seats", "active"],
        rows=[
            {"date": "2026-07-01", "account": "WareEx", "seats": 120, "active": True},
            {"date": "2026-07-02", "account": "WareEx", "seats": 121, "active": False},
        ],
        account="WareEx Logistics",
        filters={"plan": "enterprise"},
        date_range=DateRange(dt.date(2026, 7, 1), dt.date(2026, 7, 31)),
    )
    defaults.update(overrides)
    return Report(**defaults)


def admin_request(report: Report) -> ExportRequest:
    user = User(id="u_admin", name="Admin", authorized_report_ids=frozenset({"*"}))
    return ExportRequest(report=report, requested_by=user)


# -- permissions -----------------------------------------------------------


def test_unauthorized_user_is_denied():
    report = make_report()
    user = User(id="u_1", authorized_report_ids=frozenset({"some_other_report"}))
    request = ExportRequest(report=report, requested_by=user)

    with pytest.raises(PermissionDeniedError):
        CSVExporter().export(request)


def test_specific_authorization_allows_export():
    report = make_report()
    user = User(id="u_2", authorized_report_ids=frozenset({report.id}))
    result = CSVExporter().export(ExportRequest(report=report, requested_by=user))

    assert result.ok
    assert result.status is ExportStatus.COMPLETED


def test_wildcard_grants_access_to_any_report():
    result = CSVExporter().export(admin_request(make_report()))
    assert result.ok


# -- fidelity & content ----------------------------------------------------


def test_values_match_source_of_truth():
    exporter = CSVExporter(include_metadata=False)
    csv_text = exporter.render(make_report())
    lines = csv_text.strip().splitlines()

    assert lines[0] == "date,account,seats,active"
    assert lines[1] == "2026-07-01,WareEx,120,true"
    assert lines[2] == "2026-07-02,WareEx,121,false"


def test_none_becomes_empty_cell():
    report = make_report(
        columns=["a", "b"],
        rows=[{"a": None, "b": "x"}],
    )
    csv_text = CSVExporter(include_metadata=False).render(report)
    assert csv_text.strip().splitlines()[1] == ",x"


def test_missing_column_in_row_is_blank():
    report = make_report(columns=["a", "b"], rows=[{"a": "1"}])
    csv_text = CSVExporter(include_metadata=False).render(report)
    assert csv_text.strip().splitlines()[1] == "1,"


def test_values_with_commas_are_quoted():
    report = make_report(columns=["note"], rows=[{"note": "a,b"}])
    csv_text = CSVExporter(include_metadata=False).render(report)
    assert '"a,b"' in csv_text


def test_empty_report_still_has_header_and_is_complete():
    report = make_report(rows=[])
    result = CSVExporter().export(admin_request(report))
    assert result.ok
    assert result.row_count == 0
    assert result.complete


# -- metadata --------------------------------------------------------------


def test_metadata_header_included_by_default():
    csv_text = CSVExporter().render(make_report())
    assert "# Report: July Usage" in csv_text
    assert "# Report ID: rep_usage_july" in csv_text
    assert "# Source: usage" in csv_text
    assert "# Account: WareEx Logistics" in csv_text
    assert "# Date range: 2026-07-01..2026-07-31" in csv_text
    assert "# Filters: plan=enterprise" in csv_text
    assert "# Row count: 2" in csv_text
    assert "# Generated at:" in csv_text


def test_metadata_can_be_disabled():
    csv_text = CSVExporter(include_metadata=False).render(make_report())
    assert not csv_text.startswith("#")


# -- security: formula injection ------------------------------------------


def test_formula_injection_is_sanitized_by_default():
    report = make_report(columns=["x"], rows=[{"x": "=1+2"}, {"x": "@cmd"}])
    csv_text = CSVExporter(include_metadata=False).render(report)
    lines = csv_text.strip().splitlines()
    assert lines[1] == "'=1+2"
    assert lines[2] == "'@cmd"


def test_sanitization_can_be_disabled():
    report = make_report(columns=["x"], rows=[{"x": "=1+2"}])
    csv_text = CSVExporter(include_metadata=False, sanitize_formulas=False).render(report)
    assert csv_text.strip().splitlines()[1] == "=1+2"


# -- completeness / size limits -------------------------------------------


def test_oversized_report_fails_without_truncation():
    report = make_report(
        columns=["n"], rows=[{"n": i} for i in range(5)]
    )
    result = CSVExporter(max_rows=3).export(admin_request(report))

    assert result.status is ExportStatus.FAILED
    assert not result.complete
    assert result.row_count == 0
    assert "exceeds the limit" in (result.error or "")


def test_negative_max_rows_rejected():
    with pytest.raises(ValueError):
        CSVExporter(max_rows=-1)


# -- file output -----------------------------------------------------------


def test_export_to_file_writes_content_and_reports_path(tmp_path):
    report = make_report()
    path = tmp_path / "export.csv"
    result = CSVExporter().export_to_file(admin_request(report), str(path))

    assert result.ok
    assert result.file_path == str(path)
    on_disk = path.read_text(encoding="utf-8")
    assert "# Report: July Usage" in on_disk
    assert "date,account,seats,active" in on_disk


def test_checksum_matches_file_contents(tmp_path):
    import hashlib

    report = make_report()
    path = tmp_path / "export.csv"
    result = CSVExporter().export_to_file(admin_request(report), str(path))

    expected = hashlib.sha256(path.read_bytes()).hexdigest()
    assert result.checksum == expected


def test_no_temp_file_left_behind(tmp_path):
    report = make_report()
    path = tmp_path / "export.csv"
    CSVExporter().export_to_file(admin_request(report), str(path))
    assert not (tmp_path / "export.csv.tmp").exists()


def test_file_export_denied_for_unauthorized_user(tmp_path):
    report = make_report()
    user = User(id="u_x", authorized_report_ids=frozenset())
    path = tmp_path / "export.csv"
    with pytest.raises(PermissionDeniedError):
        CSVExporter().export_to_file(
            ExportRequest(report=report, requested_by=user), str(path)
        )
    assert not path.exists()
