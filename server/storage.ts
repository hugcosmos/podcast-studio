import { Episode, InsertEpisode } from "@shared/schema";

export interface IStorage {
  createEpisode(data: InsertEpisode): Promise<Episode>;
  getEpisode(id: number): Promise<Episode | undefined>;
  updateEpisode(id: number, data: Partial<Episode>): Promise<Episode>;
  listEpisodes(): Promise<Episode[]>;
  deleteEpisode(id: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private episodes: Map<number, Episode> = new Map();
  private counter = 1;

  async createEpisode(data: InsertEpisode): Promise<Episode> {
    const id = this.counter++;
    const ep: Episode = {
      id,
      topic: data.topic,
      turns: data.turns,
      tone: data.tone,
      language: data.language ?? "en",
      participants: data.participants,
      newsItems: data.newsItems ?? null,
      script: data.script ?? null,
      audioBase64: data.audioBase64 ?? null,
      status: data.status ?? "pending",
      errorMessage: data.errorMessage ?? null,
      createdAt: new Date().toISOString(),
    };
    this.episodes.set(id, ep);
    return ep;
  }

  async getEpisode(id: number): Promise<Episode | undefined> {
    return this.episodes.get(id);
  }

  async updateEpisode(id: number, data: Partial<Episode>): Promise<Episode> {
    const ep = this.episodes.get(id);
    if (!ep) throw new Error(`Episode ${id} not found`);
    const updated = { ...ep, ...data };
    this.episodes.set(id, updated);
    return updated;
  }

  async listEpisodes(): Promise<Episode[]> {
    return Array.from(this.episodes.values()).reverse();
  }

  async deleteEpisode(id: number): Promise<void> {
    this.episodes.delete(id);
  }
}

export const storage = new MemStorage();
