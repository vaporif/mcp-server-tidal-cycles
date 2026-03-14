pub const MINI_NOTATION: &str = include_str!("../resources/mini-notation.md");
pub const SAMPLES: &str = include_str!("../resources/samples.md");
pub const EFFECTS: &str = include_str!("../resources/effects.md");
pub const EXAMPLES: &str = include_str!("../resources/examples.md");
pub const SC_ANALYSIS: &str = include_str!("../resources/supercollider-analysis.md");

pub struct ResourceInfo {
    pub uri: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub content: &'static str,
}

pub const RESOURCES: &[ResourceInfo] = &[
    ResourceInfo {
        uri: "tidal://docs/mini-notation",
        name: "Mini-Notation Reference",
        description: "TidalCycles mini-notation syntax for writing patterns",
        content: MINI_NOTATION,
    },
    ResourceInfo {
        uri: "tidal://docs/samples",
        name: "Sample Library",
        description: "List of default SuperDirt samples and categories",
        content: SAMPLES,
    },
    ResourceInfo {
        uri: "tidal://docs/effects",
        name: "Effects Reference",
        description: "Available effects and controls (gain, lpf, delay, etc.)",
        content: EFFECTS,
    },
    ResourceInfo {
        uri: "tidal://docs/examples",
        name: "Pattern Examples",
        description: "Example patterns for beats, melodies, and effects",
        content: EXAMPLES,
    },
    ResourceInfo {
        uri: "tidal://docs/supercollider-analysis",
        name: "SuperCollider Analysis Setup",
        description: "Code to enable audio analysis in SuperCollider for the analyze tool",
        content: SC_ANALYSIS,
    },
];
