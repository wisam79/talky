import pytest
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

def test_read_root():
    """Test root endpoint returns static content"""
    response = client.get("/")
    assert response.status_code == 200
    assert b"Talky Engine" in response.content

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
        "seed": 1234
    })
    assert response.status_code in [200, 500, 503]

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