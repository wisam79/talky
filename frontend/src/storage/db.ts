import { openDB } from 'idb';
import type { DBSchema } from 'idb';
import type { VoicePersona } from '../domain/types';

export interface HistoryItem {
  id: string;
  text: string;
  voiceName: string;
  audioBase64: string;
  durationMs: number;
  createdAt: string;
}

interface TalkyDB extends DBSchema {
  custom_voices: {
    key: string;
    value: VoicePersona;
  };
  history: {
    key: string;
    value: HistoryItem;
    indexes: { 'by-date': string };
  };
}

const DB_NAME = 'talky_studio_db';
const DB_VERSION = 1;

export async function getDB() {
  return openDB<TalkyDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('custom_voices')) {
        db.createObjectStore('custom_voices', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('history')) {
        const historyStore = db.createObjectStore('history', { keyPath: 'id' });
        historyStore.createIndex('by-date', 'createdAt');
      }
    },
  });
}

export async function getCustomVoices(): Promise<VoicePersona[]> {
  try {
    const db = await getDB();
    return await db.getAll('custom_voices');
  } catch (e) {
    console.error('Error fetching custom voices from DB:', e);
    return [];
  }
}

export async function saveCustomVoice(voice: VoicePersona): Promise<void> {
  const db = await getDB();
  await db.put('custom_voices', voice);
}

export async function deleteCustomVoice(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('custom_voices', id);
}

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    const db = await getDB();
    const items = await db.getAllFromIndex('history', 'by-date');
    return items.reverse(); // أحدث أولاً
  } catch (e) {
    console.error('Error fetching history:', e);
    return [];
  }
}

export async function saveHistoryItem(item: HistoryItem): Promise<void> {
  const db = await getDB();
  await db.put('history', item);
}
