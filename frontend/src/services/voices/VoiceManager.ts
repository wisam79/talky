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
      console.warn('تعذر تحميل voices.json، استخدام الشخصية الاحتياطية:', e);
      this.builtinVoices = [
        {
          id: 'builtin:faseeh',
          source: 'builtin',
          name: 'فصيح - وثائقي وإخباري',
          description: 'صوت جهوري وقور وفصيح، مناسب للتقارير والوثائقيات والكتب',
          language: 'ar',
          gender: 'male',
          tags: ['فصيح', 'وثائقي', 'رسمي'],
          sampleUrl: 'samples/ar.ref.24k.wav',
          refText:
            'ويدقق النظر في القرآن الكريم وسائر الكتب السماوية ويتبع مسالك الرسل العظام عليهم الصلاة والسلام.',
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
        audioBase64 = await audioService.urlToBase64(voice.sampleUrl);
        this.base64Cache.set(voice.id, audioBase64);
      }
    }

    if (!audioBase64) {
      throw new Error(`تعذر العثور على العينة الصوتية للشخصية: ${voice.name}`);
    }

    return {
      audioBase64,
      mimeType: 'audio/wav',
      refText: voice.refText,
    };
  }
}

export const voiceManager = new VoiceManager();
