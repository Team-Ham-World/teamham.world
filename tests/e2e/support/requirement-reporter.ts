/**
 * Startup reporter for named external-service requirements.
 *
 * The default list reporter shows a bare "skipped" marker, so this reporter
 * prints, once per run, exactly which named requirements are absent and how
 * to provide them. It never fails the run; individual tests still skip with
 * the same named reasons.
 */

import type { Reporter } from "@playwright/test/reporter";

import {
  describeRequirements,
  probeStorage,
  resolveStorageUrl,
} from "./environment";

export default class RequirementReporter implements Reporter {
  #storageNotice: string | null = null;

  constructor() {
    const storageURL = resolveStorageUrl();
    void probeStorage(storageURL).then((up) => {
      if (!up) {
        this.#storageNotice =
          "local MinIO object storage at " +
          `${storageURL} is not answering; the asset upload test will skip ` +
          "(start it with npm run storage:local, or npm run dev:vps)";
      }
    });
  }

  onBegin(): void {
    const { missing } = describeRequirements();
    const lines: string[] = [];
    if (missing.length > 0) {
      lines.push("Database-backed tests will skip until these are available:");
      for (const requirement of missing) lines.push(`  - ${requirement}`);
    }
    if (this.#storageNotice) lines.push(`  - ${this.#storageNotice}`);
    if (lines.length > 0) {
      console.log(`\n[e2e requirements]\n${lines.join("\n")}\n`);
    }
  }

  onEnd(): void {
    // The storage probe may finish after onBegin; give it a second chance so
    // the notice still appears for short runs.
    if (this.#storageNotice && describeRequirements().missing.length > 0) {
      console.log(`\n[e2e requirements]\n  - ${this.#storageNotice}\n`);
    }
  }
}
