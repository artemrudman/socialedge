#!/usr/bin/env python3
"""Build a lagged SSI/activity dataset from a SocialEdge JSON export.

This intentionally starts with transparent descriptive estimates. It does not
claim causality: SSI can change because of unobserved LinkedIn activity, delayed
processing, decay, profile edits, or formula changes.
"""

from __future__ import annotations

import argparse
import json
import statistics
from datetime import date, timedelta
from pathlib import Path
from typing import Any


PILLARS = (
    "prof_brand",
    "find_right_people",
    "insight_engagement",
    "relationship",
)


def load_export(
    path: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload, {}, {}
    if not isinstance(payload, dict):
        raise ValueError("Export must be a JSON object or a legacy history array")
    history = payload.get("ssi_history", [])
    activities = payload.get("daily_activities", {})
    catalog = payload.get("activity_catalog", {})
    if (
        not isinstance(history, list)
        or not isinstance(activities, dict)
        or not isinstance(catalog, dict)
    ):
        raise ValueError("Invalid SocialEdge export structure")
    return history, activities, catalog


def _activity_ids(day: dict[str, Any], pillar: str) -> set[int]:
    values = day.get(pillar, []) if isinstance(day, dict) else []
    return {index for index, completed in enumerate(values) if completed}


def build_rows(
    history: list[dict[str, Any]],
    activities: dict[str, Any],
    lag_days: int,
) -> list[dict[str, Any]]:
    if lag_days < 0:
        raise ValueError("lag_days must be non-negative")

    dated = sorted(history, key=lambda entry: entry.get("date", ""))
    rows: list[dict[str, Any]] = []
    for previous, current in zip(dated, dated[1:]):
        previous_scores = previous.get("parsed", {})
        current_scores = current.get("parsed", {})
        previous_date = date.fromisoformat(previous["date"])
        current_date = date.fromisoformat(current["date"])
        interval_days = (current_date - previous_date).days
        if interval_days != 1:
            continue
        activity_date = (current_date - timedelta(days=lag_days)).isoformat()
        day_activities = activities.get(activity_date, {})
        row: dict[str, Any] = {
            "date": current["date"],
            "activity_date": activity_date,
            "score_interval_days": interval_days,
            "lag_days": lag_days,
        }
        for pillar in PILLARS:
            before = previous_scores.get(pillar)
            after = current_scores.get(pillar)
            row[f"delta_{pillar}"] = (
                None if before is None or after is None else float(after) - float(before)
            )
            row[f"activities_{pillar}"] = sorted(
                _activity_ids(day_activities, pillar)
            )
        rows.append(row)
    return rows


def estimate_effects(
    rows: list[dict[str, Any]], catalog: dict[str, Any] | None = None
) -> dict[str, Any]:
    catalog = catalog or {}
    results: dict[str, Any] = {}
    for pillar in PILLARS:
        delta_key = f"delta_{pillar}"
        activity_key = f"activities_{pillar}"
        observed_ids = sorted(
            {
                activity_id
                for row in rows
                for activity_id in row[activity_key]
            }
        )
        estimates = []
        for activity_id in observed_ids:
            exposed = [
                row[delta_key]
                for row in rows
                if row[delta_key] is not None and activity_id in row[activity_key]
            ]
            unexposed = [
                row[delta_key]
                for row in rows
                if row[delta_key] is not None and activity_id not in row[activity_key]
            ]
            exposed_mean = statistics.fmean(exposed) if exposed else None
            unexposed_mean = statistics.fmean(unexposed) if unexposed else None
            estimates.append(
                {
                    "activity_index": activity_id,
                    "activity_label": (
                        catalog.get(pillar, [{}])[activity_id].get("label")
                        if activity_id < len(catalog.get(pillar, []))
                        else None
                    ),
                    "days_exposed": len(exposed),
                    "days_unexposed": len(unexposed),
                    "mean_delta_exposed": exposed_mean,
                    "mean_delta_unexposed": unexposed_mean,
                    "difference": (
                        None
                        if exposed_mean is None or unexposed_mean is None
                        else exposed_mean - unexposed_mean
                    ),
                }
            )

        available_deltas = [
            row[delta_key] for row in rows if row[delta_key] is not None
        ]
        results[pillar] = {
            "observations": len(available_deltas),
            "activity_effects": estimates,
        }
    return results


def analyze(path: Path, lags: list[int]) -> dict[str, Any]:
    history, activities, catalog = load_export(path)
    return {
        "source": str(path),
        "snapshot_count": len(history),
        "activity_day_count": len(activities),
        "warning": (
            "Descriptive associations only; use controlled single-action days and "
            "at least 30-60 score transitions before interpreting effects."
        ),
        "lags": {
            str(lag): {
                "rows": len(rows := build_rows(history, activities, lag)),
                "pillars": estimate_effects(rows, catalog),
            }
            for lag in lags
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Estimate lagged associations between logged activities and SSI changes."
    )
    parser.add_argument("export", type=Path, help="SocialEdge JSON export")
    parser.add_argument(
        "--lags",
        type=int,
        nargs="+",
        default=[0, 1, 2, 3],
        help="Activity-to-score lags to test (default: 0 1 2 3)",
    )
    parser.add_argument("--output", type=Path, help="Write the report to this file")
    args = parser.parse_args()
    report = analyze(args.export, args.lags)
    rendered = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
