"""Live contract tests against the real OmniVoice Space.

Quota-free by design: every case fails validation on the server side before
the model runs, so the suite is safe even with ZeroGPU quota exhausted.

Enable with:  TALKY_LIVE_TESTS=1 python -m pytest tests/test_live_contract.py
"""
import json
import os

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TALKY_LIVE_TESTS"),
    reason="set TALKY_LIVE_TESTS=1 to run live contract tests",
)

BASE = "https://k2-fsa-omnivoice.hf.space"
CALL = f"{BASE}/gradio_api/call/_clone_fn"
TIMEOUT = httpx.Timeout(60.0, connect=20.0)

MINIMAL_PAYLOAD = {
    "data": ["hello", "Auto", None, "", "", 8, 2.0, True, 1.0, None, True, True]
}


@pytest.fixture(scope="module")
def http():
    with httpx.Client(timeout=TIMEOUT) as c:
        yield c


class TestLiveContract:
    def test_info_endpoint_reachable(self, http):
        r = http.get(f"{BASE}/gradio_api/info")
        assert r.status_code == 200
        assert "_clone_fn" in r.text

    def test_old_path_is_404(self, http):
        """Documents why the previous /call/ path never worked."""
        r = http.post(f"{BASE}/call/_clone_fn", json=MINIMAL_PAYLOAD)
        assert r.status_code == 404

    def test_correct_path_accepts_submission(self, http):
        r = http.post(CALL, json=MINIMAL_PAYLOAD)
        assert r.status_code == 200
        assert r.json().get("event_id")

    def test_invalid_language_rejected(self, http):
        r = http.post(CALL, json={"data": ["hi", "Arabic", None, "", "",
                                           8, 2.0, True, 1.0, None, True, True]})
        body = r.text
        assert r.status_code == 200  # job is accepted…
        assert "Arabic is not in the list of choices" in body or "error" in body.lower()

    def test_upload_requires_multipart(self, http):
        r = http.post(f"{BASE}/gradio_api/upload")
        assert r.status_code == 400

    def test_sse_stream_shape(self, http):
        """The stream uses named events with a raw JSON array payload."""
        event_id = http.post(CALL, json=MINIMAL_PAYLOAD).json()["event_id"]
        seen = {}
        with http.stream("GET", f"{CALL}/{event_id}") as resp:
            assert resp.status_code == 200
            event_name = None
            for raw in resp.iter_lines():
                if raw.startswith("event:"):
                    event_name = raw.split(":", 1)[1].strip()
                    seen[event_name] = None
                elif raw.startswith("data:") and event_name:
                    data = raw[5:].strip()
                    if data and data != "null":
                        seen[event_name] = json.loads(data)
                if event_name in ("complete", "error") and seen.get(event_name) is not None:
                    break
        assert "complete" in seen or "error" in seen, f"unexpected events: {seen}"
        for payload in seen.values():
            if payload is not None:
                assert isinstance(payload, list), (
                    "final SSE payload must be a raw array [output_audio, status]")

    def test_no_ref_audio_fails_with_guidance(self, http):
        """_clone_fn requires a reference audio — OmniVoice says so explicitly."""
        event_id = http.post(CALL, json=MINIMAL_PAYLOAD).json()["event_id"]
        final = None
        with http.stream("GET", f"{CALL}/{event_id}") as resp:
            event_name = None
            for raw in resp.iter_lines():
                if raw.startswith("event:"):
                    event_name = raw.split(":", 1)[1].strip()
                elif raw.startswith("data:") and event_name in ("complete", "error"):
                    data = raw[5:].strip()
                    if data and data != "null":
                        final = json.loads(data)
                        break
        assert final is not None
        assert "reference audio" in json.dumps(final).lower()
