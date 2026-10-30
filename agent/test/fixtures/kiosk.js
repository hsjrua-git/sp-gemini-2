import { startKiosk } from '../../src/kiosk.js';

let confirms = 0;
const { server } = await startKiosk({
  host: '127.0.0.1', port: 0, label: 'test',
  dialogueRef: { dialogue: {
    async confirmScreen() {
      if (++confirms === 1) throw new Error('synthetic confirmation failure');
    },
    async cancelScreen() { throw new Error('synthetic cancellation failure'); },
  } },
});
process.send({ port: server.address().port });
