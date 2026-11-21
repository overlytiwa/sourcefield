// Private filesystem IPC between the desktop and stdio processes. No listener,
// network port, public URL, or platform-specific socket dependency is needed.
import {
  promises as fs,
  mkdirSync,
  chmodSync,
  writeFileSync,
  renameSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { toolSchemas, type ToolName } from "./contracts";

export const descriptorPath = () =>
  process.env.SOURCEFIELD_MCP_BRIDGE ??
  path.join(os.homedir(), ".sourcefield", "mcp-bridge.json");
interface Descriptor {
  version: 1;
  directory: string;
  token: string;
  pid: number;
}
const MAX_REQUEST = 65536,
  MAX_RESPONSE = 600000;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function startLocalBridge(
  execute: (name: ToolName, args: unknown) => Promise<unknown>,
  descriptorFile = descriptorPath(),
) {
  const token = randomBytes(32).toString("hex"),
    parent = path.dirname(descriptorFile);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(parent, 0o700);
  const directory = path.join(parent, `mcp-session-${token.slice(0, 16)}`);
  mkdirSync(directory, { mode: 0o700 });
  const descriptor: Descriptor = {
    version: 1,
    directory,
    token,
    pid: process.pid,
  };
  const temp = `${descriptorFile}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(descriptor), { mode: 0o600 });
    renameSync(temp, descriptorFile);
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
  let closed = false,
    polling = false;
  const active = new Map<string, Promise<void>>();
  async function processRequest(name: string) {
    const id = name.slice(0, -".request.json".length),
      inputFile = path.join(directory, name);
    const outputFile = path.join(directory, `${id}.response.json`),
      temporary = `${outputFile}.tmp`;
    let response: string;
    try {
      const stat = await fs.lstat(inputFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_REQUEST)
        throw new Error("Invalid local message.");
      const bytes = await fs.readFile(inputFile);
      if (bytes.length > MAX_REQUEST)
        throw new Error("Local request is too large.");
      const request = JSON.parse(bytes.toString("utf8"));
      if (
        request.id !== id ||
        !Number.isFinite(request.created) ||
        Date.now() - request.created > 20000
      )
        throw new Error("Expired or invalid local request.");
      if (
        typeof request.token !== "string" ||
        request.token.length !== token.length ||
        !timingSafeEqual(Buffer.from(request.token), Buffer.from(token))
      )
        throw new Error("Unauthorized local connection.");
      if (
        typeof request.tool !== "string" ||
        !Object.hasOwn(toolSchemas, request.tool)
      )
        throw new Error("Unknown Sourcefield tool.");
      const result = await execute(
        request.tool as ToolName,
        request.arguments ?? {},
      );
      response = JSON.stringify({ ok: true, result });
      if (Buffer.byteLength(response) > MAX_RESPONSE)
        throw new Error("Narrow the request to reduce the response size.");
    } catch (error) {
      response = JSON.stringify({
        ok: false,
        error:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Tool request failed.",
      });
    }
    try {
      if (!closed) {
        await fs.writeFile(temporary, response, { mode: 0o600 });
        await fs.rename(temporary, outputFile);
      }
    } finally {
      await fs.rm(inputFile, { force: true }).catch(() => {});
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
  async function poll() {
    if (closed || polling) return;
    polling = true;
    try {
      const names = await fs.readdir(directory);
      for (const name of names) {
        if (
          /^[0-9a-f-]{36}\.request\.json$/.test(name) &&
          !active.has(name) &&
          active.size < 16
        ) {
          const task = processRequest(name)
            .catch(() => {})
            .finally(() => active.delete(name));
          active.set(name, task);
        } else if (/^[0-9a-f-]{36}\.response\.json(?:\.tmp)?$/.test(name)) {
          const file = path.join(directory, name),
            stat = await fs.lstat(file).catch(() => null);
          if (stat && Date.now() - stat.mtimeMs > 60000)
            await fs.rm(file, { force: true });
        }
      }
    } catch {
      /* Closing or temporarily unavailable settings directory. */
    } finally {
      polling = false;
    }
  }
  const timer = setInterval(() => {
    void poll();
  }, 100);
  return {
    closeSync() {
      closed = true;
      clearInterval(timer);
      try {
        const current = JSON.parse(readFileSync(descriptorFile, "utf8"));
        if (current.token === token) rmSync(descriptorFile, { force: true });
      } catch {
        /* already removed */
      }
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        /* OS will release open handles on exit. */
      }
    },
    async close() {
      closed = true;
      clearInterval(timer);
      await Promise.allSettled([...active.values()]);
      try {
        const current = JSON.parse(await fs.readFile(descriptorFile, "utf8"));
        if (current.token === token)
          await fs.rm(descriptorFile, { force: true });
      } catch {
        /* already removed */
      }
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

export async function callLocalBridge(
  tool: ToolName,
  args: unknown,
  descriptorFile = descriptorPath(),
): Promise<Record<string, unknown>> {
  let descriptor: Descriptor;
  try {
    if ((await fs.stat(descriptorFile)).size > 16384)
      throw new Error("Invalid descriptor.");
    descriptor = JSON.parse(await fs.readFile(descriptorFile, "utf8"));
    if (
      descriptor.version !== 1 ||
      typeof descriptor.directory !== "string" ||
      !path.isAbsolute(descriptor.directory) ||
      !/^mcp-session-[0-9a-f]{16}$/.test(path.basename(descriptor.directory)) ||
      !/^[0-9a-f]{64}$/.test(descriptor.token)
    )
      throw new Error("Invalid descriptor.");
    const directory = await fs.lstat(descriptor.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error("Invalid bridge directory.");
  } catch {
    throw new Error(
      "Open Sourcefield desktop and choose a project or saved map before using its tools.",
    );
  }
  const id = randomUUID(),
    request = path.join(descriptor.directory, `${id}.request.json`),
    response = path.join(descriptor.directory, `${id}.response.json`),
    temporary = `${request}.tmp`;
  const message = JSON.stringify({
    id,
    token: descriptor.token,
    created: Date.now(),
    tool,
    arguments: args,
  });
  if (Buffer.byteLength(message) > MAX_REQUEST)
    throw new Error("Narrow the request to reduce its size.");
  try {
    await fs.writeFile(temporary, message, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, request);
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      let stat;
      try {
        stat = await fs.lstat(response);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RESPONSE)
          throw new Error("Invalid Sourcefield response.");
        const reply = JSON.parse(await fs.readFile(response, "utf8"));
        if (!reply.ok) throw new Error(reply.error ?? "Tool failed.");
        return reply.result;
      }
      if (!(await fs.stat(descriptor.directory).catch(() => null)))
        throw new Error("Sourcefield desktop closed. Open it and try again.");
      await pause(70);
    }
    throw new Error(
      "Sourcefield did not respond. Check that its desktop window is ready.",
    );
  } finally {
    await Promise.all(
      [request, response, temporary].map((file) =>
        fs.rm(file, { force: true }).catch(() => {}),
      ),
    );
  }
}
