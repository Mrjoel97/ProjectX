declare module "ws" {
  import { EventEmitter } from "node:events";
  export default class WebSocket extends EventEmitter {
    constructor(
      url: string,
      options: { headers: Record<string, string>; handshakeTimeout: number; maxPayload: number },
    );
    static OPEN: number;
    readyState: number;
    send(data: string): void;
    close(): void;
    terminate(): void;
  }
}
