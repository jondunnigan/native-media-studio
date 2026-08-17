export function isGuidedSourceAvailabilityMessage(message: string): boolean {
  return message.includes("YouTube rejected this server’s automated request");
}
