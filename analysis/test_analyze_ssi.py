import json
import tempfile
import unittest
from pathlib import Path

from analyze_ssi import analyze, build_rows, load_export


def entry(day, brand, people=5, insights=5, relationships=5):
    return {
        "date": day,
        "parsed": {
            "prof_brand": brand,
            "find_right_people": people,
            "insight_engagement": insights,
            "relationship": relationships,
        },
    }


class AnalyzeSsiTests(unittest.TestCase):
    def test_build_rows_applies_lag(self):
        history = [entry("2026-01-01", 10), entry("2026-01-02", 11)]
        activities = {"2026-01-01": {"prof_brand": [True, False]}}

        rows = build_rows(history, activities, lag_days=1)

        self.assertEqual(rows[0]["delta_prof_brand"], 1.0)
        self.assertEqual(rows[0]["activities_prof_brand"], [0])

    def test_analyze_reports_exposed_difference(self):
        payload = {
            "schema_version": 1,
            "ssi_history": [
                entry("2026-01-01", 10),
                entry("2026-01-02", 12),
                entry("2026-01-03", 12),
            ],
            "daily_activities": {
                "2026-01-01": {"prof_brand": [True]},
                "2026-01-02": {"prof_brand": [False]},
            },
            "activity_catalog": {
                "prof_brand": [{"label": "Published an original post"}]
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "export.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            report = analyze(path, [1])

        effect = report["lags"]["1"]["pillars"]["prof_brand"][
            "activity_effects"
        ][0]
        self.assertEqual(effect["days_exposed"], 1)
        self.assertEqual(effect["days_unexposed"], 1)
        self.assertEqual(effect["difference"], 2.0)
        self.assertEqual(effect["activity_label"], "Published an original post")

    def test_legacy_export_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.json"
            path.write_text(json.dumps([entry("2026-01-01", 10)]), encoding="utf-8")
            history, activities, catalog = load_export(path)

        self.assertEqual(len(history), 1)
        self.assertEqual(activities, {})
        self.assertEqual(catalog, {})

    def test_snapshot_gaps_are_excluded(self):
        history = [entry("2026-01-01", 10), entry("2026-01-03", 12)]

        self.assertEqual(build_rows(history, {}, lag_days=1), [])


if __name__ == "__main__":
    unittest.main()
