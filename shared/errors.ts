export class UserError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

/** Keep commands, paths, stack traces and transport details out of the UI. */
export function userMessage(
  error: unknown,
  fallback = "Sourcefield couldn’t complete that action. Try again.",
): string {
  const value = error as {
    message?: unknown;
    code?: unknown;
    stderr?: unknown;
  } | null;
  const raw =
    typeof value?.message === "string"
      ? value.message
      : typeof error === "string"
        ? error
        : "";
  const details =
    raw + "\n" + (typeof value?.stderr === "string" ? value.stderr : "");
  if (/not a git repository/i.test(details))
    return "This folder isn’t a Git repository. Open a project with Git history to review changes.";
  if (
    (value?.code === "ENOENT" && /\bgit\b/i.test(raw)) ||
    /git.*(?:not recognized|not found)|spawn git ENOENT/i.test(details)
  )
    return "Git isn’t available. Install Git, then restart Sourcefield to review changes.";
  if (
    value?.code === "EACCES" ||
    value?.code === "EPERM" ||
    /permission denied|access is denied|dubious ownership/i.test(details)
  )
    return "Sourcefield doesn’t have permission to access this project or file. Check its permissions, then try again.";
  if (value?.code === "ENOENT" || value?.code === "ENOTDIR")
    return "That file or folder is no longer available. Choose it again to continue.";
  if (value?.code === "ENOSPC")
    return "There isn’t enough free disk space. Free some space, then try again.";
  if (/timed? out|ETIMEDOUT/i.test(details))
    return "This is taking longer than expected. Try again, or open a smaller project.";
  if (
    /not (?:an? )?Sourcefield map|map header|invalid (?:project metadata|map layout|scan scope|feature entries|node in map|connection in map|diagnostic in map)|map (?:has a missing|contains a cyclic)|incorrect header check|unexpected end of (?:file|JSON)|bad control character|not valid JSON/i.test(
      details,
    )
  )
    return "This file couldn’t be opened as a Sourcefield map. Try exporting a new copy from the original project.";
  if (/invalid_type|invalid_union|ZodError|"issues"\s*:/i.test(details))
    return "Some of the information is missing or invalid. Check your entries and try again.";

  const message = raw
    .replace(
      /^(?:Error:\s*)?Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i,
      "",
    )
    .replace(/^(?:Error|UserError):\s*/i, "")
    .trim();
  if (
    !message ||
    message.length > 400 ||
    /[\r\n]|Command failed:|\bfatal:|\b(?:ENOENT|EACCES|EPERM|TypeError|ReferenceError|SyntaxError)\b|Cannot (?:read|set) properties|is not a function|^spawn |^Error |\bat \S+\(/i.test(
      message,
    )
  )
    return fallback;
  return message;
}
