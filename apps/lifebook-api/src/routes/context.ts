import type { Db } from "../db/client";
import type { FireflyOptions } from "./firefly";

export interface RouteContext {
  db: Db;
  now: () => Date;
  firefly?: FireflyOptions;
}

export const today = (now: () => Date): string => now().toISOString().slice(0, 10);
export const timestamp = (now: () => Date): string => now().toISOString();
