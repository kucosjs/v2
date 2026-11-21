const timeoutMs = 6_000;

async function withTimeout(work, operation) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Gun relay timed out during ${operation}.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function openRecordsPeer(peer, name) {
  const { default: Gun } = await import('gun');
  let resolveConnection;
  const connected = new Promise((resolve) => {
    resolveConnection = resolve;
  });
  let socket;
  let closed = false;

  class RelaySocket extends WebSocket {
    constructor(url) {
      super(url);
      socket = this;
      this.addEventListener('open', resolveConnection, { once: true });
      if (closed) this.close();
    }
  }

  const gun = Gun({
    peers: [peer],
    WebSocket: RelaySocket,
    radisk: false,
    localStorage: false,
    axe: false,
    multicast: false,
    stats: false,
  });
  const reference = gun.get(`prisma-gun:records:v1:${name}`);

  return {
    async read() {
      const reading = new Promise((resolve) => {
        reference.once(resolve, { wait: 500 });
      });
      const [node] = await withTimeout(Promise.all([reading, connected]), 'read');
      if (socket?.readyState !== WebSocket.OPEN)
        throw new Error('Gun relay disconnected during read.');
      if (node === undefined) return null;
      if (typeof node.records !== 'string')
        throw new Error('Gun relay returned an invalid record set.');
      return JSON.parse(node.records);
    },
    async write(state) {
      const records = JSON.stringify(state);
      await withTimeout(
        new Promise((resolve, reject) => {
          reference.put({ records }, (ack) => {
            if (ack.err) reject(new Error('Gun relay could not store the records.'));
            else if (ack.ok) resolve();
          });
        }),
        'write',
      );
    },
    close() {
      closed = true;
      const peers = gun.back('opt.peers');
      if (peers) delete peers[peer];
      socket?.close();
    },
  };
}
