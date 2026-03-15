import { pgTable, text, integer, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Participant (host or guest) ──────────────────────────────────────────────
export const participantSchema = z.object({
  name: z.string().min(1),
  role: z.enum(["host", "guest"]),
  voiceDescription: z.string().min(1), // e.g. "serious female English scientist"
  resolvedVoice: z.string().optional(),  // resolved TTS voice name
  language: z.string().default("en"),   // ISO code e.g. "en", "zh", "es"
  color: z.string().optional(),          // hex color for UI display
});

export type Participant = z.infer<typeof participantSchema>;

// ── Script Turn ──────────────────────────────────────────────────────────────
export const scriptTurnSchema = z.object({
  speaker: z.string(),
  text: z.string(),
  audioOffset: z.number().optional(), // seconds in merged audio
  audioDuration: z.number().optional(),
});

export type ScriptTurn = z.infer<typeof scriptTurnSchema>;

// ── News Item ────────────────────────────────────────────────────────────────
export const newsItemSchema = z.object({
  title: z.string(),
  summary: z.string(),
  url: z.string().optional(),
  source: z.string().optional(),
});

export type NewsItem = z.infer<typeof newsItemSchema>;

// ── Episode Request (what the user submits) ──────────────────────────────────
export const episodeRequestSchema = z.object({
  topic: z.string().min(3),
  turns: z.number().int().min(2).max(30).default(8),
  tone: z.enum(["casual", "debate", "academic", "storytelling", "satirical"]).default("casual"),
  language: z.string().default("en"),
  participants: z.array(participantSchema).min(2).max(4), // host + 1-3 guests
});

export type EpisodeRequest = z.infer<typeof episodeRequestSchema>;

// ── Episode (stored result) ──────────────────────────────────────────────────
export const episodesTable = pgTable("episodes", {
  id: serial("id").primaryKey(),
  topic: text("topic").notNull(),
  turns: integer("turns").notNull(),
  tone: text("tone").notNull(),
  language: text("language").notNull(),
  participants: jsonb("participants").notNull(),
  newsItems: jsonb("news_items"),
  script: jsonb("script"),
  audioBase64: text("audio_base64"),
  status: text("status").notNull().default("pending"), // pending | generating | done | error
  errorMessage: text("error_message"),
  createdAt: text("created_at"),
});

export const insertEpisodeSchema = createInsertSchema(episodesTable).omit({ id: true });
export type InsertEpisode = z.infer<typeof insertEpisodeSchema>;
export type Episode = typeof episodesTable.$inferSelect;
