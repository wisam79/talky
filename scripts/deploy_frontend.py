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

    project_dir = Path(__file__).parent.parent  # scripts/ → repo root
    hf_url = f"https://huggingface.co/spaces/{HF_USERNAME}/{HF_SPACE}"
    auth_url = f"https://{HF_USERNAME}:{HF_TOKEN}@huggingface.co/spaces/{HF_USERNAME}/{HF_SPACE}"

    # إنشاء مجلد مؤقت للنشر
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        print(f"\n📁 تحضير ملفات النشر في: {tmp}")

        # نسخ الملفات المطلوبة فقط (المسارات الجديدة بعد التنظيم)
        files_to_copy = [
            ("static",                      "static"),
            ("apps/frontend/app_hf.py",     "app.py"),          # نستخدم app_hf كـ app.py رئيسي
            ("requirements.txt",            "requirements.txt"),
            ("README.md",                   "README.md"),
        ]

        for src_name, dst_name in files_to_copy:
            src = project_dir / src_name
            dst = tmp / dst_name
            if src.is_dir():
                if src_name == "static":
                    # Static Spaces serve app_file from the repository root.
                    for child in src.iterdir():
                        child_dst = tmp / child.name
                        if child.is_dir():
                            shutil.copytree(child, child_dst)
                        else:
                            shutil.copy2(child, child_dst)
                else:
                    shutil.copytree(src, dst)
            elif src.exists():
                shutil.copy2(src, dst)

        # This deployment is a static Space. The repository README describes
        # the main project as a Gradio app, so replace only the temporary
        # deployment copy's front matter to avoid starting a Python server.
        readme_path = tmp / "README.md"
        if readme_path.exists():
            readme = readme_path.read_text(encoding="utf-8")
            readme = readme.replace("sdk: gradio", "sdk: static", 1)
            readme = readme.replace("sdk_version: 6.12.0\n", "", 1)
            readme = readme.replace("app_file: app.py", "app_file: index.html", 1)
            readme_path.write_text(readme, encoding="utf-8")
        (tmp / "app.py").unlink(missing_ok=True)
        (tmp / "requirements.txt").unlink(missing_ok=True)

        # حقن RENDER_URL في ملفات الإعداد التي تستخدمها الواجهة.
        for config_name in ("index.html", "js/config.js"):
            config_path = tmp / config_name
            if config_path.exists():
                content = config_path.read_text(encoding="utf-8")
                content = content.replace("RENDER_BACKEND_URL_PLACEHOLDER", RENDER_URL)
                config_path.write_text(content, encoding="utf-8")
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
