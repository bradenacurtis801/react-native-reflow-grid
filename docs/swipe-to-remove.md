# Swipe to remove

Back to the [README](../README.md).

Pass `onSwipe` and an item can be slid away with a finger, as a tab is in Safari's tab switcher. The grid stays controlled: you take the item out of `data`. `onSwipe` says which way it went, so each way can do something different.

```tsx
<ReflowGrid
  data={items}
  layout={layout}
  keyExtractor={(item) => item.id}
  renderItem={(item, { swipe }) => <Card item={item} swipe={swipe} />}
  onSwipe={(item, direction) => {
    if (direction === 'left') {
      setItems((all) => all.filter((i) => i.id !== item.id)); // out of `data`: it flies off
      return;
    }
    toggleFavourite(item.id);
    return false; // `false` keeps it: it springs back
  }}
  canSwipe={(item) => !item.pinned}
  swipeDirections={['left', 'right']} // the default; ['left'] would let it go only that way
/>
```

- **Which way.** Across the scroll: sideways in a vertical grid (`'left'` or `'right'`), up or down in a horizontal one (`'up'` or `'down'`). It's off for a grid that scrolls on both axes. `swipeDirections` limits the ways: a finger that starts a way that isn't listed doesn't pick the item up, and one that turns back that way leaves it at its slot.
- **Live progress.** `renderItem`'s second argument has `swipe`, a shared value for how far the item has been taken, in pt: negative towards the start (left, or up), positive towards the end, 0 at rest. Use it in an animated style on the UI thread, to tint the card or fade in a label as it's pulled (a release commits past about two fifths of the item's size, or on a flick).
- **Gestures.** A finger that goes down on an item and moves across the scroll before it has scrolled or lifted anything slides the item with it. Along the scroll it's a scroll, and held still for 350 ms it lifts the item to drag it, as before.
- **Several at once.** Each finger swipes its own item, so two thumbs can swipe away two cards together. An item goes with one finger: a second finger on a card that's already being swiped does nothing.
- **Let go.** Past two fifths of the item's size, or flicked fast the way it's going, it's swiped away: `onSwipe` is called, and the item (once out of `data`) carries on that way and fades while the others glide into its place. Short of that it springs back. Return `false` from `onSwipe` to keep the item; it springs back too if it's still in `data` half a second later.
- **Buttons stay.** A ✕ drawn in the card and pressed through `touchRegions` still works and travels with the card as it's swiped, as in Safari. A finger that has moved across the card never presses.

*Swiping is new, and so far has only been checked by tests of its logic and engine (`src/swipe/`), not on a device.*
