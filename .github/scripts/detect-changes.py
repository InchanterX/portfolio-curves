"""Select Docker contexts changed since each component's current dev SHA tag.

Standard library only. PRs compare with their merge base; main compares with
dev tags so a failed build is picked up again on the next run.
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

COMPONENTS = {
    "migrations": "migrations",
    "collector-job": "collector_job",
    "metabase": "metabase",
}
SHARED = [".github/scripts/detect-changes.py", ".github/workflows/cicd.yml"]


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=False)


def select(event, revision, base="", requested="auto"):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Expected a full source commit SHA")
    if requested not in {"auto", "all", *COMPONENTS}:
        raise ValueError("Unknown component")
    entries = []
    for name, context in COMPONENTS.items():
        if not Path(context, "Dockerfile").is_file():
            if name != "collector-job" or requested == name:
                raise ValueError(f"Missing Dockerfile for {name}")
            continue
        if requested not in {"auto", "all", name}:
            continue
        previous = None
        if event == "pull_request":
            merge_base = git("merge-base", base, revision)
            if merge_base.returncode:
                raise ValueError("Cannot determine PR merge base")
            previous = merge_base.stdout.strip()
        elif requested == "auto":
            overlay = git("show", f"{revision}:kustomization/{name}/overlays/dev/kustomization.yaml")
            match = re.search(r"^\s*newTag:\s*['\"]?sha-([0-9a-f]{40})['\"]?\s*$", overlay.stdout, re.MULTILINE)
            if match:
                candidate = match[1]
                if git("merge-base", "--is-ancestor", candidate, revision).returncode == 0:
                    previous = candidate
        if requested == "auto" and previous:
            diff = git("diff", "--quiet", previous, revision, "--", context, *SHARED)
            if diff.returncode == 0:
                continue
            if diff.returncode != 1:
                raise ValueError(f"Cannot compare changes for {name}")
        entries.append({"name": name, "context": context,
                        "image": f"registry.faberge-eggs.ru/curves/{name}"})
    return {"include": entries}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", choices=["push", "pull_request", "workflow_dispatch"], required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--base", default="")
    parser.add_argument("--component", default="auto")
    args = parser.parse_args()
    try:
        print(json.dumps(select(args.event, args.revision, args.base, args.component)))
    except ValueError as error:
        parser.exit(1, f"{error}\n")
