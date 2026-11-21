"""Exercise secret preparation in isolation; never contact kubectl or a cluster."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "seal-secrets.sh"
GIT_BASH = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
BASH = str(GIT_BASH) if GIT_BASH.is_file() else shutil.which("bash")


@pytest.mark.skipif(not BASH, reason="Bash is required")
@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_secret_preparation_is_repeatable_and_failure_safe(tmp_path, newline):
    """Keep keys stable, avoid credential output, and publish only after encryption."""
    script = tmp_path / "kustomization/scripts/seal-secrets.sh"
    script.parent.mkdir(parents=True)
    shutil.copyfile(SCRIPT, script)
    for app in ("postgres", "migrations", "collector-job", "metabase"):
        overlay = tmp_path / f"kustomization/{app}/overlays/dev"
        overlay.mkdir(parents=True)
        (overlay / "kustomization.yaml").write_bytes(
            ("resources:" + newline + "- ../../base" + newline).encode()
        )
    tools = tmp_path / "bin"
    tools.mkdir()
    stubs = {
        "kubectl": 'printf \'{"kind":"Secret"}\\n\'\n',
        "jq": "cat >/dev/null; printf '{}\\n'\n",
        "openssl": "printf '%064d\\n' 0\n",
        "kubeseal": (
            'if [[ "$*" == *--fetch-cert* ]]; then printf "cert\\n"; exit 0; fi\n'
            'cat >/dev/null\n[[ "${FAIL_SEAL:-}" != 1 ]] || exit 1\n'
            "printf 'apiVersion: bitnami.com/v1alpha1\\nkind: SealedSecret\\nmetadata:\\n  name: mock\\n'\n"
        ),
    }
    for name, body in stubs.items():
        executable = tools / name
        executable.write_text("#!/usr/bin/env bash\n" + body, newline="\n")
        executable.chmod(0o755)
    passwords = [
        f"{role}_password_123456"
        for role in ("admin", "migrator", "collector", "reader", "metabase")
    ]
    key = "0" * 64

    def run(mode="", fail=False):
        values = passwords + ([] if mode else [key]) + ["harbor-user", "harbor-secret"]
        command = 'export PATH="$PWD/bin:$PATH"; '
        if fail:
            command += "export FAIL_SEAL=1; "
        command += (
            "bash kustomization/scripts/seal-secrets.sh dev controller namespace "
            + mode
        )
        return subprocess.run(
            [BASH, "-c", command],
            cwd=tmp_path,
            input=("\n".join(values) + "\n").encode(),
            capture_output=True,
            check=False,
        )

    def manifests():
        return {
            p.relative_to(tmp_path): p.read_bytes()
            for p in (tmp_path / "kustomization").rglob("*.yaml")
        }

    result = run("--initialize-key")
    assert result.returncode == 0, result.stderr.decode()
    for app, required in {
        "postgres": ["postgres-auth.yaml", "postgres-bootstrap.yaml"],
        "migrations": ["postgres-auth.yaml", "harbor-pull-secret.yaml"],
        "collector-job": ["postgres-auth.yaml", "harbor-pull-secret.yaml"],
        "metabase": ["metabase-auth.yaml", "harbor-pull-secret.yaml"],
    }.items():
        lines = (
            tmp_path / f"kustomization/{app}/overlays/dev/kustomization.yaml"
        ).read_text().splitlines()
        for name in required:
            assert lines.count("- " + name) == 1
    for secret in passwords + [key, "harbor-secret"]:
        assert secret.encode() not in result.stdout + result.stderr
    initial = manifests()
    assert run().returncode == 0
    assert manifests() == initial
    assert run("--initialize-key").returncode != 0
    assert run(fail=True).returncode != 0
    assert manifests() == initial
