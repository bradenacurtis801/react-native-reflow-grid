import { StyleSheet, View } from 'react-native';

/** A soft patch of light or shade, faded out before the edge of its box. */
const cloud = (at: string, color: string, reach: number) => `radial-gradient(circle at ${at}, rgba(${color}) 0%, rgba(${color.replace(/[\d.]+$/, '0')}) ${reach}%)`;

/** An overcast sky. The glass shows what's behind it, so this is where its light and shade come from. */
export function Wallpaper() {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundImage: [
            cloud('18% 8%', '214,220,232,0.75', 32),
            cloud('82% 16%', '198,206,222,0.65', 28),
            cloud('45% 30%', '188,197,214,0.5', 34),
            cloud('90% 55%', '86,98,122,0.45', 40),
            cloud('8% 70%', '190,184,200,0.35', 36),
            'linear-gradient(180deg, #99a3b6 0%, #7b869b 45%, #687285 100%)',
          ].join(', '),
        },
      ]}
    />
  );
}
