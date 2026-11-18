export function formatNotes(notes) {
  return notes.map(note => `${note.id}. ${note.title} [${note.tags.join(', ')}]`).join('\n');
}
