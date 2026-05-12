use std::ffi::{CStr, CString, c_char};
use std::time::Duration;

use iroh::{Endpoint, SecretKey};
use protocol::{
    BridgeRequest, BridgeResponse, COMPANION_ALPN, FORGE_AGENT_NAME, ForgeHttpRequest,
    ForgeHttpResponse, HeaderPair, PROTOCOL_VERSION, PairPayload,
};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub mod protocol;

const MAX_FRAME_BYTES: usize = 50 * 1024 * 1024;

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
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("building Forge Iroh runtime: {error}"))?;
    runtime.block_on(async move {
        let response = send_http_request_over_iroh(request).await?;
        Ok(FfiHttpResponse {
            ok: true,
            status: Some(response.status),
            headers: response.headers,
            body_base64: response.body_base64,
            error: None,
        })
    })
}

async fn send_http_request_over_iroh(request: FfiHttpRequest) -> Result<ForgeHttpResponse, String> {
    validate_pair_payload(&request.pair_payload)?;
    validate_proxy_path(&request.path)?;

    let endpoint = Endpoint::builder(iroh::endpoint::presets::N0)
        .secret_key(SecretKey::generate())
        .bind()
        .await
        .map_err(|error| format!("binding Iroh endpoint: {error}"))?;
    let result = async {
        let node_id = request
            .pair_payload
            .node_id
            .parse()
            .map_err(|error| format!("parsing Iroh node id: {error}"))?;
        let mut addr = iroh::EndpointAddr::new(node_id);
        if let Some(relay) = request.pair_payload.relay.as_deref() {
            addr = addr.with_relay_url(
                relay
                    .parse()
                    .map_err(|error| format!("parsing Iroh relay URL: {error}"))?,
            );
        }
        let conn = endpoint
            .connect(addr, COMPANION_ALPN)
            .await
            .map_err(|error| format!("connecting over Forge Iroh bridge: {error}"))?;
        let (mut send, mut recv) = conn
            .open_bi()
            .await
            .map_err(|error| format!("opening Iroh stream: {error}"))?;
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
        let response = tokio::time::timeout(
            Duration::from_secs(60),
            read_json_frame::<ForgeHttpResponse, _>(&mut recv),
        )
        .await
        .map_err(|_| "timed out waiting for Forge Iroh response".to_string())??;
        conn.close(
            iroh::endpoint::VarInt::from_u32(0),
            b"forge request complete",
        );
        Ok(response)
    }
    .await;
    endpoint.close().await;
    result
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
}
