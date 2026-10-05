/** Private local ledger persistence. No database access. */
import {
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  readFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export class LedgerPersistenceError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LedgerPersistenceError";
  }
}

/** Directory fsync is best-effort (often EPERM on Windows/OneDrive). File data fsync is mandatory. */
function fsyncDirectoryBestEffort(dirFd) {
  try {
    fsyncSync(dirFd);
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EINVAL" || error?.code === "ENOTSUP") return;
    throw error;
  }
}

function fsyncFileStrict(fd) {
  try {
    fsyncSync(fd);
  } catch (error) {
    throw new LedgerPersistenceError(
      `Ledger file fsync failed (${error?.code ?? "unknown"}); choose TRANSFER_EXPORT_DIR on a local non-synced filesystem (e.g. WSL ext4) before import`,
      { cause: error },
    );
  }
}

export function writeJsonDurable(path, value) {
  const payload = JSON.stringify(value, null, 2);
  const temp = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, payload, "utf8");
    fsyncFileStrict(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    try {
      chmodSync(path, 0o600);
    } catch {
      // Best-effort: some Windows/OneDrive locations ignore Unix mode bits.
    }
    const readBack = readFileSync(path, "utf8");
    if (readBack !== payload) {
      throw new LedgerPersistenceError(
        "Ledger read-back verification failed after write; mutations must not proceed",
      );
    }
    const dirFd = openSync(dirname(path), "r");
    try {
      fsyncDirectoryBestEffort(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function acquireRunLock(path) {
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const lock = JSON.parse(readFileSync(path, "utf8"));
    if (lock.host !== hostname() || !Number.isInteger(lock.pid) || lock.pid < 1) {
      throw new Error("Run lock cannot be verified; preserve it for operator reconciliation");
    }
    try {
      process.kill(lock.pid, 0);
    } catch (pidError) {
      if (pidError.code !== "ESRCH") throw pidError;
      throw new Error(
        "Stale run lock: confirm no transfer process is running, remove only this lock, then retry the SAME run ID",
      );
    }
    throw new Error("Transfer run is already locked by a live process");
  }
  const token = randomUUID();
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), token }));
    fsyncFileStrict(fd);
  } finally {
    closeSync(fd);
  }
  return () => {
    if (JSON.parse(readFileSync(path, "utf8")).token !== token) {
      throw new Error("Run lock ownership changed; refusing to remove lock");
    }
    unlinkSync(path);
  };
}
