import { useState, useRef, useEffect, useCallback } from 'react';
import { transliterate } from '../utils/transliterate';

/**
 * Textarea that converts Manglish (English typed Malayalam) to Malayalam script
 * on Space/Enter using Google Input Tools.
 */
export default function TranslitTextarea({ value, onChange, placeholder, rows = 3 }) {
  const [suggestions, setSuggestions] = useState([]);
  const [pendingWord, setPendingWord] = useState('');
  const [cursorInfo, setCursorInfo] = useState(null);
  const ref = useRef(null);

  const handleInput = useCallback(async (e) => {
    const text = e.target.value;
    const cursor = e.target.selectionStart;
    const lastChar = text[cursor - 1];

    // On space or enter, transliterate the last typed word
    if (lastChar === ' ' || lastChar === '\n') {
      // Find the word just before the space
      const before = text.slice(0, cursor - 1);
      const words = before.split(/[\s]/);
      const lastWord = words[words.length - 1];

      if (lastWord && /^[a-zA-Z]+$/.test(lastWord)) {
        const results = await transliterate(lastWord);
        if (results.length > 0) {
          // Auto-apply first suggestion
          const wordStart = cursor - 1 - lastWord.length;
          const newText = text.slice(0, wordStart) + results[0] + text.slice(cursor - 1);
          onChange(newText);
          
          if (results.length > 1) {
            setPendingWord(lastWord);
            setSuggestions(results);
            setCursorInfo({ wordStart, wordEnd: cursor - 1, suffix: text.slice(cursor - 1) });
          }
          return;
        }
      }
    }

    // Clear suggestions on normal typing
    if (suggestions.length > 0) {
      setSuggestions([]);
    }
    onChange(text);
  }, [onChange, suggestions.length]);

  const pickSuggestion = useCallback((s) => {
    if (!cursorInfo) return;
    const current = value;
    // Find the previously inserted suggestion and replace it
    // The value currently has the auto-inserted first suggestion
    // We need to replace from wordStart to the next space/newline
    const afterWord = current.slice(cursorInfo.wordStart);
    const nextBreak = afterWord.search(/[\s]/);
    const beforeReplace = current.slice(0, cursorInfo.wordStart);
    const afterReplace = nextBreak >= 0 ? afterWord.slice(nextBreak) : '';
    onChange(beforeReplace + s + afterReplace);
    setSuggestions([]);
    setCursorInfo(null);
    ref.current?.focus();
  }, [value, cursorInfo, onChange]);

  // Dismiss suggestions on click outside
  useEffect(() => {
    const dismiss = (e) => {
      if (ref.current && !ref.current.parentElement.contains(e.target)) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, []);

  return (
    <div className="translit-wrap">
      {suggestions.length > 1 && (
        <div className="translit-suggestions">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => pickSuggestion(s)}>{s}</button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        className="textarea"
        value={value}
        onChange={handleInput}
        placeholder={placeholder || 'Type in Manglish (e.g. namaskaram)...'}
        rows={rows}
      />
    </div>
  );
}
