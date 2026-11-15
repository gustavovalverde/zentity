"""Unit tests for the internal auth middleware helpers."""

import pytest

from ocr_service.core.auth import _mask_ip


class TestMaskIp:
    def test_ipv4_keeps_first_two_octets(self):
        assert _mask_ip("10.1.2.3") == "10.1.0.0/16"

    def test_ipv6_keeps_first_48_bits(self):
        assert _mask_ip("2001:db8:abcd:1234:5678::1") == "2001:db8:abcd::/48"

    def test_compressed_ipv6_does_not_leak_the_address(self):
        assert _mask_ip("::1") == "::/48"

    @pytest.mark.parametrize("value", ["", "not-an-ip", "10.1.2", "999.1.1.1"])
    def test_unparseable_input_is_unknown(self, value):
        assert _mask_ip(value) == "unknown"
