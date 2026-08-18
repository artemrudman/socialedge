import re
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = (ROOT / "extension" / "background.js").read_text(encoding="utf-8")
POPUP_JS = (ROOT / "extension" / "popup.js").read_text(encoding="utf-8")
POPUP_HTML = (ROOT / "extension" / "popup.html").read_text(encoding="utf-8")
POPUP_CSS = (ROOT / "extension" / "popup.css").read_text(encoding="utf-8")
POLICY = (ROOT / "extension" / "lib" / "policy.js").read_text(encoding="utf-8")
STORAGE = (ROOT / "extension" / "lib" / "storage.js").read_text(encoding="utf-8")
MESSAGES = (ROOT / "extension" / "lib" / "messages.js").read_text(encoding="utf-8")
COLLECTION = (ROOT / "extension" / "lib" / "collection.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))


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
        capture = POLICY.split("export const ALLOWED_HEADERS = Object.freeze([", 1)[1].split("]);", 1)[0]
        self.assertEqual(
            set(re.findall(r"'([^']+)'", capture)),
            {
                "accept", "csrf-token", "x-li-lang", "x-restli-protocol-version",
                "x-li-identity", "x-li-page-instance", "x-li-track",
            },
        )
        self.assertNotIn("'cookie'", capture)
        self.assertNotIn("'authorization'", capture)

    def test_background_refresh_never_navigates_without_user_action(self):
        initial_load = POPUP_JS.split("async function loadAndRender()", 1)[1].split(
            "// ── Setup card", 1
        )[0]
        self.assertNotIn('action: "fetchAnalytics"', initial_load)
        self.assertNotIn('action: "fetchNow"', initial_load)
        self.assertIn("validateAutomaticRefresh", BACKGROUND)
        self.assertIn("if (preference.enabled) await collectFeature('ssi', 'automatic')", BACKGROUND)
        self.assertNotIn("chrome.tabs.update", BACKGROUND)
        self.assertNotIn("tabs[0]", BACKGROUND)

    def test_cookie_capability_is_absent(self):
        manifest_permissions = set(MANIFEST.get("permissions", []))
        extension_source = "\n".join((BACKGROUND, POPUP_JS, POLICY, STORAGE, COLLECTION))
        self.assertNotIn("cookies", manifest_permissions)
        self.assertNotIn("chrome.cookies", extension_source)
        self.assertNotIn("JSESSIONID", extension_source)
        self.assertNotIn("response.text(", extension_source)
        self.assertNotIn("body.slice", extension_source)

    def test_session_context_is_volatile_bounded_and_auth_failures_evict(self):
        self.assertIn("session: storage.session", BACKGROUND)
        self.assertIn("CONTEXT_TTL_MS = 24 * 60 * 60 * 1000", POLICY)
        self.assertIn("now >= context.expiresAt", POLICY)
        auth_branch = BACKGROUND.split("result?.status === 401", 1)[1].split("}", 1)[0]
        self.assertIn("clearAuthenticationState", auth_branch)

    def test_migration_and_deletion_use_exact_key_registries(self):
        self.assertIn("export const LEGACY_KEYS", STORAGE)
        self.assertIn("await storage.local.remove(LEGACY_KEYS)", STORAGE)
        self.assertIn("_se_session", STORAGE)
        self.assertIn("disabledAutomaticRefresh", STORAGE)
        self.assertNotIn("storage.local.clear", STORAGE)
        self.assertIn("operations.cancelAll", BACKGROUND)
        self.assertGreaterEqual(BACKGROUND.count("operations.canWrite"), 4)

    def test_storage_and_export_exclude_raw_debug_and_bind_records(self):
        self.assertIn("accountBinding", STORAGE)
        self.assertIn("schemaVersion: 2", STORAGE)
        self.assertNotRegex(BACKGROUND, r"(?:raw|debug|snippet)\s*:")
        export_block = POPUP_JS.split("const payload = {", 1)[1].split("};", 1)[0]
        self.assertIn("schema_version: 2", export_block)
        self.assertNotIn("accountBinding", export_block)

    def test_manifest_and_runtime_messages_are_least_privilege(self):
        self.assertEqual(MANIFEST.get("host_permissions"), ["https://www.linkedin.com/*"])
        self.assertNotIn("identity", MANIFEST.get("permissions", []))
        self.assertNotIn("tabs", MANIFEST.get("permissions", []))
        self.assertNotIn("content_scripts", MANIFEST)
        self.assertNotIn("web_accessible_resources", MANIFEST)
        self.assertNotIn("oauth2", MANIFEST)
        self.assertIn("validateSender(sender, chrome.runtime.id)", BACKGROUND)
        self.assertIn("validateRequest(rawMessage)", BACKGROUND)
        self.assertNotIn("storeSSI", BACKGROUND)
        self.assertNotIn("storeAnalytics", BACKGROUND)
        self.assertFalse((ROOT / "extension" / "content.js").exists())
        self.assertFalse((ROOT / "extension" / "content_main.js").exists())

    def test_collected_values_are_rendered_with_safe_dom_properties(self):
        self.assertIn("title.textContent = job.title", POPUP_JS)
        self.assertIn("description.textContent = tip.text", POPUP_JS)
        self.assertIn('url.hostname !== "www.linkedin.com"', POPUP_JS)
        self.assertNotIn("innerHTML = data.jobs", POPUP_JS)
        self.assertNotIn("innerHTML = data.tips", POPUP_JS)

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
