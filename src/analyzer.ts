import { Server as OSCServer, Client as OSCClient } from "node-osc";

export interface AnalysisData {
  amplitude: number[];
  rms: number[];
  centroid: number[];
  flatness: number[];
  onsets: number;
}

export class AudioAnalyzer {
  private oscServer: OSCServer | null = null;
  private oscClient: OSCClient | null = null;
  private analysisData: AnalysisData | null = null;
  private resolved = false;
  private readonly localPort = 57130;
  private readonly superColliderPort = 57120;

  async analyze(durationSeconds: number): Promise<AnalysisData> {
    return new Promise((resolve, reject) => {
      this.resolved = false;
      this.analysisData = {
        amplitude: [],
        rms: [],
        centroid: [],
        flatness: [],
        onsets: 0,
      };

      const complete = () => {
        if (!this.resolved && this.analysisData) {
          this.resolved = true;
          resolve(this.analysisData);
        }
      };

      if (!this.oscServer) {
        this.oscServer = new OSCServer(this.localPort, "127.0.0.1");

        this.oscServer.on("message", (msg) => {
          const [address, ...args] = msg;

          if (address === "/analysis/result" && this.analysisData && !this.resolved) {
            const [amp, rms, centroid, flatness, onset] = args as number[];
            this.analysisData.amplitude.push(amp);
            this.analysisData.rms.push(rms);
            this.analysisData.centroid.push(centroid);
            this.analysisData.flatness.push(flatness);
            if (onset > 0.5) this.analysisData.onsets++;
          }

          if (address === "/analysis/done") {
            complete();
          }
        });

        this.oscServer.on("error", (err) => {
          if (!this.resolved) {
            this.resolved = true;
            reject(err);
          }
        });
      }

      if (!this.oscClient) {
        this.oscClient = new OSCClient("127.0.0.1", this.superColliderPort);
      }

      this.oscClient.send("/tidal/startAnalysis", durationSeconds);

      setTimeout(complete, (durationSeconds + 1) * 1000);
    });
  }

  close() {
    this.oscServer?.close();
    this.oscServer = null;
    this.oscClient?.close();
    this.oscClient = null;
  }
}
