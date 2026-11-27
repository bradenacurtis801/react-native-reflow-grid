# Home Screen

An iOS home screen, built on the grid.

- **The pages.** A horizontal `pagedLayout` of 4 × 6 apps with the grid's page dots. Hold an icon to move it, to another page too; it isn't clipped at the grid's edges (`dragOverflow`).
- **Making folders.** Hold an app on another until it's framed and drop it: the two become a folder in that place (`joinPolicy`, `onJoin`). Drop an app on a folder to add it.
- **Opening under a drag.** The moment an app covers another icon, that one darkens and loses its name; hold on, and it opens with the app still under your finger, to be dropped where you like (`onSpringLoad`, `continuesDrag`, `ReflowDragProvider`).
- **Dragging out.** Hold an app outside an open folder and the folder closes, with the app still under your finger, back in the pages (`onDragExit`).
- **Folders.** Glass squares with their apps in miniature and a badge that adds theirs up. Tap one and its pane grows out of the icon; inside is another paged grid, 3 × 3, with its own reorder, over a blur of the home screen (`expo-blur`). Its apps are there from the first frame (`initialSize`), and closed from a later page, its icon shows that page and then slides back to the first.
- **The dock.** A one-row grid in a pane of glass, with a layout of its own that centres what's there. Drag icons out of it and into it (while it has room for four): they change sides as the finger does (`onDragExit`, `continuesDrag`).
- **The glass.** `expo-glass-effect` (iOS 26's liquid glass); a pale translucent pane elsewhere.

The apps are made up: a gradient and a symbol (`expo-symbols`) each.

A full dock takes nothing in, but an app held over it can still be dropped on what's there, or held on it until it opens (`continuesDrag="join"`).

It adds `expo-blur`, `expo-glass-effect`, `expo-haptics`, `expo-status-bar` and `expo-symbols`.

## Run it

```sh
npm install
npx expo run:ios   # or run:android: reanimated needs a dev build, not Expo Go
```
