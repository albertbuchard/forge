use tokio::io::AsyncWriteExt;

use crate::codec::{FrameType, read_frame, write_frame};
use crate::envelope::SignedEnvelope;
use crate::error::Result;
use crate::provider::BoxPeerStream;

pub async fn send_on_stream(mut stream: BoxPeerStream, envelope: &SignedEnvelope) -> Result<()> {
    write_frame(&mut stream, FrameType::PeerEnvelope, envelope).await?;
    stream.shutdown().await?;
    Ok(())
}

pub async fn receive_on_stream(mut stream: BoxPeerStream) -> Result<SignedEnvelope> {
    read_frame(&mut stream, FrameType::PeerEnvelope).await
}
