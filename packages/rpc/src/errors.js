export class RpcError extends Error {
  constructor(kind, message, cause) {
    super(message, { cause });
    this.name = 'RpcError';
    this.kind = kind;
  }
}

export class RpcResponseError extends Error {
  constructor({ code, message = 'Request rejected', data }, method) {
    super(message);
    this.name = 'RpcResponseError';
    this.code = code;
    this.data = data;
    this.method = method;
  }
}
