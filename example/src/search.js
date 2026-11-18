export function normalize(text) {
  return text.toLocaleLowerCase().trim();
}

export function matchesQuery(note, query) {
  const needle = normalize(query);
  return normalize(note.title).includes(needle)
    || note.tags.some(tag => normalize(tag).includes(needle));
}
