#!/usr/bin/env python3
"""
Test runner for Talky Engine test suite
"""
import sys
import subprocess
import argparse

def run_tests(args=None):
    """Run the test suite"""
    print("=" * 60)
    print("📋 Talky Engine Test Suite")
    print("=" * 60)
    
    parser = argparse.ArgumentParser(description="Run Talky Engine tests")
    parser.add_argument("--integration", action="store_true", help="Run integration tests (requires internet)")
    parser.add_argument("--quick", action="store_true", help="Run only quick unit tests")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    
    args = parser.parse_args(args)
    
    cmd = [sys.executable, "-m", "pytest", "tests/test_api.py", "-xvs"]
    
    if args.integration:
        cmd.append("tests/test_integration.py")
    
    if args.verbose:
        cmd.append("-v")
    
    print(f"\n🚀 Running tests...\n")
    
    try:
        result = subprocess.run(cmd, cwd="E:\\projects\\talky")
        return result.returncode
    except KeyboardInterrupt:
        print("\n❌ Tests interrupted by user")
        return 1

if __name__ == "__main__":
    sys.exit(run_tests())