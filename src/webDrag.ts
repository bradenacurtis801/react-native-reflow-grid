import type { DragEngine } from './dragEngine';

/** What the browser's drag and drop asks of the engine; none of it depends on the item type. */
export type WebDragEngine = Pick<DragEngine<unknown>, 'osStart' | 'osMove' | 'osDrop' | 'osEnd'>;

/**
 * Lets a mouse drag an item, through the browser's own drag and drop. The
 * browser sends its events to the grid's element, and the props a React Native
 * Web `View` forwards don't include them, so they're listened for here. It
 * returns what undoes it.
 *
 * Everything but the browser's part (the data and the image a drag carries) is
 * the engine's.
 */
export function attachWebDrag(el: HTMLElement, engine: WebDragEngine, cellNode: (key: string) => unknown): () => void {
  const onStart = (e: DragEvent) => {
    const hit = e.dataTransfer ? engine.osStart({ x: e.clientX, y: e.clientY }) : undefined;
    if (!hit || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', hit.key);
    const node = cellNode(hit.key) as HTMLElement | undefined;
    if (node) e.dataTransfer.setDragImage(node, hit.grab.x, hit.grab.y);
  };
  const onOver = (e: DragEvent) => {
    // Only a drag that began here can land here.
    if (!engine.osMove({ x: e.clientX, y: e.clientY })) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (e: DragEvent) => {
    if (engine.osDrop()) e.preventDefault();
  };
  const onEnd = () => engine.osEnd();

  const listeners = [
    ['dragstart', onStart],
    ['dragover', onOver],
    ['drop', onDrop],
    ['dragend', onEnd],
  ] as const;
  for (const [type, listener] of listeners) el.addEventListener(type, listener as EventListener);
  el.setAttribute('draggable', 'true');
  return () => {
    for (const [type, listener] of listeners) el.removeEventListener(type, listener as EventListener);
    el.removeAttribute('draggable');
  };
}
