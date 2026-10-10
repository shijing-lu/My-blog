/** Offset is measured in visible photos, so missing storage objects cannot repeat or skip cards. */
export async function selectAlivePhotoPage<T>(
  ordered: T[], limit: number, offset: number, alive: (photo: T) => Promise<boolean>,
): Promise<{ photos: T[]; total: number; visible: T[] }> {
  const visible: T[] = [];
  // Keep storage probes bounded; the existing storage cache handles repeated requests.
  for (let start = 0; start < ordered.length; start += 16) {
    const batch = ordered.slice(start, start + 16);
    const states = await Promise.all(batch.map(alive));
    batch.forEach((photo, index) => { if (states[index]) visible.push(photo); });
  }
  const from = Math.max(0, Math.floor(offset));
  return { photos: visible.slice(from, from + Math.max(1, Math.floor(limit))), total: visible.length, visible };
}
