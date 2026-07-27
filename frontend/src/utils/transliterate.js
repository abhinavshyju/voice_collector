const GOOGLE_INPUT_TOOLS_URL =
  'https://inputtools.google.com/request?itc=ml-t-i0-und&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage';

/**
 * Fetch Malayalam transliteration suggestions from Google Input Tools.
 * Called from the browser (CORS allowed) so it works even when the
 * backend container has no outbound DNS/network access.
 */
export async function transliterate(word) {
  if (!word || !word.trim()) return [];
  try {
    const res = await fetch(`${GOOGLE_INPUT_TOOLS_URL}&text=${encodeURIComponent(word.trim())}`);
    const data = await res.json();
    if (data[0] === 'SUCCESS' && data[1]?.[0]?.[1]) {
      return data[1][0][1];
    }
    return [];
  } catch {
    return [];
  }
}
