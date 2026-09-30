"""Repository security scan for the submission build.

    python scripts/security_scan.py

Checks what git would actually stage, plus the tracked tree, for:
  - provider API keys and tokens (Google, OpenAI, Anthropic, Groq, AWS, GitHub,
    Slack, Stripe, JWT, bearer headers, private keys)
  - credential-bearing files (.env, *.pem, *.key, id_rsa, credentials.json)
  - absolute local paths and private/internal hostnames
  - anything that looks like a live secret in docs or examples

Exit code is 1 if any high-confidence finding survives review.
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

# High-confidence provider key shapes. These have enough structure that a match
# is a real credential, not a placeholder.
HIGH = [
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("OpenAI key", re.compile(r"sk-(?:proj-)?[A-Za-z0-9_\-]{20,}")),
    ("Anthropic key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}")),
    ("GitHub PAT (classic)", re.compile(r"\bghp_[A-Za-z0-9]{36}\b")),
    ("Slack token", re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}")),
    ("Stripe live key", re.compile(r"\b[rs]k_live_[A-Za-z0-9]{20,}")),
    ("Private key block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("Bearer credential", re.compile(r"[Bb]earer\s+[A-Za-z0-9._\-]{24,}")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
]

# Weaker signals: a variable name that looks credential-bearing. These are
# reported for review, not as failures, because the shipped .env.example and
# docs legitimately name such variables.
WEAK = re.compile(
    r"(?i)\b(api[_-]?key|secret|password|passwd|token|credential)\b\s*[:=]\s*[\"']?[A-Za-z0-9_\-]{8,}"
)

CRED_FILES = [
    ".env", ".env.local", ".env.production", "credentials.json", "secrets.json",
    "id_rsa", "id_ed25519", "service-account.json", "gcloud-service-key.json",
]
CRED_SUFFIX = (".pem", ".key", ".p12", ".pfx", ".jks", ".keystore")

PRIVATE_URL = re.compile(
    r"https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|"
    r"192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)"
)
# Localhost in docs is normal and correct; only flag it inside source.
ABS_LOCAL = re.compile(r"[A-Z]:\\\\?(?:Users|home)\\\\")

SKIP_DIRS = {
    ".git", "node_modules", "dist", ".venv", "venv", "__pycache__",
    ".pytest_cache", "out", ".remotion", "video", "Frontend-option1",
    "Frontend-option2", ".agents", ".playwright-mcp",
}
SKIP_SUFFIX = {".woff2", ".png", ".jpg", ".jpeg", ".mp4", ".wav", ".db", ".svg", ".ico"}


def staged_files() -> list[str]:
    r = subprocess.run(["git", "diff", "--cached", "--name-only"],
                       capture_output=True, text=True, cwd=REPO)
    staged = [ln for ln in r.stdout.splitlines() if ln.strip()]
    r2 = subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd=REPO)
    tracked = [ln for ln in r2.stdout.splitlines() if ln.strip()]
    return sorted(set(staged) | set(tracked))


def main() -> int:
    findings: list[tuple[str, str, str]] = []
    weak: list[tuple[str, str]] = []

    files = staged_files()
    print(f"scanning {len(files)} tracked/staged files\n")

    for rel in files:
        p = REPO / rel
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in SKIP_SUFFIX:
            continue

        # credential files that must never be tracked
        name = p.name
        if name in CRED_FILES or p.suffix.lower() in CRED_SUFFIX:
            if name != ".env.example":
                findings.append(("CREDENTIAL FILE", rel, "tracked credential file"))

        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        for label, rx in HIGH:
            for m in rx.finditer(text):
                line = text[: m.start()].count("\n") + 1
                snip = m.group(0)[:12] + "..."
                findings.append((label, f"{rel}:{line}", snip))

        for m in WEAK.finditer(text):
            line = text[: m.start()].count("\n") + 1
            weak.append((f"{rel}:{line}", m.group(0)[:60]))

        for m in ABS_LOCAL.finditer(text):
            line = text[: m.start()].count("\n") + 1
            weak.append((f"{rel}:{line}", "absolute local user path"))

    # .env must not be tracked
    r = subprocess.run(["git", "ls-files", "--error-unmatch", ".env"],
                       capture_output=True, text=True, cwd=REPO)
    if r.returncode == 0:
        findings.append(("CREDENTIAL FILE", ".env", ".env is tracked"))

    print("=" * 68)
    if findings:
        print("HIGH-CONFIDENCE FINDINGS")
        for label, where, snip in findings:
            print(f"  [{label}] {where}  {snip}")
    else:
        print("No high-confidence secrets found in tracked or staged files.")

    print("\n" + "=" * 68)
    print("REVIEW (variable names / local paths — expected in docs and templates)")
    seen = set()
    for where, snip in weak:
        key = (where.split(":")[0], snip[:24])
        if key in seen:
            continue
        seen.add(key)
        print(f"  {where}: {snip}")
    if not weak:
        print("  none")

    print("\n" + "=" * 68)
    print(f"private/loopback URL references in source: ", end="")
    n = 0
    for rel in files:
        p = REPO / rel
        if any(part in SKIP_DIRS for part in p.parts) or p.suffix.lower() in SKIP_SUFFIX:
            continue
        if rel.startswith("docs/") or rel == "README.md":
            continue  # localhost in documentation is correct and intended
        try:
            n += len(PRIVATE_URL.findall(p.read_text(encoding="utf-8", errors="ignore")))
        except Exception:
            pass
    print(f"{n} (expected: dev proxy + health checks)")

    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
