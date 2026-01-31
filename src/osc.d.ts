declare module "node-osc" {
  export class Server {
    constructor(port: number, host?: string, callback?: () => void);
    on(event: "message", callback: (msg: [string, ...unknown[]], rinfo: unknown) => void): void;
    on(event: "error", callback: (error: Error) => void): void;
    close(): void;
  }

  export class Client {
    constructor(host: string, port: number);
    send(address: string, ...args: (number | string | boolean | Buffer)[]): void;
    close(): void;
  }
}
