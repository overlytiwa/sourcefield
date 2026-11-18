import { matchesQuery } from './search.js';

export class Notebook {
  #notes = [];
  add(title, tags = []) {
    const note = { id: this.#notes.length + 1, title, tags };
    this.#notes.push(note);
    return note;
  }
  search(query) {
    return this.#notes.filter(note => matchesQuery(note, query));
  }
}
