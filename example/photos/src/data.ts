/** A number in [0, 1) that is always the same for the same `n`, so the data doesn't change between runs. */
export const rand = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A photo of the given size; the same seed is the same photo. */
export const photoUri = (seed: number, width: number, height: number) => `https://picsum.photos/seed/${seed}/${Math.round(width)}/${Math.round(height)}`;

/**
 * The photos the demo draws from: a pool, which cards cycle through, so after the first pass every photo is one that has
 * been loaded and cached already. A fresh image takes the host a second or more to make, which is longer than a card is
 * on screen in a fling, so a demo of unique photos would sit on patches of colour. A real feed's thumbnails are cached and
 * served fast; this is how the demo gets the same.
 */
export const POOL = 48;
/** A pooled photo is asked for at one size, whatever the grid makes of its card, so its address is always the same: it can be fetched ahead, and a second sight of it is a cache hit. */
export const PHOTO_WIDTH = 720;
/** A pooled photo's shape: height ÷ width. */
export const poolRatio = (slot: number) => 0.7 + rand(slot) * 0.9;
/** Where a pooled photo is. */
export const poolUri = (slot: number) => photoUri(slot, PHOTO_WIDTH, Math.round(PHOTO_WIDTH * poolRatio(slot)));

/** Short public clips, a megabyte or so each. */
export const VIDEOS = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4',
];

/** A colour for an id: what a photo shows until it has loaded. */
export const hueOf = (id: number) => `hsl(${Math.floor(rand(id) * 360)}, 62%, 52%)`;
