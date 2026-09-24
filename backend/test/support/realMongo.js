// A real, throwaway MongoDB for tests that must prove AGGREGATION behaviour
// (the in-memory stubs in memoryDb.js cannot run a pipeline). It starts a
// private `mongod` on a random localhost port with a temp data directory, and
// removes both afterwards. It never connects to any configured database.
//
// If no `mongod` binary can be found the tests that need it are SKIPPED with a
// clear reason rather than failed. Point MONGOD_PATH at a binary to use one
// that is not on PATH / in a default install location.
//
// Not a test file itself (no .test.js suffix) — `npm test` never runs it.

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function findMongod() {
  if (process.env.MONGOD_PATH) {
    return fs.existsSync(process.env.MONGOD_PATH) ? process.env.MONGOD_PATH : null;
  }

  const onPath = spawnSync(process.platform === "win32" ? "where" : "which", ["mongod"], { encoding: "utf8" });
  if (onPath.status === 0) {
    const found = firstExisting(onPath.stdout.split(/\r?\n/).map((line) => line.trim()));
    if (found) return found;
  }

  const candidates = [];
  if (process.platform === "win32") {
    const root = "C:/Program Files/MongoDB/Server";
    if (fs.existsSync(root)) {
      for (const version of fs.readdirSync(root).sort().reverse()) {
        candidates.push(path.join(root, version, "bin", "mongod.exe"));
      }
    }
  } else {
    candidates.push("/usr/bin/mongod", "/usr/local/bin/mongod", "/opt/homebrew/bin/mongod");
  }
  return firstExisting(candidates);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const MONGOD_BINARY = findMongod();
const MONGOD_SKIP_REASON = MONGOD_BINARY ? false : "no mongod binary found (set MONGOD_PATH to run the aggregation tests)";

// Resolves to { uri, stop() }.
async function startRealMongo() {
  if (!MONGOD_BINARY) throw new Error(MONGOD_SKIP_REASON);

  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "alshayeb-test-mongo-"));
  const port = await freePort();
  const child = spawn(
    MONGOD_BINARY,
    ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
  );

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const uri = `mongodb://127.0.0.1:${port}/alshayeb_test`;

  // Ready once a client can connect and ping.
  const { MongoClient } = require("mongodb");
  const deadline = Date.now() + 30000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`mongod exited early: ${stderr}`);
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 500 });
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      await client.close().catch(() => {});
    }
  }
  if (!ready) {
    child.kill();
    throw new Error(`mongod did not become ready in time: ${stderr}`);
  }

  async function stop() {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill();
      });
    }
    // The data files can be briefly locked on Windows right after exit.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(dbPath, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  return { uri, stop };
}

module.exports = { MONGOD_SKIP_REASON, startRealMongo };
