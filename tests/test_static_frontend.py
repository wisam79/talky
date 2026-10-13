"""Static-consistency tests — catch broken ids / assets / references without a browser.

These are the cheap guards that would have caught the known frontend bugs
(favorites writing to non-existent `*-adv` ids, deploy placeholder missing,
stale service-worker asset list…).
"""
import json
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
INDEX = os.path.join(STATIC, "index.html")


def _read(relpath):
    with open(os.path.join(ROOT, relpath), encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def index_html():
    return _read("static/index.html")


@pytest.fixture(scope="module")
def app_js():
    return _read("static/js/app.js")


# ─────────────────────────── element ids ───────────────────────────

def _ids(html):
    return set(re.findall(r'id="([^"]+)"', html))


class TestElementIds:
    def test_getElementById_targets_exist(self, index_html, app_js):
        used = set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", app_js))
        defined = _ids(index_html)
        missing = sorted(used - defined - {"tab-" + t for t in
                                           ("generator", "podcast", "history")})
        # dynamic ids built at runtime (tab-<target>) are handled separately
        assert not missing, (
            f"app.js references ids missing from index.html: {missing}")

    def test_applyVoiceConfig_targets_exist(self, index_html):
        """Regression guard: favorites apply() used *-adv ids that never existed."""
        used = set(re.findall(r"set\(['\"]([^'\"]+)['\"]", _read("static/js/app.js")))
        missing = sorted(used - _ids(index_html))
        assert not missing, f"applyVoiceConfig sets missing ids: {missing}"

    def test_fav_list_and_modal_ids_exist(self, index_html):
        defined = _ids(index_html)
        for required in ("fav-list", "save-fav-btn", "modal-overlay", "modal-input",
                         "modal-ok", "modal-cancel", "toast-container"):
            assert required in defined, required

    def test_history_search_id_exists(self, index_html):
        assert "history-search" in _ids(index_html)


# ─────────────────────────── form field names ───────────────────────────

class TestFormNames:
    def test_generate_form_fields(self, index_html):
        form = re.search(r'<form id="generate-form".*?</form>', index_html, re.S)
        assert form, "generate-form not found"
        names = set(re.findall(r'name="([^"]+)"', form.group(0)))
        for expected in ("text", "language", "role", "gender", "accent",
                         "dialect", "speed", "steps", "guidance", "ref_audio",
                         "ref_text"):
            assert expected in names, f"form missing field {expected}"

    def test_favorites_read_only_existing_fields(self, app_js):
        """currentVoiceConfig() must only read FormData names present in the form."""
        body = re.search(r"function currentVoiceConfig\(\).*?\n  \}", app_js, re.S).group(0)
        read = set(re.findall(r"f\.get\(['\"]([^'\"]+)['\"]\)", body))
        assert read <= {"language", "role", "gender", "accent", "dialect",
                        "speed", "steps", "guidance"}


# ─────────────────────────── icons ───────────────────────────

class TestIcons:
    def test_every_used_icon_is_defined(self, index_html, app_js):
        defined = set(re.findall(r'<symbol id="i-([^"]+)"', index_html))
        used_js = set(re.findall(r"ico\(['\"]([^'\"]+)['\"]", app_js))
        used_html = set(re.findall(r'#i-([a-z-]+)', index_html))
        missing = (used_js | used_html) - defined
        assert not missing, f"icons used but not defined: {sorted(missing)}"

    def test_no_unused_theme_icon_missing(self, index_html):
        assert 'id="i-moon"' in index_html and 'id="i-sun"' in index_html


# ─────────────────────────── static assets ───────────────────────────

class TestAssets:
    def test_scripts_referenced_by_html_exist(self, index_html):
        for src in re.findall(r'<script src="([^"]+)"', index_html):
            assert os.path.exists(os.path.join(STATIC, src)), src

    def test_stylesheets_referenced_by_html_exist(self, index_html):
        for href in re.findall(r'<link rel="stylesheet" href="([^"]+)"', index_html):
            assert os.path.exists(os.path.join(STATIC, href)), href

    def test_manifest_and_icon_exist(self, index_html):
        assert os.path.exists(os.path.join(STATIC, "manifest.json"))
        for icon in re.findall(r'href="(/icons/[^"]+)"', index_html):
            assert os.path.exists(os.path.join(STATIC, icon.lstrip("/"))), icon

    def test_manifest_is_valid_and_icons_exist(self):
        data = json.loads(_read("static/manifest.json"))
        for key in ("name", "short_name", "start_url", "display", "icons"):
            assert key in data, key
        for icon in data["icons"]:
            assert os.path.exists(os.path.join(STATIC, icon["src"].lstrip("/")))

    def test_service_worker_assets_exist(self):
        sw = _read("static/sw.js")
        cached = set(re.findall(r"'/([^']*)'", sw))
        for asset in cached:
            if asset == "":
                continue
            assert os.path.exists(os.path.join(STATIC, asset)), asset

    def test_config_js_either_loaded_or_absent(self, index_html):
        """config.js must not be dead code: if it exists it must be referenced."""
        exists = os.path.exists(os.path.join(STATIC, "js", "config.js"))
        referenced = "js/config.js" in index_html
        assert not exists or referenced, (
            "config.js exists but index.html never loads it")


# ─────────────────────────── deploy / secrets ───────────────────────────

class TestDeployContract:
    def test_render_url_placeholder_present(self, index_html):
        """deploy_frontend.py injects RENDER_URL by replacing this placeholder."""
        assert "RENDER_BACKEND_URL_PLACEHOLDER" in index_html, (
            "placeholder missing → deploy injection is a silent no-op")

    def test_no_secrets_in_static(self):
        forbidden = re.compile(r"hf_[A-Za-z0-9]{25,}|HF_TOKEN\s*=")
        for dirpath, _dirs, files in os.walk(STATIC):
            for f in files:
                if f.endswith((".js", ".html", ".css", ".json")):
                    body = open(os.path.join(dirpath, f), encoding="utf-8",
                                errors="ignore").read()
                    match = forbidden.search(body)
                    assert not match, f"secret-like string in {f}"

    def test_env_not_tracked_by_git(self):
        out = os.popen("cd %s && git ls-files | grep -x .env" % ROOT).read()
        assert out.strip() == "", ".env is tracked by git!"


# ─────────────────────────── API contract constants ───────────────────────────

class TestApiConstants:
    def test_gradio_base_paths(self):
        body = _read("static/js/gradio_api.js")
        assert "/gradio_api/call/_clone_fn" in body, (
            "call endpoint must live under /gradio_api/call/")
        assert "/gradio_api/upload" in body, (
            "upload endpoint must live under /gradio_api/upload")
        assert "OMNIVOICE_BASE}/call/" not in body
        assert "OMNIVOICE_BASE}/upload" not in body

    def test_language_choices_valid_for_omnivoice(self):
        """UI language options must exist in OmniVoice's lang list
        (see api_info.txt / live contract test)."""
        options = re.findall(r'<option value="([^"]+)"',
                             _read("static/index.html").split('id="language"')[1]
                             .split("</select>")[0])
        invalid = [o for o in options if o not in ("Arabic",) and o != "Arabic"]
        # 'Arabic' is NOT a valid choice on OmniVoice ('Standard Arabic' is)
        assert "Arabic" not in options, (
            "UI offers 'Arabic' which OmniVoice rejects; use 'Standard Arabic'")

    def test_sse_event_names_handled(self):
        body = _read("static/js/gradio_api.js")
        for event in ("complete", "error", "process_failed", "close_stream"):
            assert event in body, f"SSE event '{event}' is not handled"

    def test_timeout_constants_aligned(self):
        js = _read("static/js/gradio_api.js")
        py = _read("apps/backend/app.py")
        assert re.search(r"180_000", js), "JS timeout constant missing"
        assert re.search(r'PREDICT_TIMEOUT.*240', py), "backend default timeout missing"
