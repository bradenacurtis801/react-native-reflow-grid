import { createContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { LIFT_SCALE } from '../cells/motion';
import { DragCarrier } from './carrier';

export const DragContext = createContext<DragCarrier | undefined>(undefined);

/**
 * Lets a drag leave the grid it began in. Put it around the grids (and whatever covers them): an item carried from one to
 * another is drawn on a layer above everything inside it. Needed for `onSpringLoad` and `continuesDrag`.
 */
export function ReflowDragProvider({
  children,
  style,
  onDragEnd,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** A drag that was carried out of its grid has ended: what was kept mounted for it can go. */
  onDragEnd?: () => void;
}) {
  const [carrier] = useState(() => new DragCarrier());
  const item = useSyncExternalStore(carrier.subscribe, carrier.getSnapshot);
  const root = useRef<View>(null);
  // Where this view is on screen: the finger is reported in the screen's coordinates.
  const origin = useRef({ x: 0, y: 0 });
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  useEffect(() => {
    carrier.onEnd = onDragEnd;
  }, [carrier, onDragEnd]);
  useEffect(() => {
    carrier.onMove = (at) => {
      x.set(at.x - origin.current.x);
      y.set(at.y - origin.current.y);
    };
  }, [carrier, x, y]);
  const gx = item?.grab.x ?? 0;
  const gy = item?.grab.y ?? 0;
  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() - gx }, { translateY: y.get() - gy }, { scale: LIFT_SCALE }] }), [gx, gy]);

  return (
    <DragContext.Provider value={carrier}>
      <View
        ref={root}
        style={[styles.root, style]}
        onLayout={() => root.current?.measureInWindow((left, top) => (origin.current = { x: left, y: top }))}
      >
        {children}
        {item ? (
          <Animated.View pointerEvents="none" style={[styles.lifted, { width: item.size.width, height: item.size.height }, follow]}>
            {item.render() as ReactNode}
          </Animated.View>
        ) : null}
      </View>
    </DragContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  lifted: { position: 'absolute', left: 0, top: 0 },
});
