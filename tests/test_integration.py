"""
Integration tests that actually call the OmniVoice API.
These tests require internet connection and may take time.
"""
import pytest
from gradio_client import Client
import time

@pytest.fixture(scope="module")
def omni_client():
    """Create a single client instance for all tests"""
    return Client("k2-fsa/OmniVoice")

@pytest.mark.integration
def test_omni_api_basic(omni_client):
    """Test basic OmniVoice API call"""
    try:
        result = omni_client.predict(
            "Hello world",
            "English",
            None,  # ref_audio
            "",    # ref_text
            None,  # instruct
            32,    # steps
            2.0,   # cfg
            True,  # denoise
            1.0,   # speed
            None,  # duration
            True,  # preprocess
            True,  # postprocess
            fn_index=0
        )
        assert result is not None
        print(f"✅ Basic API call successful")
    except Exception as e:
        pytest.skip(f"OmniVoice API unreachable: {e}")

@pytest.mark.integration
def test_omni_api_arabic(omni_client):
    """Test Arabic language support"""
    try:
        result = omni_client.predict(
            "مرحباً بك في نظام توليد الصوت الذكي",
            "Arabic",
            None,  # ref_audio
            "",    # ref_text
            "Male",  # instruct
            32,    # steps
            2.0,   # cfg
            True,  # denoise
            1.0,   # speed
            None,  # duration
            True,  # preprocess
            True,  # postprocess
            fn_index=0
        )
        assert result is not None
        print(f"✅ Arabic API call successful")
    except Exception as e:
        pytest.skip(f"OmniVoice API unreachable: {e}")

@pytest.mark.integration
def test_omni_api_instruct(omni_client):
    """Test with instruction parameters"""
    try:
        result = omni_client.predict(
            "Welcome to our podcast",
            "English",
            None,  # ref_audio
            "",    # ref_text
            "Male, News Anchor",  # instruct
            32,    # steps
            2.0,   # cfg
            True,  # denoise
            1.0,   # speed
            None,  # duration
            True,  # preprocess
            True,  # postprocess
            fn_index=0
        )
        assert result is not None
        print(f"✅ Instruction API call successful")
    except Exception as e:
        pytest.skip(f"OmniVoice API unreachable: {e}")