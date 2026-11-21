import { Image, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';
import { hueOf, photoUri } from './data';

/**
 * A remote photo as a grid cell wants it: a patch of colour until it loads
 * (so a cell that's still loading doesn't read as broken), then a short
 * crossfade, and kept in memory and on disk, so a cell scrolled back to shows
 * at once instead of loading again.
 */
export function Photo({ seed, width, height, style }: { seed: number; width: number; height: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={{ uri: photoUri(seed, width, height) }}
      style={[{ backgroundColor: hueOf(seed) }, style]}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={200}
      recyclingKey={String(seed)}
    />
  );
}
