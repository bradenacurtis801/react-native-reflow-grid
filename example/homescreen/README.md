# Home Screen

An iOS home screen, built on the grid.

- **The pages.** A horizontal `pagedLayout` of 4 × 6 apps with the grid's page dots. Hold an icon to move it, to another page too; it isn't clipped at the grid's edges (`dragOverflow`).
- **Folders.** Glass squares with their apps in miniature and a badge that adds theirs up. Tap one and its pane grows out of the icon; inside is another paged grid, 3 × 3, with its own reorder, over a blur of the home screen (`expo-blur`).
- **The dock.** A one-row grid in a pane of glass.
- **The glass.** `expo-glass-effect` (iOS 26's liquid glass); a pale translucent pane elsewhere.

The apps are made up: a gradient and a symbol (`expo-symbols`) each.

Not here, because the grid doesn't do it yet: dragging an icon onto another to make a folder, and dragging between the pages, the dock and a folder (see the [roadmap](../../ROADMAP.md)).

It adds `expo-blur`, `expo-glass-effect`, `expo-haptics`, `expo-status-bar` and `expo-symbols`.

## Run it

```sh
npm install
npx expo run:ios   # or run:android: reanimated needs a dev build, not Expo Go
```
