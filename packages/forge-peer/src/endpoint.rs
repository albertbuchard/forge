use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use async_trait::async_trait;
use bincode::{Decode, Encode};
use sha3::{Digest as _, Sha3_256};
use subtle::ConstantTimeEq as _;
use url::{Host, Url};

use crate::codec::{BoundedString, Validate};
use crate::error::{PeerError, Result, invalid};

pub const MAX_ENDPOINTS_PER_PEER: usize = 8;
const MAX_RESOLVED_ADDRESSES: usize = 8;
const ENDPOINT_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum IpAddress {
    V4([u8; 4]),
    V6([u8; 16]),
}

impl IpAddress {
    pub fn to_std(self) -> IpAddr {
        match self {
            Self::V4(bytes) => IpAddr::V4(Ipv4Addr::from(bytes)),
            Self::V6(bytes) => IpAddr::V6(Ipv6Addr::from(bytes)),
        }
    }
}

impl From<IpAddr> for IpAddress {
    fn from(value: IpAddr) -> Self {
        match value {
            IpAddr::V4(address) => Self::V4(address.octets()),
            IpAddr::V6(address) => Self::V6(address.octets()),
        }
    }
}

impl Validate for IpAddress {
    fn validate(&self) -> Result<()> {
        validate_direct_ip_syntax(self.to_std())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct DirectEndpoint {
    pub address: IpAddress,
    pub port: u16,
}

impl DirectEndpoint {
    pub fn socket_addr(&self) -> Result<SocketAddr> {
        validate_direct_ip(self.address.to_std())?;
        validate_port(self.port)?;
        Ok(SocketAddr::new(self.address.to_std(), self.port))
    }

    pub fn socket_addr_with_loopback(&self, allow_loopback: bool) -> Result<SocketAddr> {
        let address = self.address.to_std();
        if allow_loopback && address.is_loopback() {
            validate_direct_ip_syntax(address)?;
            validate_port(self.port)?;
        } else {
            validate_direct_ip(address)?;
            validate_port(self.port)?;
        }
        Ok(SocketAddr::new(self.address.to_std(), self.port))
    }
}

impl Validate for DirectEndpoint {
    fn validate(&self) -> Result<()> {
        self.address.validate()?;
        validate_port(self.port)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct IrohEndpointDescriptor {
    pub endpoint_id: [u8; 32],
    pub relay_origin: Option<BoundedString<256>>,
}

impl Validate for IrohEndpointDescriptor {
    fn validate(&self) -> Result<()> {
        if self.endpoint_id == [0; 32] {
            return Err(invalid("Iroh endpoint id is all zero"));
        }
        if let Some(relay) = &self.relay_origin {
            relay.validate()?;
            validate_https_origin_syntax(relay.as_str())?;
            if canonical_origin(relay.as_str())? != relay.as_str() {
                return Err(invalid("Iroh relay origin is not canonical"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct TorEndpoint {
    pub onion_host: BoundedString<80>,
    pub port: u16,
}

impl Validate for TorEndpoint {
    fn validate(&self) -> Result<()> {
        self.onion_host.validate()?;
        validate_onion_v3(self.onion_host.as_str())?;
        validate_port(self.port)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct MailboxEndpointDescriptor {
    pub origin: BoundedString<256>,
    pub opaque_channel: [u8; 32],
}

impl Validate for MailboxEndpointDescriptor {
    fn validate(&self) -> Result<()> {
        self.origin.validate()?;
        validate_https_origin_syntax(self.origin.as_str())?;
        if canonical_origin(self.origin.as_str())? != self.origin.as_str() {
            return Err(invalid("mailbox origin is not canonical"));
        }
        if self.opaque_channel == [0; 32] {
            return Err(invalid("mailbox channel id is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub enum EndpointDescriptor {
    Direct(DirectEndpoint),
    Iroh(IrohEndpointDescriptor),
    Tor(TorEndpoint),
    HttpMailbox(MailboxEndpointDescriptor),
}

impl Validate for EndpointDescriptor {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Direct(value) => value.validate(),
            Self::Iroh(value) => value.validate(),
            Self::Tor(value) => value.validate(),
            Self::HttpMailbox(value) => value.validate(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct MailboxEndpointPolicy {
    allowed_origins: BTreeSet<String>,
    private_origin_exceptions: BTreeSet<String>,
    loopback_origin_exceptions: BTreeSet<String>,
}

impl MailboxEndpointPolicy {
    pub fn new(
        allowed_origins: impl IntoIterator<Item = String>,
        private_origin_exceptions: impl IntoIterator<Item = String>,
    ) -> Result<Self> {
        let mut policy = Self::default();
        for origin in allowed_origins {
            policy.allowed_origins.insert(canonical_origin(&origin)?);
        }
        for origin in private_origin_exceptions {
            let origin = canonical_origin(&origin)?;
            if !policy.allowed_origins.contains(&origin) {
                return Err(PeerError::Endpoint(
                    "private mailbox exception is not in the origin allowlist".into(),
                ));
            }
            policy.private_origin_exceptions.insert(origin);
        }
        Ok(policy)
    }

    pub fn with_loopback_exceptions(
        mut self,
        loopback_origin_exceptions: impl IntoIterator<Item = String>,
    ) -> Result<Self> {
        for origin in loopback_origin_exceptions {
            let origin = canonical_origin(&origin)?;
            if !self.allowed_origins.contains(&origin) {
                return Err(PeerError::Endpoint(
                    "loopback mailbox exception is not in the origin allowlist".into(),
                ));
            }
            self.loopback_origin_exceptions.insert(origin);
        }
        Ok(self)
    }

    fn permits(&self, origin: &str) -> bool {
        self.allowed_origins.contains(origin)
    }

    fn permits_private(&self, origin: &str) -> bool {
        self.private_origin_exceptions.contains(origin)
    }

    fn permits_loopback(&self, origin: &str) -> bool {
        self.loopback_origin_exceptions.contains(origin)
    }
}

#[derive(Debug, Clone)]
pub struct ValidatedMailboxOrigin {
    url: Url,
    canonical_origin: String,
    host: String,
    port: u16,
    pinned_addresses: Vec<SocketAddr>,
}

impl ValidatedMailboxOrigin {
    pub fn url(&self) -> &Url {
        &self.url
    }

    pub fn canonical_origin(&self) -> &str {
        &self.canonical_origin
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub const fn port(&self) -> u16 {
        self.port
    }

    pub fn pinned_addresses(&self) -> &[SocketAddr] {
        &self.pinned_addresses
    }
}

#[async_trait]
pub trait EndpointResolver: Send + Sync {
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemEndpointResolver;

#[async_trait]
impl EndpointResolver for SystemEndpointResolver {
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>> {
        let resolved = tokio::net::lookup_host((host, port))
            .await
            .map_err(|error| {
                PeerError::Endpoint(format!("mailbox DNS resolution failed: {error}"))
            })?;
        Ok(resolved.take(MAX_RESOLVED_ADDRESSES + 1).collect())
    }
}

pub async fn validate_mailbox_origin(
    raw: &str,
    policy: &MailboxEndpointPolicy,
    resolver: &dyn EndpointResolver,
) -> Result<ValidatedMailboxOrigin> {
    let url = parse_https_origin(raw)?;
    let origin = canonical_origin_from_url(&url)?;
    if !policy.permits(&origin) {
        return Err(PeerError::Endpoint(
            "mailbox origin is not explicitly allowlisted".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| PeerError::Endpoint("mailbox origin has no host".into()))?
        .to_ascii_lowercase();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| PeerError::Endpoint("mailbox origin has no valid port".into()))?;
    let mut addresses =
        tokio::time::timeout(ENDPOINT_RESOLUTION_TIMEOUT, resolver.resolve(&host, port))
            .await
            .map_err(|_| PeerError::Timeout("resolving mailbox endpoint"))??;
    addresses.sort_unstable();
    addresses.dedup();
    if addresses.is_empty() {
        return Err(PeerError::Endpoint(
            "mailbox origin resolved to no addresses".into(),
        ));
    }
    if addresses.len() > MAX_RESOLVED_ADDRESSES {
        return Err(PeerError::Endpoint(format!(
            "mailbox origin resolved to more than {MAX_RESOLVED_ADDRESSES} addresses"
        )));
    }
    if policy.permits_loopback(&origin) {
        if host != "localhost" {
            return Err(PeerError::Endpoint(
                "loopback mailbox origin must use the localhost host name".into(),
            ));
        }
        for address in &addresses {
            if !normalize_ip(address.ip()).is_loopback() {
                return Err(PeerError::Endpoint(
                    "localhost mailbox origin resolved outside loopback".into(),
                ));
            }
        }
    } else if policy.permits_private(&origin) {
        for address in &addresses {
            validate_non_metadata_ip(address.ip())?;
        }
    } else {
        for address in &addresses {
            validate_public_ip(address.ip())?;
        }
    }
    Ok(ValidatedMailboxOrigin {
        url,
        canonical_origin: origin,
        host,
        port,
        pinned_addresses: addresses,
    })
}

pub fn validate_onion_v3(host: &str) -> Result<()> {
    let Some(label) = host.strip_suffix(".onion") else {
        return Err(PeerError::Endpoint(
            "Tor endpoint must end in .onion".into(),
        ));
    };
    if label.len() != 56 {
        return Err(PeerError::Endpoint(
            "Tor v3 service id must contain exactly 56 base32 characters".into(),
        ));
    }
    let decoded = decode_onion_service_id(label)?;
    if decoded[34] != 3 {
        return Err(PeerError::Endpoint(
            "Tor v3 service id has an unsupported version".into(),
        ));
    }
    let mut checksum_input = Vec::with_capacity(15 + 32 + 1);
    checksum_input.extend_from_slice(b".onion checksum");
    checksum_input.extend_from_slice(&decoded[..32]);
    checksum_input.push(decoded[34]);
    let expected_checksum = Sha3_256::digest(checksum_input);
    if decoded[32..34].ct_eq(&expected_checksum[..2]).unwrap_u8() != 1 {
        return Err(PeerError::Endpoint(
            "Tor v3 service id checksum is invalid".into(),
        ));
    }
    Ok(())
}

fn decode_onion_service_id(label: &str) -> Result<[u8; 35]> {
    let mut output = [0_u8; 35];
    let mut output_index = 0_usize;
    let mut accumulator = 0_u16;
    let mut bits = 0_u8;
    for byte in label.bytes() {
        let value = match byte {
            b'a'..=b'z' => u16::from(byte - b'a'),
            b'2'..=b'7' => u16::from(byte - b'2' + 26),
            _ => {
                return Err(PeerError::Endpoint(
                    "Tor v3 service id contains invalid base32 characters".into(),
                ));
            }
        };
        accumulator = (accumulator << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            let decoded = accumulator >> bits;
            output[output_index] = u8::try_from(decoded & 0xff)
                .map_err(|_| invalid("Tor base32 output does not fit u8"))?;
            output_index += 1;
            accumulator &= if bits == 0 { 0 } else { (1_u16 << bits) - 1 };
        }
    }
    if output_index != output.len() || bits != 0 {
        return Err(PeerError::Endpoint(
            "Tor v3 service id has invalid base32 padding".into(),
        ));
    }
    Ok(output)
}

pub fn validate_direct_ip(address: IpAddr) -> Result<()> {
    validate_direct_ip_syntax(address)?;
    match normalize_ip(address) {
        IpAddr::V4(address)
            if address.is_unspecified()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_multicast()
                || address == Ipv4Addr::BROADCAST =>
        {
            Err(PeerError::Endpoint(
                "direct endpoint uses a non-routable or unsafe IPv4 address".into(),
            ))
        }
        IpAddr::V6(address)
            if address.is_unspecified()
                || address.is_loopback()
                || address.is_multicast()
                || is_ipv6_link_local(address) =>
        {
            Err(PeerError::Endpoint(
                "direct endpoint uses a non-routable or unsafe IPv6 address".into(),
            ))
        }
        _ => Ok(()),
    }
}

fn validate_direct_ip_syntax(address: IpAddr) -> Result<()> {
    if normalize_ip(address).is_loopback() {
        return Ok(());
    }
    validate_non_metadata_ip(address)?;
    match normalize_ip(address) {
        IpAddr::V4(address)
            if address.is_unspecified()
                || address.is_link_local()
                || address.is_multicast()
                || address == Ipv4Addr::BROADCAST =>
        {
            Err(PeerError::Endpoint(
                "direct endpoint uses an unsafe IPv4 address".into(),
            ))
        }
        IpAddr::V6(address)
            if address.is_unspecified()
                || address.is_multicast()
                || is_ipv6_link_local(address) =>
        {
            Err(PeerError::Endpoint(
                "direct endpoint uses an unsafe IPv6 address".into(),
            ))
        }
        _ => Ok(()),
    }
}

pub fn validate_public_ip(address: IpAddr) -> Result<()> {
    validate_non_metadata_ip(address)?;
    match normalize_ip(address) {
        IpAddr::V4(address) if address.is_private() || is_ipv4_shared(address) => Err(
            PeerError::Endpoint("mailbox resolved to a non-public IPv4 address".into()),
        ),
        IpAddr::V6(address) if address.is_unique_local() => Err(PeerError::Endpoint(
            "mailbox resolved to a non-public IPv6 address".into(),
        )),
        _ => Ok(()),
    }
}

fn validate_non_metadata_ip(address: IpAddr) -> Result<()> {
    let address = normalize_ip(address);
    let blocked = match address {
        IpAddr::V4(address) => {
            address.octets()[0] == 0
                || address.is_loopback()
                || address.is_link_local()
                || address.is_multicast()
                || address.is_broadcast()
                || address.is_documentation()
                || is_ipv4_benchmarking(address)
                || is_ipv4_reserved(address)
                || is_ipv4_protocol_assignment(address)
                || is_ipv4_deprecated_6to4_relay(address)
                || address == Ipv4Addr::new(100, 100, 100, 200)
        }
        IpAddr::V6(address) => {
            (!address.is_unique_local() && !is_ipv6_global_unicast(address))
                || is_ipv6_special_global(address)
                || address == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254)
        }
    };
    if blocked {
        return Err(PeerError::Endpoint(
            "endpoint targets a local, special-use, or metadata address".into(),
        ));
    }
    Ok(())
}

fn normalize_ip(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V6(address) => address
            .to_ipv4_mapped()
            .map_or(IpAddr::V6(address), IpAddr::V4),
        value @ IpAddr::V4(_) => value,
    }
}

fn validate_port(port: u16) -> Result<()> {
    if port == 0 {
        return Err(PeerError::Endpoint("endpoint port must be non-zero".into()));
    }
    Ok(())
}

fn validate_https_origin_syntax(raw: &str) -> Result<()> {
    parse_https_origin(raw).map(|_| ())
}

fn parse_https_origin(raw: &str) -> Result<Url> {
    let url = Url::parse(raw)
        .map_err(|error| PeerError::Endpoint(format!("invalid endpoint origin: {error}")))?;
    if url.scheme() != "https" {
        return Err(PeerError::Endpoint(
            "mailbox and relay origins must use HTTPS".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PeerError::Endpoint(
            "endpoint origin cannot contain userinfo".into(),
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(PeerError::Endpoint(
            "endpoint origin cannot contain a query or fragment".into(),
        ));
    }
    if url.path() != "/" {
        return Err(PeerError::Endpoint(
            "endpoint must be an origin without an arbitrary path".into(),
        ));
    }
    let host = url
        .host()
        .ok_or_else(|| PeerError::Endpoint("endpoint origin has no host".into()))?;
    if matches!(host, Host::Domain(domain) if domain.is_empty()) {
        return Err(PeerError::Endpoint("endpoint host is empty".into()));
    }
    Ok(url)
}

fn canonical_origin(raw: &str) -> Result<String> {
    canonical_origin_from_url(&parse_https_origin(raw)?)
}

fn canonical_origin_from_url(url: &Url) -> Result<String> {
    let host = url
        .host_str()
        .ok_or_else(|| PeerError::Endpoint("endpoint origin has no host".into()))?
        .to_ascii_lowercase();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| PeerError::Endpoint("endpoint origin has no valid port".into()))?;
    if port == 443 {
        Ok(format!("https://{host}"))
    } else {
        Ok(format!("https://{host}:{port}"))
    }
}

const fn is_ipv4_shared(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 100 && (octets[1] & 0b1100_0000) == 64
}

const fn is_ipv4_benchmarking(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
}

const fn is_ipv4_reserved(address: Ipv4Addr) -> bool {
    address.octets()[0] >= 240
}

const fn is_ipv4_protocol_assignment(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 192 && octets[1] == 0 && octets[2] == 0
}

const fn is_ipv4_deprecated_6to4_relay(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] == 192 && octets[1] == 88 && octets[2] == 99
}

const fn is_ipv6_link_local(address: Ipv6Addr) -> bool {
    address.segments()[0] & 0xffc0 == 0xfe80
}

const fn is_ipv6_documentation(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    segments[0] == 0x2001 && segments[1] == 0x0db8
}

const fn is_ipv6_global_unicast(address: Ipv6Addr) -> bool {
    address.segments()[0] & 0xe000 == 0x2000
}

const fn is_ipv6_special_global(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    is_ipv6_documentation(address)
        || segments[0] == 0x3ffe
        || segments[0] == 0x2002
        || (segments[0] == 0x2001 && segments[1] == 0)
        || (segments[0] == 0x2001 && segments[1] == 2 && segments[2] == 0)
        || (segments[0] == 0x2001
            && (segments[1] & 0xfff0 == 0x0010 || segments[1] & 0xfff0 == 0x0020))
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::SigningKey;

    use super::*;

    fn valid_onion_host() -> String {
        let public_key = SigningKey::from_bytes(&[42; 32]).verifying_key().to_bytes();
        let mut checksum_input = Vec::new();
        checksum_input.extend_from_slice(b".onion checksum");
        checksum_input.extend_from_slice(&public_key);
        checksum_input.push(3);
        let checksum = Sha3_256::digest(checksum_input);
        let mut service_id = Vec::from(public_key);
        service_id.extend_from_slice(&checksum[..2]);
        service_id.push(3);
        format!("{}.onion", encode_base32(&service_id))
    }

    fn encode_base32(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
        let mut encoded = String::new();
        let mut accumulator = 0_u16;
        let mut bits = 0_u8;
        for byte in bytes {
            accumulator = (accumulator << 8) | u16::from(*byte);
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                let index = usize::from((accumulator >> bits) & 0x1f);
                encoded.push(char::from(ALPHABET[index]));
                accumulator &= if bits == 0 { 0 } else { (1_u16 << bits) - 1 };
            }
        }
        encoded
    }

    #[test]
    fn onion_validation_requires_v3_lowercase_base32() {
        let valid = valid_onion_host();
        assert!(validate_onion_v3(&valid).is_ok());
        assert!(validate_onion_v3(&format!("{}.onion", "A".repeat(56))).is_err());
        assert!(validate_onion_v3(&format!("{}.onion", "a".repeat(56))).is_err());
        assert!(validate_onion_v3("example.com").is_err());
    }

    #[test]
    fn public_validation_rejects_metadata_and_mapped_private_addresses() {
        assert!(validate_public_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))).is_err());
        let mapped = Ipv6Addr::from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 10, 0, 0, 1]);
        assert!(validate_public_ip(IpAddr::V6(mapped)).is_err());
        assert!(
            validate_public_ip(
                "2001:db8::1"
                    .parse()
                    .unwrap_or(IpAddr::V6(Ipv6Addr::LOCALHOST))
            )
            .is_err()
        );
        assert!(
            validate_public_ip(
                "2002:0808:0808::1"
                    .parse()
                    .unwrap_or(IpAddr::V6(Ipv6Addr::LOCALHOST))
            )
            .is_err()
        );
        assert!(validate_public_ip(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))).is_ok());
        assert!(
            validate_public_ip(
                "2606:4700:4700::1111"
                    .parse()
                    .unwrap_or(IpAddr::V6(Ipv6Addr::LOCALHOST))
            )
            .is_ok()
        );
    }

    #[derive(Debug)]
    struct FixedResolver(Vec<SocketAddr>);

    #[async_trait::async_trait]
    impl EndpointResolver for FixedResolver {
        async fn resolve(&self, _host: &str, _port: u16) -> Result<Vec<SocketAddr>> {
            Ok(self.0.clone())
        }
    }

    #[tokio::test]
    async fn private_origin_exception_still_rejects_link_local_services() -> Result<()> {
        let origin = "https://mail.example".to_owned();
        let policy = MailboxEndpointPolicy::new([origin.clone()], [origin.clone()])?;
        let private = FixedResolver(vec![SocketAddr::from(([10, 0, 0, 4], 443))]);
        assert!(
            validate_mailbox_origin(&origin, &policy, &private)
                .await
                .is_ok()
        );

        let link_local = FixedResolver(vec![SocketAddr::from(([169, 254, 170, 2], 443))]);
        assert!(
            validate_mailbox_origin(&origin, &policy, &link_local)
                .await
                .is_err()
        );
        Ok(())
    }

    #[tokio::test]
    async fn loopback_origin_exception_is_localhost_only_and_exactly_pinned() -> Result<()> {
        let origin = "https://localhost:8443".to_owned();
        let loopback = FixedResolver(vec![
            SocketAddr::from(([127, 0, 0, 1], 8443)),
            SocketAddr::from((Ipv6Addr::LOCALHOST, 8443)),
        ]);
        let default_policy = MailboxEndpointPolicy::new([origin.clone()], std::iter::empty())?;
        assert!(
            validate_mailbox_origin(&origin, &default_policy, &loopback)
                .await
                .is_err()
        );
        let policy = MailboxEndpointPolicy::new([origin.clone()], std::iter::empty())?
            .with_loopback_exceptions([origin.clone()])?;
        let validated = validate_mailbox_origin(&origin, &policy, &loopback).await?;
        assert_eq!(validated.pinned_addresses(), loopback.0.as_slice());

        let escaped = FixedResolver(vec![SocketAddr::from(([10, 0, 0, 8], 8443))]);
        assert!(
            validate_mailbox_origin(&origin, &policy, &escaped)
                .await
                .is_err()
        );
        let named_origin = "https://mailbox.example:8443".to_owned();
        let named_policy = MailboxEndpointPolicy::new([named_origin.clone()], std::iter::empty())?
            .with_loopback_exceptions([named_origin.clone()])?;
        assert!(
            validate_mailbox_origin(&named_origin, &named_policy, &loopback)
                .await
                .is_err()
        );
        assert!(
            MailboxEndpointPolicy::new([origin], std::iter::empty())?
                .with_loopback_exceptions(["https://elsewhere.example".into()])
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn origin_rejects_userinfo_paths_and_arbitrary_schemes() -> Result<()> {
        assert!(parse_https_origin("http://mail.example").is_err());
        assert!(parse_https_origin("https://user@mail.example/").is_err());
        assert!(parse_https_origin("https://mail.example/forward").is_err());
        assert!(parse_https_origin("https://mail.example/").is_ok());
        assert!(
            MailboxEndpointDescriptor {
                origin: BoundedString::new("https://MAIL.example:443/")?,
                opaque_channel: [1; 32],
            }
            .validate()
            .is_err()
        );
        Ok(())
    }
}
