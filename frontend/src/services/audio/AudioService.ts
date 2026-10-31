export class AudioService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingStartTime = 0;

  public async startRecording(): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('المتصفح الحالي لا يدعم تسجيل الصوت من المايكروفون');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 24000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.audioChunks = [];
    this.mediaRecorder = new MediaRecorder(stream);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.recordingStartTime = Date.now();
    this.mediaRecorder.start(100);
  }

  public async stopRecording(): Promise<{
    blob: Blob;
    base64: string;
    durationSec: number;
  }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('لم يتم بدء التسجيل'));
        return;
      }

      this.mediaRecorder.onstop = async () => {
        const durationSec = (Date.now() - this.recordingStartTime) / 1000;
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const rawBlob = new Blob(this.audioChunks, { type: mimeType });

        // إيقاف مسارات المايكروفون
        this.mediaRecorder?.stream.getTracks().forEach((track) => track.stop());

        try {
          const base64 = await this.blobToBase64(rawBlob);
          resolve({ blob: rawBlob, base64, durationSec });
        } catch (err) {
          reject(err);
        }
      };

      this.mediaRecorder.stop();
    });
  }

  public async fileToBase64(file: File): Promise<{ base64: string; durationSec: number }> {
    const base64 = await this.blobToBase64(file);
    const durationSec = await this.getAudioDuration(file);
    return { base64, durationSec };
  }

  public async urlToBase64(url: string): Promise<string> {
    const res = await fetch(url);
    const blob = await res.blob();
    return this.blobToBase64(blob);
  }

  public blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  public getAudioDuration(blobOrFile: Blob): Promise<number> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blobOrFile);
      const audio = new Audio(url);
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration || 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
    });
  }

  public base64ToBlobUrl(base64: string, mimeType = 'audio/wav'): string {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    return URL.createObjectURL(blob);
  }
}

export const audioService = new AudioService();
