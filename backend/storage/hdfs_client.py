"""WebHDFS REST client for Hadoop HDFS Clean Serving Zone (with local mirror fallback).

Handles WSL2 Hadoop 3.x DataNode hostname redirects (e.g., Byan-HP840G3:9864 -> 127.0.0.1:9864)
so Windows FastAPI can reliably write and read Parquet/JSON files directly to/from Hadoop HDFS.
"""

from __future__ import annotations

import io
import json
import os
import urllib.parse
from pathlib import Path
from typing import Any

import pandas as pd
import requests

BASE_DIR = Path(__file__).resolve().parent.parent
LOCAL_MIRROR_ROOT = BASE_DIR / "data" / "hdfs_mirror"

DEFAULT_WEBHDFS_URL = os.getenv("WEBHDFS_URL", "http://127.0.0.1:9870/webhdfs/v1")
DEFAULT_HDFS_USER = os.getenv("HDFS_USER", "abbyan")
NAMENODE_UI_URL = os.getenv("HDFS_NAMENODE_UI", "http://localhost:9870")


class HDFSClient:
    """Thin WebHDFS REST client with WSL2 redirect rewriting and local fallback mirror."""

    def __init__(
        self,
        webhdfs_url: str = DEFAULT_WEBHDFS_URL,
        hdfs_user: str = DEFAULT_HDFS_USER,
        timeout: int = 12,
    ) -> None:
        self.webhdfs_url = webhdfs_url.rstrip("/")
        self.hdfs_user = hdfs_user
        self.timeout = timeout
        self._session = requests.Session()

    def _normalize_path(self, hdfs_path: str) -> str:
        clean = "/" + hdfs_path.lstrip("/")
        return clean

    def _mirror_path(self, hdfs_path: str) -> Path:
        rel = hdfs_path.lstrip("/")
        return LOCAL_MIRROR_ROOT / rel

    def _endpoint(self, hdfs_path: str) -> str:
        return f"{self.webhdfs_url}{self._normalize_path(hdfs_path)}"

    @staticmethod
    def _rewrite_redirect_url(location: str) -> str:
        """Rewrite WSL/container DataNode hostnames in 307 redirects to 127.0.0.1."""
        parsed = urllib.parse.urlparse(location)
        if parsed.hostname and parsed.hostname not in ("localhost", "127.0.0.1"):
            netloc = f"127.0.0.1:{parsed.port}" if parsed.port else "127.0.0.1"
            return urllib.parse.urlunparse(parsed._replace(netloc=netloc))
        return location

    def check_status(self) -> dict[str, Any]:
        """Check whether Hadoop WebHDFS is reachable."""
        try:
            resp = self._session.get(
                self._endpoint("/fuelpulse"),
                params={"op": "GETFILESTATUS", "user.name": self.hdfs_user},
                timeout=6,
            )
            if resp.status_code in (200, 404):
                return {
                    "connected": True,
                    "namenode_ui": NAMENODE_UI_URL,
                    "webhdfs_url": self.webhdfs_url,
                    "clean_zone": "/fuelpulse/gold_clean_analytics",
                    "mode": "Hadoop HDFS (WebHDFS)",
                    "error": None,
                }
            return {
                "connected": False,
                "namenode_ui": NAMENODE_UI_URL,
                "webhdfs_url": self.webhdfs_url,
                "clean_zone": "/fuelpulse/gold_clean_analytics",
                "mode": "Local Mirror Fallback",
                "error": f"HTTP {resp.status_code}",
            }
        except Exception as exc:
            return {
                "connected": False,
                "namenode_ui": NAMENODE_UI_URL,
                "webhdfs_url": self.webhdfs_url,
                "clean_zone": "/fuelpulse/gold_clean_analytics",
                "mode": "Local Mirror Fallback",
                "error": str(exc),
            }

    def mkdirs(self, hdfs_dir: str) -> bool:
        """Create directory in HDFS (and mirror locally)."""
        mirror = self._mirror_path(hdfs_dir)
        mirror.mkdir(parents=True, exist_ok=True)
        try:
            resp = self._session.put(
                self._endpoint(hdfs_dir),
                params={"op": "MKDIRS", "user.name": self.hdfs_user},
                timeout=self.timeout,
            )
            return resp.ok
        except Exception:
            return False

    def put_bytes(self, hdfs_path: str, payload: bytes) -> bool:
        """Write raw bytes to local mirror and upload to Hadoop HDFS via WebHDFS."""
        mirror = self._mirror_path(hdfs_path)
        mirror.parent.mkdir(parents=True, exist_ok=True)
        mirror.write_bytes(payload)

        parent_dir = str(Path(self._normalize_path(hdfs_path)).parent).replace("\\", "/")
        try:
            self._session.put(
                self._endpoint(parent_dir),
                params={"op": "MKDIRS", "user.name": self.hdfs_user},
                timeout=self.timeout,
            )
            init_resp = self._session.put(
                self._endpoint(hdfs_path),
                params={
                    "op": "CREATE",
                    "overwrite": "true",
                    "user.name": self.hdfs_user,
                },
                allow_redirects=False,
                timeout=self.timeout,
            )
            if init_resp.status_code not in (307, 201):
                return False
            if init_resp.status_code == 201:
                return True

            location = init_resp.headers.get("Location")
            if not location:
                return False
            upload_url = self._rewrite_redirect_url(location)
            upload_resp = self._session.put(
                upload_url,
                data=payload,
                headers={"Content-Type": "application/octet-stream"},
                timeout=self.timeout * 2,
            )
            return upload_resp.status_code in (200, 201)
        except Exception:
            return False

    def get_bytes(self, hdfs_path: str) -> tuple[bytes, str]:
        """Read bytes from Hadoop HDFS via WebHDFS, falling back to local mirror if offline."""
        try:
            init_resp = self._session.get(
                self._endpoint(hdfs_path),
                params={"op": "OPEN", "user.name": self.hdfs_user},
                allow_redirects=False,
                timeout=self.timeout,
            )
            if init_resp.status_code == 307 and init_resp.headers.get("Location"):
                read_url = self._rewrite_redirect_url(init_resp.headers["Location"])
                data_resp = self._session.get(read_url, timeout=self.timeout * 2)
                if data_resp.status_code == 200:
                    return data_resp.content, "Hadoop HDFS (/fuelpulse/gold_clean_analytics)"
            elif init_resp.status_code == 200:
                return init_resp.content, "Hadoop HDFS (/fuelpulse/gold_clean_analytics)"
        except Exception:
            pass

        mirror = self._mirror_path(hdfs_path)
        if mirror.exists():
            return mirror.read_bytes(), "Local HDFS Mirror Fallback (Hadoop HDFS Offline)"
        raise FileNotFoundError(f"File tidak ditemukan di HDFS maupun local mirror: {hdfs_path}")

    def put_parquet(self, hdfs_path: str, df: pd.DataFrame) -> bool:
        """Serialize DataFrame to Apache Parquet bytes and persist to HDFS."""
        buf = io.BytesIO()
        df.to_parquet(buf, index=False, engine="pyarrow")
        return self.put_bytes(hdfs_path, buf.getvalue())

    def read_parquet(self, hdfs_path: str) -> tuple[pd.DataFrame, str]:
        """Read Apache Parquet file from HDFS into a pandas DataFrame."""
        raw, source = self.get_bytes(hdfs_path)
        return pd.read_parquet(io.BytesIO(raw), engine="pyarrow"), source

    def put_json(self, hdfs_path: str, obj: Any) -> bool:
        """Serialize object to UTF-8 JSON and persist to HDFS."""
        raw = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        return self.put_bytes(hdfs_path, raw)

    def read_json(self, hdfs_path: str) -> tuple[Any, str]:
        """Read JSON object from HDFS."""
        raw, source = self.get_bytes(hdfs_path)
        return json.loads(raw.decode("utf-8")), source

    def exists(self, hdfs_path: str) -> bool:
        """Check if a file exists in HDFS or local mirror."""
        try:
            resp = self._session.get(
                self._endpoint(hdfs_path),
                params={"op": "GETFILESTATUS", "user.name": self.hdfs_user},
                timeout=3,
            )
            if resp.status_code == 200:
                return True
        except Exception:
            pass
        return self._mirror_path(hdfs_path).exists()

    def list_dir(self, hdfs_dir: str) -> list[dict[str, Any]]:
        """List files inside an HDFS directory via WebHDFS LISTSTATUS."""
        try:
            resp = self._session.get(
                self._endpoint(hdfs_dir),
                params={"op": "LISTSTATUS", "user.name": self.hdfs_user},
                timeout=self.timeout,
            )
            if resp.status_code == 200:
                return resp.json().get("FileStatuses", {}).get("FileStatus", [])
        except Exception:
            pass
        return []
