let sequence = 0;

/** Client-side id that works outside secure contexts (unlike crypto.randomUUID). */
export function uid(prefix = "id"): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
