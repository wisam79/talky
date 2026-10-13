"""Backend tests — every OmniVoice interaction is mocked (no network)."""
import os
import struct
import wave

import pytest
from fastapi.testclient import TestClient

import apps.backend.app as app_module
from apps.backend.app import _build_instruct

MOCK_WAV = b"RIFF$\x00\x00\x00WAVEfmt "


# ─────────────────────────── _build_instruct ───────────────────────────

class TestBuildInstruct:
    def test_all_auto_gives_empty(self):
        assert _build_instruct() == ""

    def test_single_values(self):
        assert _build_instruct(gender="Male") == "Male"
        assert _build_instruct(role="Lecturer / 讲师") == "Lecturer"
        assert _build_instruct(accent="British Accent / 英国口音") == "British Accent"

    def test_dialect_keeps_first_token_when_no_separator(self):
        assert _build_instruct(dialect="Egyptian") == "Egyptian"

    def test_dialect_separator(self):
        # "A / B" → backend takes parts[1]; documented behaviour
        assert _build_instruct(dialect="Foo / Bar") == "Bar"

    def test_combined_order(self):
        out = _build_instruct(gender="Female", role="Storyteller / 故事讲述",
                              accent="Indian Accent / 印度口音", dialect="Gulf")
        assert out == "Female, Storyteller, Indian Accent, Gulf"

    def test_mixed_auto_skipped(self):
        out = _build_instruct(gender="Male", role="Auto", accent="Auto", dialect="Auto")
        assert out == "Male"


# ─────────────────────────── basic endpoints ───────────────────────────

class TestBasics:
    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_serves_index(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "Talky" in r.text

    def test_serves_static_assets(self, client):
        assert client.get("/js/app.js").status_code == 200
        assert client.get("/css/style.css").status_code == 200

    def test_method_not_allowed_on_generate(self, client):
        assert client.get("/api/generate").status_code in (404, 405)


# ─────────────────────────── validation ───────────────────────────

class TestValidation:
    def test_missing_text_is_rejected(self, client):
        assert client.post("/api/generate", data={}).status_code == 422

    def test_empty_text_400(self, client):
        r = client.post("/api/generate", data={"text": "   "})
        # FastAPI treats '' as missing → 422; whitespace-only reaches handler → 400
        assert r.status_code in (400, 422)
        if r.status_code == 400:
            assert "empty" in r.json()["detail"].lower()

    def test_text_too_long(self, client):
        r = client.post("/api/generate", data={"text": "أ" * 5001})
        assert r.status_code == 400
        assert "too long" in r.json()["detail"].lower()

    def test_max_length_ok(self, client, mock_omni, tmp_path):
        mock_omni.result = (str(tmp_path / "a.wav"), "ok")
        (tmp_path / "a.wav").write_bytes(MOCK_WAV)
        r = client.post("/api/generate", data={"text": "أ" * 5000})
        assert r.status_code == 200

    @pytest.mark.parametrize("field,min_v,max_v", [("speed", 0.5, 2.0),
                                                   ("guidance", 0.5, 5.0)])
    def test_float_clamping(self, client, mock_omni, field, min_v, max_v):
        r = client.post("/api/generate", data={"text": "test", field: "99"})
        assert r.status_code == 200
        sent = mock_omni.args_list[-1]
        # args: text, lang, ref_aud, ref_text, instruct, ns, gs, dn, sp, du, pp, po
        assert sent[6 if field == "guidance" else 8] == max_v

        r = client.post("/api/generate", data={"text": "test", field: "-5"})
        assert r.status_code == 200
        sent = mock_omni.args_list[-1]
        assert sent[6 if field == "guidance" else 8] == min_v

    def test_steps_clamping(self, client, mock_omni):
        client.post("/api/generate", data={"text": "t", "steps": "500"})
        assert mock_omni.args_list[-1][5] == 64
        client.post("/api/generate", data={"text": "t", "steps": "1"})
        assert mock_omni.args_list[-1][5] == 8

    def test_predict_param_order(self, client, mock_omni, tmp_path):
        (tmp_path / "o.wav").write_bytes(MOCK_WAV)
        mock_omni.result = (str(tmp_path / "o.wav"), "ok")
        client.post("/api/generate", data={
            "text": "مرحبا", "language": "Auto", "gender": "Male",
            "role": "Lecturer / 讲师", "accent": "British Accent / 英国口音",
            "dialect": "Gulf", "ref_text": "abc",
            "speed": "1.5", "steps": "16", "guidance": "3.0",
        })
        a = mock_omni.args_list[-1]
        assert a[0] == "مرحبا"          # text
        assert a[1] == "Auto"           # language
        assert a[2] is None             # ref_audio
        assert a[3] == "abc"            # ref_text
        assert a[4] == "Male, Lecturer, British Accent, Gulf"  # instruct
        assert a[5] == 16               # ns
        assert a[6] == 3.0              # gs
        assert a[7] is True             # dn
        assert a[8] == 1.5              # sp
        assert a[10] is True and a[11] is True  # pp, po
        assert mock_omni.calls[-1]["fn_index"] == 0


# ─────────────────────────── reference audio ───────────────────────────

class TestRefAudio:
    def test_valid_upload_passed_through(self, client, mock_omni, tmp_path):
        (tmp_path / "r.wav").write_bytes(MOCK_WAV)
        r = client.post("/api/generate", data={"text": "t"},
                        files={"ref_audio": ("r.wav", MOCK_WAV, "audio/wav")})
        assert r.status_code == 200
        sent_path = mock_omni.args_list[-1][2]
        assert sent_path["path"].endswith(".wav")
        # temp file must be cleaned up after the response
        assert not os.path.exists(sent_path["path"])

    def test_reject_txt(self, client):
        r = client.post("/api/generate", data={"text": "t"},
                        files={"ref_audio": ("evil.txt", b"x", "text/plain")})
        assert r.status_code == 415

    @pytest.mark.parametrize("name,content_type",
                             [("a.mp3", "audio/mpeg"), ("a.ogg", "audio/ogg"),
                              ("a.m4a", "audio/mp4"), ("a.webm", "audio/webm"),
                              ("a.flac", "audio/flac")])
    def test_allowed_extensions(self, client, mock_omni, name, content_type):
        r = client.post("/api/generate", data={"text": "t"},
                        files={"ref_audio": (name, b"\x00" * 100, content_type)})
        assert r.status_code == 200

    def test_oversize_rejected(self, client):
        big = b"\x00" * (10 * 1024 * 1024 + 1)
        r = client.post("/api/generate", data={"text": "t"},
                        files={"ref_audio": ("big.wav", big, "audio/wav")})
        assert r.status_code == 413


# ─────────────────────────── OmniVoice failure modes ───────────────────────────

class TestOmniFailureModes:
    def test_upstream_exception_500(self, client, mock_omni):
        mock_omni.exc = RuntimeError("boom")
        r = client.post("/api/generate", data={"text": "t"})
        assert r.status_code == 500

    def test_client_unavailable_503(self, client, monkeypatch, mock_omni):
        import apps.backend.app as m
        monkeypatch.setattr(m, "_client", None)

        class Boom:
            def __init__(self, *a, **k):
                raise ConnectionError("down")

        monkeypatch.setattr(m, "Client", Boom)
        r = client.post("/api/generate", data={"text": "t"})
        assert r.status_code == 503

    def test_timeout_504(self, client, mock_omni, monkeypatch):
        monkeypatch.setenv("PREDICT_TIMEOUT", "0.3")
        mock_omni.delay = 1.0
        r = client.post("/api/generate", data={"text": "t"})
        assert r.status_code == 504
        assert "timed out" in r.json()["detail"].lower()

    def test_missing_output_file_500(self, client, mock_omni):
        mock_omni.result = ("/nonexistent/nope.wav", "ok")
        r = client.post("/api/generate", data={"text": "t"})
        assert r.status_code == 500

    def test_success_returns_wav(self, client, mock_omni, tmp_path):
        p = tmp_path / "ok.wav"
        p.write_bytes(MOCK_WAV)
        mock_omni.result = (str(p), "done")
        r = client.post("/api/generate", data={"text": "t"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("audio/wav")
        assert "talky_output.wav" in r.headers.get("content-disposition", "")


# ─────────────────────────── auth / rate limit / cors ───────────────────────────

class TestSecurity:
    def test_api_key_required_when_set(self, client, monkeypatch):
        monkeypatch.setattr(app_module, "OPTIONAL_API_KEY", "secret")
        assert client.post("/api/generate", data={"text": "t"}).status_code == 401
        r = client.post("/api/generate", data={"text": "t"},
                        headers={"X-API-Key": "wrong"})
        assert r.status_code == 401

    def test_api_key_accepted(self, client, mock_omni, monkeypatch, tmp_path):
        monkeypatch.setattr(app_module, "OPTIONAL_API_KEY", "secret")
        (tmp_path / "k.wav").write_bytes(MOCK_WAV)
        mock_omni.result = (str(tmp_path / "k.wav"), "ok")
        r = client.post("/api/generate", data={"text": "t"},
                        headers={"X-API-Key": "secret"})
        assert r.status_code == 200

    def test_rate_limit(self, client, monkeypatch):
        monkeypatch.setattr(app_module, "_RATE_MAX", 2)
        monkeypatch.setattr(app_module, "_RATE_WINDOW", 3600)
        app_module._rate_hits.clear()
        try:
            for _ in range(2):
                client.post("/api/generate", data={"text": "t"})
            r = client.post("/api/generate", data={"text": "t"})
            assert r.status_code == 429
            assert int(r.headers["Retry-After"]) > 0
        finally:
            monkeypatch.undo()
            app_module._rate_hits.clear()

    def test_cors_preflight(self, client):
        r = client.options("/api/generate", headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "POST",
        })
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == "*"
        assert "POST" in r.headers["access-control-allow-methods"]


def _valid_wav_bytes(seconds=0.05):
    import io
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(struct.pack("<800h", *([1000, -1000] * 400)))
    return buf.getvalue()
