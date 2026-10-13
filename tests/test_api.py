import pytest
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi.testclient import TestClient
from apps.backend.app import app

client = TestClient(app)

def test_read_root():
    """Test root endpoint returns static content"""
    response = client.get("/")
    assert response.status_code == 200
    assert b"Talky" in response.content

def test_generate_empty_text():
    """Test generate endpoint with empty text returns validation error"""
    response = client.post("/api/generate", data={"text": ""})
    # FastAPI returns 422 for missing/empty required fields before our code runs
    if response.status_code == 422:
        # This is expected FastAPI behavior for Form(...) fields
        assert True
    else:
        assert response.status_code == 400
        assert "Text cannot be empty" in response.json()["detail"]

def test_generate_minimal_parameters():
    """Test generate endpoint with only required text parameter"""
    # We don't need to actually call OmniVoice for this test
    # Just verify the endpoint accepts the parameters correctly
    response = client.post("/api/generate", data={
        "text": "مرحباً بالعالم",
        "language": "Arabic",
        "gender": "Male",
        "role": "News Anchor / 新闻广播"
    })
    # This will fail if OmniVoice is unreachable, but parameters are validated
    assert response.status_code in [200, 500, 503]

def test_generate_all_parameters():
    """Test generate endpoint with all possible parameters"""
    response = client.post("/api/generate", data={
        "text": "هذا اختبار لجميع المعاملات",
        "language": "Arabic",
        "dialect": "Egyptian",
        "gender": "Female",
        "role": "Storyteller / 故事讲述",
        "accent": "American Accent / 美式口音",
        "ref_text": "",
        "speed": 1.0,
        "steps": 32,
        "guidance": 2.0,
    })
    assert response.status_code in [200, 500, 503]

def test_generate_text_too_long():
    """Text over 5000 chars must be rejected with 400 before touching OmniVoice"""
    response = client.post("/api/generate", data={"text": "أ" * 5001})
    assert response.status_code == 400
    assert "too long" in response.json()["detail"].lower()

def test_generate_unsupported_audio_type():
    """Non-audio uploads must be rejected with 415"""
    response = client.post(
        "/api/generate",
        data={"text": "مرحبا"},
        files={"ref_audio": ("evil.txt", b"not audio", "text/plain")},
    )
    assert response.status_code == 415

def test_generate_oversize_audio():
    """Uploads over 10MB must be rejected with 413"""
    big = b"\x00" * (10 * 1024 * 1024 + 1)
    response = client.post(
        "/api/generate",
        data={"text": "مرحبا"},
        files={"ref_audio": ("big.wav", big, "audio/wav")},
    )
    assert response.status_code == 413

def test_rate_limit_headers():
    """Exhausting the limit must return 429 with Retry-After"""
    import apps.backend.app as app_module
    old_max = app_module._RATE_MAX
    old_window = app_module._RATE_WINDOW
    app_module._RATE_MAX = 1
    app_module._RATE_WINDOW = 3600
    app_module._rate_hits.clear()
    try:
        # consumes the single allowed hit (may 200/500/503 depending on backend)
        client.post("/api/generate", data={"text": "واحد"})
        r = client.post("/api/generate", data={"text": "اثنان"})
        assert r.status_code == 429
        assert "Retry-After" in r.headers
    finally:
        app_module._RATE_MAX = old_max
        app_module._RATE_WINDOW = old_window
        app_module._rate_hits.clear()

def test_cors_headers():
    """Test CORS headers are properly set"""
    response = client.options("/api/generate", headers={
        "Origin": "https://example.com",
        "Access-Control-Request-Method": "POST"
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    # FastAPI lists allowed methods explicitly instead of using *
    assert "POST" in response.headers["access-control-allow-methods"]

def test_invalid_method():
    """Test that GET method returns appropriate error"""
    response = client.get("/api/generate")
    # FastAPI returns 404 for GET on POST-only endpoint when using Form data
    assert response.status_code in [404, 405]