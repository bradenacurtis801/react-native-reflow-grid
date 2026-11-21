# Tiles

The grid on its own, with made-up tiles: the example for trying a layout or a gesture.

- **Layouts.** Switch between 3 columns, a list, masonry (columns, or rows that scroll sideways), one or two rows, pages, and a fixed-size grid that scrolls on both axes. Changing layout glides every tile to its new place.
- **Drag to reorder.** Hold a tile and drag it; hold it at an edge to scroll, or to turn the page in the paged layouts.
- **Add and remove.** Tap a tile's ✕, with as many fingers as you like, or add 300 and watch the mounted count stay small.

## Run it

```sh
npm install
npx expo install --fix
npx expo run:ios   # or run:android: reanimated needs a dev build, not Expo Go
```

It uses `gridLayout`, `masonryLayout` and `pagedLayout`, `onReorder` and `touchRegions`. See the [main README](../../README.md).
