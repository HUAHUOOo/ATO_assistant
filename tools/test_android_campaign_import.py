"""Compile and exercise the real Android local API with in-memory platform stubs.

Run: python tools/test_android_campaign_import.py
Uses the Android packager's cached JDK and a pinned JSON library; no SDK is needed.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from export_android import ensure_java, java_home
from packaging.package_common import CACHE_ROOT, PROJECT_ROOT, download


def main() -> None:
    java = ensure_java()
    javac = java_home(java) / "bin" / ("javac.exe" if os.name == "nt" else "javac")
    json_jar = download(
        "https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar",
        CACHE_ROOT / "android" / "json-20240303.jar",
    )
    fixtures = PROJECT_ROOT / "tests" / "fixtures" / "android-local-api"
    api = PROJECT_ROOT / "tools/packaging/android/app/src/main/java/com/ato/assistant/LocalCampaignApi.java"
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run([
            str(javac), "-encoding", "UTF-8", "-cp", str(json_jar), "-d", directory,
            str(api), *(str(path) for path in sorted(fixtures.rglob("*.java"))),
        ], check=True)
        subprocess.run([
            str(java), "-cp", os.pathsep.join((directory, str(json_jar))),
            "com.ato.assistant.CampaignImportHarness",
        ], check=True)


if __name__ == "__main__":
    main()
