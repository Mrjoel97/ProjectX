export const ONBOARDING_FOLDER_FILE_CAP = 200;
export const ONBOARDING_FOLDER_INTAKE_CHAR_CAP = 120_000;

export type OnboardingFolderFile = {
  name: string;
  type: string;
  size: number;
  webkitRelativePath?: string;
  text: () => Promise<string>;
};

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(MIME_BY_EXTENSION));
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv"]);
const SKIPPED_PATH_SEGMENTS = new Set(["validation-private", ".git", "node_modules", "__macosx"]);

const PRIORITY_TERMS = [
  "business-overview",
  "company-overview",
  "company-profile",
  "one-page-strategy",
  "founder-profile",
  "mission-vision-values",
  "goals-and-scorecard",
  "ideal-customer-profile",
  "product-overview",
  "service-catalogue",
  "pricing",
  "document-index",
] as const;

function extension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function onboardingFolderMimeType(file: Pick<OnboardingFolderFile, "name" | "type">) {
  return file.type || MIME_BY_EXTENSION[extension(file.name)] || "application/octet-stream";
}

export function onboardingFolderDisplayPath(
  file: Pick<OnboardingFolderFile, "name" | "webkitRelativePath">,
) {
  const segments = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
  return segments.length > 1 ? segments.slice(1).join("/") : file.name;
}

function isPrivateOrGenerated(file: Pick<OnboardingFolderFile, "name" | "webkitRelativePath">) {
  const segments = (file.webkitRelativePath || file.name)
    .split("/")
    .map((segment) => segment.toLowerCase());
  return segments.some((segment) => SKIPPED_PATH_SEGMENTS.has(segment));
}

function priority(file: Pick<OnboardingFolderFile, "name" | "webkitRelativePath">) {
  const path = onboardingFolderDisplayPath(file).toLowerCase();
  const found = PRIORITY_TERMS.findIndex((term) => path.includes(term));
  return found === -1 ? PRIORITY_TERMS.length : found;
}

export function selectOnboardingFolderFiles<T extends OnboardingFolderFile>(files: readonly T[]) {
  const supported = files
    .filter((file) => !isPrivateOrGenerated(file) && SUPPORTED_EXTENSIONS.has(extension(file.name)))
    .sort((a, b) => priority(a) - priority(b));
  return {
    files: supported.slice(0, ONBOARDING_FOLDER_FILE_CAP),
    ignoredCount: files.length - Math.min(supported.length, ONBOARDING_FOLDER_FILE_CAP),
  };
}

export function isOnboardingTextFile(file: Pick<OnboardingFolderFile, "name" | "type">) {
  return file.type.startsWith("text/") || TEXT_EXTENSIONS.has(extension(file.name));
}

export async function buildOnboardingFolderIntake(files: readonly OnboardingFolderFile[]) {
  let intake = "";
  for (const file of files) {
    if (!isOnboardingTextFile(file)) continue;
    let contents: string;
    try {
      contents = (await file.text()).trim();
    } catch {
      continue;
    }
    if (!contents) continue;
    const segment = `\n\n--- ${onboardingFolderDisplayPath(file)} ---\n${contents}`;
    const remaining = ONBOARDING_FOLDER_INTAKE_CHAR_CAP - intake.length;
    if (remaining <= 0) break;
    intake += segment.slice(0, remaining);
  }
  return intake.trim();
}
