const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const HEADER_BYTES = 5;

export function encodeMessage(message, maxMessageBytes) {
  const text = typeof message === 'string';
  const payload = text ? encoder.encode(message) : message;
  if (payload.byteLength > maxMessageBytes) {
    throw new Error('Transport message limit exceeded.');
  }

  const frame = new Uint8Array(HEADER_BYTES + payload.byteLength);
  frame[0] = text ? 0 : 1;
  new DataView(frame.buffer).setUint32(1, payload.byteLength);
  frame.set(payload, HEADER_BYTES);
  return frame;
}

export async function* readMessages(reader, maxMessageBytes) {
  let pending = new Uint8Array(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (pending.byteLength) throw new Error('Incomplete transport frame.');
      return;
    }

    const bytes = new Uint8Array(pending.byteLength + value.byteLength);
    bytes.set(pending);
    bytes.set(value, pending.byteLength);
    let offset = 0;
    while (bytes.byteLength - offset >= HEADER_BYTES) {
      const type = bytes[offset];
      if (type !== 0 && type !== 1) {
        throw new Error('Unknown transport message type.');
      }
      const length = new DataView(bytes.buffer).getUint32(offset + 1);
      if (length > maxMessageBytes) {
        throw new Error('Transport message limit exceeded.');
      }
      const end = offset + HEADER_BYTES + length;
      if (end > bytes.byteLength) break;

      const payload = bytes.slice(offset + HEADER_BYTES, end);
      yield type === 0 ? decoder.decode(payload) : payload;
      offset = end;
    }
    pending = bytes.slice(offset);
  }
}
