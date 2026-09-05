/**
 * The application is mounted at squora.de/schiedsrichter-note/. Every incoming
 * path is normalised by stripping this prefix (see worker.ts's relativePath),
 * and every outgoing URL the Worker emits (login page assets, form actions,
 * redirects, links in emails) is prefixed with it. Shared here (rather than
 * only living in worker.ts) so anything that needs to build an absolute
 * app URL — e.g. the password-reset email — doesn't duplicate the constant.
 */
export const MOUNT_PATH = "/schiedsrichter-note";
