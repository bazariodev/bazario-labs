export class TestWebSocket {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  sent = [];
  sendError = null;

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message) {
    const data =
      message instanceof Uint8Array
        ? this.binaryType === 'arraybuffer'
          ? message.slice().buffer
          : new Blob([message])
        : message;
    this.onmessage?.({ data });
  }

  fail(cause) {
    this.onerror?.(cause);
  }

  send(message) {
    if (this.sendError) throw this.sendError;
    this.sent.push(message);
  }

  close() {
    if (this.readyState < 2) this.readyState = 2;
  }

  finishClose({ code = 1000, reason = '', wasClean = true } = {}) {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean });
  }
}
