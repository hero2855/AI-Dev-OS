export interface MemoryEntry {
  goal: string;
  plan: any;
  results: any;
  timestamp: number;
}

const memoryStore: MemoryEntry[] = [];

export function saveMemory(entry: MemoryEntry): MemoryEntry {
  const memoryEntry: MemoryEntry = {
    goal: typeof entry.goal === "string" ? entry.goal : "",
    plan: entry.plan,
    results: entry.results,
    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
  };

  memoryStore.push(memoryEntry);
  return memoryEntry;
}

export function getMemory(goal: string): MemoryEntry[] {
  const normalizedGoal = typeof goal === "string" ? goal.trim() : "";

  return memoryStore.filter((entry) => entry.goal === normalizedGoal);
}

export function getRecentMemory(limit = 10): MemoryEntry[] {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;

  return memoryStore.slice(-safeLimit);
}

export default memoryStore;
