import { pbkdf2, randomBytes } from "node:crypto";

const ITERATIONS = 600_000;
const MIN_PASSWORD_LENGTH = 12;

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
const hash = await new Promise((resolve, reject) => {
  pbkdf2(password, salt, ITERATIONS, 32, "sha256", (error, derived) => error ? reject(error) : resolve(derived));
});
process.stdout.write(`pbkdf2-sha256$${ITERATIONS}$${salt.toString("hex")}$${hash.toString("hex")}`);
