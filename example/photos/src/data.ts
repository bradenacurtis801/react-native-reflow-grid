/** A number in [0, 1) that is always the same for the same `n`, so the data doesn't change between runs. */
export const rand = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A photo of the given size; the same seed is the same photo. */
export const photoUri = (seed: number, width: number, height: number) => `https://picsum.photos/seed/${seed}/${Math.round(width)}/${Math.round(height)}`;

/** Short public clips, a megabyte or so each. */
export const VIDEOS = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4',
];

/** A colour for an id: what a photo shows until it has loaded. */
export const hueOf = (id: number) => `hsl(${Math.floor(rand(id) * 360)}, 62%, 52%)`;
