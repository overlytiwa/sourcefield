import { Notebook } from './notebook.js';
import { formatNotes } from './format.js';

const notebook = new Notebook();
notebook.add('Explore Sourcefield', ['code', 'ideas']);
notebook.add('Ship the first version', ['code', 'work']);
const matches = notebook.search(process.argv[2] ?? 'code');
console.log(formatNotes(matches));
