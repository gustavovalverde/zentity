"""
Pytest configuration for liveness service tests.
"""
import pytest
import sys
from pathlib import Path

# Add app directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))


@pytest.fixture
def sample_image_array():
    """Create a sample numpy array image for testing."""
    import numpy as np
    return np.zeros((100, 100, 3), dtype=np.uint8)


@pytest.fixture
def sample_base64_image():
    """Create a sample base64 encoded image for testing."""
    import base64
    import io
    from PIL import Image

    img = Image.new('RGB', (100, 100), color='red')
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    return base64.b64encode(buffer.getvalue()).decode('utf-8')
