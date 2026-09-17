type Value = Record<string, any>;

const ACTIVE = new Set(["queued", "running"]);
const TERMINAL = new Set(["succeeded", "failed", "interrupted", "cancelled"]);

export type ImportAnalysisCompletion = {
  id: string;
  status: string;
  productionId: string;
  importId: string;
  filename: string;
};

export function importAnalysisCompletions(previous: Map<string, string>, jobs: Value[]) {
  const completed: ImportAnalysisCompletion[] = [];
  for (const job of jobs) {
    const marker = job.input?.script_import_analysis;
    if (!marker?.productionId || !marker?.importId) continue;
    const before = previous.get(job.id);
    previous.set(job.id, job.status);
    if (before && ACTIVE.has(before) && TERMINAL.has(job.status)) {
      completed.push({
        id: job.id,
        status: job.status,
        productionId: marker.productionId,
        importId: marker.importId,
        filename: marker.filename || "导入文档",
      });
    }
  }
  if (previous.size > 500) {
    const visible = new Set(jobs.map((job) => job.id));
    for (const id of previous.keys()) if (!visible.has(id)) previous.delete(id);
  }
  return completed;
}

export async function requestImportNotificationPermission() {
  try {
    if (typeof Notification === "undefined") return "unsupported" as const;
    if (Notification.permission === "default") return await Notification.requestPermission();
    return Notification.permission;
  } catch {
    return "unsupported" as const;
  }
}

export function showImportDesktopNotification(
  completion: {id: string;title: string;body: string},
  onOpen: () => void,
) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    const notification = new Notification(completion.title, {
      body: completion.body,
      tag: `anying-import-${completion.id}`,
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
      onOpen();
    };
    return true;
  } catch {
    return false;
  }
}

export function importResultStage(productionId: string, importId: string, storage?: Pick<Storage, "getItem">) {
  const source = storage || (typeof localStorage === "undefined" ? undefined : localStorage);
  if (!source) return "source" as const;
  for (const mode of ["source", "script"] as const) {
    try {
      const record = JSON.parse(source.getItem(`anying-import:${productionId}:${mode}`) || "null");
      if (record?.id === importId) return mode;
    } catch {}
  }
  return "source" as const;
}
