#!/usr/bin/env python3
"""
Podcast Studio AI Backend
- News search:      Perplexity Sonar API
- Script gen:       Perplexity chat API (sonar-pro)
- TTS:              Microsoft Edge TTS (edge-tts, FREE, no API key)
- Audio merge:      ffmpeg
"""
import asyncio

# Load environment variables from .env file (for local development)
from dotenv import load_dotenv
load_dotenv()

import base64
import json
import os
import re
import tempfile
import subprocess
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import httpx
import edge_tts

try:
    from tinytag import TinyTag
    TINYTAG_AVAILABLE = True
except ImportError:
    TINYTAG_AVAILABLE = False
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


# ── Edge TTS Voice Catalogue (dynamic, loaded at startup) ────────────────────
# Populated by fetch_all_voices() called in the lifespan handler.
# Each entry: {"name": str, "gender": str, "locale": str, "tags": [str], "friendly_name": str}
ALL_VOICES: list[dict] = []

# Locale → human-readable keyword tags derived automatically
_LOCALE_TAGS: dict[str, list[str]] = {
    # lang
    "en": ["english"], "zh": ["chinese"], "es": ["spanish"], "fr": ["french"],
    "de": ["german"], "ja": ["japanese"], "ko": ["korean"], "pt": ["portuguese"],
    "ar": ["arabic"], "hi": ["hindi"], "it": ["italian"], "ru": ["russian"],
    "nl": ["dutch"], "pl": ["polish"], "sv": ["swedish"], "da": ["danish"],
    "nb": ["norwegian"], "fi": ["finnish"], "tr": ["turkish"], "id": ["indonesian"],
    "ms": ["malay"], "th": ["thai"], "vi": ["vietnamese"], "cs": ["czech"],
    "ro": ["romanian"], "hu": ["hungarian"], "sk": ["slovak"], "uk": ["ukrainian"],
    "el": ["greek"], "he": ["hebrew"], "bg": ["bulgarian"], "hr": ["croatian"],
    "lt": ["lithuanian"], "lv": ["latvian"], "et": ["estonian"], "sl": ["slovenian"],
    "sr": ["serbian"], "ca": ["catalan"], "gl": ["galician"], "eu": ["basque"],
    "af": ["afrikaans"], "sw": ["swahili"], "cy": ["welsh"], "ga": ["irish"],
    "mt": ["maltese"], "sq": ["albanian"], "mk": ["macedonian"], "az": ["azerbaijani"],
    "kk": ["kazakh"], "ky": ["kyrgyz"], "uz": ["uzbek"], "mn": ["mongolian"],
    "am": ["amharic"], "so": ["somali"], "zu": ["zulu"],
    # region/country
    "US": ["american", "us"], "GB": ["british", "uk"], "AU": ["australian"],
    "CA": ["canadian"], "IN": ["indian"], "CN": ["mandarin", "mainland"],
    "HK": ["cantonese", "hongkong"], "TW": ["taiwanese"],
    "MX": ["mexican"], "ES": ["spain"], "AR": ["argentinian"],
    "CO": ["colombian"], "CL": ["chilean"], "PE": ["peruvian"],
    "FR": ["france"], "BE": ["belgian"], "CH": ["swiss"],
    "DE": ["germany"], "AT": ["austrian"],
    "BR": ["brazilian"], "PT": ["portugal"],
    "JP": ["japan"], "KR": ["korean", "korea"],
    "EG": ["egyptian"], "SA": ["saudi"], "AE": ["arab", "emirati"],
    "NG": ["nigerian"], "ZA": ["south african"], "KE": ["kenyan"],
    "PH": ["filipino"], "SG": ["singaporean"], "MY": ["malaysian"],
    "ID": ["indonesian", "indonesia"], "TH": ["thai", "thailand"],
    "VN": ["vietnamese", "vietnam"], "PK": ["pakistani"],
    "RU": ["russian", "russia"], "PL": ["polish", "poland"],
    "UA": ["ukrainian"], "IT": ["italian", "italy"],
    "NL": ["dutch", "netherlands"], "SE": ["swedish"], "NO": ["norwegian"],
    "FI": ["finnish"], "DK": ["danish"],
}

# Keyword → score weight (used to match free-text persona descriptions)
KEYWORD_WEIGHTS: dict[str, int] = {
    # gender
    "female": 10, "woman": 10, "girl": 10, "male": 10, "man": 10, "boy": 10,
    # language/region (high weight so locale matches strongly)
    "english": 8, "chinese": 8, "mandarin": 8, "cantonese": 8,
    "spanish": 8, "french": 8, "german": 8, "japanese": 8, "korean": 8,
    "portuguese": 8, "arabic": 8, "hindi": 8, "italian": 8, "russian": 8,
    "dutch": 8, "polish": 8, "swedish": 8, "turkish": 8, "indonesian": 8,
    "american": 8, "british": 8, "australian": 8, "canadian": 8,
    "indian": 8, "brazilian": 8, "mexican": 8, "spain": 8,
    "hongkong": 7, "taiwanese": 7, "singaporean": 7, "nigerian": 7,
    "south african": 7, "filipino": 7,
    # role/persona
    "scientist": 6, "professor": 6, "expert": 6, "journalist": 6, "reporter": 6,
    "host": 5, "doctor": 5, "dr": 5, "anchor": 5, "presenter": 5,
    # style/tone
    "serious": 4, "professional": 4, "authoritative": 4, "deep": 4,
    "warm": 3, "friendly": 3, "casual": 3, "energetic": 3, "calm": 3,
    "young": 3, "mature": 3, "lively": 3, "cheerful": 3,
    "clear": 2, "neutral": 2, "natural": 2,
}

# Fallback pool used when no scored voice is available
DEFAULT_POOL = [
    "en-US-ChristopherNeural", "en-US-AriaNeural",
    "en-GB-RyanNeural",        "en-GB-SoniaNeural",
    "en-US-EricNeural",        "en-US-NancyNeural",
]


def _derive_tags(short_name: str, gender: str, locale: str) -> list[str]:
    """Build keyword tags from a voice's locale and gender automatically."""
    tags: list[str] = []
    # gender
    tags.append(gender.lower())  # "male" or "female"
    # locale parts, e.g. "en-US" → lang="en", region="US"
    parts = locale.split("-")
    lang = parts[0] if parts else ""
    region = parts[1] if len(parts) > 1 else ""
    tags += _LOCALE_TAGS.get(lang, [lang])
    tags += _LOCALE_TAGS.get(region, [region.lower()] if region else [])
    # deduplicate
    return list(dict.fromkeys(tags))


async def fetch_all_voices() -> None:
    """Fetch all available Edge TTS voices and populate ALL_VOICES."""
    global ALL_VOICES
    try:
        raw = await edge_tts.list_voices()
        ALL_VOICES = [
            {
                "name":          v["ShortName"],
                "friendly_name": v.get("FriendlyName", v["ShortName"]),
                "gender":        v["Gender"],      # "Male" | "Female"
                "locale":        v["Locale"],       # e.g. "en-US"
                "tags":          _derive_tags(v["ShortName"], v["Gender"], v["Locale"]),
            }
            for v in raw
        ]
        print(f"[edge-tts] Loaded {len(ALL_VOICES)} voices from Microsoft.")
    except Exception as e:
        print(f"[edge-tts] Could not fetch dynamic voice list: {e}. Falling back to defaults.")
        # minimal static fallback so the server still works offline
        ALL_VOICES = [
            {"name": n, "friendly_name": n, "gender": g, "locale": n[:5],
             "tags": _derive_tags(n, g, n[:5])}
            for n, g in [
                ("en-US-ChristopherNeural", "Male"),   ("en-US-AriaNeural",  "Female"),
                ("en-GB-RyanNeural",        "Male"),   ("en-GB-SoniaNeural", "Female"),
                ("en-US-EricNeural",        "Male"),   ("en-US-NancyNeural", "Female"),
            ]
        ]


def resolve_edge_voice(
    description: str,
    used_voices: list,
    language: str = "en",
    gender: str = "",
) -> str:
    """
    Resolve the best-matching Edge TTS voice for a participant.

    Steps:
      1. Language filter (hard): keep only voices whose locale starts with `language`.
      2. Gender filter  (hard): if `gender` is "Male" or "Female", keep only those.
         Empty string means no gender constraint.
      3. Score within the filtered pool using KEYWORD_WEIGHTS.
      4. Return the highest-scoring unused voice.
      5. Relax gender → relax language → try any voice, as fallback layers.
    """
    desc_lower = description.lower()
    all_pool = ALL_VOICES if ALL_VOICES else []

    # ── Step 1: language / accent filter ─────────────────────────────────
    # If a full locale is given (e.g. "en-HK", "en-GB", "zh-CN"), match
    # voices of exactly that locale region.
    # If only a base code is given (e.g. "en", "zh"), match all variants.
    lang_lower = language.lower()                      # e.g. "en-hk" or "en"
    lang_code  = lang_lower.split("-")[0]              # "en"
    has_region = "-" in lang_lower                     # True for "en-hk", "en-gb"

    if has_region:
        # Exact locale match first: keep "en-HK-*" when "en-HK" requested
        locale_prefix = lang_lower + "-"               # "en-hk-"
        lang_pool = [v for v in all_pool
                     if v["locale"].lower().startswith(lang_lower)]
        # Fallback: relax to base language if this region has no voices
        if not lang_pool:
            lang_pool = [v for v in all_pool
                         if v["locale"].lower().startswith(lang_code)]
    else:
        # Base language only → all regional variants
        lang_pool = [v for v in all_pool
                     if v["locale"].lower().startswith(lang_code)]

    pool = lang_pool if lang_pool else all_pool

    # ── Step 2: gender filter ─────────────────────────────────────────────
    if gender and gender.lower() in ("male", "female"):
        gender_pool = [v for v in pool if v["gender"].lower() == gender.lower()]
        pool = gender_pool if gender_pool else pool  # relax if no match

    # ── Step 3: score within filtered pool ───────────────────────────────
    def score_voice(v: dict) -> int:
        tag_str = " ".join(v["tags"])
        return sum(
            weight
            for kw, weight in KEYWORD_WEIGHTS.items()
            if kw in desc_lower and kw in tag_str
        )

    scored = sorted(pool, key=lambda v: -score_voice(v))

    # ── Step 4: return best unused voice ─────────────────────────────────
    for v in scored:
        if v["name"] not in used_voices:
            return v["name"]

    # ── Step 5: fallback layers ───────────────────────────────────────────
    # Relax gender constraint, keep language
    for v in sorted(lang_pool or all_pool, key=lambda v: -score_voice(v)):
        if v["name"] not in used_voices:
            return v["name"]
    # Relax everything
    for v in all_pool:
        if v["name"] not in used_voices:
            return v["name"]
    for name in DEFAULT_POOL:
        if name not in used_voices:
            return name
    return DEFAULT_POOL[0]


# ── Models ────────────────────────────────────────────────────────────────────
class ParticipantIn(BaseModel):
    name: str
    role: str
    voiceDescription: str
    language: str = "en"
    gender: str = ""   # "Male" | "Female" | "" (any)
    color: Optional[str] = None
    background: Optional[str] = ""  # Speaker's background/personality


class GenerateRequest(BaseModel):
    topic: str
    turns: int = Field(default=8, ge=2, le=50, description="Number of conversation turns (2-50)")
    tone: str = "casual"
    language: str = "en"
    participants: List[ParticipantIn]
    context: Optional[str] = ""  # Additional context/background about the topic
    targetAudience: Optional[str] = ""  # Target audience description


class VoicePreviewRequest(BaseModel):
    voiceDescription: str
    language: str = "en"
    gender: str = ""   # "Male" | "Female" | "" (any)
    usedVoices: List[str] = []


# ── App Setup ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load all Edge TTS voices from Microsoft at startup
    await fetch_all_voices()
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PPLX_API_KEY = os.environ.get("PPLX_API_KEY", "")

# Serve built React frontend from /static if it exists (Docker mode)
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")


# ── Perplexity: News Search ───────────────────────────────────────────────────
async def search_news(topic: str) -> list:
    """Search latest news via Perplexity Sonar."""
    if not PPLX_API_KEY:
        return []
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={"Authorization": f"Bearer {PPLX_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "sonar",
                    "messages": [{
                        "role": "user",
                        "content": (
                            f"Find the 6 most recent and relevant news stories about: {topic}. "
                            "For each item return a JSON object with keys: title, summary (2 sentences), source, url. "
                            "Respond ONLY with a JSON array, no markdown, no explanation."
                        )
                    }],
                    "search_recency_filter": "week",
                    "return_citations": True,
                },
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            match = re.search(r"\[.*?\]", content, re.DOTALL)
            if match:
                return json.loads(match.group())
        except Exception as e:
            print(f"[search_news] {e}")
    return []


# ── Perplexity: Script Generation ─────────────────────────────────────────────
async def generate_script_with_perplexity(request: GenerateRequest, news_items: list) -> list:
    """
    Use Perplexity API (sonar-pro) to generate the podcast script.
    Returns a list of {speaker, text} dicts.
    """
    if not PPLX_API_KEY:
        raise ValueError("PPLX_API_KEY environment variable is not set.")

    tone_descriptions = {
        "casual":       "conversational and relaxed, like friends talking over coffee",
        "debate":       "argumentative — each participant actively defends their own perspective with evidence",
        "academic":     "scholarly and data-driven, citing sources and using precise technical language",
        "storytelling": "narrative-driven, using human stories and anecdotes to illustrate key points",
        "satirical":    "witty and ironic, using humor and satire to comment on the topic",
    }

    participants_desc = "\n".join(
        f"  - {p.name} ({p.role.upper()}): described as '{p.voiceDescription}', speaks {p.language}" +
        (f"\n    Background: {p.background}" if p.background else "")
        for p in request.participants
    )

    news_section = ""
    if news_items:
        news_section = "\n\nLATEST NEWS TO WEAVE INTO THE CONVERSATION (ground the script in these real facts):\n"
        for i, item in enumerate(news_items, 1):
            src = item.get("source", "")
            title = item.get("title", "")
            summary = item.get("summary", "")
            news_section += f"  {i}. [{src}] {title} — {summary}\n"

    system_prompt = f"""You are an expert podcast scriptwriter. You write authentic, engaging, multi-voice podcast conversations.

STRICT OUTPUT RULE: Respond with ONLY a valid JSON array. No markdown fences, no explanation, no preamble. 
The array must contain exactly {request.turns} objects, each with exactly two string keys: "speaker" and "text".

Example format:
[
  {{"speaker": "Alex", "text": "Welcome to the show. Today we are talking about..."}},
  {{"speaker": "Dr. Rivera", "text": "Thanks for having me. This topic is fascinating because..."}}
]"""

    # Build an explicit list of the EXACT names the AI must use
    allowed_names = [p.name for p in request.participants]
    names_list = ", ".join(f'"{n}"' for n in allowed_names)

    # Build additional context section
    context_section = ""
    if request.context:
        context_section = f"\n\nADDITIONAL CONTEXT/BACKGROUND:\n{request.context}\n"
    if request.targetAudience:
        context_section += f"\nTARGET AUDIENCE: {request.targetAudience}\n"

    user_prompt = f"""Write a {request.turns}-turn podcast script on the topic: "{request.topic}"

TONE: {tone_descriptions.get(request.tone, "conversational")}

PARTICIPANTS (use these EXACT names in the \"speaker\" field — no others):
{participants_desc}

ALLOWED SPEAKER NAMES: {names_list}
{news_section}
{context_section}
RULES:
1. Exactly {request.turns} turns total — one object per speaker turn.
2. The \"speaker\" value MUST be one of: {names_list}. Do NOT invent new names.
3. Distribute turns naturally. The host starts and closes. Guests get roughly equal time.
4. Each turn is 2–4 sentences. Conversational, not monologue.
5. Weave the news facts naturally into the dialogue — never list them robotically.
6. Maintain each speaker's personality consistently throughout.
7. The final turn must be the host wrapping up with a memorable closing thought.
8. Output ONLY the JSON array."""

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": f"Bearer {PPLX_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": "sonar-pro",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
                "temperature": 0.8,
                "max_tokens": 4096,
            },
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()

    # Strip markdown fences if present
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)

    match = re.search(r"\[.*\]", content, re.DOTALL)
    if match:
        script = json.loads(match.group())
        return normalize_speakers(script, [p.name for p in request.participants])
    raise ValueError(f"Could not parse script JSON from Perplexity response:\n{content[:300]}")


def normalize_speakers(script: list, allowed_names: list[str]) -> list:
    """
    Map any AI-invented speaker name back to the closest real participant name.

    Strategy (in order):
      1. Exact match (case-insensitive) → use the canonical casing.
      2. Substring match: if the generated name contains a participant's name or vice versa.
      3. First-seen-order fallback: map the Nth new unknown name to the Nth participant
         in the order they were defined by the user.
    """
    lower_map = {n.lower(): n for n in allowed_names}  # lowercase → canonical
    remap: dict[str, str] = {}          # generated name → canonical name
    seen_order: list[str] = []          # order unique generated names appear

    for turn in script:
        gen = turn.get("speaker", "").strip()
        if not gen:
            continue
        gen_lower = gen.lower()

        if gen_lower in lower_map:
            # 1. Exact match
            remap[gen] = lower_map[gen_lower]
        elif gen not in remap:
            # 2. Substring match
            sub_match = next(
                (canonical for canonical in allowed_names
                 if canonical.lower() in gen_lower or gen_lower in canonical.lower()),
                None,
            )
            if sub_match:
                remap[gen] = sub_match
            else:
                # 3. Order-based fallback
                if gen not in seen_order:
                    seen_order.append(gen)
                idx = seen_order.index(gen)
                remap[gen] = allowed_names[idx % len(allowed_names)]

    # Apply remapping
    for turn in script:
        gen = turn.get("speaker", "").strip()
        if gen in remap:
            turn["speaker"] = remap[gen]

    return script


# ── Edge TTS: Synthesize Per-Turn ─────────────────────────────────────────────
async def synthesize_turn(text: str, voice: str, output_path: str) -> None:
    """Synthesize one script turn to an MP3 file using Edge TTS."""
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)


def get_audio_duration(path: str) -> float:
    """Get audio duration in seconds using tinytag or ffmpeg fallback."""
    if TINYTAG_AVAILABLE:
        try:
            tag = TinyTag.get(path)
            return tag.duration or 0.0
        except Exception:
            pass
    # Fallback: use ffprobe
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, check=True
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


async def synthesize_all_turns(script: list, voice_map: dict) -> tuple[bytes, list]:
    """
    Synthesize every turn in parallel, then merge with ffmpeg into one MP3.
    Returns: (audio_bytes, turn_timestamps)
    turn_timestamps: list of {start: float, end: float} for each turn
    voice_map: {speaker_name -> edge_tts_voice_name}
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        # Synthesize all turns in parallel
        tasks = []
        paths = []
        for i, turn in enumerate(script):
            voice = voice_map.get(turn["speaker"], "en-US-AriaNeural")
            path = os.path.join(tmpdir, f"turn_{i:03d}.mp3")
            paths.append(path)
            tasks.append(synthesize_turn(turn["text"], voice, path))
        
        await asyncio.gather(*tasks)
        
        # Calculate cumulative timestamps for each turn
        turn_timestamps = []
        current_time = 0.0
        for path in paths:
            duration = get_audio_duration(path)
            turn_timestamps.append({
                "start": round(current_time, 3),
                "end": round(current_time + duration, 3)
            })
            current_time += duration
        
        # Write ffmpeg concat list
        list_path = os.path.join(tmpdir, "concat.txt")
        with open(list_path, "w") as f:
            for p in paths:
                f.write(f"file '{p}'\n")
        
        # Merge
        out_path = os.path.join(tmpdir, "episode.mp3")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path,
             "-c:a", "libmp3lame", "-q:a", "2", out_path],
            check=True,
            capture_output=True,
        )
        with open(out_path, "rb") as f:
            return f.read(), turn_timestamps


# ── API Routes ────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    has_key = bool(PPLX_API_KEY)
    is_docker = os.environ.get("RUNNING_IN_DOCKER") == "true"
    return {"status": "ok", "pplx_key_set": has_key, "in_docker": is_docker, "voice_count": len(ALL_VOICES)}


@app.get("/api/voices")
def list_voices(locale: str = "", gender: str = "", search: str = ""):
    """
    Return all available Edge TTS voices.
    Optional query params:
      - locale:  filter by locale prefix, e.g. "en", "en-US", "zh-CN"
      - gender:  "Male" or "Female" (case-insensitive)
      - search:  free-text search across name, locale, tags
    """
    voices = ALL_VOICES
    if locale:
        voices = [v for v in voices if v["locale"].lower().startswith(locale.lower())]
    if gender:
        voices = [v for v in voices if v["gender"].lower() == gender.lower()]
    if search:
        q = search.lower()
        voices = [
            v for v in voices
            if q in v["name"].lower()
            or q in v["locale"].lower()
            or any(q in tag for tag in v["tags"])
        ]
    return {"total": len(voices), "voices": voices}


@app.post("/api/voices/preview")
async def preview_voice(req: VoicePreviewRequest):
    """Generate a short voice preview using Edge TTS."""
    voice = resolve_edge_voice(req.voiceDescription, req.usedVoices, req.language, req.gender)
    sample = "Hello! I'm excited to be part of this podcast. Let's dive into the topic."
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        communicate = edge_tts.Communicate(sample, voice)
        await communicate.save(tmp_path)
        with open(tmp_path, "rb") as f:
            audio_bytes = f.read()
        os.unlink(tmp_path)
        b64 = base64.b64encode(audio_bytes).decode()
        return {"voice": voice, "audio": f"data:audio/mpeg;base64,{b64}"}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@app.post("/api/voices/resolve")
async def resolve_voices_endpoint(request: GenerateRequest):
    """Resolve voice descriptions for all participants."""
    used: list = []
    result = []
    for p in request.participants:
        voice = resolve_edge_voice(p.voiceDescription, used, p.language, p.gender)
        used.append(voice)
        result.append({"name": p.name, "voice": voice})
    return {"voices": result}


# Persistent storage directory for podcasts
PODCASTS_DIR = Path(__file__).parent / "podcasts"
PODCASTS_DIR.mkdir(exist_ok=True)


def sanitize_filename(name: str) -> str:
    """Sanitize string to be safe for filename."""
    # Remove or replace invalid characters
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    # Replace spaces with underscores
    name = name.replace(' ', '_')
    # Limit length
    return name[:50]


@app.post("/api/generate")
async def generate_episode(request: GenerateRequest):
    """Main pipeline: search → script → TTS → merge."""
    try:
        # 1. Resolve voices
        used_voices: list = []
        voice_map: dict = {}
        resolved_participants = []
        for p in request.participants:
            voice = resolve_edge_voice(p.voiceDescription, used_voices, p.language, p.gender)
            used_voices.append(voice)
            voice_map[p.name] = voice
            resolved_participants.append({
                "name": p.name,
                "role": p.role,
                "voiceDescription": p.voiceDescription,
                "resolvedVoice": voice,
                "language": p.language,
                "color": p.color,
            })

        # 2. Search news
        news_items = await search_news(request.topic)

        # 3. Generate script with Perplexity
        script = await generate_script_with_perplexity(request, news_items)

        # 4. Synthesize with Edge TTS and merge
        audio_bytes, turn_timestamps = await synthesize_all_turns(script, voice_map)
        audio_b64 = base64.b64encode(audio_bytes).decode()

        # 5. Save to persistent storage (podcasts/)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_topic = sanitize_filename(request.topic)
        filename = f"{safe_topic}_{timestamp}.mp3"
        file_path = PODCASTS_DIR / filename
        
        with open(file_path, "wb") as f:
            f.write(audio_bytes)

        return {
            "status": "done",
            "topic": request.topic,
            "participants": resolved_participants,
            "newsItems": news_items,
            "script": script,
            "turnTimestamps": turn_timestamps,
            "audio": f"data:audio/mpeg;base64,{audio_b64}",
            "savedFile": filename,
            "savedPath": str(file_path),
        }

    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(status_code=400, content={"status": "error", "error": str(e)})


# SPA Catch-all must be defined AFTER all API routes
if STATIC_DIR.exists():
    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str = ""):
        # All non-API routes serve index.html (SPA)
        index = STATIC_DIR / "index.html"
        return FileResponse(str(index))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
