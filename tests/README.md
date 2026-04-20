# 🧪 Talky Engine Test Suite

## Running Tests

### Quick Unit Tests (Fast)
```bash
python run_tests.py --quick
```

### Full Test Suite
```bash
python run_tests.py
```

### Run Including Integration Tests
```bash
python run_tests.py --integration
```

## Test Categories

1. **Unit Tests** (`tests/test_api.py`)
   - ✅ API endpoint validation
   - ✅ CORS header tests
   - ✅ Parameter validation
   - ✅ Error handling

2. **Integration Tests** (`tests/test_integration.py`)
   - ✅ Actual OmniVoice API calls
   - ✅ Language support tests
   - ✅ Instruction parameter tests

## Running Directly with pytest

```bash
# All tests
pytest tests/ -v

# Only unit tests
pytest tests/test_api.py -v

# Only integration tests
pytest tests/test_integration.py -v
```