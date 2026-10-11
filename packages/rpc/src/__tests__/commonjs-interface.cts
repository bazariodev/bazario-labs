import Rpc = require('@bazariodev/rpc');

declare const channel: Rpc.RpcChannel;
const client = new Rpc.RpcClient({ channel });
const result: Promise<unknown> = client.request({ method: 'getUserInfo' });
void result;
client.stop();
