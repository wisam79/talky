import gradio as gr
from gradio_client import Client, handle_file

def process_voice_request(text, ref_audio_path):
    try:
        # الاتصال بالخادم الأصلي القوي لنموذج OmniVoice
        client = Client("k2-fsa/OmniVoice")
        
        # إرسال البيانات للمعالجة السحابية
        result = client.predict(
            text=text,
            ref_audio=handle_file(ref_audio_path) if ref_audio_path else None,
            api_name="/predict" # نقطة الاتصال الافتراضية
        )
        
        # استرجاع مسار الملف الصوتي المولد
        return result
    except Exception as e:
        print(f"Error: {e}")
        return None

# بناء الواجهة التي ستتحول تلقائياً إلى API لتطبيق هاتفك
interface = gr.Interface(
    fn=process_voice_request,
    inputs=[
        gr.Textbox(label="النص (Text)"),
        gr.Audio(type="filepath", label="الصوت المرجعي (Reference Audio)")
    ],
    outputs=gr.Audio(label="النتيجة النهائية"),
    title="Talky Backend API",
    description="محرك معالجة الصوت الوسيط لتطبيق الهاتف الخاص بي."
)

interface.launch()