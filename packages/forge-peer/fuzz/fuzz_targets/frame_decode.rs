#![no_main]

use forge_peer::codec::{FrameType, decode_frame, decode_json_frame};
use forge_peer::envelope::SignedEnvelope;
use forge_peer::ipc::IpcRequest;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = decode_frame::<SignedEnvelope>(FrameType::PeerEnvelope, data);
    let _ = decode_json_frame::<IpcRequest>(data);
});
