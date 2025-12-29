"""Application settings and environment parsing."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime

TRUTHY_VALUES = frozenset({"1", "true", "yes"})


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _is_truthy(value: str) -> bool:
    return value.strip().lower() in TRUTHY_VALUES


def _get_git_sha() -> str:
    """Resolve git SHA from env or git command."""
    if sha := _env("GIT_SHA"):
        return sha
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    return "unknown"


def _get_build_time() -> str:
    """Resolve build time from env or current time."""
    if build_time := _env("BUILD_TIME"):
        return build_time
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class Settings:
    port: int
    internal_service_token: str
    internal_service_token_required: bool
    node_env: str
    app_env: str
    rust_env: str
    version: str
    git_sha: str
    build_time: str

    @property
    def is_production(self) -> bool:
        return any(env == "production" for env in (self.node_env, self.app_env, self.rust_env))

    def validate(self) -> None:
        requires_token = self.is_production or self.internal_service_token_required
        if requires_token and not self.internal_service_token:
            raise SystemExit(
                "INTERNAL_SERVICE_TOKEN is required in production. "
                "Set INTERNAL_SERVICE_TOKEN or INTERNAL_SERVICE_TOKEN_REQUIRED=0."
            )

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            port=int(_env("PORT", "5004")),
            internal_service_token=_env("INTERNAL_SERVICE_TOKEN"),
            internal_service_token_required=_is_truthy(_env("INTERNAL_SERVICE_TOKEN_REQUIRED")),
            node_env=_env("NODE_ENV").lower(),
            app_env=_env("APP_ENV").lower(),
            rust_env=_env("RUST_ENV").lower(),
            version="1.0.0",
            git_sha=_get_git_sha(),
            build_time=_get_build_time(),
        )
