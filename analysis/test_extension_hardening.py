import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = (ROOT / "extension" / "background.js").read_text(encoding="utf-8")
POPUP_JS = (ROOT / "extension" / "popup.js").read_text(encoding="utf-8")
POPUP_HTML = (ROOT / "extension" / "popup.html").read_text(encoding="utf-8")
POPUP_CSS = (ROOT / "extension" / "popup.css").read_text(encoding="utf-8")


def relative_luminance(hex_color):
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    channels = [
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
        for value in channels
    ]
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(foreground, background):
    lighter, darker = sorted(
        (relative_luminance(foreground), relative_luminance(background)),
        reverse=True,
    )
    return (lighter + 0.05) / (darker + 0.05)


class ExtensionHardeningTests(unittest.TestCase):
    def test_daily_keys_use_local_calendar_date(self):
        for source in (BACKGROUND, POPUP_JS):
            self.assertIn("function localDateKey", source)
            self.assertNotIn("toISOString().split", source)

    def test_header_capture_is_allowlisted_and_excludes_credentials(self):
        capture = BACKGROUND.split("const allowedHeaders = new Set([", 1)[1].split("]);", 1)[0]
        self.assertEqual(
            set(re.findall(r"'([^']+)'", capture)),
            {"accept", "csrf-token", "x-li-lang", "x-restli-protocol-version"},
        )
        self.assertNotIn("'cookie'", capture)
        self.assertNotIn("'authorization'", capture)

    def test_background_refresh_never_navigates_without_user_action(self):
        initial_load = POPUP_JS.split("async function loadAndRender()", 1)[1].split(
            "// ── Setup card", 1
        )[0]
        self.assertNotIn('action: "fetchAnalytics"', initial_load)
        self.assertNotIn('action: "fetchNow"', initial_load)
        self.assertIn("async function runFetch(allowNavigation = true)", BACKGROUND)
        self.assertIn("runFetch(false)", BACKGROUND)
        self.assertIn("if (!allowNavigation)", BACKGROUND)

    def test_projection_is_labeled_and_has_minimum_sample(self):
        self.assertIn("function computeTrendProjection", POPUP_JS)
        self.assertIn("observations.length < 7", POPUP_JS)
        self.assertIn("Linear trend projection", POPUP_JS)
        self.assertIn("Not a prediction or guarantee", POPUP_JS)
        self.assertIn('classList.toggle("hidden", !trendProjectionPoints.length)', POPUP_JS)
        self.assertNotIn("FAKE_FORECAST", POPUP_JS)

    def test_canvas_backing_store_is_only_resized_when_dimensions_change(self):
        self.assertGreaterEqual(
            POPUP_JS.count("canvas.width !== pixelWidth || canvas.height !== pixelHeight"),
            2,
        )
        self.assertIn("if (nextHoverIdx === hoverIdx) return", POPUP_JS)
        self.assertIn("requestAnimationFrame", POPUP_JS)
        switch_tab = POPUP_JS.split("function switchDashTab", 1)[1].split(
            "// Tab click handlers", 1
        )[0]
        self.assertIn('if (tab === "history")', switch_tab)
        self.assertIn("drawChart", switch_tab)

    def test_primary_cards_are_keyboard_operable(self):
        self.assertRegex(
            POPUP_HTML,
            r'<button type="button" class="brand"[^>]+>',
        )
        self.assertEqual(
            len(re.findall(r'<button type="button" class="pillar"', POPUP_HTML)),
            4,
        )
        self.assertIn(":focus-visible", POPUP_CSS)

    def test_narrow_layout_has_no_fixed_minimum_width(self):
        body = POPUP_CSS.split("body {", 1)[1].split("}", 1)[0]
        self.assertIn("min-width: 0", body)
        self.assertNotIn("min-width: 420px", POPUP_CSS)
        self.assertIn("@media (max-width: 419px)", POPUP_CSS)

    def test_secondary_text_colors_meet_wcag_aa(self):
        combinations = (
            ("#A1A1B8", "#0C0C10"),
            ("#85859D", "#0C0C10"),
            ("#A1A1B8", "#14141A"),
            ("#85859D", "#14141A"),
            ("#3F4B63", "#F5F6FA"),
            ("#58647C", "#F5F6FA"),
            ("#3F4B63", "#FFFFFF"),
            ("#58647C", "#FFFFFF"),
        )
        for foreground, background in combinations:
            with self.subTest(foreground=foreground, background=background):
                self.assertGreaterEqual(contrast_ratio(foreground, background), 4.5)

    def test_first_history_entry_is_rendered(self):
        render_history = POPUP_JS.split("function renderHistory", 1)[1].split(
            "// ──", 1
        )[0]
        self.assertNotIn("history.length === 1", render_history)
        self.assertIn("history\n    .slice(0, 30)\n    .map", render_history)


if __name__ == "__main__":
    unittest.main()
