"""Malayalam recording prompt generation via Groq."""

import os
import re

from groq import Groq

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
MODEL = "openai/gpt-oss-120b"
MAX_TOKENS = 512
MAX_EXCLUDE = 10

SYSTEM_PROMPT = """You are a native Malayalam speaker writing simple, everyday sentences 
for a voice-recording app. Ordinary people (not writers, not news readers) will read 
these sentences out loud to record their voice.

WRITE LIKE: how people actually talk to family and friends — WhatsApp messages, 
casual chats, small daily complaints and updates. Think of a person casually telling 
a friend about their day.

DO NOT WRITE LIKE: news anchors, textbooks, formal speeches, or literature. 
Avoid heavy/bookish words such as എന്നിരുന്നാലും, അതിനാൽ, പ്രസ്തുത, സമ്പൂർണ്ണ, 
അഭിവന്ദ്യ, തദവസരത്തിൽ — replace these with the simple words people actually use.

EXAMPLES OF THE STYLE YOU SHOULD PRODUCE:
- ഇന്ന് രാവിലെ ഉമ്മ ഉണ്ടാക്കിയ ദോശ കഴിച്ചപ്പോൾ നല്ല സന്തോഷം തോന്നി.
- മഴ പെയ്യാൻ തുടങ്ങിയപ്പോൾ ഞാൻ കുട എടുക്കാൻ മറന്നു പോയി.
- ഇന്നലെ രാത്രി ശരിക്കും ഉറക്കം കിട്ടിയില്ല, ഇപ്പോൾ നല്ല ക്ഷീണം ഉണ്ട്.
- അമ്മയ്ക്ക് സുഖമില്ലാത്തതുകൊണ്ട് ഇന്ന് ഓഫീസിൽ പോകാൻ തോന്നുന്നില്ല.
- ബസ്സ് ഒരു മണിക്കൂർ വൈകി വന്നപ്പോൾ ശരിക്കും ദേഷ്യം വന്നു.
- ചേച്ചി ഉണ്ടാക്കിയ ഫിഷ് കറി കഴിച്ചപ്പോൾ വായിൽ വെള്ളമൂറി.
- അടുത്ത ആഴ്ച കുടുംബത്തോടെ ഊട്ടിക്ക് പോകുന്നുണ്ട്, ശരിക്കും സന്തോഷം തോന്നുന്നു.

Notice: short clauses, everyday words, mild emotional color, things a real person 
would actually say about their own life.

RULES:
- Output exactly ONE sentence, Malayalam script only.
- Target length: 8-12 words (ideal, ~8-12 seconds read aloud).
- Minimum 5 words (~3 seconds), maximum 20 words (~20 seconds). Never exceed 20.
- Reflect the requested emotion naturally through word choice and situation, 
  not by stating the emotion name directly.
- Rotate across topics: weather, food, family, work/study, travel, health, 
  shopping, weekend plans, friends, small daily annoyances, small daily joys.
- No English words, no quotes, no numbering, no labels, no explanation — 
  sentence only."""
  
MALAYALAM_RE = re.compile(r"[\u0D00-\u0D7F]")


class PromptGeneratorError(Exception):
    """Raised when prompt generation fails."""


class PromptGeneratorNotConfigured(PromptGeneratorError):
    """Raised when GROQ_API_KEY is missing."""


def _client() -> Groq:
    if not GROQ_API_KEY:
        raise PromptGeneratorNotConfigured("GROQ_API_KEY is not configured")
    return Groq(api_key=GROQ_API_KEY)


def _clean_text(raw: str) -> str:
    text = raw.strip().strip('"\'“”‘’')
    text = re.sub(r"^\d+[\.\)]\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _is_valid_malayalam(text: str) -> bool:
    if not text or len(text) < 4:
        return False
    malayalam_chars = len(MALAYALAM_RE.findall(text))
    return malayalam_chars >= max(3, len(text) * 0.5)


def _build_user_prompt(emotion: str, exclude: list[str]) -> str:
    parts = [f"Emotion: {emotion}. Generate one new Malayalam sentence."]
    if exclude:
        joined = "\n".join(f"- {s}" for s in exclude[:MAX_EXCLUDE])
        parts.append(f"Do not repeat or closely paraphrase these:\n{joined}")
    return "\n\n".join(parts)


def generate_prompt(emotion: str = "neutral", exclude: list[str] | None = None) -> str:
    """Generate a single Malayalam recording prompt."""
    exclude = exclude or []
    client = _client()
    user_prompt = _build_user_prompt(emotion, exclude)

    last_error: Exception | None = None
    for attempt in range(2):
        try:
            completion = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.9 if attempt == 0 else 1.0,
                max_tokens=MAX_TOKENS,
                reasoning_effort="low",
            )
            raw = completion.choices[0].message.content or ""
            text = _clean_text(raw)
            if _is_valid_malayalam(text):
                return text
            last_error = PromptGeneratorError(f"Invalid Malayalam output: {raw!r}")
        except PromptGeneratorNotConfigured:
            raise
        except Exception as e:
            last_error = e

    raise PromptGeneratorError(str(last_error) if last_error else "Failed to generate prompt")
