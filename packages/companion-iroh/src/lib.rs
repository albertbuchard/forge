use std::collections::HashMap;
use std::ffi::{CStr, CString, c_char};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use iroh::endpoint::Connection;
use iroh::{Endpoint, SecretKey};
use protocol::{
    BridgeRequest, BridgeResponse, COMPANION_ALPN, FORGE_AGENT_NAME, ForgeHttpRequest,
    ForgeHttpResponse, HeaderPair, PROTOCOL_VERSION, PairPayload,
};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub mod protocol;

const MAX_FRAME_BYTES: usize = 50 * 1024 * 1024;
const IROH_CLIENT_TIMING_HEADER: &str = "x-forge-iroh-client-timing-ms";
const IROH_CLIENT_CONNECTION_REUSED_HEADER: &str = "x-forge-iroh-client-connection-reused";
const FFI_RUNTIME_WORKER_THREADS: usize = 6;
#[cfg(test)]
const FOREGROUND_HEALTH_SYNC_STREAMS: usize = 6;

struct FfiIrohState {
    runtime: tokio::runtime::Runtime,
    endpoint: Mutex<Option<Arc<Endpoint>>>,
    connections: Mutex<HashMap<ConnectionCacheKey, Arc<Connection>>>,
    secret_key: SecretKey,
}

static FFI_STATE: OnceLock<Result<FfiIrohState, String>> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ConnectionCacheKey {
    node_id: String,
    relay: Option<String>,
    token: String,
}

impl ConnectionCacheKey {
    fn from_payload(payload: &PairPayload) -> Self {
        Self {
            node_id: payload.node_id.clone(),
            relay: payload.relay.clone(),
            token: payload.token.clone(),
        }
    }
}

fn ffi_state() -> Result<&'static FfiIrohState, String> {
    match FFI_STATE.get_or_init(FfiIrohState::new) {
        Ok(state) => Ok(state),
        Err(error) => Err(error.clone()),
    }
}

impl FfiIrohState {
    fn new() -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(FFI_RUNTIME_WORKER_THREADS)
            .enable_all()
            .build()
            .map_err(|error| format!("building Forge Iroh runtime: {error}"))?;
        Ok(Self {
            runtime,
            endpoint: Mutex::new(None),
            connections: Mutex::new(HashMap::new()),
            secret_key: SecretKey::generate(),
        })
    }

    async fn cached_endpoint(&self) -> Result<Arc<Endpoint>, String> {
        if let Some(endpoint) = self.endpoint.lock().map_err(lock_error)?.as_ref().cloned() {
            return Ok(endpoint);
        }

        let endpoint = Arc::new(
            Endpoint::builder(iroh::endpoint::presets::N0)
                .secret_key(self.secret_key.clone())
                .bind()
                .await
                .map_err(|error| format!("binding Iroh endpoint: {error}"))?,
        );
        let mut guard = self.endpoint.lock().map_err(lock_error)?;
        if let Some(existing) = guard.as_ref().cloned() {
            return Ok(existing);
        }
        *guard = Some(endpoint.clone());
        Ok(endpoint)
    }

    async fn cached_connection(
        &self,
        payload: &PairPayload,
    ) -> Result<(ConnectionCacheKey, Arc<Connection>, bool), String> {
        let key = ConnectionCacheKey::from_payload(payload);
        if let Some(connection) = self
            .connections
            .lock()
            .map_err(lock_error)?
            .get(&key)
            .cloned()
        {
            return Ok((key, connection, true));
        }

        let endpoint = self.cached_endpoint().await?;
        let connection = Arc::new(connect_iroh(endpoint, payload).await?);
        let mut guard = self.connections.lock().map_err(lock_error)?;
        if let Some(existing) = guard.get(&key).cloned() {
            return Ok((key, existing, true));
        }
        guard.insert(key.clone(), connection.clone());
        Ok((key, connection, false))
    }

    fn evict_connection(&self, key: &ConnectionCacheKey, connection: &Arc<Connection>) {
        let Ok(mut guard) = self.connections.lock() else {
            connection.close(
                iroh::endpoint::VarInt::from_u32(1),
                b"forge connection cache lock failed",
            );
            return;
        };
        if guard
            .get(key)
            .is_some_and(|existing| Arc::ptr_eq(existing, connection))
        {
            guard.remove(key);
            connection.close(
                iroh::endpoint::VarInt::from_u32(1),
                b"forge request stream failed",
            );
        }
    }
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("Forge Iroh client state lock poisoned: {error}")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FfiHttpRequest {
    pair_payload: PairPayload,
    method: String,
    path: String,
    #[serde(default)]
    headers: Vec<HeaderPair>,
    #[serde(default)]
    body_base64: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FfiHttpResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    headers: Vec<HeaderPair>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[unsafe(no_mangle)]
pub extern "C" fn forge_iroh_http_request_json(input_json: *const c_char) -> *mut c_char {
    let response = match read_c_string(input_json)
        .and_then(|input| serde_json::from_str::<FfiHttpRequest>(&input).map_err(|e| e.to_string()))
        .and_then(run_ffi_http_request)
    {
        Ok(response) => response,
        Err(error) => FfiHttpResponse {
            ok: false,
            status: None,
            headers: vec![],
            body_base64: None,
            error: Some(error),
        },
    };
    into_c_string(serde_json::to_string(&response).unwrap_or_else(|error| {
        format!(r#"{{"ok":false,"error":"failed to encode Forge Iroh response: {error}"}}"#)
    }))
}

#[unsafe(no_mangle)]
pub extern "C" fn forge_iroh_free_string(value: *mut c_char) {
    if value.is_null() {
        return;
    }
    unsafe {
        let _ = CString::from_raw(value);
    }
}

fn read_c_string(input_json: *const c_char) -> Result<String, String> {
    if input_json.is_null() {
        return Err("input JSON pointer was null".to_string());
    }
    unsafe { CStr::from_ptr(input_json) }
        .to_str()
        .map(|value| value.to_string())
        .map_err(|error| format!("input JSON was not valid UTF-8: {error}"))
}

fn into_c_string(value: String) -> *mut c_char {
    let sanitized = value.replace('\0', "\\u0000");
    CString::new(sanitized)
        .expect("sanitized Forge Iroh response should not contain NUL bytes")
        .into_raw()
}

fn run_ffi_http_request(request: FfiHttpRequest) -> Result<FfiHttpResponse, String> {
    let state = ffi_state()?;
    state.runtime.block_on(async move {
        let response = send_http_request_over_iroh(state, request).await?;
        Ok(FfiHttpResponse {
            ok: true,
            status: Some(response.status),
            headers: response.headers,
            body_base64: response.body_base64,
            error: None,
        })
    })
}

async fn send_http_request_over_iroh(
    state: &FfiIrohState,
    request: FfiHttpRequest,
) -> Result<ForgeHttpResponse, String> {
    validate_pair_payload(&request.pair_payload)?;
    validate_proxy_path(&request.path)?;

    let total_started_at = Instant::now();
    let connection_started_at = Instant::now();
    let (cache_key, conn, connection_reused) =
        state.cached_connection(&request.pair_payload).await?;
    let connection_ms = elapsed_ms(connection_started_at);
    match send_request_over_connection(&conn, request).await {
        Ok((mut response, mut timing)) => {
            timing.connection_ms = connection_ms;
            timing.connection_reused = connection_reused;
            timing.total_ms = elapsed_ms(total_started_at);
            response.headers.push(HeaderPair {
                name: IROH_CLIENT_TIMING_HEADER.to_string(),
                value: timing.to_header_value(),
            });
            response.headers.push(HeaderPair {
                name: IROH_CLIENT_CONNECTION_REUSED_HEADER.to_string(),
                value: if connection_reused { "1" } else { "0" }.to_string(),
            });
            Ok(response)
        }
        Err(error) => {
            state.evict_connection(&cache_key, &conn);
            Err(error)
        }
    }
}

async fn connect_iroh(
    endpoint: Arc<Endpoint>,
    payload: &PairPayload,
) -> Result<Connection, String> {
    let node_id = payload
        .node_id
        .parse()
        .map_err(|error| format!("parsing Iroh node id: {error}"))?;
    let mut addr = iroh::EndpointAddr::new(node_id);
    if let Some(relay) = payload.relay.as_deref() {
        addr = addr.with_relay_url(
            relay
                .parse()
                .map_err(|error| format!("parsing Iroh relay URL: {error}"))?,
        );
    }
    endpoint
        .connect(addr, COMPANION_ALPN)
        .await
        .map_err(|error| format!("connecting over Forge Iroh bridge: {error}"))
}

async fn send_request_over_connection(
    conn: &Connection,
    request: FfiHttpRequest,
) -> Result<(ForgeHttpResponse, IrohClientTiming), String> {
    let mut timing = IrohClientTiming::default();
    let open_started_at = Instant::now();
    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|error| format!("opening Iroh stream: {error}"))?;
    timing.open_stream_ms = elapsed_ms(open_started_at);

    let bridge_started_at = Instant::now();
    write_json_frame(
        &mut send,
        &BridgeRequest::Connect {
            v: PROTOCOL_VERSION,
            token: request.pair_payload.token.clone(),
            agent: FORGE_AGENT_NAME.to_string(),
        },
    )
    .await?;
    let ack: BridgeResponse = read_json_frame(&mut recv).await?;
    validate_bridge_response(&ack)?;
    timing.bridge_ack_ms = elapsed_ms(bridge_started_at);

    let write_started_at = Instant::now();
    write_json_frame(
        &mut send,
        &ForgeHttpRequest {
            v: PROTOCOL_VERSION,
            method: request.method,
            path: request.path,
            headers: request.headers,
            body_base64: request.body_base64,
        },
    )
    .await?;
    timing.write_request_ms = elapsed_ms(write_started_at);

    let response_started_at = Instant::now();
    let response = tokio::time::timeout(
        Duration::from_secs(60),
        read_json_frame::<ForgeHttpResponse, _>(&mut recv),
    )
    .await
    .map_err(|_| "timed out waiting for Forge Iroh response".to_string())??;
    timing.response_wait_ms = elapsed_ms(response_started_at);
    Ok((response, timing))
}

#[derive(Debug, Default)]
struct IrohClientTiming {
    connection_reused: bool,
    connection_ms: u128,
    open_stream_ms: u128,
    bridge_ack_ms: u128,
    write_request_ms: u128,
    response_wait_ms: u128,
    total_ms: u128,
}

impl IrohClientTiming {
    fn to_header_value(&self) -> String {
        format!(
            "reused={},total={},connection={},openStream={},bridgeAck={},writeRequest={},responseWait={}",
            if self.connection_reused { 1 } else { 0 },
            self.total_ms,
            self.connection_ms,
            self.open_stream_ms,
            self.bridge_ack_ms,
            self.write_request_ms,
            self.response_wait_ms
        )
    }
}

fn elapsed_ms(started_at: Instant) -> u128 {
    started_at.elapsed().as_millis()
}

fn validate_pair_payload(payload: &PairPayload) -> Result<(), String> {
    if payload.v != PROTOCOL_VERSION {
        return Err(format!(
            "Iroh bridge protocol mismatch: payload={} client={}",
            payload.v, PROTOCOL_VERSION
        ));
    }
    if payload.node_id.trim().is_empty() {
        return Err("Iroh node id was empty".to_string());
    }
    if payload.token.trim().is_empty() {
        return Err("Iroh pairing token was empty".to_string());
    }
    Ok(())
}

fn validate_proxy_path(path: &str) -> Result<(), String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        return Err("absolute proxy paths are not allowed".to_string());
    }
    if !path.starts_with('/') {
        return Err("proxy path must start with /".to_string());
    }
    Ok(())
}

fn validate_bridge_response(response: &BridgeResponse) -> Result<(), String> {
    if response.v != PROTOCOL_VERSION {
        return Err(format!(
            "Iroh bridge response protocol mismatch: host={} client={}",
            response.v, PROTOCOL_VERSION
        ));
    }
    if !response.ok {
        return Err(response
            .error
            .clone()
            .unwrap_or_else(|| "Forge Iroh host rejected the request".to_string()));
    }
    Ok(())
}

async fn read_json_frame<T, R>(reader: &mut R) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
    R: AsyncRead + Unpin,
{
    let len = reader
        .read_u32()
        .await
        .map_err(|error| format!("reading frame length: {error}"))? as usize;
    if len > MAX_FRAME_BYTES {
        return Err(format!("frame too large: {len} bytes"));
    }
    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .await
        .map_err(|error| format!("reading frame body: {error}"))?;
    serde_json::from_slice(&buf).map_err(|error| format!("decoding JSON frame: {error}"))
}

async fn write_json_frame<T, W>(writer: &mut W, value: &T) -> Result<(), String>
where
    T: serde::Serialize,
    W: AsyncWrite + Unpin,
{
    let buf = serde_json::to_vec(value).map_err(|error| format!("encoding JSON frame: {error}"))?;
    if buf.len() > MAX_FRAME_BYTES {
        return Err(format!("frame too large: {} bytes", buf.len()));
    }
    writer
        .write_u32(buf.len() as u32)
        .await
        .map_err(|error| format!("writing frame length: {error}"))?;
    writer
        .write_all(&buf)
        .await
        .map_err(|error| format!("writing frame body: {error}"))?;
    writer
        .flush()
        .await
        .map_err(|error| format!("flushing frame: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_rejects_null_input() {
        let ptr = forge_iroh_http_request_json(std::ptr::null());
        assert!(!ptr.is_null());
        let response = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().to_string();
        forge_iroh_free_string(ptr);
        assert!(response.contains("input JSON pointer was null"));
    }

    #[test]
    fn proxy_path_rejects_absolute_urls() {
        assert!(validate_proxy_path("https://example.com/api/v1/health").is_err());
    }

    #[test]
    fn ffi_reuses_runtime_and_endpoint_between_requests() {
        let state = ffi_state().expect("ffi state");
        let first = state
            .runtime
            .block_on(state.cached_endpoint())
            .expect("first endpoint");
        let second = state
            .runtime
            .block_on(state.cached_endpoint())
            .expect("second endpoint");

        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn connection_cache_key_tracks_remote_and_token() {
        let payload = PairPayload {
            v: PROTOCOL_VERSION,
            node_id: "node-a".to_string(),
            token: "token-a".to_string(),
            host_name: Some("host".to_string()),
            relay: Some("https://relay.example".to_string()),
        };
        let same = PairPayload {
            host_name: None,
            ..payload.clone()
        };
        let different_token = PairPayload {
            token: "token-b".to_string(),
            ..payload.clone()
        };

        assert_eq!(
            ConnectionCacheKey::from_payload(&payload),
            ConnectionCacheKey::from_payload(&same)
        );
        assert_ne!(
            ConnectionCacheKey::from_payload(&payload),
            ConnectionCacheKey::from_payload(&different_token)
        );
    }

    #[test]
    fn iroh_client_timing_header_names_response_wait() {
        let timing = IrohClientTiming {
            connection_reused: true,
            connection_ms: 1,
            open_stream_ms: 2,
            bridge_ack_ms: 3,
            write_request_ms: 4,
            response_wait_ms: 5,
            total_ms: 15,
        };

        assert_eq!(
            timing.to_header_value(),
            "reused=1,total=15,connection=1,openStream=2,bridgeAck=3,writeRequest=4,responseWait=5"
        );
    }

    #[test]
    fn ffi_runtime_keeps_up_with_foreground_health_sync_window() {
        assert!(
            FFI_RUNTIME_WORKER_THREADS >= FOREGROUND_HEALTH_SYNC_STREAMS,
            "Iroh FFI runtime workers should not be narrower than foreground HealthKit streams"
        );
    }
}
