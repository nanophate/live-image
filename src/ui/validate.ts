import { requireElement } from "./shared.js";
import {
  isSafeValidationArtifactPath,
  type ValidationArtifactKind,
} from "../validation-report.js";

type ValidationResult = "full" | "limited" | "reject" | "error";
type ExpectedResult = ValidationResult | string;
type DetailRecord = Record<string, unknown>;

interface ValidationArtifacts {
  limg?: string;
  overlay?: string;
  diagnostic?: string;
}

interface ValidationCase {
  id: string;
  category: string;
  source: string;
  expected: ExpectedResult;
  result: ValidationResult;
  quality?: DetailRecord;
  capabilities?: DetailRecord;
  artifacts?: ValidationArtifacts;
  message?: string;
}

interface ValidationSummary {
  total: number;
  full: number;
  limited: number;
  reject: number;
  error: number;
}

interface ValidationReport {
  version: 1;
  generatedAt: string;
  summary: ValidationSummary;
  cases: ValidationCase[];
}

const SAMPLE_REPORT_URL = "/fixtures/validation/report.json";
const RESULTS: ValidationResult[] = ["full", "limited", "reject", "error"];

const fileInput = requireElement<HTMLInputElement>("report-file");
const sampleButton = requireElement<HTMLButtonElement>("load-sample");
const notice = requireElement<HTMLParagraphElement>("report-notice");
const metadata = requireElement<HTMLParagraphElement>("report-meta");
const summaryGrid = requireElement<HTMLElement>("summary-grid");
const toolbar = requireElement<HTMLElement>("report-toolbar");
const filter = requireElement<HTMLSelectElement>("result-filter");
const visibleCount = requireElement<HTMLOutputElement>("visible-count");
const caseList = requireElement<HTMLElement>("case-list");

let activeReport: ValidationReport | undefined;
let artifactBase = new URL("/", window.location.href);

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  void loadLocalFile(file);
});

sampleButton.addEventListener("click", () => void loadSample());
filter.addEventListener("change", renderCases);

async function loadLocalFile(file: File): Promise<void> {
  setLoading(`Reading ${file.name}…`);
  try {
    const report = parseReport(JSON.parse(await file.text()));
    artifactBase = new URL("/", window.location.href);
    showReport(report, file.name);
  } catch (error) {
    showError(error);
  }
}

async function loadSample(): Promise<void> {
  setLoading("Loading sample report…");
  sampleButton.disabled = true;
  try {
    const response = await fetch(SAMPLE_REPORT_URL);
    if (!response.ok) throw new Error(`Sample report is unavailable (${response.status}).`);
    const report = parseReport(await response.json());
    artifactBase = new URL(SAMPLE_REPORT_URL, window.location.href);
    showReport(report, "sample report");
  } catch (error) {
    showError(error);
  } finally {
    sampleButton.disabled = false;
  }
}

function setLoading(message: string): void {
  notice.className = "report-notice";
  notice.textContent = message;
}

function showError(error: unknown): void {
  notice.className = "report-notice report-notice-error";
  notice.textContent = error instanceof Error ? error.message : "Could not load the report.";
}

function showReport(report: ValidationReport, label: string): void {
  activeReport = report;
  filter.value = "all";
  const generated = formatDate(report.generatedAt);
  metadata.textContent = `${label} · version ${report.version} · generated ${generated}`;
  notice.className = "report-notice";
  notice.textContent = `${report.cases.length} validation cases loaded.`;
  renderSummary(report.summary);
  toolbar.hidden = false;
  renderCases();
}

function renderSummary(summary: ValidationSummary): void {
  summaryGrid.replaceChildren();
  const items: Array<[string, number, string]> = [
    ["Total", summary.total, "total"],
    ["Full", summary.full, "full"],
    ["Limited", summary.limited, "limited"],
    ["Rejected", summary.reject, "reject"],
    ["Errors", summary.error, "error"],
  ];
  for (const [label, value, tone] of items) {
    const card = document.createElement("div");
    card.className = `summary-card result-${tone}`;
    const count = document.createElement("strong");
    count.textContent = String(value);
    const name = document.createElement("span");
    name.textContent = label;
    card.append(count, name);
    summaryGrid.append(card);
  }
  summaryGrid.hidden = false;
}

function renderCases(): void {
  if (!activeReport) return;
  const selected = filter.value;
  const cases = activeReport.cases.filter((item) => selected === "all"
    || (selected === "mismatch" ? isMismatch(item) : item.result === selected));

  visibleCount.textContent = `${cases.length} of ${activeReport.cases.length}`;
  caseList.replaceChildren(...cases.map(renderCase));
  if (!cases.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state muted";
    empty.textContent = "No cases match this filter.";
    caseList.append(empty);
  }
}

function renderCase(item: ValidationCase): HTMLElement {
  const article = document.createElement("article");
  article.className = `validation-case result-${item.result}${isMismatch(item) ? " has-mismatch" : ""}`;

  const heading = document.createElement("header");
  heading.className = "case-heading";
  const identity = document.createElement("div");
  const category = document.createElement("p");
  category.className = "case-category";
  category.textContent = item.category;
  const title = document.createElement("h2");
  title.textContent = item.id;
  const source = document.createElement("p");
  source.className = "case-source";
  source.textContent = item.source;
  identity.append(category, title, source);

  const outcome = document.createElement("div");
  outcome.className = "case-outcome";
  const badge = document.createElement("span");
  badge.className = `result-badge result-${item.result}`;
  badge.textContent = item.result;
  outcome.append(badge);
  if (isMismatch(item)) {
    const mismatch = document.createElement("strong");
    mismatch.className = "mismatch-label";
    mismatch.textContent = `Expected ${item.expected}`;
    outcome.append(mismatch);
  }
  heading.append(identity, outcome);
  article.append(heading);

  if (item.message) {
    const message = document.createElement("p");
    message.className = "case-message";
    message.textContent = item.message;
    article.append(message);
  }

  const details = document.createElement("div");
  details.className = "case-details";
  if (item.quality) details.append(renderRecord("Quality", item.quality));
  if (item.capabilities) details.append(renderRecord("Capabilities", item.capabilities));
  article.append(details);

  if (item.artifacts) article.append(renderArtifacts(item.artifacts, item.id));
  return article;
}

function renderRecord(title: string, values: DetailRecord): HTMLElement {
  const section = document.createElement("section");
  section.className = "case-detail-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("dl");
  list.className = "case-metrics";
  for (const [key, value] of Object.entries(values)) {
    if (key === "metrics" && isRecord(value)) {
      for (const [metric, metricValue] of Object.entries(value)) {
        appendDetail(list, metric, metricValue);
      }
    } else {
      appendDetail(list, key, value);
    }
  }
  section.append(heading, list);
  return section;
}

function appendDetail(list: HTMLDListElement, key: string, value: unknown): void {
  const term = document.createElement("dt");
  term.textContent = humanize(key);
  const description = document.createElement("dd");
  description.textContent = formatValue(value);
  list.append(term, description);
}

function renderArtifacts(artifacts: ValidationArtifacts, caseId: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "artifact-section";
  const heading = document.createElement("h3");
  heading.textContent = "Artifacts";
  const grid = document.createElement("div");
  grid.className = "artifact-grid";

  for (const kind of ["limg", "overlay", "diagnostic"] as const) {
    const path = artifacts[kind];
    if (!path) continue;
    const url = resolveArtifact(path);
    if (!url) continue;
    const item = document.createElement("div");
    item.className = "artifact-item";
    const link = document.createElement("a");
    link.href = url;
    link.textContent = `${humanize(kind)} ↗`;
    link.target = "_blank";
    link.rel = "noreferrer";
    if (kind === "overlay") {
      const image = document.createElement("img");
      image.src = url;
      image.alt = `${caseId} ${kind}`;
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove());
      item.append(image);
    }
    item.append(link);
    grid.append(item);
  }
  section.append(heading, grid);
  return section;
}

function resolveArtifact(path: string): string | undefined {
  try {
    const url = new URL(path, artifactBase);
    if ((url.protocol !== "http:" && url.protocol !== "https:")
      || url.origin !== window.location.origin) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function isMismatch(item: ValidationCase): boolean {
  return item.expected !== item.result;
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (value === null) return "—";
  return JSON.stringify(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function parseReport(value: unknown): ValidationReport {
  if (!isRecord(value) || value.version !== 1 || typeof value.generatedAt !== "string") {
    throw new Error("Unsupported validation report: expected version 1.");
  }
  if (!isSummary(value.summary) || !Array.isArray(value.cases)) {
    throw new Error("Invalid validation report: summary or cases are missing.");
  }
  const cases = value.cases.map(parseCase);
  return { version: 1, generatedAt: value.generatedAt, summary: value.summary, cases };
}

function parseCase(value: unknown, index: number): ValidationCase {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.category !== "string"
    || typeof value.source !== "string"
    || typeof value.expected !== "string"
    || !isResult(value.result)) {
    throw new Error(`Invalid validation case at index ${index}.`);
  }
  if (value.quality !== undefined && !isRecord(value.quality)) throw new Error(`Invalid quality data for ${value.id}.`);
  if (value.capabilities !== undefined && !isRecord(value.capabilities)) throw new Error(`Invalid capabilities for ${value.id}.`);
  const artifacts = parseArtifacts(value.artifacts, value.id);
  if (value.message !== undefined && typeof value.message !== "string") throw new Error(`Invalid message for ${value.id}.`);
  return {
    id: value.id,
    category: value.category,
    source: value.source,
    expected: value.expected,
    result: value.result,
    quality: value.quality,
    capabilities: value.capabilities,
    artifacts,
    message: value.message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResult(value: unknown): value is ValidationResult {
  return typeof value === "string" && RESULTS.includes(value as ValidationResult);
}

function isSummary(value: unknown): value is ValidationSummary {
  return isRecord(value) && ["total", ...RESULTS].every((key) => typeof value[key] === "number");
}

function parseArtifacts(value: unknown, caseId: string): ValidationArtifacts | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Invalid artifacts for ${caseId}.`);
  const allowed: ValidationArtifactKind[] = ["limg", "overlay", "diagnostic"];
  if (Object.keys(value).some((key) => !allowed.includes(key as ValidationArtifactKind))) {
    throw new Error(`Invalid artifacts for ${caseId}.`);
  }
  const artifacts: ValidationArtifacts = {};
  for (const kind of allowed) {
    const path = value[kind];
    if (path === undefined) continue;
    if (typeof path !== "string" || !isSafeValidationArtifactPath(kind, path, caseId)) {
      throw new Error(`Unsafe ${kind} artifact path for ${caseId}.`);
    }
    artifacts[kind] = path;
  }
  return artifacts;
}
