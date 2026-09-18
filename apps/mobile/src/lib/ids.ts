/** Client-generated idempotency key / commandId (plan.md §6: app generates). */
export function newId(): string {
  // UUIDv4 without native deps (works on Expo Go + web).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
