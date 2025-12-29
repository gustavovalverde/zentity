use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::sync::OnceLock;
use tfhe::{generate_keys, ClientKey, CompressedPublicKey, CompressedServerKey, ConfigBuilder};

use crate::crypto::{get_key_store, init_keys};

struct TestKeyMaterial {
    client_key_bytes: Vec<u8>,
    public_key_b64: String,
    key_id: String,
}

static TEST_KEYS: OnceLock<TestKeyMaterial> = OnceLock::new();

pub fn get_test_keys() -> (ClientKey, String, String) {
    let material = TEST_KEYS.get_or_init(|| {
        init_keys();

        let config = ConfigBuilder::default().build();
        let (client_key, _server_key) = generate_keys(config);
        let public_key = CompressedPublicKey::new(&client_key);
        let server_key = CompressedServerKey::new(&client_key).decompress();
        let key_id = get_key_store().register_server_key(server_key);

        let public_key_b64 = BASE64.encode(bincode::serialize(&public_key).unwrap());
        let client_key_bytes = bincode::serialize(&client_key).unwrap();

        TestKeyMaterial {
            client_key_bytes,
            public_key_b64,
            key_id,
        }
    });

    let client_key: ClientKey = bincode::deserialize(&material.client_key_bytes).unwrap();

    (
        client_key,
        material.public_key_b64.clone(),
        material.key_id.clone(),
    )
}
