#!/usr/bin/env python3
"""
Unified test runner for Talky.

Usage:
    python scripts/run_tests.py                 # quick suite (default)
    python scripts/run_tests.py --quick         # static + backend + frontend JS
    python scripts/run_tests.py --live          # quick + live OmniVoice contract
    python scripts/run_tests.py --integration   # quick + live + gradio_client integration
    python scripts/run_tests.py --all           # everything, verbose
    python scripts/run_tests.py --static        # only static-consistency checks
    python scripts/run_tests.py --py            # only pytest (backend + static)
    python scripts/run_tests.py --js            # only node tests (frontend)

Exit code is non-zero when any suite fails, so it is CI-friendly.
Live suites require network; the live contract suite is quota-free by design.
"""
import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SUITES = [
    ("static",  "Static consistency (ids, assets, contracts)", ["--py-static"]),
    ("backend", "Backend API (mocked OmniVoice)",              ["--py-backend"]),
    ("js",      "Frontend JS (jsdom UI + gradio_api contract)", ["--js"]),
    ("live",    "Live OmniVoice contract (network, quota-free)", ["--py-live"]),
    ("integration", "gradio_client integration (network)",     ["--py-integration"]),
]


def run(cmd, cwd=ROOT, env=None):
    print(f"\n\033[1m$ {' '.join(cmd)}\033[0m", flush=True)
    return subprocess.run(cmd, cwd=cwd, env=env).returncode


def main():
    ap = argparse.ArgumentParser(description="Talky unified test runner")
    grp = ap.add_mutually_exclusive_group()
    grp.add_argument("--quick", action="store_true", help="static + backend + js (default)")
    grp.add_argument("--live", action="store_true", help="quick + live contract")
    grp.add_argument("--integration", action="store_true", help="live + gradio integration")
    grp.add_argument("--all", action="store_true", help="everything")
    ap.add_argument("--static", action="store_true", help="static checks only")
    ap.add_argument("--py", action="store_true", help="pytest only (unit suites)")
    ap.add_argument("--js", action="store_true", help="node tests only")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    want_all = args.all
    include = {
        "static":     True,
        "backend":    True,
        "js":         True,
        "live":       args.live or args.integration or want_all,
        "integration": args.integration or want_all,
    }
    if args.static:
        include = {k: k == "static" for k in include}
    if args.py:
        include = {k: k in ("static", "backend") for k in include}
    if args.js:
        include = {k: k == "js" for k in include}

    print("=" * 64)
    print("  Talky — Test Suite")
    print("=" * 64)

    results = {}
    py = sys.executable

    # ── python pytest (static checks + backend + optional live/integration) ──
    pytest_targets = []
    if include["static"]:
        pytest_targets.append("tests/test_static_frontend.py")
    if include["backend"]:
        pytest_targets += ["tests/test_api.py", "tests/test_backend.py"]
    if include["live"]:
        pytest_targets.append("tests/test_live_contract.py")
    if include["integration"]:
        pytest_targets.append("tests/test_integration.py")

    if pytest_targets:
        if not _has_module("pytest") or not _has_module("fastapi"):
            print("\n[!] pytest/fastapi غير مثبتة لهذا المفسّر:")
            print(f"    {py} -m pip install -r requirements.txt")
            return 2
        env = os.environ.copy()
        if include["live"]:
            env["TALKY_LIVE_TESTS"] = "1"
        cmd = [py, "-m", "pytest", *pytest_targets, "-q", "--no-header"]
        if args.verbose or want_all:
            cmd.append("-v")
        results["python"] = run(cmd, env=env)

    # ── node tests ──
    if include["js"]:
        if not shutil.which("node"):
            print("\n[!] node غير مثبّت — تم تخطي اختبارات الفرونتند")
            results["node"] = 0
        else:
            cmd = ["node", "--test", "tests_js/"]
            if args.verbose or want_all:
                cmd.append("--test-reporter=spec")
            results["node"] = run(cmd)

    # ── summary ──
    print("\n" + "=" * 64)
    print("  Summary")
    print("=" * 64)
    labels = {"python": "pytest (static + backend + …)", "node": "node --test (frontend JS)"}
    failed = 0
    for key, code in results.items():
        state = "PASS" if code == 0 else f"FAIL ({code})"
        print(f"  {labels.get(key, key):32s} {state}")
        if code != 0:
            failed += 1
    print("=" * 64)
    if failed:
        print(f"  ❌ {failed} suite(s) failed")
    else:
        print("  ✅ all suites passed")
    print("=" * 64)
    return 1 if failed else 0


def _has_module(name):
    try:
        import importlib.util
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


if __name__ == "__main__":
    sys.exit(main())
