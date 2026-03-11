use std::sync::Arc;

use rmcp::{
    RoleServer, ServerHandler,
    handler::server::{router::prompt::PromptRouter, tool::ToolRouter, wrapper::Parameters},
    model::{
        AnnotateAble, CallToolResult, Content, GetPromptRequestParams, GetPromptResult,
        Implementation, ListPromptsResult, ListResourcesResult, PaginatedRequestParams,
        PromptMessage, PromptMessageRole, RawResource, ReadResourceRequestParams,
        ReadResourceResult, Resource, ResourceContents, ServerCapabilities, ServerInfo,
    },
    prompt, prompt_handler, prompt_router,
    service::RequestContext,
    tool, tool_handler, tool_router,
};
use schemars::JsonSchema;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::{errors::Error, resources::RESOURCES, tidal::TidalProcess, tools::TransitionType};

// ---------------------------------------------------------------------------
// Tool parameter structs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SendPatternParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// Pattern to play
    pub pattern: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SilenceParams {
    /// Channel to silence (omit to silence all)
    pub channel: Option<u8>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetTempoParams {
    /// Tempo in cycles per second
    pub cps: f64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SoloParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// true to solo, false to unsolo
    pub enable: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MuteParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// true to mute, false to unmute
    pub enable: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TransitionParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// Pattern to transition to
    pub pattern: String,
    /// Transition type
    #[serde(rename = "type")]
    pub transition_type: TransitionType,
    /// Number of cycles for the transition
    pub cycles: Option<f64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct OnceParams {
    /// Pattern to play once
    pub pattern: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AnalyzeParams {
    /// Duration in seconds (1-30, default 5)
    pub duration: Option<u32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TidalCodeParams {
    /// Arbitrary Tidal/Haskell code to execute
    pub code: String,
}

// ---------------------------------------------------------------------------
// Prompt parameter structs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateBeatParams {
    /// Style of beat (e.g. "techno", "hip-hop")
    pub style: Option<String>,
    /// Tempo in BPM
    pub tempo: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateAmbientParams {
    /// Mood for the soundscape (e.g. "dark", "ethereal")
    pub mood: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ExplainPatternParams {
    /// The pattern to explain
    pub pattern: String,
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct TidalMcpServer {
    tidal: Arc<Mutex<Option<TidalProcess>>>,
    tool_router: ToolRouter<Self>,
    prompt_router: PromptRouter<Self>,
}

impl TidalMcpServer {
    pub fn new() -> Self {
        Self {
            tidal: Arc::new(Mutex::new(None)),
            tool_router: Self::tool_router(),
            prompt_router: Self::prompt_router(),
        }
    }

    async fn get_tidal(&self) -> Result<tokio::sync::MutexGuard<'_, Option<TidalProcess>>, Error> {
        let mut guard = self.tidal.lock().await;
        if guard.is_none() {
            tracing::info!("starting tidal process on first use");
            let process = TidalProcess::start().await?;
            *guard = Some(process);
        }
        Ok(guard)
    }

    pub async fn shutdown(&self) {
        let mut guard = self.tidal.lock().await;
        if let Some(tidal) = guard.as_mut() {
            tidal.stop().await;
        }
    }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

#[allow(clippy::significant_drop_tightening)]
#[tool_router]
impl TidalMcpServer {
    #[tool(description = "Send a TidalCycles pattern to a channel (d1-d16)")]
    async fn send_pattern(
        &self,
        Parameters(params): Parameters<SendPatternParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg =
            crate::tools::patterns::send_pattern(tidal, params.channel, &params.pattern).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Silence a specific channel or all channels (hush)")]
    async fn silence(
        &self,
        Parameters(params): Parameters<SilenceParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::patterns::silence(tidal, params.channel).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Set the tempo in cycles per second")]
    async fn set_tempo(
        &self,
        Parameters(params): Parameters<SetTempoParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::control::set_tempo(tidal, params.cps).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Solo or unsolo a channel")]
    async fn solo(
        &self,
        Parameters(params): Parameters<SoloParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::control::solo(tidal, params.channel, params.enable).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Mute or unmute a channel")]
    async fn mute(
        &self,
        Parameters(params): Parameters<MuteParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::control::mute(tidal, params.channel, params.enable).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Transition to a new pattern using xfade, clutch, anticipate, jump, etc.")]
    async fn transition(
        &self,
        Parameters(params): Parameters<TransitionParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::patterns::transition(
            tidal,
            params.channel,
            &params.pattern,
            &params.transition_type,
            params.cycles,
        )
        .await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Play a pattern once (one-shot)")]
    async fn once(
        &self,
        Parameters(params): Parameters<OnceParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::patterns::once(tidal, &params.pattern).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "MIDI panic - send all notes off")]
    async fn panic(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::control::panic(tidal).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Reset the cycle count to 0")]
    async fn reset_cycles(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::control::reset_cycles(tidal).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Analyze audio for N seconds (amplitude, brightness, noisiness, onsets)")]
    async fn analyze(
        &self,
        Parameters(params): Parameters<AnalyzeParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let msg = crate::tools::analysis::analyze(params.duration).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Execute arbitrary Tidal/Haskell code")]
    async fn tidal_code(
        &self,
        Parameters(params): Parameters<TidalCodeParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().expect("tidal initialized");
        let msg = crate::tools::control::tidal_code(tidal, &params.code).await?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

#[prompt_router]
impl TidalMcpServer {
    #[prompt(description = "Help create drum patterns")]
    async fn create_beat(
        &self,
        Parameters(params): Parameters<CreateBeatParams>,
    ) -> GetPromptResult {
        let style = params.style.as_deref().unwrap_or("four-on-the-floor");
        let tempo = params.tempo.as_deref().unwrap_or("120");
        let text = format!(
            "Create a {style} drum beat at {tempo} BPM using TidalCycles.\n\n\
             Read the mini-notation reference (tidal://docs/mini-notation) and samples list \
             (tidal://docs/samples) first.\n\n\
             Use the send_pattern tool to play patterns. Use multiple channels (d1, d2, d3) for \
             different drum elements.\n\n\
             Start simple and layer up. Set the tempo first with set_tempo."
        );
        GetPromptResult::new(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
    }

    #[prompt(description = "Create ambient soundscapes")]
    async fn create_ambient(
        &self,
        Parameters(params): Parameters<CreateAmbientParams>,
    ) -> GetPromptResult {
        let mood = params.mood.as_deref().unwrap_or("peaceful");
        let text = format!(
            "Create a {mood} ambient soundscape using TidalCycles.\n\n\
             Read the effects reference (tidal://docs/effects) for reverb, delay, and filter \
             settings.\n\n\
             Use slow-moving patterns, long samples (pad, ambient, space), heavy reverb (room, \
             size), and subtle filter modulation.\n\n\
             Use the send_pattern tool. Keep tempo slow (try 0.25 cps or lower)."
        );
        GetPromptResult::new(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
    }

    #[prompt(description = "Interactive live coding session")]
    async fn live_session(&self) -> GetPromptResult {
        let text = "Let's have an interactive TidalCycles live coding session!\n\n\
             First, read all the documentation resources to understand patterns, samples, and \
             effects.\n\n\
             Then start with a simple pattern on d1 and gradually build up. Ask me what style or \
             mood I want, then create patterns accordingly.\n\n\
             Be ready to:\n\
             - Add/remove layers on different channels\n\
             - Apply effects and transitions\n\
             - Respond to my feedback to evolve the music\n\
             - Use transitions (xfade, clutch) to smoothly change patterns\n\
             - Use the analyze tool to check audio characteristics and adjust accordingly\n\n\
             Start by asking what kind of music I'd like to create.";
        GetPromptResult::new(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
    }

    #[prompt(description = "Explain a TidalCycles pattern")]
    async fn explain_pattern(
        &self,
        Parameters(params): Parameters<ExplainPatternParams>,
    ) -> GetPromptResult {
        let pattern = &params.pattern;
        let text = format!(
            "Explain what this TidalCycles pattern does:\n\n\
             ```haskell\n{pattern}\n```\n\n\
             Break down:\n\
             1. The sound/sample being used\n\
             2. The rhythm structure (mini-notation)\n\
             3. Any effects applied\n\
             4. What it will sound like\n\n\
             Reference the mini-notation docs (tidal://docs/mini-notation) if needed."
        );
        GetPromptResult::new(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
    }
}

// ---------------------------------------------------------------------------
// ServerHandler
// ---------------------------------------------------------------------------

#[tool_handler]
#[prompt_handler]
impl ServerHandler for TidalMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
        .with_server_info(Implementation::new(
            "mcp-server-tidal-cycles",
            env!("CARGO_PKG_VERSION"),
        ))
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, rmcp::ErrorData> {
        let resources: Vec<Resource> = RESOURCES
            .iter()
            .map(|r| {
                RawResource::new(r.uri, r.name)
                    .with_description(r.description)
                    .with_mime_type("text/markdown")
                    .no_annotation()
            })
            .collect();

        Ok(ListResourcesResult::with_all_items(resources))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, rmcp::ErrorData> {
        let uri = &request.uri;
        let resource = RESOURCES.iter().find(|r| r.uri == uri).ok_or_else(|| {
            rmcp::ErrorData::invalid_params(format!("resource not found: {uri}"), None)
        })?;

        Ok(ReadResourceResult::new(vec![
            ResourceContents::text(resource.content, uri).with_mime_type("text/markdown"),
        ]))
    }
}
