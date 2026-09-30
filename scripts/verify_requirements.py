"""Create a clean virtual environment and install PIVOT from requirement.txt.

Used to prove the declared dependency set is complete and installable, and that
nothing in the backend imports a package the file forgot to declare. The
environment is created outside the repository so the working tree stays clean.

    python scripts/verify_requirements.py [--keep]
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import venv

REPO = pathlib.Path(__file__).resolve().parent.parent
VENV = pathlib.Path(
    os.environ.get("TEMP", r"C:\Users\Ryan\AppData\Local\Temp")
) / "pivot-verify-venv"

PY = VENV / "Scripts" / "python.exe"


def run(args: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, **kw)


def main() -> int:
    keep = "--keep" in sys.argv
    if VENV.exists():
        print(f"removing previous {VENV}")
        import shutil

        shutil.rmtree(VENV)

    print(f"creating venv at {VENV}")
    venv.EnvBuilder(with_pip=True, clear=True).create(VENV)

    print("\n--- installing from requirement.txt ---")
    r = run([str(PY), "-m", "pip", "install", "--disable-pip-version-check",
             "-r", str(REPO / "requirement.txt")])
    if r.returncode != 0:
        print(r.stdout[-4000:])
        print(r.stderr[-4000:])
        return 1
    installed = [
        ln.split()[0]
        for ln in r.stdout.splitlines()
        if ln.startswith("Successfully installed")
    ]
    print(installed[0] if installed else r.stdout[-800:])

    print("\n--- installed distributions ---")
    r = run([str(PY), "-m", "pip", "list", "--format=json"])
    dists = {d["name"].lower(): d["version"] for d in json.loads(r.stdout)}
    for name in ("fastapi", "uvicorn", "pydantic", "python-dotenv",
                 "playwright", "pytest", "pytest-asyncio"):
        print(f"  {name:<16} {dists.get(name, 'MISSING')}")

    print("\n--- import check: every backend module ---")
    backend = REPO / "backend"
    sys.path.insert(0, str(backend))
    r = run(
        [str(PY), "-c",
         "import api.main, runtime.runtime, runtime.scheduler, runtime.graph, "
         "runtime.semantic, runtime.interruption, runtime.state, runtime.events, "
         "runtime.types, browser.executor, providers.deterministic, providers; "
         "print('all backend modules import cleanly')"],
        cwd=str(backend),
    )
    print(r.stdout.strip() or r.stderr.strip()[-2000:])
    if r.returncode != 0:
        return 1

    print("\n--- boot the backend from the clean environment ---")
    r = run(
        [str(PY), "-c",
         "from api.main import app; "
         "paths = sorted({r.path for r in app.routes}); "
         "print('routes:', len(paths)); "
         "print('has /api/health:', '/api/health' in paths); "
         "print('has /ws:', '/ws' in paths)"],
        cwd=str(backend),
    )
    print(r.stdout.strip() or r.stderr.strip()[-2000:])
    if r.returncode != 0:
        return 1

    print("\n--- test suite in the clean environment ---")
    r = run([str(PY), "-m", "pytest", "tests/", "-q"], cwd=str(REPO))
    tail = r.stdout.strip().splitlines()[-6:]
    print("\n".join(tail))
    if r.returncode != 0:
        print(r.stdout[-3000:])
        return 1

    if not keep:
        import shutil

        shutil.rmtree(VENV, ignore_errors=True)
        print(f"\nremoved {VENV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
