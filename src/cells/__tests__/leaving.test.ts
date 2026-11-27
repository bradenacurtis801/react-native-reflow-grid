import { leavingAfter, type Leaving } from '../leaving';

const keyOf = (item: { id: string }) => item.id;
const items = (...ids: string[]) => ids.map((id) => ({ id }));
const keys = (leaving: Leaving<{ id: string }>[]) => leaving.map((l) => l.key);

describe('leavingAfter', () => {
  it('has nothing leaving when nothing was taken out', () => {
    expect(leavingAfter(items('a', 'b'), items('a', 'b'), [], keyOf)).toEqual([]);
  });

  it('has the item that was taken out, with the item itself', () => {
    const seen = items('a', 'b', 'c');
    const result = leavingAfter(seen, items('a', 'c'), [], keyOf);
    expect(result).toEqual([{ key: 'b', item: seen[1] }]);
  });

  it('has every item that was taken out, in the order they were', () => {
    expect(keys(leavingAfter(items('a', 'b', 'c', 'd'), items('b'), [], keyOf))).toEqual(['a', 'c', 'd']);
  });

  it('keeps one still on its way out when another is taken out', () => {
    const first = leavingAfter(items('a', 'b', 'c'), items('b', 'c'), [], keyOf);
    expect(keys(leavingAfter(items('b', 'c'), items('c'), first, keyOf))).toEqual(['a', 'b']);
  });

  it('drops one that has come back', () => {
    const first = leavingAfter(items('a', 'b'), items('b'), [], keyOf);
    expect(keys(first)).toEqual(['a']);
    expect(leavingAfter(items('b'), items('a', 'b'), first, keyOf)).toEqual([]);
  });

  it('knows an item just taken out in the same call, which is what the cells of this render need', () => {
    // The removal and the list that says so arrive together: no render later has it.
    const result = leavingAfter(items('1', '2', '3'), items('2', '3'), [], keyOf);
    expect(keys(result)).toContain('1');
  });

  it('does not see an item go that another has taken the place of', () => {
    expect(keys(leavingAfter(items('a', 'b', 'c'), items('x', 'c'), [], keyOf, (k) => k === 'b'))).toEqual(['a']);
  });

  it('has everything leaving when data is emptied', () => {
    expect(keys(leavingAfter(items('a', 'b'), [], [], keyOf))).toEqual(['a', 'b']);
  });

  it('does not repeat an item that is taken out while already leaving', () => {
    const first = leavingAfter(items('a', 'b'), items('b'), [], keyOf);
    expect(keys(leavingAfter(items('b'), items('b'), first, keyOf))).toEqual(['a']);
  });
});
