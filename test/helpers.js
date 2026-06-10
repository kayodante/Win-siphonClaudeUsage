export class MemoryStore {
  constructor(value) {
    this.value = value;
  }

  async load() {
    return this.value;
  }

  async save(value) {
    this.value = structuredClone(value);
  }
}
