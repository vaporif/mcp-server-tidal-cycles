use rosc::{OscMessage, OscPacket, OscType};
use tokio::{
    net::UdpSocket,
    time::{Duration, timeout},
};

use crate::errors::Error;

type Result<T> = std::result::Result<T, Error>;

const LOCAL_PORT: u16 = 57130;
const SC_PORT: u16 = 57120;

pub struct AnalysisResult {
    pub amplitude: Vec<f32>,
    pub rms: Vec<f32>,
    pub centroid: Vec<f32>,
    pub flatness: Vec<f32>,
    pub onsets: u32,
}

impl AnalysisResult {
    pub fn summary(&self, duration: u32) -> String {
        let avg_amp = avg(&self.amplitude);
        let peak_amp = max(&self.amplitude);
        let avg_rms = avg(&self.rms);
        let avg_centroid = avg(&self.centroid);
        let avg_flatness = avg(&self.flatness);

        let brightness = if avg_centroid < 1000.0 {
            "dark/bassy"
        } else if avg_centroid < 3000.0 {
            "balanced"
        } else if avg_centroid < 6000.0 {
            "bright"
        } else {
            "very bright/harsh"
        };

        let noisiness = if avg_flatness < 0.2 {
            "tonal/melodic"
        } else if avg_flatness < 0.5 {
            "mixed"
        } else {
            "noisy/percussive"
        };

        format!(
            "Audio Analysis ({duration}s):\n\
             - Amplitude: avg {avg_amp:.3}, peak {peak_amp:.3}\n\
             - RMS Level: {avg_rms:.3}\n\
             - Spectral Centroid: {avg_centroid:.0} Hz ({brightness})\n\
             - Spectral Flatness: {avg_flatness:.3} ({noisiness})\n\
             - Onsets Detected: {onsets}\n\
             - Samples Collected: {len}",
            onsets = self.onsets,
            len = self.amplitude.len(),
        )
    }
}

#[allow(clippy::cast_precision_loss)]
fn avg(arr: &[f32]) -> f32 {
    if arr.is_empty() {
        return 0.0;
    }
    arr.iter().sum::<f32>() / arr.len() as f32
}

fn max(arr: &[f32]) -> f32 {
    arr.iter().copied().reduce(f32::max).unwrap_or(0.0)
}

#[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
const fn extract_f32(arg: &OscType) -> f32 {
    match arg {
        OscType::Float(f) => *f,
        OscType::Double(d) => *d as f32,
        OscType::Int(i) => *i as f32,
        _ => 0.0,
    }
}

pub async fn analyze(duration_secs: u32) -> Result<AnalysisResult> {
    let socket = UdpSocket::bind(format!("127.0.0.1:{LOCAL_PORT}")).await?;

    let duration_i32 = i32::try_from(duration_secs).unwrap_or(i32::MAX);
    let msg = OscMessage {
        addr: "/tidal/startAnalysis".to_owned(),
        args: vec![OscType::Int(duration_i32)],
    };

    let packet = rosc::encoder::encode(&OscPacket::Message(msg))
        .map_err(|e| Error::Osc(format!("failed to encode OSC message: {e}")))?;

    socket
        .send_to(&packet, format!("127.0.0.1:{SC_PORT}"))
        .await?;

    let deadline = Duration::from_secs(u64::from(duration_secs) + 1);

    let recv_result = timeout(deadline, receive_loop(&socket)).await;

    // On timeout, return empty result; otherwise propagate inner result
    recv_result.unwrap_or_else(|_elapsed| {
        Ok(AnalysisResult {
            amplitude: Vec::new(),
            rms: Vec::new(),
            centroid: Vec::new(),
            flatness: Vec::new(),
            onsets: 0,
        })
    })
}

async fn receive_loop(socket: &UdpSocket) -> Result<AnalysisResult> {
    let mut result = AnalysisResult {
        amplitude: Vec::new(),
        rms: Vec::new(),
        centroid: Vec::new(),
        flatness: Vec::new(),
        onsets: 0,
    };

    let mut buf = [0u8; 4096];

    loop {
        let (size, _) = socket.recv_from(&mut buf).await?;
        let (_, osc_packet) = rosc::decoder::decode_udp(&buf[..size])
            .map_err(|e| Error::Osc(format!("failed to decode OSC message: {e}")))?;

        if let OscPacket::Message(msg) = osc_packet {
            match msg.addr.as_str() {
                "/analysis/result" if msg.args.len() >= 5 => {
                    let amp = extract_f32(&msg.args[0]);
                    let rms = extract_f32(&msg.args[1]);
                    let centroid = extract_f32(&msg.args[2]);
                    let flatness = extract_f32(&msg.args[3]);
                    let onset = extract_f32(&msg.args[4]);

                    result.amplitude.push(amp);
                    result.rms.push(rms);
                    result.centroid.push(centroid);
                    result.flatness.push(flatness);
                    if onset > 0.5 {
                        result.onsets += 1;
                    }
                }
                "/analysis/done" => break,
                _ => {}
            }
        }
    }

    Ok(result)
}
