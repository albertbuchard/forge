use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{Context, anyhow};
use base64::Engine;
use clap::{Parser, Subcommand};
use forge_companion_iroh::protocol::{
    BridgeRequest, BridgeResponse, COMPANION_ALPN, FORGE_AGENT_NAME, ForgeHttpRequest,
    ForgeHttpResponse, HeaderPair, PROTOCOL_VERSION, PairPayload,
};
use iroh::endpoint::{IdleTimeout, QuicTransportConfig, RecvStream, SendStream, presets};
use iroh::{Endpoint, SecretKey};
use reqwest::header::{HeaderName, HeaderValue};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

const MAX_FRAME_BYTES: usize = 50 * 1024 * 1024;
const IROH_HOST_TIMING_HEADER: &str = "x-forge-iroh-host-timing-ms";

#[derive(Parser, Debug)]
#[command(version, about = "Forge Companion transport over Iroh QUIC")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    Host(HostArgs),
    Probe(ProbeArgs),
}

#[derive(Parser, Debug)]
struct HostArgs {
    #[arg(long)]
    state_dir: PathBuf,
    #[arg(long)]
    token: Option<String>,
    #[arg(long)]
    local_base_url: String,
    #[arg(long)]
    relay: Option<String>,
}

#[derive(Parser, Debug)]
struct ProbeArgs {
    #[arg(long)]
    node_id: String,
    #[arg(long)]
    token: String,
    #[arg(long)]
    relay: Option<String>,
    #[arg(long, default_value = "GET")]
    method: String,
    #[arg(long, default_value = "/api/v1/health")]
    path: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    install_tls_crypto_provider()?;
    init_logging();
    match Cli::parse().command {
        Command::Host(args) => run_host(args).await,
        Command::Probe(args) => run_probe(args).await,
    }
}

fn install_tls_crypto_provider() -> anyhow::Result<()> {
    if rustls::crypto::CryptoProvider::get_default().is_some() {
        return Ok(());
    }
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow!("installing the TLS crypto provider failed"))
}

async fn run_host(args: HostArgs) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(&args.state_dir)
        .await
        .with_context(|| format!("creating {}", args.state_dir.display()))?;
    let secret_key = load_or_create_secret_key(&args.state_dir).await?;
    let token = match args.token {
        Some(token) => token,
        None => load_or_create_token(&args.state_dir).await?,
    };
    let endpoint = bind_endpoint(secret_key.clone()).await?;
    wait_for_endpoint_route(&endpoint).await;
    let relay = endpoint_home_relay(&endpoint).or(args.relay);
    let payload = PairPayload {
        v: PROTOCOL_VERSION,
        node_id: secret_key.public().to_string(),
        token,
        host_name: local_host_name(),
        relay,
    };
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "event": "ready",
            "pairPayload": payload,
            "alpn": String::from_utf8_lossy(COMPANION_ALPN),
        }))?
    );

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .build()
        .context("building HTTP client")?;
    let shutdown = wait_for_shutdown();
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            _ = &mut shutdown => {
                break;
            }
            incoming = endpoint.accept() => {
                let Some(connecting) = incoming else { break };
                let client = client.clone();
                let local_base_url = args.local_base_url.clone();
                let expected_token = payload.token.clone();
                tokio::spawn(async move {
                    match connecting.await {
                        Ok(conn) => {
                            let conn_id = conn.stable_id();
                            info!(conn = conn_id, node_id = %conn.remote_id(), "forge iroh connection accepted");
                            while let Ok((send, recv)) = conn.accept_bi().await {
                                let client = client.clone();
                                let local_base_url = local_base_url.clone();
                                let expected_token = expected_token.clone();
                                tokio::spawn(async move {
                                    if let Err(error) = handle_stream(send, recv, client, &local_base_url, &expected_token).await {
                                        warn!("forge iroh stream ended: {error:#}");
                                    }
                                });
                            }
                        }
                        Err(error) => warn!("incoming iroh connection failed: {error:#}"),
                    }
                });
            }
        }
    }
    endpoint.close().await;
    Ok(())
}

async fn run_probe(args: ProbeArgs) -> anyhow::Result<()> {
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(SecretKey::generate())
        .alpns(vec![COMPANION_ALPN.to_vec()])
        .bind()
        .await
        .context("binding probe endpoint")?;
    let result = run_probe_with_endpoint(&endpoint, args).await;
    endpoint.close().await;
    result
}

async fn run_probe_with_endpoint(endpoint: &Endpoint, args: ProbeArgs) -> anyhow::Result<()> {
    let node_id = args
        .node_id
        .parse()
        .with_context(|| format!("parsing node id {}", args.node_id))?;
    let mut addr = iroh::EndpointAddr::new(node_id);
    if let Some(relay) = args.relay {
        addr = addr.with_relay_url(
            relay
                .parse()
                .with_context(|| format!("parsing relay URL {relay}"))?,
        );
    }
    let conn = endpoint
        .connect(addr, COMPANION_ALPN)
        .await
        .context("connecting over Forge Iroh bridge")?;
    let (mut send, mut recv) = conn.open_bi().await.context("opening stream")?;
    write_json_frame(
        &mut send,
        &BridgeRequest::Connect {
            v: PROTOCOL_VERSION,
            token: args.token,
            agent: FORGE_AGENT_NAME.to_string(),
        },
    )
    .await?;
    let ack: BridgeResponse = read_json_frame(&mut recv).await?;
    if !ack.ok {
        anyhow::bail!("connect rejected: {}", ack.error.unwrap_or_default());
    }
    write_json_frame(
        &mut send,
        &ForgeHttpRequest {
            v: PROTOCOL_VERSION,
            method: args.method,
            path: args.path,
            headers: vec![],
            body_base64: None,
        },
    )
    .await?;
    let response: ForgeHttpResponse = read_json_frame(&mut recv).await?;
    println!("{}", serde_json::to_string_pretty(&response)?);
    conn.close(iroh::endpoint::VarInt::from_u32(0), b"probe complete");
    Ok(())
}

async fn handle_stream(
    mut send: SendStream,
    mut recv: RecvStream,
    client: reqwest::Client,
    local_base_url: &str,
    expected_token: &str,
) -> anyhow::Result<()> {
    let request: BridgeRequest = read_json_frame(&mut recv).await?;
    validate_bridge_request(&request, expected_token)?;
    match request {
        BridgeRequest::ListAgents { .. } => {
            write_json_frame(&mut send, &BridgeResponse::agents()).await?;
            Ok(())
        }
        BridgeRequest::Connect { agent, .. } if agent == FORGE_AGENT_NAME => {
            write_json_frame(&mut send, &BridgeResponse::ok()).await?;
            let request: ForgeHttpRequest = read_json_frame(&mut recv).await?;
            let response = proxy_http_request(client, local_base_url, request).await?;
            write_json_frame(&mut send, &response).await?;
            let _ = send.finish();
            Ok(())
        }
        BridgeRequest::Connect { agent, .. } => {
            let message = format!("agent `{agent}` is disabled or unknown");
            write_json_frame(&mut send, &BridgeResponse::error(&message)).await?;
            Err(anyhow!(message))
        }
    }
}

fn validate_bridge_request(request: &BridgeRequest, expected_token: &str) -> anyhow::Result<()> {
    if request.version() != PROTOCOL_VERSION {
        anyhow::bail!(
            "protocol mismatch: client={} host={}",
            request.version(),
            PROTOCOL_VERSION
        );
    }
    if request.token() != expected_token {
        anyhow::bail!("invalid token");
    }
    Ok(())
}

async fn proxy_http_request(
    client: reqwest::Client,
    local_base_url: &str,
    request: ForgeHttpRequest,
) -> anyhow::Result<ForgeHttpResponse> {
    if request.v != PROTOCOL_VERSION {
        anyhow::bail!(
            "HTTP protocol mismatch: client={} host={}",
            request.v,
            PROTOCOL_VERSION
        );
    }
    let url = build_proxy_url(local_base_url, &request.path)?;
    let method = request.method.parse().context("parsing HTTP method")?;
    let mut builder = client.request(method, url);
    for header in request.headers {
        let lower = header.name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "connection" | "host" | "content-length" | "transfer-encoding"
        ) {
            continue;
        }
        let name = HeaderName::from_bytes(header.name.as_bytes())
            .with_context(|| format!("invalid header name {}", header.name))?;
        let value = HeaderValue::from_str(&header.value)
            .with_context(|| format!("invalid header value for {}", header.name))?;
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body_base64 {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(body)
            .context("decoding request body")?;
        builder = builder.body(bytes);
    }
    let request_started_at = Instant::now();
    let response = builder.send().await.context("forwarding HTTP request")?;
    let upstream_response_ms = request_started_at.elapsed().as_millis();
    let status = response.status().as_u16();
    let body_started_at = Instant::now();
    let mut headers: Vec<HeaderPair> = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value.to_str().ok().map(|value| HeaderPair {
                name: name.as_str().to_string(),
                value: value.to_string(),
            })
        })
        .collect();
    let body = response
        .bytes()
        .await
        .context("reading HTTP response body")?;
    let body_read_ms = body_started_at.elapsed().as_millis();
    let total_ms = request_started_at.elapsed().as_millis();
    headers.push(HeaderPair {
        name: IROH_HOST_TIMING_HEADER.to_string(),
        value: format!(
            "total={},upstreamResponse={},bodyRead={}",
            total_ms, upstream_response_ms, body_read_ms
        ),
    });
    Ok(ForgeHttpResponse {
        v: PROTOCOL_VERSION,
        status,
        headers,
        body_base64: Some(base64::engine::general_purpose::STANDARD.encode(body)),
    })
}

fn build_proxy_url(local_base_url: &str, path: &str) -> anyhow::Result<String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        anyhow::bail!("absolute proxy paths are not allowed");
    }
    if !path.starts_with('/') {
        anyhow::bail!("proxy path must start with /");
    }
    Ok(format!("{}{}", local_base_url.trim_end_matches('/'), path))
}

async fn bind_endpoint(secret_key: SecretKey) -> anyhow::Result<Endpoint> {
    let idle_timeout = IdleTimeout::try_from(Duration::from_secs(600))
        .context("constructing Iroh idle timeout")?;
    let transport = QuicTransportConfig::builder()
        .max_idle_timeout(Some(idle_timeout))
        .build();
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(secret_key)
        .alpns(vec![COMPANION_ALPN.to_vec()])
        .transport_config(transport)
        .bind()
        .await
        .context("binding Iroh endpoint")?;
    Ok(endpoint)
}

async fn wait_for_endpoint_route(endpoint: &Endpoint) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    while tokio::time::Instant::now() < deadline {
        if endpoint_home_relay(endpoint).is_some() {
            info!(addr = ?endpoint.addr(), "forge iroh endpoint route ready");
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    warn!("forge iroh endpoint did not report relay routing within timeout");
}

async fn load_or_create_secret_key(state_dir: &Path) -> anyhow::Result<SecretKey> {
    let path = state_dir.join("host.key");
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => parse_secret_key(raw.trim())
            .with_context(|| format!("parsing host key {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let key = SecretKey::generate();
            write_private_file(&path, hex::encode(key.to_bytes())).await?;
            Ok(key)
        }
        Err(error) => Err(error).with_context(|| format!("reading {}", path.display())),
    }
}

async fn load_or_create_token(state_dir: &Path) -> anyhow::Result<String> {
    let path = state_dir.join("host.token");
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => Ok(raw.trim().to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let token = hex::encode(SecretKey::generate().to_bytes());
            write_private_file(&path, token.clone()).await?;
            Ok(token)
        }
        Err(error) => Err(error).with_context(|| format!("reading {}", path.display())),
    }
}

fn parse_secret_key(raw: &str) -> anyhow::Result<SecretKey> {
    let bytes = hex::decode(raw).context("host key must be 32 bytes of hex")?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow!("host key must decode to exactly 32 bytes"))?;
    Ok(SecretKey::from_bytes(&bytes))
}

async fn write_private_file(path: &Path, content: String) -> anyhow::Result<()> {
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, format!("{content}\n"))
        .await
        .with_context(|| format!("writing {}", tmp.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
            .with_context(|| format!("chmod 0600 {}", tmp.display()))?;
    }
    tokio::fs::rename(&tmp, path)
        .await
        .with_context(|| format!("renaming {} -> {}", tmp.display(), path.display()))?;
    Ok(())
}

async fn read_json_frame<T, R>(reader: &mut R) -> anyhow::Result<T>
where
    T: serde::de::DeserializeOwned,
    R: AsyncRead + Unpin,
{
    let len = reader.read_u32().await.context("reading frame length")? as usize;
    if len > MAX_FRAME_BYTES {
        anyhow::bail!("frame too large: {len} bytes");
    }
    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .await
        .context("reading frame body")?;
    serde_json::from_slice(&buf).context("decoding JSON frame")
}

async fn write_json_frame<T, W>(writer: &mut W, value: &T) -> anyhow::Result<()>
where
    T: serde::Serialize,
    W: AsyncWrite + Unpin,
{
    let buf = serde_json::to_vec(value).context("encoding JSON frame")?;
    if buf.len() > MAX_FRAME_BYTES {
        anyhow::bail!("frame too large: {} bytes", buf.len());
    }
    writer
        .write_u32(buf.len() as u32)
        .await
        .context("writing frame length")?;
    writer.write_all(&buf).await.context("writing frame body")?;
    writer.flush().await.context("flushing frame")?;
    Ok(())
}

fn endpoint_home_relay(endpoint: &Endpoint) -> Option<String> {
    endpoint
        .addr()
        .relay_urls()
        .next()
        .map(|url| url.to_string())
}

fn local_host_name() -> Option<String> {
    hostname::get()
        .ok()
        .and_then(|name| name.into_string().ok())
        .map(|name| name.trim().trim_end_matches('.').to_string())
        .filter(|name| !name.is_empty())
}

async fn wait_for_shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}

fn init_logging() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new(
                "warn,forge_companion_iroh=info,iroh=error,noq=error,noq_udp=error,quinn=error",
            )
        }))
        .with_writer(std::io::stderr)
        .try_init();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tls_crypto_provider_installation_is_idempotent() {
        install_tls_crypto_provider().unwrap();
        install_tls_crypto_provider().unwrap();
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }

    #[test]
    fn proxy_url_rejects_absolute_paths() {
        assert!(build_proxy_url("http://127.0.0.1:4317", "https://example.com").is_err());
    }

    #[test]
    fn proxy_url_requires_absolute_origin_path() {
        assert!(build_proxy_url("http://127.0.0.1:4317", "api/v1/health").is_err());
    }

    #[test]
    fn proxy_url_joins_local_origin() {
        let url = build_proxy_url("http://127.0.0.1:4317/", "/api/v1/health").unwrap();
        assert_eq!(url, "http://127.0.0.1:4317/api/v1/health");
    }
}
