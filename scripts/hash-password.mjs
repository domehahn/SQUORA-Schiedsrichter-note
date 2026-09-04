import { pbkdf2, randomBytes } from "node:crypto";

// Must match cloudflare/auth/password.ts: the Workers runtime caps a single
// PBKDF2 call at 100 000 iterations, so the work factor comes from chaining.
const ROUND_ITERATIONS = 100_000;
const ROUNDS = 6;
const MIN_PASSWORD_LENGTH = 12;

const pbkdf2Async = (material, salt) => new Promise((resolve, reject) => {
  pbkdf2(material, salt, ROUND_ITERATIONS, 32, "sha256", (error, derived) => (error ? reject(error) : resolve(derived)));
});

async function deriveChained(password, salt) {
  let material = Buffer.from(password, "utf8");
  for (let round = 0; round < ROUNDS; round += 1) material = await pbkdf2Async(material, salt);
  return material;
}

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
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Abgebrochen"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f") {
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
if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
  throw new Error(`Passwort muss zwischen ${MIN_PASSWORD_LENGTH} und 200 Zeichen lang sein`);
}
const salt = randomBytes(16);
const hash = await deriveChained(password, salt);
process.stdout.write(`pbkdf2-sha256$${ROUND_ITERATIONS}*${ROUNDS}$${salt.toString("hex")}$${hash.toString("hex")}`);
