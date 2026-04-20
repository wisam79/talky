#!/usr/bin/env python3
"""
deploy_hf.py — رفع الواجهة الأمامية (Frontend) فقط إلى Hugging Face Space
يحتاج إلى RENDER_URL في ملف .env أو كمتغير بيئة
"""
import os, subprocess, shutil, tempfile
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

HF_TOKEN     = os.getenv("HF_TOKEN", "").strip()
HF_USERNAME  = os.getenv("HF_USERNAME", "wisam99").strip()
HF_SPACE     = os.getenv("HF_SPACE_NAME", "talky").strip()
RENDER_URL   = os.getenv("RENDER_URL", "").strip()   # مثال: https://talky-backend.onrender.com

def run(cmd, cwd=None):
    result = subprocess.run(cmd, shell=True, cwd=cwd, text=True,
                            encoding="utf-8", errors="replace",
                            capture_output=True)
    if result.returncode != 0:
        print(f"❌ فشل: {cmd}\n{result.stderr}")
        raise SystemExit(1)
    return result.stdout.strip()

def main():
    print("=" * 55)
    print("  🚀  Talky — نشر الواجهة إلى Hugging Face Space")
    print("=" * 55)

    if not HF_TOKEN:
        print("❌ HF_TOKEN غير موجود في .env")
        raise SystemExit(1)

    if not RENDER_URL:
        print("⚠️  RENDER_URL غير محدد في .env")
        print("    سيتم استخدام عنوان فارغ — الـ API لن يعمل حتى تضيف العنوان!")

    project_dir = Path(__file__).parent
    hf_url = f"https://huggingface.co/spaces/{HF_USERNAME}/{HF_SPACE}"
    auth_url = f"https://{HF_USERNAME}:{HF_TOKEN}@huggingface.co/spaces/{HF_USERNAME}/{HF_SPACE}"

    # إنشاء مجلد مؤقت للنشر
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        print(f"\n📁 تحضير ملفات النشر في: {tmp}")

        # نسخ الملفات المطلوبة فقط
        files_to_copy = [
            ("static",       "static"),
            ("app_hf.py",    "app.py"),          # نستخدم app_hf كـ app.py رئيسي
            ("requirements.txt", "requirements.txt"),
            ("README.md",    "README.md"),
        ]

        for src_name, dst_name in files_to_copy:
            src = project_dir / src_name
            dst = tmp / dst_name
            if src.is_dir():
                shutil.copytree(src, dst)
            elif src.exists():
                shutil.copy2(src, dst)

        # حقن RENDER_URL في index.html
        index_path = tmp / "static" / "index.html"
        if index_path.exists():
            content = index_path.read_text(encoding="utf-8")
            content = content.replace(
                "RENDER_BACKEND_URL_PLACEHOLDER",
                RENDER_URL
            )
            index_path.write_text(content, encoding="utf-8")
            print(f"✅ تم حقن RENDER_URL: {RENDER_URL or '(فارغ)'}")

        # تهيئة Git
        run("git init", cwd=tmp)
        run('git config user.email "deploy@talky.app"', cwd=tmp)
        run('git config user.name "Talky Deploy"', cwd=tmp)

        # إضافة الملفات
        run("git add .", cwd=tmp)
        run('git commit -m "deploy: update frontend"', cwd=tmp)

        # ضبط remote وإرسال
        remotes = subprocess.run("git remote", shell=True, cwd=tmp,
                                 capture_output=True, text=True).stdout
        if "origin" in remotes:
            run(f'git remote set-url origin "{auth_url}"', cwd=tmp)
        else:
            run(f'git remote add origin "{auth_url}"', cwd=tmp)

        print(f"\n⬆️  جارٍ الرفع إلى Hugging Face...")
        run("git push --force origin main", cwd=tmp)

    print(f"\n✅ تم الرفع بنجاح!")
    print(f"🌐 التطبيق: {hf_url}")

if __name__ == "__main__":
    main()
