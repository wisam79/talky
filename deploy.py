"""
deploy.py — أداة النشر التلقائي على Hugging Face
تطلب منك التوكن وترفع المشروع تلقائياً دون الحاجة لأي إعداد يدوي.
"""

import subprocess
import sys
import getpass
import os
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # python-dotenv not installed, continue without it
    pass

# ───── إعدادات Space ───────────────────────────────────────────────
HF_USERNAME    = "wisam99"
HF_SPACE_NAME  = "talky"
REPO_URL_BASE  = f"https://huggingface.co/spaces/{HF_USERNAME}/{HF_SPACE_NAME}"
# ────────────────────────────────────────────────────────────────────


def run(cmd, cwd=None, check=True):
    """تشغيل أمر shell وإرجاع الناتج."""
    result = subprocess.run(
        cmd, shell=True, cwd=cwd,
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if check and result.returncode != 0:
        print(f"\n❌ فشل الأمر: {cmd}")
        print(result.stderr or result.stdout)
        sys.exit(1)
    return result.stdout.strip()


def check_git_installed():
    result = subprocess.run("git --version", shell=True, capture_output=True)
    if result.returncode != 0:
        print("❌ Git غير مثبّت. يرجى تثبيته من https://git-scm.com/")
        sys.exit(1)


def main():
    print("=" * 55)
    print("  🚀  Talky — أداة النشر التلقائي على Hugging Face")
    print("=" * 55)
    print(f"  المستودع: {REPO_URL_BASE}")
    print("=" * 55)

    check_git_installed()

    # ── طلب التوكن ──────────────────────────────────────────────────
    # أولاً نتحقق من وجود التوكن في ملف .env
    token = os.getenv("HF_TOKEN", "").strip()
    
    if not token:
        print("\n📌 احصل على Access Token (Write) من:")
        print("   https://huggingface.co/settings/tokens\n")
        print("💡 يمكنك وضع التوكن في ملف .env لكي لا تكتبه كل مرة!\n")
        token = getpass.getpass("🔑 أدخل HF Access Token (لن يُعرض أثناء الكتابة): ").strip()

    if not token:
        print("❌ لم يتم إدخال توكن. تم الإلغاء.")
        sys.exit(1)
        
    if token.startswith("hf_"):
        print("✅ تم تحميل التوكن بنجاح!")

    # ── بناء عنوان الـ remote مع التوكن ──────────────────────────────
    authenticated_url = f"https://{HF_USERNAME}:{token}@huggingface.co/spaces/{HF_USERNAME}/{HF_SPACE_NAME}"
    project_dir = os.path.dirname(os.path.abspath(__file__))

    print("\n⏳ جارٍ التحقق من حالة Git...")

    # تأكد أن الـ repo موجود
    git_status = subprocess.run("git status", shell=True, cwd=project_dir,
                                capture_output=True, text=True)
    if git_status.returncode != 0:
        print("❌ هذا المجلد ليس مستودع Git. تأكد من أنك في المجلد الصحيح.")
        sys.exit(1)

    # إضافة أي تعديلات جديدة
    print("📦 جارٍ تجميع الملفات المعدّلة (git add)...")
    run("git add -A", cwd=project_dir)

    # التحقق هل يوجد تغييرات للإرسال
    diff_result = subprocess.run(
        "git diff --cached --quiet", shell=True, cwd=project_dir
    )

    if diff_result.returncode == 0:
        print("ℹ️  لا توجد تعديلات جديدة منذ آخر رفع. سيتم إعادة الإرسال مباشرة.")
    else:
        print("✍️  جارٍ حفظ التعديلات (git commit)...")
        run('git commit -m "deploy: update via deploy.py"', cwd=project_dir)

    # تعيين الـ remote URL مع التوكن مؤقتاً
    print("🔗 جارٍ ضبط عنوان الاتصال...")
    remotes = subprocess.run("git remote", shell=True, cwd=project_dir, capture_output=True, text=True).stdout
    if "origin" in remotes:
        run(f'git remote set-url origin "{authenticated_url}"', cwd=project_dir)
    else:
        run(f'git remote add origin "{authenticated_url}"', cwd=project_dir)

    # الرفع
    print("\n⬆️  جارٍ رفع المشروع إلى Hugging Face...")
    push_result = subprocess.run(
        "git push origin main",
        shell=True, cwd=project_dir,
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )

    # إعادة الـ URL بدون التوكن للحفاظ على الأمان
    run(f'git remote set-url origin "{REPO_URL_BASE}"', cwd=project_dir)

    if push_result.returncode == 0:
        print("\n✅ تم الرفع بنجاح!")
        print(f"🌐 التطبيق متاح على: https://huggingface.co/spaces/{HF_USERNAME}/{HF_SPACE_NAME}")
    else:
        err = push_result.stderr or push_result.stdout
        print("\n❌ فشل الرفع. تفاصيل الخطأ:")
        print(err)
        if "401" in err or "Authentication" in err.lower():
            print("\n💡 تلميح: تأكد أن التوكن صحيح ولديه صلاحية Write.")
        elif "rejected" in err.lower():
            print("\n💡 تلميح: قد تحتاج إلى: git pull --rebase ثم أعد التشغيل.")
        sys.exit(1)


if __name__ == "__main__":
    main()
