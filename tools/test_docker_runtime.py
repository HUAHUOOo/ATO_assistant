"""Build the Docker export and verify mounted resources through a real container.

Run on a host with Docker Engine and Compose v2:
  python tools/test_docker_runtime.py
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import urllib.request
import uuid
import zipfile
from pathlib import Path

from export_portable import build_docker
from test_docker_mounts import RESTORED_PROGRAM_FILES


def main() -> None:
    subprocess.run(["docker", "info"], check=True, stdout=subprocess.DEVNULL)
    package = build_docker("local")
    identity = f"ato-regression-{uuid.uuid4().hex[:10]}"
    image = f"ato-assistant:{identity}"
    environment = {**os.environ, "ATO_IMAGE": image, "ATO_PULL_POLICY": "never"}
    with tempfile.TemporaryDirectory(prefix="ato-docker-") as directory:
        with zipfile.ZipFile(package) as archive:
            archive.extractall(directory)
        root = Path(directory) / "ATO-Assistant-Docker-local"
        app = root / "app"
        expected_player = (app / "assets/bgm/bgm.js").read_bytes()
        expected_ps = {target: (app / target).read_bytes() for target in RESTORED_PROGRAM_FILES}
        for index, target in enumerate(RESTORED_PROGRAM_FILES):
            if index % 2:
                (app / target).write_bytes(b"stale host program data")
            else:
                (app / target).unlink()
        # An old pack may contain these files; the player must still come from the image.
        (app / "assets/bgm/bgm.js").write_bytes(b"stale host player")
        # Build from a clean export, then use the deliberately stale app/ as host mounts.
        with zipfile.ZipFile(package) as archive:
            archive.extractall(root / "image-context")
        context = root / "image-context/ATO-Assistant-Docker-local"
        compose = ["docker", "compose", "-p", identity, "-f", str(root / "compose.yaml")]
        subprocess.run(["docker", "build", "-t", image, str(context)], check=True)
        try:
            configuration = json.loads(subprocess.check_output(
                [*compose, "config", "--format", "json"], cwd=root, env=environment, text=True,
            ))
            assert configuration["services"]["ato"]["image"] == image
            assert configuration["services"]["ato"]["pull_policy"] == "never"
            # Allocate a host port so the smoke test can coexist with other services.
            configuration["services"]["ato"]["ports"] = ["127.0.0.1::8793"]
            smoke = root / "smoke.json"
            smoke.write_text(json.dumps(configuration), encoding="utf-8")
            compose = ["docker", "compose", "-p", identity, "-f", str(smoke)]
            subprocess.run([*compose, "up", "-d"], check=True, cwd=root, env=environment)
            address = subprocess.check_output(
                [*compose, "port", "ato", "8793"], cwd=root, env=environment, text=True,
            ).strip()
            base = f"http://{address}/"

            def read(target: str) -> bytes:
                with urllib.request.urlopen(base + target, timeout=5) as response:
                    return response.read()

            deadline = time.monotonic() + 30
            while True:
                try:
                    assert b"ATO" in read("index.html")
                    break
                except (OSError, AssertionError):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.25)
            assert read("assets/bgm/bgm.js") == expected_player, "Host player shadowed image program"
            for target, expected in expected_ps.items():
                assert read(target) == expected, f"AIBP program was not restored: {target}"
            # Import resources after startup, without re-running the installer or container.
            flat_audio = b"ID3late-resource-pack-audio"
            (app / "assets/bgm/LB_Armory.mp3").write_bytes(flat_audio)
            assert read("assets/bgm/media/LB_Armory.mp3") == flat_audio
            glyph = app / "story/assets/cryptic/glyphs/babelian-01.png"
            glyph.parent.mkdir(parents=True, exist_ok=True)
            glyph.write_bytes(b"glyph smoke fixture")
            assert read("story/assets/cryptic/glyphs/babelian-01.png") == glyph.read_bytes()
            print("Docker runtime passed: local image starts, program data restores, late BGM/glyph imports work.")
        finally:
            subprocess.run([*compose, "down", "--remove-orphans"], cwd=root, env=environment, check=False)
            subprocess.run(["docker", "image", "rm", image], check=False)


if __name__ == "__main__":
    main()
