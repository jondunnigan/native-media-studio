export const CONTAINER_BIND_HOST = "0.0.0.0";

export function getAssignedPort(portValue: string | undefined): number {
  const port = Number.parseInt(portValue ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port between 1 and 65535.");
  }
  return port;
}
