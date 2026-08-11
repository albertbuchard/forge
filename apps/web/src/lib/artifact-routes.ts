export const ARTIFACT_HUMAN_DOWNLOAD_ANCHOR = "artifact-human-download";

export function getArtifactHumanDownloadRoute(artifactId: string) {
  return `/artifacts/${encodeURIComponent(artifactId)}#${ARTIFACT_HUMAN_DOWNLOAD_ANCHOR}`;
}
