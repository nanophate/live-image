export type ValidationArtifactKind = "limg" | "overlay" | "diagnostic";

const SAFE_CASE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UNSAFE_SEGMENT = /[\\/?#%\u0000-\u001f\u007f]/u;

export function isSafeValidationArtifactPath(
  kind: ValidationArtifactKind,
  path: string,
  caseId: string,
): boolean {
  if (!SAFE_CASE_ID.test(caseId) || path.length > 512) return false;
  const segments = path.split("/");
  if (segments.length !== 3 || segments[1] !== caseId) return false;
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || UNSAFE_SEGMENT.test(segment))) {
    return false;
  }

  const root = segments[0]!;
  const filename = segments[2]!;
  if (kind === "overlay") return root === "overlays" && filename.endsWith(".png");
  if (root !== "artifacts") return false;
  return kind === "limg"
    ? filename.endsWith(".limg")
    : filename.endsWith(".diagnostic.json");
}
