import type { VoicePersona, ReferencePayload } from '../../domain/types';
import { getCustomVoices, saveCustomVoice, deleteCustomVoice } from '../../storage/db';
import { audioService } from '../audio/AudioService';

export class VoiceManager {
  private builtinVoices: VoicePersona[] = [];
  private base64Cache: Map<string, string> = new Map();

  public async loadBuiltinVoices(): Promise<VoicePersona[]> {
    if (this.builtinVoices.length > 0) return this.builtinVoices;

    try {
      const res = await fetch('./voices.json');
      if (!res.ok) throw new Error('فشل جلب ملف الشخصيات الافتراضية');
      const data = await res.json();
      this.builtinVoices = (data.voices || []).map((v: Partial<VoicePersona>) => ({
        ...v,
        source: 'builtin',
      }));
      return this.builtinVoices;
    } catch (e) {
      console.warn('تعذر تحميل voices.json، استخدام الشخصيات الاحتياطية:', e);
      this.builtinVoices = [
        {
          id: 'builtin:faseeh',
          source: 'builtin',
          name: 'فصيح',
          description: 'صوت جهوري وقور وفصيح، مناسب للتقارير والوثائقيات والكتب',
          language: 'ar',
          gender: 'male',
          tags: ['فصيح', 'وثائقي', 'رسمي'],
          sampleUrl: 'samples/faseeh.wav',
          refText: 'مرحباً، أنا فصيح؛ أقدّم لكم صوتاً جهورياً وقوراً وفصيحاً.',
        },
        {
          id: 'builtin:nour',
          source: 'builtin',
          name: 'نور',
          description: 'صوت نسائي هادئ ومتزن، مناسب للروايات والسرد والتأمل',
          language: 'ar',
          gender: 'female',
          tags: ['روائي', 'سرد', 'تأمل'],
          sampleUrl: 'samples/nour.wav',
          refText: 'أهلاً بكم، أنا نور؛ نبرتي هادئة ومتزنة، ترافقكم في الروايات والسرد والتأمل.',
        },
      ];
      return this.builtinVoices;
    }
  }

  public async getAllVoices(): Promise<VoicePersona[]> {
    const builtin = await this.loadBuiltinVoices();
    const custom = await getCustomVoices();
    return [...builtin, ...custom];
  }

  public async addCustomVoice(voice: VoicePersona): Promise<void> {
    await saveCustomVoice(voice);
  }

  public async removeCustomVoice(id: string): Promise<void> {
    await deleteCustomVoice(id);
    this.base64Cache.delete(id);
  }

  public async getReferencePayload(voice: VoicePersona): Promise<ReferencePayload> {
    let audioBase64 = voice.audioBase64;

    if (!audioBase64 && voice.sampleUrl) {
      if (this.base64Cache.has(voice.id)) {
        audioBase64 = this.base64Cache.get(voice.id)!;
      } else {
        try {
          audioBase64 = await audioService.urlToBase64(voice.sampleUrl);
          this.base64Cache.set(voice.id, audioBase64);
        } catch (err) {
          console.warn('تعذر تحميل العينة الصوتية:', err);
          audioBase64 = '';
        }
      }
    }

    return {
      audioBase64: audioBase64 || '',
      mimeType: 'audio/wav',
      refText: voice.refText || '',
    };
  }
}

export const voiceManager = new VoiceManager();
