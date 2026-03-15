import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import PerplexityAttribution from "@/components/PerplexityAttribution";
import { Mic, Plus, Trash2, Play, Pause, Download, SkipBack, SkipForward, Volume2, VolumeX, Loader2, ChevronRight, ExternalLink, RefreshCw, Radio, Headphones } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Participant {
  id: string;
  name: string;
  role: "host" | "guest";
  voiceDescription: string;
  language: string;
  gender: "Male" | "Female" | "";
  color: string;
  resolvedVoice?: string;
  background?: string;  // Speaker's background/personality
}

interface ReferenceFile {
  name: string;
  content: string;
  type: "text" | "pdf" | "url";
}

interface ScriptTurn {
  speaker: string;
  text: string;
}

interface NewsItem {
  title: string;
  summary: string;
  url?: string;
  source?: string;
}

interface TurnTimestamp {
  start: number;
  end: number;
}

interface EpisodeResult {
  topic: string;
  participants: Participant[];
  newsItems: NewsItem[];
  script: ScriptTurn[];
  audio: string; // data URI
  turnTimestamps?: TurnTimestamp[];
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SPEAKER_COLORS = [
  "#7c3aed", // violet — host
  "#0ea5e9", // sky — guest 1
  "#f59e0b", // amber — guest 2
  "#10b981", // emerald — guest 3
];

const TONE_OPTIONS = [
  { value: "casual", label: "Casual", desc: "Relaxed, friendly conversation" },
  { value: "debate", label: "Debate", desc: "Argumentative, defending perspectives" },
  { value: "academic", label: "Academic", desc: "Scholarly, data-driven, cite sources" },
  { value: "storytelling", label: "Storytelling", desc: "Narrative-driven, anecdotes" },
  { value: "satirical", label: "Satirical", desc: "Witty, ironic commentary" },
];

// Each option: value = locale code sent to backend, label = display name
// group = optional section header label (renders as a disabled separator)
const LANGUAGE_OPTIONS: { value: string; label: string; group?: string }[] = [
  // ── English accents ──────────────────────────────────────────────────────
  { value: "en",    label: "English · Any accent",            group: "English" },
  { value: "en-US", label: "English · American 🇺🇸" },
  { value: "en-GB", label: "English · British 🇬🇧" },
  { value: "en-AU", label: "English · Australian 🇦🇺" },
  { value: "en-CA", label: "English · Canadian 🇨🇦" },
  { value: "en-IN", label: "English · Indian 🇮🇳" },
  { value: "en-HK", label: "English · Hong Kong 🇭🇰 (Chinese accent)" },
  { value: "en-SG", label: "English · Singaporean 🇸🇬" },
  { value: "en-PH", label: "English · Filipino 🇵🇭" },
  { value: "en-NZ", label: "English · New Zealand 🇳🇿" },
  { value: "en-NG", label: "English · Nigerian 🇳🇬" },
  // ── Chinese ──────────────────────────────────────────────────────────────
  { value: "zh",    label: "Chinese · Any",                   group: "Chinese" },
  { value: "zh-CN", label: "Chinese · Mandarin (Mainland) 🇨🇳" },
  { value: "zh-HK", label: "Chinese · Cantonese (HK) 🇭🇰" },
  { value: "zh-TW", label: "Chinese · Taiwanese 🇹🇼" },
  // ── Spanish ──────────────────────────────────────────────────────────────
  { value: "es",    label: "Spanish · Any",                   group: "Spanish" },
  { value: "es-ES", label: "Spanish · Spain 🇪🇸" },
  { value: "es-MX", label: "Spanish · Mexican 🇲🇽" },
  { value: "es-AR", label: "Spanish · Argentinian 🇦🇷" },
  // ── Other languages ──────────────────────────────────────────────────────
  { value: "fr",    label: "French 🇫🇷",                        group: "Other" },
  { value: "de",    label: "German 🇩🇪" },
  { value: "ja",    label: "Japanese 🇯🇵" },
  { value: "ko",    label: "Korean 🇰🇷" },
  { value: "pt",    label: "Portuguese · Any" },
  { value: "pt-BR", label: "Portuguese · Brazilian 🇧🇷" },
  { value: "ar",    label: "Arabic 🇸🇦" },
  { value: "hi",    label: "Hindi 🇮🇳" },
  { value: "it",    label: "Italian 🇮🇹" },
  { value: "ru",    label: "Russian 🇷🇺" },
  { value: "nl",    label: "Dutch 🇳🇱" },
  { value: "sv",    label: "Swedish 🇸🇪" },
  { value: "tr",    label: "Turkish 🇹🇷" },
  { value: "id",    label: "Indonesian 🇮🇩" },
];

// In Docker: frontend + backend are served from the same origin (port 8000)
// In dev: backend runs on localhost:8000
// After deploy: __PORT_8000__ is replaced by the proxy path
const API = "__PORT_8000__".startsWith("__")
  ? "http://localhost:8000"
  : "__PORT_8000__";

function generateId() {
  return Math.random().toString(36).slice(2);
}

// ── WaveformIcon ──────────────────────────────────────────────────────────────
function WaveformIcon({ playing, color }: { playing: boolean; color?: string }) {
  return (
    <div className="flex items-end gap-0.5 h-4" data-testid="waveform-icon">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-0.5 rounded-full ${playing ? "wave-bar" : ""}`}
          style={{ 
            height: `${[8, 14, 10, 16, 8][i - 1]}px`, 
            opacity: playing ? 1 : 0.4,
            backgroundColor: color || "hsl(255 75% 65%)"
          }}
        />
      ))}
    </div>
  );
}

// ── ParticipantCard ───────────────────────────────────────────────────────────
function ParticipantCard({
  participant,
  index,
  onUpdate,
  onRemove,
  canRemove,
}: {
  participant: Participant;
  index: number;
  onUpdate: (id: string, updates: Partial<Participant>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  const handlePreview = async () => {
    if (previewing) {
      previewAudio?.pause();
      setPreviewing(false);
      return;
    }
    try {
      setPreviewing(true);
      const res = await fetch(`${API}/api/voices/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceDescription: participant.voiceDescription,
          language: participant.language,
          gender: participant.gender,
          usedVoices: [],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const audio = new Audio(data.audio);
      setPreviewAudio(audio);
      audio.play();
      audio.onended = () => setPreviewing(false);
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
      setPreviewing(false);
    }
  };

  return (
    <div
      className="rounded-xl border p-4 space-y-3 transition-all"
      style={{ 
        borderColor: participant.color + "44", 
        background: participant.color + "0a",
        ['--participant-color' as string]: participant.color 
      }}
      data-testid={`participant-card-${index}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ background: participant.color }} />
          <Badge variant="outline" className="text-xs capitalize" style={{ borderColor: participant.color + "88", color: participant.color }}>
            {participant.role}
          </Badge>
        </div>
        {canRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(participant.id)}
            data-testid={`remove-participant-${index}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Row 1: Name + Language */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Name</label>
          <Input
            value={participant.name}
            onChange={(e) => onUpdate(participant.id, { name: e.target.value })}
            placeholder={participant.role === "host" ? "Host name" : `Guest ${index} name`}
            className="h-8 text-sm participant-input"
            data-testid={`participant-name-${index}`}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Language</label>
          <Select
            value={participant.language}
            onValueChange={(v) => onUpdate(participant.id, { language: v })}
          >
            <SelectTrigger 
              className="h-8 text-sm participant-select-trigger" 
              data-testid={`participant-lang-${index}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {/* Pre-group options by their 'group' marker, then render */}
              {(() => {
                const groups: { label: string; items: typeof LANGUAGE_OPTIONS }[] = [];
                for (const l of LANGUAGE_OPTIONS) {
                  if (l.group) groups.push({ label: l.group, items: [l] });
                  else groups[groups.length - 1]?.items.push(l);
                }
                return groups.map((g) => (
                  <SelectGroup key={g.label}>
                    <SelectLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 px-2 pt-2 pb-0.5">
                      {g.label}
                    </SelectLabel>
                    {g.items.map((l) => (
                      <SelectItem 
                        key={l.value} 
                        value={l.value}
                        className="participant-select-item"
                        style={{ ['--participant-color' as string]: participant.color }}
                      >
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ));
              })()}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 2: Gender */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Gender</label>
        <div className="flex gap-1.5">
          {(["Female", "Male", ""] as const).map((g) => {
            const isSelected = participant.gender === g;
            return (
              <button
                key={g || "any"}
                type="button"
                onClick={() => onUpdate(participant.id, { gender: g })}
                data-testid={`participant-gender-${g || "any"}-${index}`}
                className="flex-1 h-8 rounded-md text-xs font-medium border transition-colors"
                style={{
                  borderColor: isSelected ? participant.color : undefined,
                  backgroundColor: isSelected ? participant.color + "20" : undefined,
                  color: isSelected ? participant.color : undefined,
                }}
              >
                {g === "Female" ? "♀ Female" : g === "Male" ? "♂ Male" : "⊕ Any"}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Voice Description</label>
        <div className="flex gap-2">
          <Input
            value={participant.voiceDescription}
            onChange={(e) => onUpdate(participant.id, { voiceDescription: e.target.value })}
            placeholder="e.g. serious female scientist, warm British male host…"
            className="h-8 text-sm flex-1 participant-input"
            data-testid={`participant-voice-${index}`}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 shrink-0"
            onClick={handlePreview}
            disabled={!participant.voiceDescription}
            data-testid={`preview-voice-${index}`}
            title="Preview voice"
          >
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Headphones className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {participant.resolvedVoice && (
        <p className="text-xs text-muted-foreground">
          Voice: <span style={{ color: participant.color }}>{participant.resolvedVoice}</span>
        </p>
      )}

      {/* Speaker Background */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Background & Personality (optional)</label>
        <textarea
          value={participant.background || ""}
          onChange={(e) => onUpdate(participant.id, { background: e.target.value })}
          placeholder="e.g. Professor of Physics at MIT, loves using analogies, slightly sarcastic humor..."
          className="w-full h-16 px-3 py-2 text-xs rounded-md bg-background resize-none participant-textarea"
        />
      </div>
    </div>
  );
}

// ── AudioPlayer ───────────────────────────────────────────────────────────────
const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function AudioPlayer({
  audioSrc,
  script,
  participants,
  turnTimestamps,
  onActiveTurn,
}: {
  audioSrc: string;
  script: ScriptTurn[];
  participants: Participant[];
  turnTimestamps?: TurnTimestamp[];
  onActiveTurn: (index: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying]       = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]     = useState(0);
  const [volume, setVolume]         = useState(1);       // 0–1
  const [speed, setSpeed]           = useState(1);       // playback rate
  const [muted, setMuted]           = useState(false);

  // Build color + name maps from participants
  const colorMap = participants.reduce((acc, p) => {
    acc[p.name] = p.color;
    return acc;
  }, {} as Record<string, string>);

  // ── Determine active turn using actual timestamps ──────────────────────────
  const activeTurnIndex = (() => {
    if (turnTimestamps && turnTimestamps.length > 0) {
      // Use actual audio timestamps for perfect sync
      const idx = turnTimestamps.findIndex(
        t => currentTime >= t.start && currentTime < t.end
      );
      return idx >= 0 ? idx : turnTimestamps.length - 1;
    }
    // Fallback: estimate based on equal division
    if (duration > 0 && script.length > 0) {
      return Math.min(
        Math.floor((currentTime / duration) * script.length),
        script.length - 1
      );
    }
    return 0;
  })();

  const activeSpeaker = script[activeTurnIndex]?.speaker ?? "";
  const activeDot     = colorMap[activeSpeaker] ?? "hsl(255 80% 65%)";

  // Notify parent whenever active turn changes
  useEffect(() => {
    onActiveTurn(activeTurnIndex);
  }, [activeTurnIndex]);

  // ── Audio event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate      = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata  = () => setDuration(audio.duration);
    const onPlay            = () => setPlaying(true);
    const onPause           = () => setPlaying(false);
    const onEnded           = () => setPlaying(false);
    audio.addEventListener("timeupdate",     onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("play",           onPlay);
    audio.addEventListener("pause",          onPause);
    audio.addEventListener("ended",          onEnded);
    return () => {
      audio.removeEventListener("timeupdate",     onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("play",           onPlay);
      audio.removeEventListener("pause",          onPause);
      audio.removeEventListener("ended",          onEnded);
    };
  }, []);

  // ── Controls ──────────────────────────────────────────────────────────────
  const togglePlay = () => {
    if (!audioRef.current) return;
    playing ? audioRef.current.pause() : audioRef.current.play();
  };

  const seek = (pct: number) => {
    if (!audioRef.current || !duration) return;
    audioRef.current.currentTime = (pct / 100) * duration;
  };

  const skip = (secs: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + secs));
  };

  const changeVolume = (val: number) => {
    const v = Math.max(0, Math.min(1, val));
    setVolume(v);
    setMuted(v === 0);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const toggleMute = () => {
    const newMuted = !muted;
    setMuted(newMuted);
    if (audioRef.current) audioRef.current.volume = newMuted ? 0 : volume;
  };

  const cycleSpeed = () => {
    const idx = SPEED_STEPS.indexOf(speed);
    const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = audioSrc;
    a.download = "podcast-episode.mp3";
    a.click();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;
  const volPct   = muted ? 0 : Math.round(volume * 100);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="audio-player">
      <audio ref={audioRef} src={audioSrc} preload="metadata" />

      {/* Progress bar */}
      <div className="space-y-2">
        <Slider
          min={0}
          max={100}
          step={0.1}
          value={[progress]}
          onValueChange={([v]) => seek(v)}
          className="w-full"
          data-testid="audio-seek"
          rangeColor={activeDot}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono font-bold uppercase tracking-wider">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* Left: skip + play */}
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => skip(-10)} data-testid="skip-back" title="-10s">
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="default" size="icon"
            className="h-12 w-12 rounded-full transition-all duration-300 transform active:scale-90"
            style={{ 
              background: activeDot, 
              boxShadow: playing ? `0 0 24px ${activeDot}aa` : `0 4px 12px ${activeDot}44` 
            }}
            onClick={togglePlay}
            data-testid="play-pause"
          >
            {playing ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 ml-1 fill-white" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => skip(10)} data-testid="skip-forward" title="+10s">
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: speaker dot, speed, volume, download */}
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 justify-end">

          {/* Active speaker dot + name */}
          <div className="flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-full bg-secondary/40 border border-border/50 shrink-0">
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-500 ${playing ? "animate-pulse" : ""}`}
              style={{
                background: activeDot,
                boxShadow: playing ? `0 0 12px ${activeDot}` : undefined,
              }}
            />
            <span
              className="text-xs font-bold truncate max-w-[60px] sm:max-w-[80px] transition-colors duration-500"
              style={{ color: activeDot }}
            >
              {activeSpeaker}
            </span>
          </div>

          {/* Speed button — cycles through presets */}
          <button
            onClick={cycleSpeed}
            data-testid="speed-control"
            title="Playback speed"
            className="text-[10px] font-bold font-mono px-2 py-1 rounded-md border border-border
              text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all min-w-[36px] bg-secondary/30 shrink-0"
          >
            {speed}×
          </button>

          {/* Volume: mute toggle + slider + % label */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={toggleMute}
              title={muted ? "Unmute" : "Mute"}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              data-testid="mute-toggle"
            >
              {muted || volPct === 0
                ? <VolumeX className="h-4 w-4" />
                : <Volume2 className="h-4 w-4" />}
            </button>
            <div className="w-12 sm:w-16">
              <Slider
                min={0}
                max={100}
                step={1}
                value={[volPct]}
                onValueChange={([v]) => changeVolume(v / 100)}
                className="cursor-pointer"
                data-testid="volume-slider"
                rangeColor={activeDot}
              />
            </div>
            <span className="text-[10px] text-muted-foreground w-6 text-right tabular-nums font-mono font-bold shrink-0">
              {volPct}%
            </span>
          </div>

          {/* Download — always visible */}
          <Button variant="ghost" size="icon" className="h-8 w-8 ml-1 shrink-0" onClick={handleDownload}
            data-testid="download-audio" title="Download MP3">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── ScriptViewer ──────────────────────────────────────────────────────────────
function ScriptViewer({
  script,
  participants,
  newsItems,
  activeTurnIndex,
}: {
  script: ScriptTurn[];
  participants: Participant[];
  newsItems: NewsItem[];
  activeTurnIndex: number;
}) {
  const colorMap = participants.reduce((acc, p) => {
    acc[p.name] = p.color;
    return acc;
  }, {} as Record<string, string>);

  // Refs for each turn card and for the scroll viewport
  const turnRefs     = useRef<(HTMLDivElement | null)[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = turnRefs.current[activeTurnIndex];
    // Radix ScrollArea renders a hidden inner viewport with this data attribute
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (!el || !viewport) return;

    const elTop    = el.offsetTop;
    const elHeight = el.offsetHeight;
    const vpHeight = (viewport as HTMLElement).clientHeight;

    viewport.scrollTo({
      top: elTop - vpHeight / 2 + elHeight / 2,
      behavior: "smooth",
    });
  }, [activeTurnIndex]);

  const handleDownloadScript = () => {
    const lines = script.map((t) => `[${t.speaker}]\n${t.text}`).join("\n\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "podcast-script.txt";
    a.click();
  };

  return (
    <div className="space-y-3" data-testid="script-viewer">
      {newsItems.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            News Sources Used
          </h3>
          <div className="space-y-1.5">
            {newsItems.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground shrink-0 mt-0.5">{i + 1}.</span>
                <div>
                  <span className="text-foreground font-medium">{item.title}</span>
                  {item.source && <span className="text-muted-foreground"> · {item.source}</span>}
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 ml-1 text-primary hover:underline">
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{script.length} Turns</h3>
        <Button variant="outline" size="sm" onClick={handleDownloadScript}
          data-testid="download-script" className="h-7 text-xs gap-1">
          <Download className="h-3 w-3" />
          Script
        </Button>
      </div>

      <ScrollArea className="h-[420px] pr-2" ref={scrollAreaRef}>
        <div className="space-y-3 pb-20">
          {script.map((turn, i) => {
            const color       = colorMap[turn.speaker] || "#7c3aed";
            const participant = participants.find((p) => p.name === turn.speaker);
            const isActive    = i === activeTurnIndex;
            return (
              <div
                key={i}
                ref={(el) => { turnRefs.current[i] = el; }}
                className="rounded-lg p-4 transition-all duration-500"
                style={{
                  background:  isActive ? color + "22" : color + "0a",
                  borderLeft:  `4px solid ${color}`,
                  boxShadow:   isActive ? `0 0 0 2px ${color}, 0 8px 24px ${color}33` : undefined,
                  opacity:     isActive ? 1 : 0.4,
                  transform:   isActive ? "scale(1.01)" : "scale(1)",
                }}
                data-testid={`script-turn-${i}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div
                    className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-500 ${isActive ? "animate-pulse" : ""}`}
                    style={{
                      background: color,
                      boxShadow: isActive ? `0 0 8px ${color}` : undefined,
                    }}
                  />
                  <span className="text-xs font-bold" style={{ color }}>
                    {turn.speaker}
                  </span>
                  {participant && (
                    <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider h-4 px-1"
                      style={{ borderColor: color + "55", color }}>
                      {participant.role}
                    </Badge>
                  )}
                  {isActive && (
                    <span className="text-[10px] ml-1 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter"
                      style={{ background: color + "33", color }}>
                      ▶ now
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto font-mono">#{i + 1}</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed transition-colors duration-500"
                   style={{ opacity: isActive ? 1 : 0.8 }}>
                  {turn.text}
                </p>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StudioPage() {
  const { toast } = useToast();
  const [topic, setTopic] = useState("");
  const [topicContext, setTopicContext] = useState("");  // Additional context about the topic
  const [targetAudience, setTargetAudience] = useState("");  // Target audience description
  const [referenceContent, setReferenceContent] = useState("");  // Pasted reference material
  const [turns, setTurns] = useState(8);
  const [tone, setTone] = useState("casual");
  const [participants, setParticipants] = useState<Participant[]>([
    { id: generateId(), name: "Alex",       role: "host",  voiceDescription: "warm authoritative host",    language: "en", gender: "Male",   color: SPEAKER_COLORS[0] },
    { id: generateId(), name: "Dr. Rivera", role: "guest", voiceDescription: "serious scientist expert",    language: "en", gender: "Female", color: SPEAKER_COLORS[1] },
  ]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<EpisodeResult | null>(null);
  const [step, setStep] = useState<"setup" | "result">("setup");
  const [envLabel, setEnvLabel] = useState<string | null>(null);
  const [activeTurnIndex, setActiveTurnIndex] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);  // Toggle advanced options

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then((res) => res.json())
      .then((data) => {
        setEnvLabel(data.in_docker ? "Docker" : "Local");
      })
      .catch((e) => {
        console.error("Failed to check environment:", e);
        setEnvLabel("Unknown Env");
      });
  }, []);

  const addGuest = () => {
    if (participants.length >= 4) return;
    const guestIndex = participants.filter((p) => p.role === "guest").length + 1;
    setParticipants((prev) => [
      ...prev,
      {
        id: generateId(),
        name: `Guest ${guestIndex}`,
        role: "guest",
        voiceDescription: "casual energetic journalist",
        language: "en",
        gender: "",
        color: SPEAKER_COLORS[prev.length] || SPEAKER_COLORS[3],
      },
    ]);
  };

  const removeParticipant = (id: string) => {
    setParticipants((prev) => prev.filter((p) => p.id !== id));
  };

  const updateParticipant = (id: string, updates: Partial<Participant>) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast({ title: "Topic required", description: "Please enter a topic for your podcast.", variant: "destructive" });
      return;
    }
    if (participants.some((p) => !p.name.trim() || !p.voiceDescription.trim())) {
      toast({ title: "Incomplete participants", description: "All participants need a name and voice description.", variant: "destructive" });
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          turns,
          tone,
          language: "en",
          context: [topicContext, referenceContent].filter(Boolean).join("\n\n---\n\n"),
          targetAudience: targetAudience || undefined,
          participants: participants.map((p) => ({
            name: p.name,
            role: p.role,
            voiceDescription: p.voiceDescription,
            language: p.language,
            gender: p.gender,
            color: p.color,
            background: p.background,
          })),
        }),
      });

      const data = await res.json();
      if (data.status === "error" || data.error) {
        throw new Error(data.error || "Generation failed");
      }

      // Merge resolved voices back into participant state
      const resolvedMap: Record<string, string> = {};
      (data.participants || []).forEach((rp: any) => {
        resolvedMap[rp.name] = rp.resolvedVoice;
      });
      setParticipants((prev) =>
        prev.map((p) => ({ ...p, resolvedVoice: resolvedMap[p.name] || p.resolvedVoice }))
      );

      setResult({
        topic: data.topic,
        participants: data.participants.map((rp: any, i: number) => ({
          ...rp,
          color: participants.find((p) => p.name === rp.name)?.color || SPEAKER_COLORS[i],
        })),
        newsItems: data.newsItems || [],
        script: data.script,
        audio: data.audio,
        turnTimestamps: data.turnTimestamps,
      });
      setStep("result");
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const selectedTone = TONE_OPTIONS.find((t) => t.value === tone);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* SVG Logo — Microphone */}
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="Podcast Studio" className="shrink-0">
              <rect width="32" height="32" rx="8" fill="hsl(255 75% 65% / 0.12)" />
              {/* Mic body */}
              <rect x="13" y="6" width="6" height="12" rx="3" stroke="hsl(255 75% 65%)" strokeWidth="1.5" fill="none" />
              {/* Mic mesh dots */}
              <circle cx="16" cy="9" r="0.8" fill="hsl(255 75% 65% / 0.6)" />
              <circle cx="14.5" cy="11" r="0.8" fill="hsl(255 75% 65% / 0.6)" />
              <circle cx="17.5" cy="11" r="0.8" fill="hsl(255 75% 65% / 0.6)" />
              <circle cx="16" cy="13" r="0.8" fill="hsl(255 75% 65% / 0.6)" />
              {/* Mic stand (U-shape) */}
              <path d="M9 16c0 3.866 3.134 7 7 7s7-3.134 7-7" stroke="hsl(255 75% 65%)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              {/* Mic stem */}
              <line x1="16" y1="23" x2="16" y2="26" stroke="hsl(255 75% 65%)" strokeWidth="1.5" strokeLinecap="round" />
              {/* Mic base */}
              <line x1="12" y1="26" x2="20" y2="26" stroke="hsl(255 75% 65%)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div className="flex items-center gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-bold text-foreground leading-none">Podcast Studio</h1>
                  {envLabel && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground border-border/60 cursor-default">
                      {envLabel}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-none mt-1">AI-powered episodes</p>
              </div>
            </div>
          </div>
          {result && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep(step === "setup" ? "result" : "setup")}
              className="text-xs gap-1.5"
              data-testid="toggle-view"
            >
              {step === "setup" ? (
                <><Headphones className="h-3.5 w-3.5" /> View Episode</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5" /> New Episode</>
              )}
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {step === "setup" ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left: Config */}
            <div className="lg:col-span-3 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-foreground mb-1">Episode Setup</h2>
                <p className="text-sm text-muted-foreground">Configure your podcast, then hit Generate.</p>
              </div>

              {/* Topic */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Topic</label>
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. The future of AI regulation in 2026"
                  className="h-10"
                  data-testid="topic-input"
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                />
                <p className="text-xs text-muted-foreground">Latest news will be searched automatically to ground the script.</p>
              </div>

              {/* Advanced Options Toggle */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <span className={`transform transition-transform ${showAdvanced ? "rotate-90" : ""}`}>▶</span>
                  Advanced Options
                  {(topicContext || targetAudience || referenceContent) && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">configured</Badge>
                  )}
                </button>

                {showAdvanced && (
                  <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
                    {/* Topic Context */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground flex items-center gap-2">
                        Additional Context
                        <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                      </label>
                      <textarea
                        value={topicContext}
                        onChange={(e) => setTopicContext(e.target.value)}
                        placeholder="Add background information, specific angles you want covered, or anything else the AI should know about this topic..."
                        className="w-full h-20 px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>

                    {/* Target Audience */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground flex items-center gap-2">
                        Target Audience
                        <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                      </label>
                      <Input
                        value={targetAudience}
                        onChange={(e) => setTargetAudience(e.target.value)}
                        placeholder="e.g. tech professionals, general public, students..."
                        className="h-9 text-sm"
                      />
                    </div>

                    {/* Reference Content */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground flex items-center gap-2">
                        Reference Material
                        <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                      </label>
                      <textarea
                        value={referenceContent}
                        onChange={(e) => setReferenceContent(e.target.value)}
                        placeholder="Paste text content, notes, or any reference material you want the AI to consider when writing the script..."
                        className="w-full h-24 px-3 py-2 text-xs rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Tip: You can paste article text, research notes, or any content you want referenced in the episode.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Turns + Tone */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Conversation Turns <span className="text-primary font-bold">{turns}</span>
                  </label>
                  <Slider
                    min={2}
                    max={50}
                    step={1}
                    value={[turns]}
                    onValueChange={([v]) => setTurns(v)}
                    className="mt-1"
                    data-testid="turns-slider"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>2</span><span>Short ~5min</span><span>50</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Tone</label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger data-testid="tone-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONE_OPTIONS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          <span className="font-medium">{t.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTone && (
                    <p className="text-xs text-muted-foreground">{selectedTone.desc}</p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Generate button */}
              <Button
                size="lg"
                className="w-full gap-2 generating-pulse"
                onClick={handleGenerate}
                disabled={generating || !topic.trim()}
                data-testid="generate-button"
              >
                {generating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Generating Episode…</>
                ) : (
                  <><Mic className="h-4 w-4" /> Generate Podcast<ChevronRight className="h-4 w-4 ml-auto" /></>
                )}
              </Button>

              {generating && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground space-y-1">
                  <p className="text-primary font-medium">Generating your episode…</p>
                  <p>1. Searching latest news on your topic</p>
                  <p>2. Writing the {turns}-turn script with AI</p>
                  <p>3. Synthesizing voices with Edge TTS (free, no API key)</p>
                  <p className="text-muted-foreground">This may take {Math.max(15, turns * 2)}–{Math.max(30, turns * 3)} seconds.</p>
                </div>
              )}
            </div>

            {/* Right: Participants */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Participants</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{participants.length}/4 (1 host + up to 3 guests)</p>
                </div>
                {participants.length < 4 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addGuest}
                    className="h-7 text-xs gap-1"
                    data-testid="add-guest"
                  >
                    <Plus className="h-3 w-3" /> Add Guest
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                {participants.map((p, i) => (
                  <ParticipantCard
                    key={p.id}
                    participant={p}
                    index={i}
                    onUpdate={updateParticipant}
                    onRemove={removeParticipant}
                    canRemove={p.role === "guest" && participants.filter((x) => x.role === "guest").length > 1}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          result && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left: Player + Info */}
              <div className="lg:col-span-2 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-0.5">{result.topic}</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    {result.participants.map((p) => (
                      <Badge
                        key={p.name}
                        variant="outline"
                        className="text-xs gap-1"
                        style={{ borderColor: p.color + "66", color: p.color }}
                      >
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
                        {p.name}
                      </Badge>
                    ))}
                  </div>
                </div>

                <AudioPlayer
                  audioSrc={result.audio}
                  script={result.script}
                  participants={result.participants}
                  turnTimestamps={result.turnTimestamps}
                  onActiveTurn={setActiveTurnIndex}
                />

                <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Cast</h3>
                  {result.participants.map((p) => (
                    <div key={p.name} className="flex items-center gap-2 text-sm">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className="text-xs text-muted-foreground capitalize ml-auto">{p.role}</span>
                      {p.resolvedVoice && (
                        <span className="text-xs" style={{ color: p.color }}>{p.resolvedVoice}</span>
                      )}
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  className="w-full gap-2 text-sm"
                  onClick={() => { setResult(null); setStep("setup"); }}
                  data-testid="new-episode"
                >
                  <Plus className="h-4 w-4" /> New Episode
                </Button>
              </div>

              {/* Right: Script */}
              <div className="lg:col-span-3">
                <ScriptViewer
                  script={result.script}
                  participants={result.participants}
                  newsItems={result.newsItems}
                  activeTurnIndex={activeTurnIndex}
                />
              </div>
            </div>
          )
        )}
      </main>

      <PerplexityAttribution />
    </div>
  );
}
