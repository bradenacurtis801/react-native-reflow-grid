import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';

/**
 * The players of the cells that are mounted, by key. A press is the grid's
 * (`touchRegions`), outside the cell, so it reaches the player through here.
 */
const players = new Map<string, VideoPlayer>();

/** Plays or pauses one cell's video, if the cell is mounted. */
export function togglePlayback(key: string) {
  const player = players.get(key);
  if (!player) return;
  if (player.playing) player.pause();
  else player.play();
}

/** Plays or pauses every mounted video whose key starts with `prefix`. */
export function setPlayback(prefix: string, playing: boolean) {
  players.forEach((player, key) => {
    if (!key.startsWith(prefix)) return;
    if (playing) player.play();
    else player.pause();
  });
}

/** A muted, looping video that fills its cell. It's made as the cell mounts and let go as it unmounts. */
export function VideoCell({ id, source, autoplay = true }: { id: string; source: string; autoplay?: boolean }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    if (autoplay) p.play();
  });
  useEffect(() => {
    players.set(id, player);
    return () => {
      players.delete(id);
    };
  }, [id, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}
