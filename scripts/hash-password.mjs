import { pbkdf2, randomBytes } from "node:crypto";

// Emits the currently preferred hash format for cloudflare/auth/password.ts:
//   pbkdf2-sha256$i=<iterations>$<saltHex>$<hashHex>
// Single-call PBKDF2-HMAC-SHA256. Node has no per-call iteration cap; the
// Workers runtime verifies this format via node:crypto (nodejs_compat).
const ITERATIONS = 600_000;
const KEY_BYTES = 32;
const MIN_PASSWORD_LENGTH = 12;

const pbkdf2Async = (password, salt) => new Promise((resolve, reject) => {
  pbkdf2(password, salt, ITERATIONS, KEY_BYTES, "sha256", (error, derived) => (error ? reject(error) : resolve(derived)));
});

function readHiddenPassword() {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { value += chunk; });
      process.stdin.on("end", () => resolve(value.replace(/[\r\n]+$/u, "")));
    });
  }

  return new Promise((resolve, reject) => {
    let value = "";
    process.stderr.write("Passwort: ");
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.off("data", handleInput);
      process.stdin.pause();
      process.stderr.write("\n");
    };
    const finish = () => {
      cleanup();
      resolve(value);
    };
    const handleInput = (chunk) => {
      for (const character of chunk) {
        const code = character.charCodeAt(0);
        if (code === 3) { // Ctrl-C
          cleanup();
          reject(new Error("Abgebrochen"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (code === 8 || code === 127) { // Backspace / DEL
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    process.stdin.on("data", handleInput);
  });
}

const password = await readHiddenPassword();
if (password.length < MIN_PASSWORD_LENGTH || password.length > 1024) {
  throw new Error(`Passwort muss zwischen ${MIN_PASSWORD_LENGTH} und 1024 Zeichen lang sein`);
}
const salt = randomBytes(16);
const hash = await pbkdf2Async(Buffer.from(password, "utf8"), salt);
process.stdout.write(`pbkdf2-sha256$i=${ITERATIONS}$${salt.toString("hex")}$${hash.toString("hex")}`);
