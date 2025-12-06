"""
Pytest configuration for OCR service tests.
"""
import pytest
import sys
from pathlib import Path

# Add app directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))


@pytest.fixture
def sample_document_number():
    """Sample DR cedula number for testing."""
    return "001-1234567-8"


@pytest.fixture
def sample_name():
    """Sample name for testing."""
    return "Juan Carlos Pérez González"


@pytest.fixture
def sample_salt():
    """Fixed salt for deterministic testing."""
    return "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
