import { nameProblem, suggestName } from './names';

describe('app names', () => {
  it.each([
    ['My Movies', 'my-movies'],
    ['  Jellyfin!! 2 ', 'jellyfin-2'],
    ['-weird--name-', 'weird-name'],
    ['Café', 'caf'],
  ])('suggests %p → %p', (input, expected) => {
    expect(suggestName(input)).toBe(expected);
  });

  it('explains what is wrong with a name with spaces', () => {
    expect(nameProblem('My Movies')).toMatch(/no spaces/);
    expect(nameProblem('my-movies')).toBeNull();
    expect(nameProblem('')).toMatch(/name/i);
  });
});
