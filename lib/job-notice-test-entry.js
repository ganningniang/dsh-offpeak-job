// src/job-notice.ts
function isJobCompletionNotice(message) {
  const source = message?.source;
  if (source === null || typeof source !== "object") return false;
  const tagged = source;
  return tagged.kind === "plugin" && tagged.plugin === "tool-jobs" && tagged.form === "notice";
}
export {
  isJobCompletionNotice
};
