import type { Express } from "express";
import { createServer, type Server } from "http";

export async function registerRoutes(app: Express): Promise<Server> {
  // The Python FastAPI server (port 8000) handles all /api/* routes.
  // This Express server only serves the React frontend via Vite.
  // API calls from the frontend go directly to __PORT_8000__ (the Python server).
  
  const httpServer = createServer(app);
  return httpServer;
}
