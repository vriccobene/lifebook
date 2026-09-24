import type { Db } from "../db/client";

export interface RouteContext {
  db: Db;
  now: () => Date;
}

export const today = (now: () => Date): string => now().toISOString().slice(0, 10);
export const timestamp = (now: () => Date): string => now().toISOString();
