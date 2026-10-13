"""Shared pytest fixtures for the Talky test suite."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture()
def client(monkeypatch):
    """FastAPI TestClient with the OmniVoice client stubbed out."""
    from fastapi.testclient import TestClient
    import apps.backend.app as app_module

    monkeypatch.setattr(app_module, "OPTIONAL_API_KEY", "", raising=False)
    app_module._rate_hits.clear()
    return TestClient(app_module.app)


@pytest.fixture()
def mock_omni(monkeypatch):
    """Replace the OmniVoice client with a recording mock.

    Returns the mock instance: mock_omni.calls[0] is **kwargs of the last
    client.predict() call, mock_omni.args[0] its positional args.
    """
    import apps.backend.app as app_module

    class MockOmniClient:
        def __init__(self):
            self.calls = []
            self.args_list = []
            self.result = ("/tmp/mock_out.wav", "ok")
            self.exc = None
            self.delay = 0.0

        def predict(self, *args, **kwargs):
            import time
            self.calls.append(kwargs)
            self.args_list.append(args)
            if self.delay:
                time.sleep(self.delay)
            if self.exc is not None:
                raise self.exc
            output_path = self.result[0] if isinstance(self.result, tuple) else self.result
            if output_path and not os.path.exists(output_path):
                with open(output_path, "wb") as output:
                    output.write(b"RIFF$\x00\x00\x00WAVEfmt ")
            return self.result

    mock = MockOmniClient()
    monkeypatch.setattr(app_module, "_client", mock)
    return mock


@pytest.fixture()
def wav_file(tmp_path):
    """A real 16-bit PCM WAV file on disk (used as generate output / ref audio)."""
    import struct
    import wave

    path = tmp_path / "out.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(struct.pack("<8h", *([1000, -1000] * 4)))
    return path
