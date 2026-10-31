import type { GenerateRequest, GenerateResponse, GenerateSuccess, GenerationPhase } from '../../domain/types';

const DEFAULT_MODAL_URL = 'https://wisamsamir78--talky-tts-talkyserver-web.us-east.modal.run';
const STORAGE_KEY_ENDPOINT = 'talky_modal_endpoint';

export class ModalClient {
  private endpoint: string;

  constructor() {
    this.endpoint = localStorage.getItem(STORAGE_KEY_ENDPOINT) || DEFAULT_MODAL_URL;
  }

  public getEndpoint(): string {
    return this.endpoint;
  }

  public setEndpoint(url: string) {
    this.endpoint = url.trim().replace(/\/$/, '');
    localStorage.setItem(STORAGE_KEY_ENDPOINT, this.endpoint);
  }

  public async checkHealth(): Promise<{ ok: boolean; warm?: boolean }> {
    try {
      const res = await fetch(`${this.endpoint}/v1/health`, { method: 'GET' });
      if (!res.ok) return { ok: false };
      const data = await res.json();
      return { ok: true, warm: data.warm };
    } catch {
      return { ok: false };
    }
  }

  public async generateSpeech(
    request: GenerateRequest,
    onPhaseChange?: (phase: GenerationPhase) => void,
    signal?: AbortSignal
  ): Promise<GenerateSuccess> {
    onPhaseChange?.('connecting');

    try {
      onPhaseChange?.('warming');

      const response = await fetch(`${this.endpoint}/v1/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      });

      onPhaseChange?.('generating');

      const data: GenerateResponse = await response.json();

      if (!response.ok || !data.ok) {
        const errorData = !data.ok ? data.error : null;
        throw new Error(
          errorData?.messageAr || errorData?.message || 'فشل في توليد الصوت من السيرفر السحابي'
        );
      }

      onPhaseChange?.('decoding');
      return data;
    } catch (err: unknown) {
      onPhaseChange?.('error');
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('تم إلغاء عملية التوليد');
        }
        throw err;
      }
      throw new Error('حدث خطأ غير متوقع أثناء الاتصال بالخادم');
    }
  }
}

export const modalClient = new ModalClient();
