import { spawn, ChildProcess } from "child_process";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

const BOOT_TIDAL_PATHS = [
  join(homedir(), ".cabal/share/tidal-*/BootTidal.hs"),
  "/usr/share/tidal/BootTidal.hs",
  "/usr/local/share/tidal/BootTidal.hs",
  join(homedir(), ".local/share/tidal/BootTidal.hs"),
];

export class TidalProcess {
  private process: ChildProcess | null = null;
  private errorBuffer: string = "";
  private outputBuffer: string = "";
  private bootTidalPath: string | null = null;
  private isReady: boolean = false;

  constructor(bootTidalPath?: string) {
    this.bootTidalPath = bootTidalPath ?? this.findBootTidal();
  }

  private findBootTidal(): string | null {
    for (const pattern of BOOT_TIDAL_PATHS) {
      try {
        const result = execSync(`ls ${pattern} 2>/dev/null`, { encoding: "utf-8" }).trim();
        if (result) {
          const paths = result.split("\n");
          if (paths.length > 0 && existsSync(paths[0])) {
            return paths[0];
          }
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  async start(): Promise<void> {
    if (this.process) return;

    return new Promise((resolve, reject) => {
      const args = ["--interactive"];
      if (this.bootTidalPath) {
        args.push("-ghci-script", this.bootTidalPath);
      }

      this.process = spawn("ghci", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        this.outputBuffer += text;
        if (text.includes("tidal>") || text.includes("Prelude>")) {
          this.isReady = true;
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        this.errorBuffer += data.toString();
      });

      this.process.on("error", (err) => {
        reject(new Error(`Failed to start GHCi: ${err.message}`));
      });

      this.process.on("close", () => {
        this.process = null;
        this.isReady = false;
      });

      const startTime = Date.now();
      const checkReady = () => {
        if (this.isReady) {
          resolve();
        } else if (Date.now() - startTime > 30000) {
          reject(new Error("Tidal startup timeout. Make sure GHCi and Tidal are installed."));
        } else {
          setTimeout(checkReady, 100);
        }
      };
      setTimeout(checkReady, 500);
    });
  }

  async send(code: string): Promise<{ success: boolean; error?: string; output?: string }> {
    if (!this.process || !this.isReady) {
      await this.start();
    }

    return new Promise((resolve) => {
      this.errorBuffer = "";
      this.outputBuffer = "";

      this.process!.stdin?.write(code + "\n");

      setTimeout(() => {
        const error = this.parseError(this.errorBuffer);
        if (error) {
          resolve({ success: false, error });
        } else {
          resolve({ success: true, output: this.outputBuffer.trim() });
        }
      }, 200);
    });
  }

  private parseError(stderr: string): string | null {
    const errorPatterns = [
      /error:[\s\S]*?(?=\n\n|\n[^\s]|$)/gi,
      /parse error[\s\S]*?(?=\n\n|\n[^\s]|$)/gi,
      /not in scope[\s\S]*?(?=\n\n|\n[^\s]|$)/gi,
      /couldn't match[\s\S]*?(?=\n\n|\n[^\s]|$)/gi,
    ];

    for (const pattern of errorPatterns) {
      const match = stderr.match(pattern);
      if (match) return match[0].trim();
    }

    if (stderr.includes("error") || stderr.includes("Error") || stderr.includes("exception")) {
      return stderr.trim();
    }
    return null;
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.stdin?.write(":quit\n");
      this.process.kill();
      this.process = null;
      this.isReady = false;
    }
  }
}
