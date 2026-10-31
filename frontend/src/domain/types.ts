export type AudioFormat = 'wav' | 'mp3';
export type VoiceSource = 'builtin' | 'custom';

export interface VoicePersona {
  id: string; // 'builtin:faseeh' | 'custom:<uuid>'
  source: VoiceSource;
  name: string;
  description?: string;
  language: 'ar' | 'ar-en';
  gender?: 'female' | 'male' | 'neutral';
  tags?: string[];
  sampleUrl?: string;
  audioBase64?: string;
  refText?: string;
  createdAt?: string;
}

export interface ReferencePayload {
  audioBase64?: string;
  mimeType?: 'audio/wav';
  refText?: string;
}

export interface VoicePayload {
  type: 'inline' | 'preset' | 'custom';
  voiceId?: string;
  reference?: ReferencePayload;
}

export interface GenerateOptions {
  speed?: number;
  pitch?: number;
  seed?: number | null;
  format?: AudioFormat;
}

export interface GenerateRequest {
  apiVersion: 1;
  requestId: string;
  text: string;
  voice: VoicePayload;
  options?: GenerateOptions;
}

export type ErrorCode =
  | 'INVALID_REQUEST' | 'TEXT_EMPTY' | 'TEXT_TOO_LONG'
  | 'REF_AUDIO_INVALID' | 'REF_AUDIO_TOO_SHORT' | 'REF_AUDIO_TOO_LONG' | 'REF_AUDIO_TOO_QUIET'
  | 'PAYLOAD_TOO_LARGE' | 'UNAUTHORIZED' | 'RATE_LIMITED'
  | 'MODEL_ERROR' | 'SERVICE_UNAVAILABLE' | 'TIMEOUT'
  | 'NETWORK_ERROR' | 'ABORTED';

export interface ApiError {
  code: ErrorCode;
  message: string;
  messageAr: string;
  retryable: boolean;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
}

export interface GenerateSuccess {
  ok: true;
  apiVersion: 1;
  requestId: string;
  audio: {
    base64: string;
    format: AudioFormat;
    mimeType: 'audio/wav' | 'audio/mpeg';
    sampleRate: number;
    durationMs: number;
  };
  meta: {
    model: string;
    coldStart: boolean;
    seed?: number | null;
    timings: {
      inferMs: number;
      encodeMs: number;
      totalMs: number;
    };
  };
}

export interface GenerateFailure {
  ok: false;
  apiVersion: 1;
  requestId: string;
  error: ApiError;
}

export type GenerateResponse = GenerateSuccess | GenerateFailure;

export type GenerationPhase =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'warming'
  | 'generating'
  | 'decoding'
  | 'ready'
  | 'error';
