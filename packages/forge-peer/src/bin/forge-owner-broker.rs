#![forbid(unsafe_code)]

use std::io::{Read as _, Write as _};
use std::net::IpAddr;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use forge_peer::codec::Validate as _;
use forge_peer::owner_broker::{
    OWNER_BROKER_PROTOCOL, OwnerBrokerRequest, OwnerBrokerServer, approve_owner_request,
};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use url::Url;

const MAX_STDIN_BYTES: u64 = 8 * 1024;
const MAX_BROWSER_CHALLENGE_BYTES: u64 = 32 * 1024;

#[derive(Debug, Parser)]
#[command(version, about = "Forge native local-owner authentication broker")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Verify one exact owner request over a kernel-authenticated Unix socket.
    Serve {
        #[arg(long)]
        socket: PathBuf,
    },
    /// Submit an exact request from the local owner helper.
    Approve {
        #[arg(long)]
        socket: PathBuf,
    },
    /// Approve a browser transaction containing only public bootstrap material.
    ApproveUrl {
        #[arg(long)]
        url: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum BrokerEvent<'a> {
    Ready {
        protocol: &'a str,
    },
    Verified {
        #[serde(rename = "requestId")]
        request_id: &'a str,
        #[serde(rename = "peerUid")]
        peer_uid: u32,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrowserChallengeBroker {
    socket_path: PathBuf,
    request: OwnerBrokerRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrowserChallengeResponse {
    broker: BrowserChallengeBroker,
}

struct BrowserHandlerRequest {
    api_origin: Url,
    browser_origin: String,
    transaction_id: String,
    browser_nonce: String,
}

fn read_request() -> Result<OwnerBrokerRequest, String> {
    let mut body = Vec::new();
    std::io::stdin()
        .take(MAX_STDIN_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|error| format!("reading bounded request: {error}"))?;
    if body.is_empty() || body.len() as u64 > MAX_STDIN_BYTES {
        return Err("owner request is empty or oversized".into());
    }
    let mut deserializer = serde_json::Deserializer::from_slice(&body);
    let request = OwnerBrokerRequest::deserialize(&mut deserializer)
        .map_err(|error| format!("decoding strict owner request: {error}"))?;
    deserializer
        .end()
        .map_err(|error| format!("owner request contains trailing data: {error}"))?;
    request
        .validate()
        .map_err(|error| format!("validating owner request: {error}"))?;
    Ok(request)
}

fn write_event(event: &BrokerEvent<'_>) -> Result<(), String> {
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, event)
        .map_err(|error| format!("encoding broker event: {error}"))?;
    stdout
        .write_all(b"\n")
        .and_then(|()| stdout.flush())
        .map_err(|error| format!("writing broker event: {error}"))
}

fn parse_browser_handler_url(value: &str) -> Result<BrowserHandlerRequest, String> {
    let parsed =
        Url::parse(value).map_err(|error| format!("parsing browser handler URL: {error}"))?;
    if parsed.scheme() != "forge"
        || parsed.host_str() != Some("local-auth")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !matches!(parsed.path(), "" | "/")
        || parsed.fragment().is_some()
    {
        return Err("browser handler URL is not Forge local authentication".into());
    }
    let mut api_origin = None;
    let mut browser_origin = None;
    let mut transaction_id = None;
    let mut browser_nonce = None;
    for (name, value) in parsed.query_pairs() {
        let slot = match name.as_ref() {
            "apiOrigin" => &mut api_origin,
            "browserOrigin" => &mut browser_origin,
            "transactionId" => &mut transaction_id,
            "browserNonce" => &mut browser_nonce,
            _ => return Err("browser handler URL contains an unknown field".into()),
        };
        if slot.replace(value.into_owned()).is_some() {
            return Err("browser handler URL contains a duplicate field".into());
        }
    }
    let api_origin = Url::parse(
        api_origin
            .as_deref()
            .ok_or("browser handler URL has no API origin")?,
    )
    .map_err(|error| format!("parsing browser API origin: {error}"))?;
    let host = api_origin
        .host_str()
        .ok_or("browser API origin has no host")?;
    let loopback = host == "localhost"
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if api_origin.scheme() != "http"
        || !loopback
        || !api_origin.username().is_empty()
        || api_origin.password().is_some()
        || api_origin.path() != "/"
        || api_origin.query().is_some()
        || api_origin.fragment().is_some()
    {
        return Err("browser API origin must be exact loopback HTTP".into());
    }
    let browser_origin = Url::parse(
        browser_origin
            .as_deref()
            .ok_or("browser handler URL has no browser origin")?,
    )
    .map_err(|error| format!("parsing browser origin: {error}"))?;
    let browser_host = browser_origin
        .host_str()
        .ok_or("browser origin has no host")?;
    let browser_loopback = browser_host == "localhost"
        || browser_host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if browser_origin.scheme() != "http"
        || !browser_loopback
        || !browser_origin.username().is_empty()
        || browser_origin.password().is_some()
        || browser_origin.path() != "/"
        || browser_origin.query().is_some()
        || browser_origin.fragment().is_some()
    {
        return Err("browser origin must be exact loopback HTTP".into());
    }
    let transaction_id = transaction_id.ok_or("browser handler URL has no transaction")?;
    let browser_nonce = browser_nonce.ok_or("browser handler URL has no nonce")?;
    if !(16..=160).contains(&transaction_id.len())
        || !transaction_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        || !(43..=128).contains(&browser_nonce.len())
        || !browser_nonce
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err("browser handler transaction binding is malformed".into());
    }
    Ok(BrowserHandlerRequest {
        api_origin,
        browser_origin: browser_origin.origin().ascii_serialization(),
        transaction_id,
        browser_nonce,
    })
}

async fn read_browser_challenge(
    input: &BrowserHandlerRequest,
) -> Result<BrowserChallengeBroker, String> {
    let port = input
        .api_origin
        .port_or_known_default()
        .ok_or("browser API origin has no port")?;
    let addresses = input
        .api_origin
        .socket_addrs(|| None)
        .map_err(|error| format!("resolving browser API origin: {error}"))?;
    let address = addresses
        .into_iter()
        .find(|candidate| candidate.ip().is_loopback() && candidate.port() == port)
        .ok_or("browser API origin did not resolve to loopback")?;
    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .map_err(|error| format!("connecting to Forge browser challenge: {error}"))?;
    let body = serde_json::to_vec(&serde_json::json!({
        "transactionId": input.transaction_id,
        "browserOrigin": input.browser_origin,
        "browserNonce": input.browser_nonce
    }))
    .map_err(|error| format!("encoding browser challenge request: {error}"))?;
    let host = input
        .api_origin
        .host_str()
        .ok_or("browser API origin has no host")?;
    let host_header = if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    let request = format!(
        "POST /api/v1/auth/local/browser/challenge HTTP/1.1\r\nHost: {host_header}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|error| format!("writing browser challenge request: {error}"))?;
    stream
        .write_all(&body)
        .await
        .map_err(|error| format!("writing browser challenge body: {error}"))?;
    let mut response = Vec::new();
    stream
        .take(MAX_BROWSER_CHALLENGE_BYTES + 1)
        .read_to_end(&mut response)
        .await
        .map_err(|error| format!("reading browser challenge response: {error}"))?;
    if response.len() as u64 > MAX_BROWSER_CHALLENGE_BYTES {
        return Err("browser challenge response is oversized".into());
    }
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("browser challenge response has no header boundary")?;
    let header_bytes = &response[..header_end];
    let body_bytes = &response[header_end + 4..];
    let headers =
        std::str::from_utf8(header_bytes).map_err(|_| "browser challenge headers are not UTF-8")?;
    let mut lines = headers.split("\r\n");
    let status = lines
        .next()
        .ok_or("browser challenge response has no status")?;
    if !status.starts_with("HTTP/1.1 200 ") {
        return Err(format!("Forge browser challenge returned {status}"));
    }
    let mut content_length = None;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or("browser challenge response contains a malformed header")?;
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err("browser challenge response uses transfer encoding".into());
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err("browser challenge response repeats content length".into());
            }
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| "browser challenge content length is invalid")?,
            );
        }
    }
    if content_length != Some(body_bytes.len()) {
        return Err("browser challenge response length does not match".into());
    }
    let response: BrowserChallengeResponse = serde_json::from_slice(body_bytes)
        .map_err(|error| format!("decoding browser challenge response: {error}"))?;
    response
        .broker
        .request
        .validate()
        .map_err(|error| format!("validating browser broker request: {error}"))?;
    if response.broker.request.transaction_id != input.transaction_id
        || response.broker.request.browser_origin != input.browser_origin
        || response.broker.request.browser_nonce != input.browser_nonce
    {
        return Err("browser broker request is bound to another transaction".into());
    }
    Ok(response.broker)
}

#[tokio::main]
async fn main() -> ExitCode {
    let result = match Cli::parse().command {
        Command::Serve { socket } => {
            async {
                let expected = read_request()?;
                let server = OwnerBrokerServer::bind(socket)
                    .map_err(|error| format!("binding native owner broker: {error}"))?;
                write_event(&BrokerEvent::Ready {
                    protocol: OWNER_BROKER_PROTOCOL,
                })?;
                let verified = server
                    .serve_once(&expected)
                    .await
                    .map_err(|error| format!("verifying local owner: {error}"))?;
                write_event(&BrokerEvent::Verified {
                    request_id: &verified.request.request_id,
                    peer_uid: verified.peer_uid,
                })
            }
            .await
        }
        Command::Approve { socket } => {
            async {
                let request = read_request()?;
                approve_owner_request(socket, &request)
                    .await
                    .map_err(|error| format!("submitting local owner approval: {error}"))
            }
            .await
        }
        Command::ApproveUrl { url } => {
            async {
                let handler = parse_browser_handler_url(&url)?;
                let challenge = read_browser_challenge(&handler).await?;
                approve_owner_request(challenge.socket_path, &challenge.request)
                    .await
                    .map_err(|error| format!("submitting browser owner approval: {error}"))
            }
            .await
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_browser_handler_url;

    #[test]
    fn browser_handler_accepts_only_public_loopback_transaction_material() {
        let parsed = parse_browser_handler_url(
            "forge://local-auth?apiOrigin=http%3A%2F%2F127.0.0.1%3A4317&browserOrigin=http%3A%2F%2F127.0.0.1%3A3027&transactionId=local_1234567890abcdef&browserNonce=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        )
        .expect("valid public handler URL");
        assert_eq!(
            parsed.api_origin.origin().ascii_serialization(),
            "http://127.0.0.1:4317"
        );
        assert_eq!(parsed.browser_origin, "http://127.0.0.1:3027");
        assert_eq!(parsed.transaction_id, "local_1234567890abcdef");
    }

    #[test]
    fn browser_handler_rejects_unknown_duplicate_and_remote_material() {
        for invalid in [
            "forge://local-auth?apiOrigin=http%3A%2F%2F127.0.0.1%3A4317&browserOrigin=http%3A%2F%2F127.0.0.1%3A3027&transactionId=local_1234567890abcdef&browserNonce=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&token=fg_secret",
            "forge://local-auth?apiOrigin=http%3A%2F%2F127.0.0.1%3A4317&apiOrigin=http%3A%2F%2F127.0.0.1%3A4317&browserOrigin=http%3A%2F%2F127.0.0.1%3A3027&transactionId=local_1234567890abcdef&browserNonce=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "forge://local-auth?apiOrigin=https%3A%2F%2Fforge.example.test&browserOrigin=http%3A%2F%2F127.0.0.1%3A3027&transactionId=local_1234567890abcdef&browserNonce=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "forge://local-auth?apiOrigin=http%3A%2F%2F127.0.0.1%3A4317&browserOrigin=https%3A%2F%2Fforge.example.test&transactionId=local_1234567890abcdef&browserNonce=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ] {
            assert!(parse_browser_handler_url(invalid).is_err(), "{invalid}");
        }
    }
}
