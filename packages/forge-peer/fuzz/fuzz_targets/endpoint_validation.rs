#![no_main]

use forge_peer::endpoint::{MailboxEndpointPolicy, validate_onion_v3};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(value) = std::str::from_utf8(data) {
        let _ = validate_onion_v3(value);
        let _ = MailboxEndpointPolicy::new([value.to_owned()], std::iter::empty());
    }
});
