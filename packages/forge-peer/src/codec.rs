use std::time::Duration;

use bincode::{Decode, Encode};
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::error::{PeerError, Result, invalid, limit};

pub const FRAME_MAGIC: [u8; 4] = *b"FGP1";
pub const FRAME_HEADER_BYTES: usize = 10;
pub const MAX_PEER_FRAME_BYTES: usize = 256 * 1024;
pub const MAX_IPC_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_APPLICATION_BYTES: usize = 128 * 1024;
pub const MAX_MLS_CIPHERTEXT_BYTES: usize = 192 * 1024;
pub const FRAME_IO_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameType {
    PeerEnvelope = 1,
    LocalIpc = 2,
}

impl FrameType {
    fn from_u8(value: u8) -> Result<Self> {
        match value {
            1 => Ok(Self::PeerEnvelope),
            2 => Ok(Self::LocalIpc),
            _ => Err(invalid(format!("unknown frame type {value}"))),
        }
    }

    const fn limit(self) -> usize {
        match self {
            Self::PeerEnvelope => MAX_PEER_FRAME_BYTES,
            Self::LocalIpc => MAX_IPC_FRAME_BYTES,
        }
    }
}

pub trait Validate {
    fn validate(&self) -> Result<()>;
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct BoundedBytes<const N: usize>(Vec<u8>);

impl<const N: usize> BoundedBytes<N> {
    pub fn new(value: Vec<u8>) -> Result<Self> {
        if value.len() > N {
            return Err(limit(format!("byte field {} exceeds {N}", value.len())));
        }
        Ok(Self(value))
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }

    pub fn into_vec(self) -> Vec<u8> {
        self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }
}

impl<const N: usize> Validate for BoundedBytes<N> {
    fn validate(&self) -> Result<()> {
        if self.0.len() > N {
            return Err(limit(format!("byte field {} exceeds {N}", self.0.len())));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct BoundedString<const N: usize>(String);

impl<const N: usize> BoundedString<N> {
    pub fn new(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        let field = Self(value);
        field.validate()?;
        Ok(field)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

impl<const N: usize> Validate for BoundedString<N> {
    fn validate(&self) -> Result<()> {
        if self.0.len() > N {
            return Err(limit(format!(
                "text field {} exceeds {N} bytes",
                self.0.len()
            )));
        }
        if self.0.contains('\0') {
            return Err(invalid("text field contains NUL"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct BoundedVec<T, const N: usize>(Vec<T>);

impl<T, const N: usize> BoundedVec<T, N> {
    pub fn new(value: Vec<T>) -> Result<Self> {
        if value.len() > N {
            return Err(limit(format!("list length {} exceeds {N}", value.len())));
        }
        Ok(Self(value))
    }

    pub fn as_slice(&self) -> &[T] {
        &self.0
    }

    pub fn into_vec(self) -> Vec<T> {
        self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl<T: Validate, const N: usize> Validate for BoundedVec<T, N> {
    fn validate(&self) -> Result<()> {
        if self.0.len() > N {
            return Err(limit(format!("list length {} exceeds {N}", self.0.len())));
        }
        for value in &self.0 {
            value.validate()?;
        }
        Ok(())
    }
}

pub fn encode_limited<const LIMIT: usize, T>(value: &T) -> Result<Vec<u8>>
where
    T: Encode + Validate,
{
    value.validate()?;
    let config = bincode::config::standard()
        .with_big_endian()
        .with_variable_int_encoding()
        .with_limit::<LIMIT>();
    let encoded = bincode::encode_to_vec(value, config)
        .map_err(|error| invalid(format!("binary encoding failed: {error}")))?;
    if encoded.len() > LIMIT {
        return Err(limit(format!(
            "encoded body {} exceeds {LIMIT}",
            encoded.len()
        )));
    }
    Ok(encoded)
}

pub fn decode_limited<const LIMIT: usize, T>(bytes: &[u8]) -> Result<T>
where
    T: Decode<()> + Validate,
{
    if bytes.len() > LIMIT {
        return Err(limit(format!(
            "encoded body {} exceeds {LIMIT}",
            bytes.len()
        )));
    }
    let config = bincode::config::standard()
        .with_big_endian()
        .with_variable_int_encoding()
        .with_limit::<LIMIT>();
    let (value, consumed): (T, usize) = bincode::decode_from_slice(bytes, config)
        .map_err(|error| invalid(format!("binary decoding failed: {error}")))?;
    if consumed != bytes.len() {
        return Err(invalid(format!(
            "trailing bytes after typed body: {}",
            bytes.len() - consumed
        )));
    }
    value.validate()?;
    Ok(value)
}

pub fn encode_frame<T>(frame_type: FrameType, value: &T) -> Result<Vec<u8>>
where
    T: Encode + Validate,
{
    let body = match frame_type {
        FrameType::PeerEnvelope => encode_limited::<MAX_PEER_FRAME_BYTES, _>(value)?,
        FrameType::LocalIpc => encode_limited::<MAX_IPC_FRAME_BYTES, _>(value)?,
    };
    let body_len =
        u32::try_from(body.len()).map_err(|_| limit("frame body length does not fit u32"))?;
    let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + body.len());
    frame.extend_from_slice(&FRAME_MAGIC);
    frame.push(frame_type as u8);
    frame.push(0); // Flags are reserved. Compression is deliberately unsupported.
    frame.extend_from_slice(&body_len.to_be_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

pub fn decode_frame<T>(expected: FrameType, frame: &[u8]) -> Result<T>
where
    T: Decode<()> + Validate,
{
    if frame.len() < FRAME_HEADER_BYTES {
        return Err(invalid("truncated frame header"));
    }
    if frame[..4] != FRAME_MAGIC {
        return Err(invalid("invalid frame magic"));
    }
    let actual = FrameType::from_u8(frame[4])?;
    if actual != expected {
        return Err(invalid(format!(
            "unexpected frame type {}; expected {}",
            frame[4], expected as u8
        )));
    }
    if frame[5] != 0 {
        return Err(invalid("unknown critical frame flags"));
    }
    let body_len = u32::from_be_bytes(
        frame[6..10]
            .try_into()
            .map_err(|_| invalid("invalid frame length"))?,
    ) as usize;
    if body_len > actual.limit() {
        return Err(limit(format!(
            "frame body {body_len} exceeds {}",
            actual.limit()
        )));
    }
    if frame.len() != FRAME_HEADER_BYTES + body_len {
        return Err(invalid("frame length does not match body"));
    }
    match actual {
        FrameType::PeerEnvelope => {
            decode_limited::<MAX_PEER_FRAME_BYTES, T>(&frame[FRAME_HEADER_BYTES..])
        }
        FrameType::LocalIpc => {
            decode_limited::<MAX_IPC_FRAME_BYTES, T>(&frame[FRAME_HEADER_BYTES..])
        }
    }
}

pub fn encode_json_frame<T>(value: &T) -> Result<Vec<u8>>
where
    T: Serialize + Validate,
{
    value.validate()?;
    let body = serde_json::to_vec(value)
        .map_err(|error| invalid(format!("JSON encoding failed: {error}")))?;
    if body.len() > MAX_IPC_FRAME_BYTES {
        return Err(limit(format!(
            "JSON IPC body {} exceeds {MAX_IPC_FRAME_BYTES}",
            body.len()
        )));
    }
    let body_len =
        u32::try_from(body.len()).map_err(|_| limit("JSON IPC body length does not fit u32"))?;
    let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + body.len());
    frame.extend_from_slice(&FRAME_MAGIC);
    frame.push(FrameType::LocalIpc as u8);
    frame.push(0);
    frame.extend_from_slice(&body_len.to_be_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

pub fn decode_json_frame<T>(frame: &[u8]) -> Result<T>
where
    T: DeserializeOwned + Validate,
{
    let body = checked_frame_body(FrameType::LocalIpc, frame)?;
    decode_json_body(body)
}

pub async fn write_frame<W, T>(writer: &mut W, frame_type: FrameType, value: &T) -> Result<()>
where
    W: AsyncWrite + Unpin,
    T: Encode + Validate,
{
    let frame = encode_frame(frame_type, value)?;
    tokio::time::timeout(FRAME_IO_TIMEOUT, async {
        writer.write_all(&frame).await?;
        writer.flush().await
    })
    .await
    .map_err(|_| PeerError::Timeout("writing protocol frame"))??;
    Ok(())
}

pub async fn read_frame<R, T>(reader: &mut R, expected: FrameType) -> Result<T>
where
    R: AsyncRead + Unpin,
    T: Decode<()> + Validate,
{
    let mut header = [0_u8; FRAME_HEADER_BYTES];
    tokio::time::timeout(FRAME_IO_TIMEOUT, reader.read_exact(&mut header))
        .await
        .map_err(|_| PeerError::Timeout("reading protocol frame header"))??;
    if header[..4] != FRAME_MAGIC {
        return Err(invalid("invalid frame magic"));
    }
    let actual = FrameType::from_u8(header[4])?;
    if actual != expected {
        return Err(invalid("unexpected frame type"));
    }
    if header[5] != 0 {
        return Err(invalid("unknown critical frame flags"));
    }
    let body_len = u32::from_be_bytes(
        header[6..10]
            .try_into()
            .map_err(|_| invalid("invalid frame length"))?,
    ) as usize;
    if body_len > actual.limit() {
        return Err(limit(format!(
            "frame body {body_len} exceeds {}",
            actual.limit()
        )));
    }
    let mut body = vec![0_u8; body_len];
    tokio::time::timeout(FRAME_IO_TIMEOUT, reader.read_exact(&mut body))
        .await
        .map_err(|_| PeerError::Timeout("reading protocol frame body"))??;
    match actual {
        FrameType::PeerEnvelope => decode_limited::<MAX_PEER_FRAME_BYTES, T>(&body),
        FrameType::LocalIpc => decode_limited::<MAX_IPC_FRAME_BYTES, T>(&body),
    }
}

pub async fn write_json_frame<W, T>(writer: &mut W, value: &T) -> Result<()>
where
    W: AsyncWrite + Unpin,
    T: Serialize + Validate,
{
    let frame = encode_json_frame(value)?;
    tokio::time::timeout(FRAME_IO_TIMEOUT, async {
        writer.write_all(&frame).await?;
        writer.flush().await
    })
    .await
    .map_err(|_| PeerError::Timeout("writing JSON IPC frame"))??;
    Ok(())
}

pub async fn read_json_frame<R, T>(reader: &mut R) -> Result<T>
where
    R: AsyncRead + Unpin,
    T: DeserializeOwned + Validate,
{
    let body = read_json_frame_body(reader).await?;
    decode_json_body(&body)
}

pub(crate) async fn read_json_frame_body<R>(reader: &mut R) -> Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut header = [0_u8; FRAME_HEADER_BYTES];
    tokio::time::timeout(FRAME_IO_TIMEOUT, reader.read_exact(&mut header))
        .await
        .map_err(|_| PeerError::Timeout("reading JSON IPC frame header"))??;
    if header[..4] != FRAME_MAGIC {
        return Err(invalid("invalid frame magic"));
    }
    let actual = FrameType::from_u8(header[4])?;
    if actual != FrameType::LocalIpc || header[5] != 0 {
        return Err(invalid("invalid JSON IPC frame type or flags"));
    }
    let body_len = u32::from_be_bytes(
        header[6..10]
            .try_into()
            .map_err(|_| invalid("invalid JSON IPC frame length"))?,
    ) as usize;
    if body_len > MAX_IPC_FRAME_BYTES {
        return Err(limit(format!(
            "JSON IPC body {body_len} exceeds {MAX_IPC_FRAME_BYTES}"
        )));
    }
    let mut body = vec![0_u8; body_len];
    tokio::time::timeout(FRAME_IO_TIMEOUT, reader.read_exact(&mut body))
        .await
        .map_err(|_| PeerError::Timeout("reading JSON IPC frame body"))??;
    Ok(body)
}

fn checked_frame_body(expected: FrameType, frame: &[u8]) -> Result<&[u8]> {
    if frame.len() < FRAME_HEADER_BYTES || frame[..4] != FRAME_MAGIC {
        return Err(invalid("truncated or invalid frame header"));
    }
    let actual = FrameType::from_u8(frame[4])?;
    if actual != expected || frame[5] != 0 {
        return Err(invalid("unexpected frame type or critical flags"));
    }
    let body_len = u32::from_be_bytes(
        frame[6..10]
            .try_into()
            .map_err(|_| invalid("invalid frame length"))?,
    ) as usize;
    if body_len > actual.limit() || frame.len() != FRAME_HEADER_BYTES + body_len {
        return Err(invalid("frame body length is invalid"));
    }
    Ok(&frame[FRAME_HEADER_BYTES..])
}

pub(crate) fn decode_json_body<T>(body: &[u8]) -> Result<T>
where
    T: DeserializeOwned + Validate,
{
    let mut deserializer = serde_json::Deserializer::from_slice(body);
    let value = T::deserialize(&mut deserializer)
        .map_err(|error| invalid(format!("JSON decoding failed: {error}")))?;
    deserializer
        .end()
        .map_err(|error| invalid(format!("trailing JSON data: {error}")))?;
    value.validate()?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    #[derive(Debug, PartialEq, Eq, Encode, Decode)]
    struct TestBody {
        value: BoundedString<16>,
    }

    impl Validate for TestBody {
        fn validate(&self) -> Result<()> {
            self.value.validate()
        }
    }

    #[test]
    fn frame_round_trip_is_exact() -> Result<()> {
        let body = TestBody {
            value: BoundedString::new("hello")?,
        };
        let frame = encode_frame(FrameType::PeerEnvelope, &body)?;
        assert_eq!(
            decode_frame::<TestBody>(FrameType::PeerEnvelope, &frame)?,
            body
        );
        Ok(())
    }

    #[test]
    fn frame_rejects_unknown_flags() -> Result<()> {
        let body = TestBody {
            value: BoundedString::new("hello")?,
        };
        let mut frame = encode_frame(FrameType::PeerEnvelope, &body)?;
        frame[5] = 1;
        assert!(decode_frame::<TestBody>(FrameType::PeerEnvelope, &frame).is_err());
        Ok(())
    }

    #[test]
    fn frame_rejects_trailing_bytes() -> Result<()> {
        let body = TestBody {
            value: BoundedString::new("hello")?,
        };
        let mut frame = encode_frame(FrameType::PeerEnvelope, &body)?;
        frame.push(0);
        assert!(decode_frame::<TestBody>(FrameType::PeerEnvelope, &frame).is_err());
        Ok(())
    }

    proptest! {
        #[test]
        fn arbitrary_frames_fail_closed_without_panicking(bytes in proptest::collection::vec(any::<u8>(), 0..4096)) {
            let _result = decode_frame::<TestBody>(FrameType::PeerEnvelope, &bytes);
        }

        #[test]
        fn bounded_ascii_strings_round_trip(value in "[A-Za-z0-9_]{0,16}") {
            let body = TestBody {
                value: BoundedString::new(value)?,
            };
            let frame = encode_frame(FrameType::PeerEnvelope, &body)?;
            prop_assert_eq!(decode_frame::<TestBody>(FrameType::PeerEnvelope, &frame)?, body);
        }
    }
}
