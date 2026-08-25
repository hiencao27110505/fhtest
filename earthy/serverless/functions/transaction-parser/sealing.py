"""Sealing a parsed transaction to a family's key.

This is the boundary the whole feature stands on. Everything before it holds
plaintext — this function read the mail, so of course it does. Everything after
it holds ciphertext the pipeline cannot open again, because the ephemeral secret
that made it is destroyed before this returns.

THERE ARE THREE IMPLEMENTATIONS OF THIS ENVELOPE AND THEY MUST AGREE EXACTLY.

    pipeline/sealed-box.gs                      Apps Script, forwarding
    supabase/functions/_shared/mailbox/…mjs     JavaScript
    this file                                   Python, direct read

and exactly ONE opener, on the client: `fhStagingOpenRow` in
src/js-data/18-staging-keys.js. A divergence does not fail near itself. The row
inserts, the queue renders, and the person sees "không mở được" against a
transaction they can no longer recover. `tests/test_sealing.py` seals with this
module and opens with that client code, so the claim is proven rather than
asserted.

WIRE FORMAT (v1) — what lands on an email_transactions row:

    sealed   base64( crypto_box(payload_utf8, nonce, family_pub, eph_priv) )
    eph_pub  base64( 32-byte ephemeral public key )
    nonce    base64( 24-byte nonce )
    enc_v    1

Ephemeral-static X25519 + XSalsa20-Poly1305. `family_pub` is stored in the clear
because a public key only locks; the private half is wrapped under the family's
DEK and never leaves their devices.

WHY THE BINDING IS NOT OPTIONAL. `family_id` and `gmail_message_id` are injected
into the plaintext HERE rather than trusted from the caller, and the opener
checks them against the row's own columns. Without that, anyone with database
write access could move a ciphertext onto another row of the same family and
land the wrong amount on the wrong transaction, with nothing outside the box
able to tell.
"""

from __future__ import annotations

import base64
import json
import logging
import os

log = logging.getLogger(__name__)

SEALED_BOX_VERSION = 1

_KEY_BYTES = 32
_NONCE_BYTES = 24


class CannotSeal(Exception):
    """Sealing did not happen, so nothing may be written.

    Raised for every reason: no family key, a malformed one, a missing library.
    There is deliberately no failure mode that returns a partial result, because
    the only safe response to "could not seal" is to write nothing — and a
    caller handed `None` has to remember that, while a caller handed an
    exception does not.
    """


def seal_for_family(payload: dict, family_pub_b64: str, family_id: str,
                    gmail_message_id: str) -> dict:
    """Seal `payload` to a family's staging public key.

    Returns the four envelope columns. Raises `CannotSeal` for anything else —
    see the class docstring for why there is no in-between.
    """
    try:
        from nacl.public import Box, PrivateKey, PublicKey  # noqa: PLC0415
        from nacl.utils import random as nacl_random  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - a deploy problem, not a runtime one
        raise CannotSeal("PyNaCl is not installed") from exc

    if not family_pub_b64:
        raise CannotSeal("family has no staging key yet")
    if not family_id:
        raise CannotSeal("no family_id to bind")
    if not gmail_message_id:
        raise CannotSeal("no gmail_message_id to bind")

    try:
        family_pub_raw = base64.b64decode(family_pub_b64, validate=True)
    except Exception as exc:
        raise CannotSeal("staging key is not valid base64") from exc
    if len(family_pub_raw) != _KEY_BYTES:
        raise CannotSeal(f"staging key is {len(family_pub_raw)} bytes, expected {_KEY_BYTES}")

    bound = dict(payload)
    bound["family_id"] = family_id
    bound["gmail_message_id"] = gmail_message_id
    bound["enc_v"] = SEALED_BOX_VERSION

    # separators= matters more than it looks: the default json.dumps puts a
    # space after ':' and ',', and while the opener parses either, keeping the
    # output compact is worth the ~5% of ciphertext it saves on every row.
    plaintext = json.dumps(bound, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    ephemeral = PrivateKey.generate()
    nonce = nacl_random(_NONCE_BYTES)
    box = Box(ephemeral, PublicKey(family_pub_raw))

    # PyNaCl returns nonce + ciphertext concatenated. The wire format carries
    # them in separate columns, so only the ciphertext half goes in `sealed`.
    # Passing the whole EncryptedMessage would prepend the nonce a second time
    # and every open would fail authentication.
    sealed = box.encrypt(plaintext, nonce).ciphertext

    envelope = {
        "sealed": base64.b64encode(sealed).decode("ascii"),
        "eph_pub": base64.b64encode(bytes(ephemeral.public_key)).decode("ascii"),
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "enc_v": SEALED_BOX_VERSION,
    }

    # The ephemeral secret has done its work. Python gives no guarantee that
    # `del` clears the bytes, and PyNaCl holds them in an immutable object, so
    # this is a statement of intent more than a scrub — but the name going out
    # of scope here rather than living to the end of the request is the part
    # that is actually true.
    del ephemeral, box
    return envelope


def sealing_enabled() -> bool:
    """Whether the pipeline may write at all.

    Not a toggle between sealed and plaintext — there is no plaintext path. It
    is a toggle between writing and not writing, so that persistence can be
    switched on for a beta without redeploying, and switched off instantly if
    something downstream is wrong.
    """
    return os.environ.get("PERSIST_TRANSACTIONS", "").lower() == "true"
