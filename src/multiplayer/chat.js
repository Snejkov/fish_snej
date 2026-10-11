export class SnejChatBuffer {
  constructor(limit = 40) {
    this.limit = limit;
    this.messages = [];
  }

  add(message) {
    this.messages.push(message);
    if (this.messages.length > this.limit) this.messages.splice(0, this.messages.length - this.limit);
  }

  list() {
    return this.messages.slice();
  }
}
