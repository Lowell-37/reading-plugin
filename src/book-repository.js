import { deleteBook, listBooks, saveBook, updateBook } from './storage.js'

export class BookRepository {
  constructor(storage = { deleteBook, listBooks, saveBook, updateBook }) {
    this.storage = storage
  }

  save(file, format) {
    return this.storage.saveBook(file, format)
  }

  update(id, changes) {
    return this.storage.updateBook(id, changes)
  }

  list() {
    return this.storage.listBooks()
  }

  delete(id) {
    return this.storage.deleteBook(id)
  }
}

export const bookRepository = new BookRepository()
