/**
 * The signing key behind every session token.
 *
 * Both the signer and the verifier used to fall back to a literal default when
 * JWT_SECRET was unset:
 *
 *     jwt.sign({ id }, process.env.JWT_SECRET || "default_jwt_secret_key_12345")
 *
 * That default is committed to this repository. Any deployment that lost the
 * variable would keep working, quietly accepting tokens minted by anyone who
 * has read the source — and since `protect` resolves whatever `id` the token
 * carries, a forged one can name the Admin account. It would defeat the guard
 * on every route at once, silently, with nothing in the logs.
 *
 * So there is no fallback. A missing secret is fatal at boot rather than an
 * open door that looks healthy.
 */

/** Short enough to brute-force offline is not a secret. */
const MIN_LENGTH = 32;

/** The known default from before this file existed; refused outright. */
const RETIRED_DEFAULT = "default_jwt_secret_key_12345";

/**
 * The secret, or a thrown error. Called per sign and per verify so a secret
 * rotated in the environment is picked up without a code change.
 */
export const jwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret || !secret.trim()) {
    throw new Error(
      "JWT_SECRET is not set. Refusing to sign or verify tokens with a built-in key."
    );
  }
  if (secret === RETIRED_DEFAULT) {
    throw new Error(
      "JWT_SECRET is still the old built-in default, which is public. Set a new one."
    );
  }

  return secret;
};

/**
 * Boot-time check, so a misconfigured deployment fails on startup rather than
 * on the first login. Length is a warning rather than fatal: an install that is
 * already running on a short secret should not be knocked over by a deploy.
 */
export const assertJwtSecret = () => {
  const secret = jwtSecret();

  if (secret.length < MIN_LENGTH) {
    console.warn(
      `JWT_SECRET is ${secret.length} characters; ${MIN_LENGTH}+ is recommended. ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
};
