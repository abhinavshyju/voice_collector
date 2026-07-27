import { api } from './api';

/**
 * Fetch Malayalam transliteration suggestions via backend proxy.
 */
export async function transliterate(word) {
  if (!word || !word.trim()) return [];
  try {
    const data = await api.transliterate(word.trim());
    return data.suggestions || [];
  } catch {
    return [];
  }
}
