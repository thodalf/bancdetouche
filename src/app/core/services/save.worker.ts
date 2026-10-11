/// <reference lib="webworker" />
import { compressToUTF16 } from 'lz-string';

/** Compression de la sauvegarde hors du fil principal (l'interface reste fluide). */
addEventListener('message', ({ data }: MessageEvent<{ id: number; json: string }>) => {
  postMessage({ id: data.id, packed: compressToUTF16(data.json) });
});
