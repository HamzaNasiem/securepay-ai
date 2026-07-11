import os
import logging
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)
_KDF_SALT = b"securepay-ai-vault-v1-fixed-salt"

def derive_kek(version: int) -> bytes:
    """
    Derives a version-specific Key Encryption Key (KEK) deterministically 
    from VAULT_ENCRYPTION_KEY using PBKDF2-HMAC-SHA256.
    Allows simulating dynamic KMS key rotation by incrementing the version index.
    """
    raw = os.environ.get("VAULT_ENCRYPTION_KEY", "").strip()
    if not raw:
        raise RuntimeError("VAULT_ENCRYPTION_KEY is not configured in environment.")
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_KDF_SALT,
        iterations=100_000,
    )
    # Combine secret with KEK version tag
    data_input = f"{raw}_version_{version}".encode("utf-8")
    return kdf.derive(data_input)
